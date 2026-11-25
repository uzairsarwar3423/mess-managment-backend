import { AppError } from './AppError';
import { looksLikeDbError, mapDbError, type DbErrorLike } from './mapDbError';

/** Throws the mapped AppError when a supabase-js query returned an error; otherwise no-op. */
export function throwIfError(error: DbErrorLike | null | undefined): void {
  if (!error) return;
  throw looksLikeDbError(error) ? mapDbError(error) : new AppError('INTERNAL_ERROR');
}
