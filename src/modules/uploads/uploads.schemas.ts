import { z } from 'zod';
import { UPLOAD_PURPOSES } from './uploadPolicies';

export const signatureBody = z.object({ purpose: z.enum(UPLOAD_PURPOSES) }).strict();
export type SignatureBody = z.infer<typeof signatureBody>;
