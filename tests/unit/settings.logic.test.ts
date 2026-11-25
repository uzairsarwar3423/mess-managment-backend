import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { updateSettingsBody } from '../../src/modules/settings/settings.schemas';
import {
  applySettingsPatch,
  assertValidAccount,
  assertValidSettings,
  diffValues,
  toDbPatch,
  toEditable,
} from '../../src/modules/settings/settings.logic';
import type { SettingsRow } from '../../src/modules/settings/settings.repository';

const row: SettingsRow = {
  mess_id: '11111111-1111-4111-8111-111111111111',
  monthly_fee: 8500,
  currency: 'PKR',
  subscription_days: 30,
  lunch_start: '10:00:00',
  lunch_end: '16:00:00',
  dinner_start: '16:45:00',
  dinner_end: '20:45:00',
  expiry_reminder_days: 3,
  payment_instructions: null,
  geofence_enabled: false,
  latitude: null,
  longitude: null,
  geofence_radius_m: 150,
  updated_at: '2026-11-25T00:00:00Z',
};
const current = toEditable(row);
const parse = (body: unknown) => updateSettingsBody.parse(body);

function expectInvalid(fn: () => void, text: RegExp): void {
  try {
    fn();
    throw new Error('expected VALIDATION_ERROR');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('VALIDATION_ERROR');
    expect((e as AppError).message).toMatch(text);
  }
}

describe('toEditable', () => {
  it('normalises times to HH:mm and the fee to 2 decimals', () => {
    expect(current).toMatchObject({ lunch_start: '10:00', dinner_end: '20:45', monthly_fee: '8500.00' });
  });
});

describe('updateSettingsBody schema', () => {
  it('rejects an empty patch and unknown fields', () => {
    expect(updateSettingsBody.safeParse({}).success).toBe(false);
    expect(updateSettingsBody.safeParse({ monthly_fee: 9000, currency: 'USD' }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ geofence: { enabled: true, extra: 1 } }).success).toBe(false);
  });

  it('accepts the fee as number or string, rejects bad amounts', () => {
    expect(parse({ monthly_fee: 9000 }).monthly_fee).toBe('9000');
    expect(parse({ monthly_fee: '9000.50' }).monthly_fee).toBe('9000.50');
    for (const bad of [0, -5, '12.345', 'abc', 1_000_001]) {
      expect(updateSettingsBody.safeParse({ monthly_fee: bad }).success).toBe(false);
    }
  });

  it('validates time format, days and geofence ranges', () => {
    expect(updateSettingsBody.safeParse({ meal_windows: { lunch: { start: '9:00', end: '16:00' } } }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ meal_windows: { lunch: { start: '10:00', end: '24:00' } } }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ subscription_days: 0 }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ geofence: { latitude: 120 } }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ geofence: { radius_m: 5 } }).success).toBe(false);
  });
});

describe('applySettingsPatch + assertValidSettings', () => {
  it('changes only what was sent', () => {
    const next = applySettingsPatch(current, parse({ monthly_fee: 9000 }));
    expect(next).toEqual({ ...current, monthly_fee: '9000.00' });
    expect(() => assertValidSettings(next)).not.toThrow();
  });

  it('keeps the default windows valid (10:00-16:00, 16:45-20:45)', () => {
    expect(() => assertValidSettings(current)).not.toThrow();
  });

  it('rejects overlapping or inverted windows', () => {
    expectInvalid(() => assertValidSettings(applySettingsPatch(current, parse({ meal_windows: { lunch: { start: '10:00', end: '17:00' } } }))), /Dinner cannot start before Lunch ends/);
    expectInvalid(() => assertValidSettings(applySettingsPatch(current, parse({ meal_windows: { dinner: { start: '20:00', end: '19:00' } } }))), /Dinner must end after/);
    expectInvalid(() => assertValidSettings(applySettingsPatch(current, parse({ meal_windows: { lunch: { start: '12:00', end: '11:00' } } }))), /Lunch must end after/);
  });

  it('allows lunch to end exactly when dinner starts', () => {
    const next = applySettingsPatch(current, parse({ meal_windows: { lunch: { start: '10:00', end: '16:45' } } }));
    expect(() => assertValidSettings(next)).not.toThrow();
  });

  it('refuses to enable the geofence without a mess location', () => {
    expectInvalid(() => assertValidSettings(applySettingsPatch(current, parse({ geofence: { enabled: true } }))), /Set the mess location/);
  });

  it('enables the geofence when the location is sent in the same request, or already stored', () => {
    const both = applySettingsPatch(current, parse({ geofence: { enabled: true, latitude: 31.52, longitude: 74.35 } }));
    expect(() => assertValidSettings(both)).not.toThrow();
    const stored = { ...current, latitude: 31.52, longitude: 74.35 };
    expect(() => assertValidSettings(applySettingsPatch(stored, parse({ geofence: { enabled: true } })))).not.toThrow();
  });

  it('blank payment instructions are stored as null', () => {
    const next = applySettingsPatch({ ...current, payment_instructions: 'old' }, parse({ payment_instructions: '' }));
    expect(next.payment_instructions).toBeNull();
  });
});

describe('toDbPatch / diffValues', () => {
  it('writes and audits only changed columns', () => {
    const next = applySettingsPatch(current, parse({ monthly_fee: 9000, subscription_days: 30, geofence: { radius_m: 200 } }));
    expect(toDbPatch(current, next)).toEqual({ monthly_fee: '9000.00', geofence_radius_m: 200 });
    expect(diffValues(current, next)).toEqual({
      before: { monthly_fee: '8500.00', geofence_radius_m: 150 },
      after: { monthly_fee: '9000.00', geofence_radius_m: 200 },
    });
  });

  it('an identical patch produces no changes', () => {
    const next = applySettingsPatch(current, parse({ subscription_days: 30 }));
    expect(toDbPatch(current, next)).toEqual({});
  });
});

describe('assertValidAccount', () => {
  it('requires a bank name for bank accounts only', () => {
    expect(() => assertValidAccount({ method: 'bank', bank_name: null })).toThrow(AppError);
    expect(() => assertValidAccount({ method: 'bank', bank_name: 'Meezan Bank' })).not.toThrow();
    expect(() => assertValidAccount({ method: 'easypaisa', bank_name: null })).not.toThrow();
  });
});
