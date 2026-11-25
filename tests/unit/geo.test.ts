import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluateGeofence } from '../../src/lib/geo';

const mess = { latitude: 31.5204, longitude: 74.3587 }; // Lahore (example coordinates)
const radiusM = 150;

// ~0.001 degree of latitude is about 111 m
const near = { latitude: mess.latitude + 0.0005, longitude: mess.longitude }; // ~55 m
const far = { latitude: mess.latitude + 0.01, longitude: mess.longitude }; // ~1.1 km

describe('distanceMeters', () => {
  it('is zero for identical points', () => {
    expect(distanceMeters(mess, mess)).toBe(0);
  });
  it('one degree of longitude on the equator is about 111.2 km', () => {
    const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe('evaluateGeofence', () => {
  const base = { center: mess, radiusM };

  it('requires a location', () => {
    expect(evaluateGeofence({ ...base, location: null })).toEqual({
      ok: false,
      code: 'LOCATION_REQUIRED',
      reason: 'missing',
    });
  });

  it('rejects mocked locations', () => {
    const r = evaluateGeofence({ ...base, location: { ...near, accuracy_m: 10, mocked: true } });
    expect(r).toMatchObject({ ok: false, code: 'OUTSIDE_MESS_AREA', reason: 'mocked' });
  });

  it('asks to retry when accuracy is worse than 150 m', () => {
    const r = evaluateGeofence({ ...base, location: { ...near, accuracy_m: 300, mocked: false } });
    expect(r).toMatchObject({ ok: false, code: 'LOCATION_REQUIRED', reason: 'inaccurate' });
  });

  it('accepts a phone inside the radius and reports the distance', () => {
    const r = evaluateGeofence({ ...base, location: { ...near, accuracy_m: 20, mocked: false } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.distanceM).toBeGreaterThan(40);
  });

  it('rejects a phone far away', () => {
    const r = evaluateGeofence({ ...base, location: { ...far, accuracy_m: 20, mocked: false } });
    expect(r).toMatchObject({ ok: false, code: 'OUTSIDE_MESS_AREA', reason: 'too_far' });
  });

  it('gives accuracy credit (capped at 100 m) near the edge', () => {
    // ~210 m away: outside 150 m with a precise fix, inside once 100 m credit applies
    const edge = { latitude: mess.latitude + 0.0019, longitude: mess.longitude };
    expect(evaluateGeofence({ ...base, location: { ...edge, accuracy_m: 5, mocked: false } }).ok).toBe(false);
    expect(evaluateGeofence({ ...base, location: { ...edge, accuracy_m: 120, mocked: false } }).ok).toBe(true);
  });
});
