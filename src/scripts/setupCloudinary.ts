/**
 * Creates (or updates) the two SIGNED upload presets the backend uses (docs/cloudinary-integration.md section 2.1),
 * with the names from .env: CLOUDINARY_PRESET_PAYMENTS and CLOUDINARY_PRESET_PROFILES. Safe to run again.
 *
 *   npm run cloudinary:setup
 *
 * Presets are OPTIONAL. If the names are in .env the presets must exist (else uploads fail with "Upload preset not found");
 * if the names are empty/removed, the backend uploads without presets and this script is not needed. Unsigned uploading stays off.
 */
import { env } from '../config/env';
import { getCloudinary } from '../lib/cloudinary';

const FORMATS = 'jpg,jpeg,png,webp';

const presets = [
  {
    name: env.CLOUDINARY_PRESET_PAYMENTS,
    label: 'payment screenshots (private, "authenticated")',
    options: {
      unsigned: false,
      type: 'authenticated',
      allowed_formats: FORMATS,
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      transformation: [{ crop: 'limit', width: 1600, height: 1600 }, { quality: 'auto:good' }],
    },
  },
  {
    name: env.CLOUDINARY_PRESET_PROFILES,
    label: 'profile photos (public)',
    options: {
      unsigned: false,
      type: 'upload',
      allowed_formats: FORMATS,
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      transformation: [{ crop: 'fill', gravity: 'face', width: 512, height: 512 }, { quality: 'auto' }],
    },
  },
];

async function main(): Promise<void> {
  const api = getCloudinary().api;
  for (const preset of presets) {
    if (!preset.name) {
      console.log(`skipped : ${preset.label} (no preset name in .env, uploads work without a preset)`);
      continue;
    }
    let exists = true;
    try {
      await api.upload_preset(preset.name);
    } catch {
      exists = false;
    }
    if (exists) {
      await api.update_upload_preset(preset.name, preset.options);
      console.log(`updated : ${preset.name}  ->  ${preset.label}`);
    } else {
      await api.create_upload_preset({ name: preset.name, ...preset.options });
      console.log(`created : ${preset.name}  ->  ${preset.label}`);
    }
  }
  console.log('\nDone. Students can upload payment screenshots and profile photos now.');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    const e = err as { error?: { message?: string }; message?: string };
    console.error('\nCloudinary setup failed:', e?.error?.message ?? e?.message ?? err);
    process.exit(1);
  },
);
