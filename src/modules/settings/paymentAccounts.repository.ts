import type { PaymentMethod } from '../../config/constants';
import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface PaymentAccountRow {
  id: string;
  mess_id: string;
  method: PaymentMethod;
  account_title: string;
  account_number: string;
  bank_name: string | null;
  merchant_name: string | null;
  instructions: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, mess_id, method, account_title, account_number, bank_name, merchant_name, instructions, ' +
  'display_order, is_active, created_at, updated_at';

export interface NewPaymentAccount {
  mess_id: string;
  method: PaymentMethod;
  account_title: string;
  account_number: string;
  bank_name: string | null;
  merchant_name: string | null;
  instructions: string | null;
  display_order: number;
  created_by: string;
}

export type PaymentAccountPatch = Partial<
  Pick<
    PaymentAccountRow,
    | 'method'
    | 'account_title'
    | 'account_number'
    | 'bank_name'
    | 'merchant_name'
    | 'instructions'
    | 'display_order'
    | 'is_active'
  >
>;

export async function list(messId: string, includeInactive: boolean): Promise<PaymentAccountRow[]> {
  let query = getDb().from('payment_accounts').select(COLUMNS).eq('mess_id', messId);
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  throwIfError(error);
  return (data as unknown as PaymentAccountRow[] | null) ?? [];
}

export async function findById(id: string, messId: string): Promise<PaymentAccountRow | null> {
  const { data, error } = await getDb()
    .from('payment_accounts')
    .select(COLUMNS)
    .eq('id', id)
    .eq('mess_id', messId)
    .maybeSingle();
  throwIfError(error);
  return (data as unknown as PaymentAccountRow | null) ?? null;
}

export async function insert(account: NewPaymentAccount): Promise<PaymentAccountRow> {
  const { data, error } = await getDb().from('payment_accounts').insert(account).select(COLUMNS).single();
  throwIfError(error);
  return data as unknown as PaymentAccountRow;
}

export async function update(id: string, messId: string, patch: PaymentAccountPatch): Promise<PaymentAccountRow | null> {
  const { data, error } = await getDb()
    .from('payment_accounts')
    .update(patch)
    .eq('id', id)
    .eq('mess_id', messId)
    .select(COLUMNS)
    .maybeSingle();
  throwIfError(error);
  return (data as unknown as PaymentAccountRow | null) ?? null;
}
