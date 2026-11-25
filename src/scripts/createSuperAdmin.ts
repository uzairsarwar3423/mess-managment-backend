/**
 * Creates the FIRST super admin of a mess (run once per mess, by whoever installs the system).
 * It does what used to be done by hand in Supabase: creates a confirmed login and the matching `admins` row.
 *
 *   npm run admin:create -- --email owner@mess.com --name "Ahmed Khan"
 *   npm run admin:create -- --email owner@mess.com --name "Ahmed Khan" --password "Mess2026x" --phone 03001234567
 *
 * Without --password a strong one is generated and printed ONCE. The owner then logs in to the Admin App,
 * changes it under More > Change password, and adds the rest of the staff under More > Admins.
 * Uses the same .env as the server (SUPABASE_URL and the service-role key).
 */
import { randomInt } from 'node:crypto';
import { getDb } from '../lib/supabase';
import * as authRepository from '../modules/auth/auth.repository';
import { getDefaultMessId } from '../modules/settings/defaultMess';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 12 characters, letters and digits only (no look-alikes), always at least one of each. */
function generatePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 10 }, () => pick(letters + digits))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function fail(message: string): never {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const fullName = arg('name')?.trim();
  const phone = arg('phone')?.trim() || null;
  const given = arg('password');
  const generated = given === undefined;
  const password = given ?? generatePassword();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Give a valid email: --email owner@mess.com');
  if (!fullName || fullName.length < 2) fail('Give the full name: --name "Ahmed Khan"');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    fail('The password needs 8-72 characters with at least one letter and one number.');
  }

  const messId = await getDefaultMessId().catch(() => fail('No mess found. Run the Supabase migrations and the seed (0007) first.'));

  let userId: string;
  try {
    userId = await authRepository.createVerifiedUser(email, password);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'EMAIL_ALREADY_REGISTERED') {
      fail('This email already has a login (a student or admin). Use a different email, or delete that user in Supabase first.');
    }
    throw err;
  }

  const { error } = await getDb()
    .from('admins')
    .insert({ id: userId, mess_id: messId, email, full_name: fullName, phone, role: 'super_admin', created_by: null });
  if (error) {
    await authRepository.deleteUser(userId).catch(() => undefined); // leave nothing half-created
    fail(`Could not create the admin row: ${error.message}`);
  }

  console.log('\nSuper admin created.\n');
  console.log(`  Name     : ${fullName}`);
  console.log(`  Email    : ${email}`);
  console.log(`  Password : ${password}${generated ? '   (generated: shown only now, write it down)' : ''}`);
  console.log('\nGive these to the mess owner. Admin App > log in > More > Change password.\n');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('\nUnexpected error:', err);
    process.exit(1);
  },
);
