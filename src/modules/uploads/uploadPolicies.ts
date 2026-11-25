import { env } from '../../config/env';

export const UPLOAD_PURPOSES = ['payment_screenshot', 'profile_image'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export interface UploadPolicy {
  /** Sub-folder under the environment root: <root>/<kind>/<owner id>/<uuid> */
  kind: 'payments' | 'profiles';
  /** Optional Cloudinary upload preset name; without one the signed parameters carry all the rules. */
  preset: string | undefined;
  /** Cloudinary delivery type: payment screenshots are private (authenticated), avatars are public. */
  type: 'authenticated' | 'upload';
  formats: readonly string[];
  maxBytes: number;
  minDimension: number;
  maxDimension: number;
  /** An uploaded asset older than this is rejected (it must belong to the current upload flow). */
  maxAgeMs: number;
}

const FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** Server-side policy per purpose. The client can only choose the purpose, nothing else. */
export function getPolicy(purpose: UploadPurpose): UploadPolicy {
  switch (purpose) {
    case 'payment_screenshot':
      return {
        kind: 'payments',
        preset: env.CLOUDINARY_PRESET_PAYMENTS,
        type: 'authenticated',
        formats: FORMATS,
        maxBytes: env.UPLOAD_MAX_BYTES,
        minDimension: 200,
        maxDimension: 4000,
        maxAgeMs: 2 * 60 * 60 * 1000,
      };
    case 'profile_image':
      return {
        kind: 'profiles',
        preset: env.CLOUDINARY_PRESET_PROFILES,
        type: 'upload',
        formats: FORMATS,
        maxBytes: 1024 * 1024,
        minDimension: 64,
        maxDimension: 4000,
        maxAgeMs: 2 * 60 * 60 * 1000,
      };
  }
}

/** `<root>/<kind>/<owner id>/` — ownership is proven by this prefix. */
export function ownerFolder(policy: UploadPolicy, ownerId: string): string {
  return `${env.CLOUDINARY_ROOT_FOLDER}/${policy.kind}/${ownerId}`;
}
