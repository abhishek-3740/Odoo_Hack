/**
 * End-to-end verification for local Supabase.
 * Proves: auth works, JWT is accepted by PostgREST, and RLS actually isolates users.
 *
 * Run: node verify-setup.mjs
 */

const URL = 'http://127.0.0.1:54321';
const PUB = process.env.SUPABASE_ANON_KEY || '';
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// NOTE: the `apikey` header determines the ROLE (anon vs service_role).
// It MUST match the key in `Authorization`, or admin calls get downgraded to anon
// and fail with `not_admin` / get RLS applied to them.
const authHeaders = (token, apikey = token) => ({
  apikey,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`);
  if (!ok) failures++;
}

async function signup(email, password) {
  const res = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: authHeaders(PUB),
    body: JSON.stringify({ email, password }),
  });
  return { res, json: await res.json() };
}

async function signin(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(PUB),
    body: JSON.stringify({ email, password }),
  });
  return { res, json: await res.json() };
}

/** Sign up, or fall back to sign-in if the user already exists. */
async function getSession(email, password) {
  let { res, json } = await signup(email, password);
  if (!res.ok) {
    ({ res, json } = await signin(email, password));
  }
  if (!res.ok || !json.access_token) {
    throw new Error(`no session for ${email}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const stamp = Date.now();
  const emailA = `rls_a_${stamp}@test.local`;
  const emailB = `rls_b_${stamp}@test.local`;
  const password = 'TestPass123!';

  console.log('--- Auth ---');
  const userA = await getSession(emailA, password);
  check('user A authenticated', !!userA.access_token, `id=${userA.user.id}`);
  const userB = await getSession(emailB, password);
  check('user B authenticated', !!userB.access_token, `id=${userB.user.id}`);

  console.log('\n--- PostgREST accepts user JWT + RLS ---');
  const insA = await fetch(`${URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...authHeaders(userA.access_token), Prefer: 'return=representation' },
    body: JSON.stringify({ id: userA.user.id, full_name: 'User A', email: emailA }),
  });
  const insAJson = await insA.json();
  check(
    'user A can insert own profile (RLS + JWT decode)',
    insA.ok,
    insA.ok ? `rows=${insAJson.length}` : JSON.stringify(insAJson)
  );

  const insB = await fetch(`${URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...authHeaders(userB.access_token), Prefer: 'return=representation' },
    body: JSON.stringify({ id: userB.user.id, full_name: 'User B', email: emailB }),
  });
  const insBJson = await insB.json();
  check('user B can insert own profile', insB.ok, insB.ok ? `rows=${insBJson.length}` : JSON.stringify(insBJson));

  console.log('\n--- RLS isolation ---');
  const readA = await fetch(`${URL}/rest/v1/profiles?select=id,full_name`, {
    headers: authHeaders(userA.access_token),
  });
  const rowsA = await readA.json();
  check(
    'user A sees ONLY own profile',
    readA.ok && Array.isArray(rowsA) && rowsA.length === 1 && rowsA[0].id === userA.user.id,
    `visible=${rowsA.length}`
  );

  const readB = await fetch(`${URL}/rest/v1/profiles?select=id,full_name`, {
    headers: authHeaders(userB.access_token),
  });
  const rowsB = await readB.json();
  check(
    'user B sees ONLY own profile (cannot see A)',
    readB.ok && Array.isArray(rowsB) && rowsB.length === 1 && rowsB[0].id === userB.user.id,
    `visible=${rowsB.length}`
  );

  console.log('\n--- Admin access (secret key bypasses RLS) ---');
  const readAdmin = await fetch(`${URL}/rest/v1/profiles?select=id`, {
    headers: authHeaders(SECRET, SECRET),
  });
  const rowsAdmin = await readAdmin.json();
  check('secret key sees all profiles', readAdmin.ok && rowsAdmin.length >= 2, `visible=${rowsAdmin.length}`);

  // Cleanup test users (cascade deletes their profiles)
  console.log('\n--- Cleanup ---');
  for (const id of [userA.user.id, userB.user.id]) {
    const del = await fetch(`${URL}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders(SECRET, SECRET),
    });
    check(`deleted test user ${id.slice(0, 8)}`, del.ok, `status=${del.status}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
