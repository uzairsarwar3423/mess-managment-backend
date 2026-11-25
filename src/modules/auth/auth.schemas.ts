import { z } from 'zod';
import { email, fullName, otp, password, phonePk } from '../../common/schemas';

export const registerBody = z
  .object({
    full_name: fullName,
    email,
    phone: phonePk,
    roll_number: z.string().trim().max(30).optional(),
    password,
  })
  .strict();

export const verifyEmailBody = z.object({ email, otp }).strict();

export const emailOnlyBody = z.object({ email }).strict();

/** Login does not enforce the password policy (it only checks credentials). */
export const loginBody = z.object({ email, password: z.string().min(1).max(72) }).strict();

export const refreshBody = z.object({ refresh_token: z.string().min(10).max(2000) }).strict();

export const logoutBody = z.object({ push_token: z.string().max(200).optional() }).strict();

export const resetPasswordBody = z.object({ email, otp, new_password: password }).strict();

export const changePasswordBody = z
  .object({ current_password: z.string().min(1).max(72), new_password: password })
  .strict()
  .refine((v) => v.current_password !== v.new_password, {
    path: ['new_password'],
    message: 'New password must be different from the current one',
  });

export type RegisterBody = z.infer<typeof registerBody>;
export type VerifyEmailBody = z.infer<typeof verifyEmailBody>;
export type EmailOnlyBody = z.infer<typeof emailOnlyBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type RefreshBody = z.infer<typeof refreshBody>;
export type LogoutBody = z.infer<typeof logoutBody>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
