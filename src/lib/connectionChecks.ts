import { env } from '../config/env';
import { getCloudinary } from './cloudinary';
import { logger } from './logger';
import { getDefaultMessId } from '../modules/settings/defaultMess';
import { getDb } from './supabase';

const TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS).unref(),
    ),
  ]);
}

async function checkSupabase(): Promise<void> {
  const started = Date.now();
  try {
    const { error } = await withTimeout(
      Promise.resolve(getDb().from('messes').select('id', { head: true, count: 'exact' }).limit(1)),
      'Supabase',
    );
    if (error) throw new Error(error.message);
    logger.info(
      { service: 'supabase', host: new URL(env.SUPABASE_URL).host, ms: Date.now() - started },
      'Supabase connected',
    );
  } catch (err) {
    logger.error({ service: 'supabase', err }, 'Supabase connection FAILED');
  }
}

async function checkCloudinary(): Promise<void> {
  const started = Date.now();
  try {
    await withTimeout(getCloudinary().api.ping(), 'Cloudinary');
    logger.info(
      { service: 'cloudinary', cloud: env.CLOUDINARY_CLOUD_NAME, ms: Date.now() - started },
      'Cloudinary connected',
    );
  } catch (err) {
    // The Cloudinary SDK rejects with { error: { message, http_code } } rather than an Error.
    const e = err as { error?: { message?: string; http_code?: number }; message?: string };
    logger.error(
      { service: 'cloudinary', reason: e.error?.message ?? e.message, http_code: e.error?.http_code },
      'Cloudinary connection FAILED',
    );
  }
}

/** Registration needs a mess row: report a missing/ambiguous mess at startup instead of at the first signup. */
async function checkMess(): Promise<void> {
  try {
    const messId = await withTimeout(getDefaultMessId(), 'mess lookup');
    logger.info({ mess_id: messId }, 'Mess found');
  } catch (err) {
    logger.error({ err }, 'Mess is not ready (see the message above)');
  }
}

function reportExpo(): void {
  logger.info(
    { service: 'expo', accessToken: env.EXPO_ACCESS_TOKEN ? 'set' : 'not set' },
    'Expo push client ready',
  );
}

/** Logs the status of every external service at startup. Never throws: the server keeps running. */
export async function logConnectionStatus(): Promise<void> {
  await Promise.all([checkSupabase(), checkCloudinary(), checkMess()]);
  reportExpo();
}
