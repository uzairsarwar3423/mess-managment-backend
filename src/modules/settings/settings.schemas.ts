import { z } from 'zod';
import { PAYMENT_METHODS } from '../../config/constants';
import { boolQuery, hhmm, money } from '../../common/schemas';

const window = z.object({ start: hhmm, end: hhmm }).strict();

export const updateSettingsBody = z
  .object({
    monthly_fee: money,
    subscription_days: z.number().int().min(1).max(366),
    meal_windows: z.object({ lunch: window, dinner: window }).partial().strict(),
    expiry_reminder_days: z.number().int().min(0).max(14),
    payment_instructions: z.string().trim().max(2000).nullable(),
    geofence: z
      .object({
        enabled: z.boolean(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radius_m: z.number().int().min(20).max(2000),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one setting to change' });

export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>;

// ---------------------------------------------------------------- payment accounts

const accountNumber = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,38}[A-Za-z0-9]$/, 'Use 4-40 letters, digits, spaces or dashes');

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const listAccountsQuery = z.object({ include_inactive: boolQuery.default(false) }).strict();

export const createAccountBody = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    account_title: z.string().trim().min(2).max(100),
    account_number: accountNumber,
    bank_name: optionalText(100).optional(),
    merchant_name: optionalText(100).optional(),
    instructions: optionalText(300).optional(),
    display_order: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export const updateAccountBody = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    account_title: z.string().trim().min(2).max(100),
    account_number: accountNumber,
    bank_name: optionalText(100),
    merchant_name: optionalText(100),
    instructions: optionalText(300),
    display_order: z.number().int().min(0).max(100),
    is_active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });

export type CreateAccountBody = z.infer<typeof createAccountBody>;
export type UpdateAccountBody = z.infer<typeof updateAccountBody>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuery>;
