import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';

let configured = false;

/** Returns the configured Cloudinary SDK. The API secret never leaves the backend. */
export function getCloudinary(): typeof cloudinary {
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}
