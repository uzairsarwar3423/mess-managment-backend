/**
 * Checks that the Cloudinary API key in .env may do everything the backend needs. It uploads a 1-pixel test
 * image, reads it back and deletes it again (nothing is left behind):
 *
 *   npm run cloudinary:check
 *
 *   read    - verify an uploaded image (Admin API: resource)
 *   upload  - accept student uploads        (Upload API: create)
 *   delete  - remove rejected/replaced images (Upload API: destroy)
 *
 * "forbidden / missing permissions" on any line means the key's role is too small: create a key with the right
 * role (see the fix printed below) and put it in .env.
 */
import { getCloudinary } from '../lib/cloudinary';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type Probe = { name: string; why: string; run: () => Promise<unknown> };

const messageOf = (err: unknown): string => {
  const e = err as { error?: { message?: string }; message?: string };
  return e?.error?.message ?? e?.message ?? String(err);
};
const forbidden = (text: string): boolean => /forbidden|missing permission|not allowed|unauthorized|invalid api|status code - 40[13]/i.test(text);

async function main(): Promise<void> {
  const c = getCloudinary();
  // A tiny REAL image: it is uploaded, read back and deleted again (leaves nothing behind).
  const id = 'mess-permission-check/probe';
  const probes: Probe[] = [
    { name: 'connect', why: 'the cloud name, key and secret are valid', run: () => c.api.ping() },
    { name: 'upload', why: 'accept student uploads', run: () => c.uploader.upload(TINY_PNG, { type: 'authenticated', public_id: id, overwrite: true, resource_type: 'image' }) },
    { name: 'read', why: 'verify each uploaded image', run: () => c.api.resource(id, { resource_type: 'image', type: 'authenticated' }) },
    { name: 'delete', why: 'remove rejected or replaced images', run: () => c.uploader.destroy(id, { resource_type: 'image', type: 'authenticated', invalidate: true }) },
  ];
  let blocked = 0;
  for (const probe of probes) {
    let verdict = 'OK';
    try {
      await probe.run();
    } catch (err) {
      const text = messageOf(err);
      verdict = forbidden(text) ? `BLOCKED  ${text}` : `FAILED   ${text}`;
      blocked++;
    }
    console.log(`${probe.name.padEnd(8)} ${verdict}   (${probe.why})`);
  }

  if (blocked === 0) {
    console.log('\nAll good: this key can read, upload and delete. Student uploads will work.');
    return;
  }
  console.log(`
FIX: this API key is restricted. In the Cloudinary Console open  Settings > API Keys  and either
  - use the main key that was created with your account (full access), or
  - click "Generate new API key" and give it the Admin role (or at least: Upload, Admin API read, Destroy),
then put the new CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the backend .env and restart the backend.
Run this check again afterwards.`);
  process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    console.error('Check failed:', messageOf(err));
    process.exit(1);
  },
);
