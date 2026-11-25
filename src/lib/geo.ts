import { GEOFENCE } from '../config/constants';

const EARTH_RADIUS_M = 6_371_000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ScanLocation extends Coordinates {
  accuracy_m: number;
  /** Android "mock location" flag reported by the device. */
  mocked: boolean;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceResult =
  | { ok: true; distanceM: number }
  | { ok: false; code: 'LOCATION_REQUIRED'; reason: 'missing' | 'inaccurate' }
  | { ok: false; code: 'OUTSIDE_MESS_AREA'; reason: 'mocked' | 'too_far'; distanceM?: number };

/**
 * Geofence rules (docs/qr-code-system.md section 7):
 *  - missing location                        -> LOCATION_REQUIRED
 *  - mocked location                         -> OUTSIDE_MESS_AREA
 *  - accuracy worse than MAX_ACCURACY_M      -> LOCATION_REQUIRED (ask to retry)
 *  - distance - min(accuracy, credit) > radius -> OUTSIDE_MESS_AREA
 */
export function evaluateGeofence(params: {
  center: Coordinates;
  radiusM: number;
  location: ScanLocation | null | undefined;
}): GeofenceResult {
  const { center, radiusM, location } = params;
  if (!location) return { ok: false, code: 'LOCATION_REQUIRED', reason: 'missing' };
  if (location.mocked) return { ok: false, code: 'OUTSIDE_MESS_AREA', reason: 'mocked' };
  if (location.accuracy_m > GEOFENCE.MAX_ACCURACY_M) {
    return { ok: false, code: 'LOCATION_REQUIRED', reason: 'inaccurate' };
  }
  const distanceM = Math.round(distanceMeters(center, location));
  const credit = Math.min(location.accuracy_m, GEOFENCE.MAX_ACCURACY_CREDIT_M);
  if (distanceM - credit > radiusM) {
    return { ok: false, code: 'OUTSIDE_MESS_AREA', reason: 'too_far', distanceM };
  }
  return { ok: true, distanceM };
}
