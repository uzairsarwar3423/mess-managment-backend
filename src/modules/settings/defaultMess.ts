import { AppError } from '../../common/errors/AppError';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import * as repository from './settings.repository';

let cached: string | null = null;

/**
 * The mess new students (and failed-login audit entries) belong to.
 *
 * v1 has exactly ONE mess, so nobody should have to copy its id around: unless DEFAULT_MESS_ID is set
 * explicitly in .env, the single active mess is looked up in the database (and remembered). With
 * several messes the id must be configured, because the server cannot guess.
 */
export async function getDefaultMessId(): Promise<string> {
  if (env.DEFAULT_MESS_ID) return env.DEFAULT_MESS_ID;
  if (cached) return cached;

  const ids = await repository.listActiveMessIds();
  if (ids.length === 1 && ids[0]) {
    cached = ids[0];
    return cached;
  }
  logger.error(
    { found: ids.length },
    ids.length === 0
      ? 'No mess exists yet: run database/all_in_one.sql in the Supabase SQL editor'
      : 'More than one mess exists: set DEFAULT_MESS_ID in .env',
  );
  throw new AppError('SERVICE_UNAVAILABLE', 'The mess is not set up yet. Please contact the admin.');
}

/** Test helper. */
export function resetDefaultMessCache(): void {
  cached = null;
}
