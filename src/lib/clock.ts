/**
 * The only source of "now" for business code. Tests can replace it with a fixed time.
 * Business code must never call `new Date()` directly.
 */
let override: (() => Date) | null = null;

export function now(): Date {
  return override ? override() : new Date();
}

/** Test helper: freeze or replace the clock. Pass `null` to restore the real clock. */
export function setClock(fn: (() => Date) | null): void {
  override = fn;
}
