// Runs before every test file: dummy configuration so `config/env.ts` validates without real secrets.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DEFAULT_MESS_ID: '11111111-1111-4111-8111-111111111111',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
  CLOUDINARY_PRESET_PAYMENTS: 'mess_payments_signed',
  CLOUDINARY_PRESET_PROFILES: 'mess_profiles_signed',
  QR_SIGNING_SECRET: 'test-qr-secret-test-qr-secret-test-qr-secret',
});
