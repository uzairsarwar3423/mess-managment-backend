import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/AppError';
import type { AuthContext } from '../../common/types';
import { env } from '../../config/env';
import { now } from '../../lib/clock';
import { getCloudinary } from '../../lib/cloudinary';
import { logger } from '../../lib/logger';
import { getPolicy, ownerFolder, type UploadPurpose } from './uploadPolicies';

const SIGNATURE_TTL_MS = 10 * 60 * 1000;

/**
 * Signed-upload parameters for a direct client -> Cloudinary upload. The server chooses every
 * parameter (path, preset, type, formats); changing any of them invalidates the signature.
 */
export function createSignature(auth: AuthContext, purpose: UploadPurpose) {
  const policy = getPolicy(purpose);
  const publicId = `${ownerFolder(policy, auth.userId)}/${randomUUID()}`;

  const params: Record<string, string> = {
    allowed_formats: policy.formats.join(','),
    overwrite: 'false',
    public_id: publicId,
    timestamp: String(Math.floor(now().getTime() / 1000)),
    type: policy.type,
    // With a preset its name is signed too; without one the signed values above are the whole rule set.
    ...(policy.preset ? { upload_preset: policy.preset } : {}),
  };
  const signature = getCloudinary().utils.api_sign_request(params, env.CLOUDINARY_API_SECRET);

  return {
    upload_url: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    // The client must send every entry exactly as given, plus `file`.
    fields: { api_key: env.CLOUDINARY_API_KEY, ...params, signature },
    max_bytes: policy.maxBytes,
    expires_at: new Date(now().getTime() + SIGNATURE_TTL_MS).toISOString(),
  };
}

export interface VerifiedAsset {
  publicId: string;
  secureUrl: string;
  etag: string | null;
  bytes: number;
  format: string;
  width: number;
  height: number;
}

interface CloudinaryResource {
  public_id: string;
  secure_url: string;
  etag?: string;
  bytes: number;
  format: string;
  width: number;
  height: number;
  type: string;
  created_at: string;
}

/**
 * The authoritative check of an uploaded image (docs/cloudinary-integration.md section 6): owner
 * prefix, delivery type, format, size, dimensions and freshness. Assets that violate format/size
 * rules are deleted immediately so they do not pile up as orphans.
 */
export async function verifyAsset(ownerId: string, purpose: UploadPurpose, publicId: string): Promise<VerifiedAsset> {
  const policy = getPolicy(purpose);
  const invalid = (message: string): AppError => new AppError('INVALID_UPLOAD', message);

  // Not the caller's folder: reject without touching (or deleting) someone else's asset.
  if (!publicId.startsWith(`${ownerFolder(policy, ownerId)}/`)) throw invalid('This image does not belong to you.');

  let resource: CloudinaryResource;
  try {
    resource = (await getCloudinary().api.resource(publicId, {
      resource_type: 'image',
      type: policy.type,
    })) as CloudinaryResource;
  } catch (err) {
    const httpCode = (err as { error?: { http_code?: number }; http_code?: number })?.error?.http_code
      ?? (err as { http_code?: number })?.http_code;
    if (httpCode === 404) throw invalid('Image not found. Please upload it again.');
    logger.error({ err }, 'cloudinary resource lookup failed');
    throw new AppError('SERVICE_UNAVAILABLE');
  }

  if (resource.type !== policy.type) throw invalid('Unexpected image type.');

  const format = resource.format.toLowerCase();
  if (!policy.formats.includes(format)) {
    await deleteAsset(publicId, policy.type);
    throw invalid('Only JPG, PNG or WebP images are accepted.');
  }
  if (resource.bytes > policy.maxBytes) {
    await deleteAsset(publicId, policy.type);
    throw invalid(`The image is too large (max ${Math.round(policy.maxBytes / 1024 / 1024)} MB).`);
  }
  const { width, height } = resource;
  if (
    Math.min(width, height) < policy.minDimension ||
    Math.max(width, height) > policy.maxDimension
  ) {
    await deleteAsset(publicId, policy.type);
    throw invalid('The image dimensions are not acceptable.');
  }
  const ageMs = now().getTime() - new Date(resource.created_at).getTime();
  if (Number.isNaN(ageMs) || ageMs > policy.maxAgeMs) throw invalid('This image is too old. Please upload it again.');

  return {
    publicId: resource.public_id,
    secureUrl: resource.secure_url,
    etag: resource.etag ?? null,
    bytes: resource.bytes,
    format,
    width,
    height,
  };
}

/** Best-effort deletion (used for rejected uploads and replaced images). Never throws. */
export async function deleteAsset(publicId: string, type: 'authenticated' | 'upload'): Promise<void> {
  try {
    await getCloudinary().uploader.destroy(publicId, { resource_type: 'image', type, invalidate: true });
  } catch (err) {
    logger.warn({ err, public_id: publicId }, 'could not delete cloudinary asset');
  }
}

/**
 * Signed delivery URL for a private (authenticated) image. The signature is deterministic, so the
 * URL for a given asset is stable and does not expire (BR-20); it cannot be guessed or altered.
 * Pure local computation: no network call.
 */
export function signedImageUrl(publicId: string, width = 1400): string {
  return getCloudinary().url(publicId, {
    resource_type: 'image',
    type: 'authenticated',
    sign_url: true,
    secure: true,
    transformation: [{ width, crop: 'limit', quality: 'auto' }],
  });
}
