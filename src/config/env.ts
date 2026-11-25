import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_TIMEZONE: z.string().min(1).default('Asia/Karachi'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ENABLE_JOBS: bool,

  // Optional: with a single mess the backend finds it by itself. The all-zero id from .env.example counts as unset.
  DEFAULT_MESS_ID: z
    .string()
    .optional()
    .transform((v) => (!v || v.trim() === '' || /^0{8}-0{4}-/.test(v) ? undefined : v.trim()))
    .pipe(z.uuid().optional()),

  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  // OPTIONAL. Leave empty (or delete the lines) to upload without upload presets: the backend then signs every
  // rule itself (type, formats, public id) and verifies each image after upload, which is all this system needs.
  CLOUDINARY_PRESET_PAYMENTS: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).optional()),
  CLOUDINARY_PRESET_PROFILES: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).optional()),
  CLOUDINARY_ROOT_FOLDER: z.string().min(1).default('mess-dev'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),

  QR_SIGNING_SECRET: z.string().min(32, 'QR_SIGNING_SECRET must be at least 32 characters'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast at boot with a readable list; never print values (they may be secrets).
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();
