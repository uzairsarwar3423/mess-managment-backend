import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface MessRow {
  id: string;
  name: string;
  timezone: string;
}

export interface SettingsRow {
  mess_id: string;
  /** numeric(10,2): PostgREST returns it as a JSON number. */
  monthly_fee: number | string;
  currency: string;
  subscription_days: number;
  /** Postgres `time`: "10:00:00". */
  lunch_start: string;
  lunch_end: string;
  dinner_start: string;
  dinner_end: string;
  expiry_reminder_days: number;
  payment_instructions: string | null;
  geofence_enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  updated_at: string;
}

const MESS_COLUMNS = 'id, name, timezone';
const SETTINGS_COLUMNS =
  'mess_id, monthly_fee, currency, subscription_days, lunch_start, lunch_end, dinner_start, dinner_end, ' +
  'expiry_reminder_days, payment_instructions, geofence_enabled, latitude, longitude, geofence_radius_m, updated_at';

export async function findMess(messId: string): Promise<MessRow | null> {
  const { data, error } = await getDb().from('messes').select(MESS_COLUMNS).eq('id', messId).maybeSingle();
  throwIfError(error);
  return (data as MessRow | null) ?? null;
}

export async function findSettings(messId: string): Promise<SettingsRow | null> {
  const { data, error } = await getDb()
    .from('mess_settings')
    .select(SETTINGS_COLUMNS)
    .eq('mess_id', messId)
    .maybeSingle();
  throwIfError(error);
  return (data as unknown as SettingsRow | null) ?? null;
}

/** Columns that may be changed through the API. */
export type SettingsPatch = Partial<
  Pick<
    SettingsRow,
    | 'monthly_fee'
    | 'subscription_days'
    | 'lunch_start'
    | 'lunch_end'
    | 'dinner_start'
    | 'dinner_end'
    | 'expiry_reminder_days'
    | 'payment_instructions'
    | 'geofence_enabled'
    | 'latitude'
    | 'longitude'
    | 'geofence_radius_m'
  >
>;

export async function updateSettings(
  messId: string,
  patch: SettingsPatch,
  updatedBy: string,
): Promise<SettingsRow | null> {
  const { data, error } = await getDb()
    .from('mess_settings')
    .update({ ...patch, updated_by: updatedBy })
    .eq('mess_id', messId)
    .select(SETTINGS_COLUMNS)
    .maybeSingle();
  throwIfError(error);
  return (data as unknown as SettingsRow | null) ?? null;
}

/** Ids of all active messes (the nightly jobs loop over them). */
export async function listActiveMessIds(): Promise<string[]> {
  const { data, error } = await getDb().from('messes').select('id').eq('is_active', true);
  throwIfError(error);
  return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
}
