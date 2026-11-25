import { z } from 'zod';
import { MEAL_TYPES, PAYMENT_METHODS } from '../config/constants';

export const uuid = z.uuid();

export const idParam = z.object({ id: uuid }).strict();

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** YYYY-MM-DD, must be a real calendar date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'Invalid date');

/** YYYY-MM */
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const mealType = z.enum(MEAL_TYPES);
export const paymentMethod = z.enum(PAYMENT_METHODS);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

/** Pakistani mobile: 03XXXXXXXXX or +923XXXXXXXXX */
export const phonePk = z.string().trim().regex(/^(\+92|0)3\d{9}$/, 'Enter a valid mobile number');

/** 8-72 chars with at least one letter and one digit. */
export const password = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, 'Password needs at least one letter')
  .regex(/\d/, 'Password needs at least one digit');

export const otp = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const fullName = z.string().trim().min(2).max(100);

/** "HH:mm" 24-hour clock. */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');

/** Amount in PKR with at most 2 decimals, > 0 and <= 1,000,000. Accepts 8500, "8500" or "8500.50". */
export const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'Use a number with at most 2 decimals'))
  .refine((v) => Number(v) > 0 && Number(v) <= 1_000_000, 'Amount must be between 0 and 1,000,000');

/** Query-string boolean: "true" | "false". */
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
