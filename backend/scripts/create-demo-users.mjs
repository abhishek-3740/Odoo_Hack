#!/usr/bin/env node
/**
 * Creates the Supabase auth users that match the seeded demo profiles.
 *
 * The API seeds profiles by EMAIL with no auth user id (DEMO_SEED=true). When
 * each of these users signs in for the first time, the API verifies the token
 * and binds the Supabase user id to the pre-provisioned profile. Roles are
 * therefore assigned by the seed, never by anything in this script or in the
 * token.
 *
 * Usage:
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   DEMO_PASSWORD=<choose one locally> \
 *   node scripts/create-demo-users.mjs
 *
 * The password is supplied locally and is never stored in source. Re-running
 * is safe: existing users are left alone.
 */

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;

if (!url || !serviceKey || !password) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('DEMO_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

// Must match DemoDataSeeder exactly. Roles live in the database, not here.
const users = [
  ['admin@dealflow.demo', 'Demo Admin'],
  ['rep.a@dealflow.demo', 'Rep A'],
  ['rep.b@dealflow.demo', 'Rep B'],
  ['manager.a@dealflow.demo', 'Manager A'],
  ['manager.backup@dealflow.demo', 'Backup Manager'],
  ['finance@dealflow.demo', 'Finance Ops'],
  ['alpha@customer.demo', 'Alpha Buyer'],
  ['beta@customer.demo', 'Beta Buyer'],
];

// The apikey header decides the role; it must be the service key too, or the
// admin endpoint silently downgrades to anon and returns not_admin.
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function existing(email) {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!res.ok) throw new Error(`list users failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return (body.users ?? []).find((u) => u.email?.toLowerCase() === email);
}

async function create(email, fullName) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`create ${email} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

let failures = 0;
for (const [email, fullName] of users) {
  try {
    const found = await existing(email);
    if (found) {
      console.log(`SKIP    ${email} (exists, id=${found.id})`);
      continue;
    }
    const created = await create(email, fullName);
    console.log(`CREATED ${email} (id=${created.id})`);
  } catch (err) {
    failures++;
    console.error(`FAILED  ${email}: ${err.message}`);
  }
}
console.log(failures === 0 ? '\nAll demo users ready.' : `\n${failures} user(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
