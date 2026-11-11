// The server-side picks lock (supabase/picks_lock_server_side_migration.sql), run for real in an in-memory Postgres (pglite).
// The real migration file is executed, against a small stand-in for the tables it touches and for Supabase's auth.uid() /
// auth.role() (which read the request's JWT claims). Roles are simulated with SET ROLE + request.jwt.claims.
// Not covered here, because they need the live project: the real RLS policies on picks / festival_picks (see the migration's checks).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = new URL('../supabase/picks_lock_server_side_migration.sql', import.meta.url)
const U1 = '00000000-0000-0000-0000-000000000001'
const U2 = '00000000-0000-0000-0000-000000000002'
const AD = '00000000-0000-0000-0000-0000000000ad'
const PICK = '99999999-0000-0000-0000-000000000001'

// Week side: race OPEN1/OPEN2 are in a week locking in an hour, LOCKED is in a week that locked an hour ago.
const OPEN1 = '20000000-0000-0000-0000-000000000001'
const OPEN2 = '20000000-0000-0000-0000-000000000002'
const LOCKED = '20000000-0000-0000-0000-000000000003'
const R_OK = '30000000-0000-0000-0000-000000000001'
const R_WITHDRAWN = '30000000-0000-0000-0000-000000000002'
const R_OTHER_RACE = '30000000-0000-0000-0000-000000000003'
const R_LOCKED = '30000000-0000-0000-0000-000000000004'
// Festival side: F_OPEN open, F_FLAG open by time but flagged is_locked, F_LOCKED past its deadline.
const F_OPEN = '50000000-0000-0000-0000-000000000001'
const F_FLAG = '50000000-0000-0000-0000-000000000002'
const F_LOCKED = '50000000-0000-0000-0000-000000000003'
const FR_OPEN = '60000000-0000-0000-0000-000000000001'
const FR_FLAG = '60000000-0000-0000-0000-000000000002'
const FR_LOCKED = '60000000-0000-0000-0000-000000000003'

let db

before(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth;
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'role' $$;
    create table profiles(id uuid primary key, is_admin boolean default false);
    create table race_weeks(id uuid primary key, saturday_date date, picks_deadline timestamptz);
    create table races(id uuid primary key, race_week_id uuid references race_weeks);
    create table runners(id uuid primary key, race_id uuid references races, is_withdrawn boolean default false);
    create table picks(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, race_id uuid references races, runner_id uuid references runners);
    create table festival_days(id uuid primary key, race_date date, picks_deadline timestamptz, is_locked boolean default false);
    create table festival_races(id uuid primary key, festival_day_id uuid references festival_days);
    create table festival_runners(id uuid primary key, festival_race_id uuid references festival_races, is_withdrawn boolean default false);
    create table festival_picks(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, festival_race_id uuid references festival_races, runner_id uuid references festival_runners);
    grant all on all tables in schema public to authenticated, anon, service_role;
    grant usage on schema auth, public to authenticated, anon, service_role;
    grant execute on all functions in schema auth to authenticated, anon, service_role;
  `)
  const sql = fs.readFileSync(MIGRATION, 'utf8')
  await db.exec(sql)
  await db.exec(sql)     // safe to run twice
  await db.exec(`
    insert into profiles values ('${U1}',false),('${U2}',false),('${AD}',true);
    insert into race_weeks values ('10000000-0000-0000-0000-000000000001', current_date, now() + interval '1 hour'),
                                  ('10000000-0000-0000-0000-000000000002', current_date, now() - interval '1 hour');
    insert into races values ('${OPEN1}','10000000-0000-0000-0000-000000000001'),
                             ('${OPEN2}','10000000-0000-0000-0000-000000000001'),
                             ('${LOCKED}','10000000-0000-0000-0000-000000000002');
    insert into runners values ('${R_OK}','${OPEN1}',false), ('${R_WITHDRAWN}','${OPEN1}',true),
                               ('${R_OTHER_RACE}','${OPEN2}',false), ('${R_LOCKED}','${LOCKED}',false);
    insert into festival_days values ('40000000-0000-0000-0000-000000000001', current_date, now() + interval '1 hour', false),
                                     ('40000000-0000-0000-0000-000000000002', current_date, now() + interval '1 hour', true),
                                     ('40000000-0000-0000-0000-000000000003', current_date, now() - interval '1 hour', false);
    insert into festival_races values ('${F_OPEN}','40000000-0000-0000-0000-000000000001'),
                                      ('${F_FLAG}','40000000-0000-0000-0000-000000000002'),
                                      ('${F_LOCKED}','40000000-0000-0000-0000-000000000003');
    insert into festival_runners values ('${FR_OPEN}','${F_OPEN}',false), ('${FR_FLAG}','${F_FLAG}',false), ('${FR_LOCKED}','${F_LOCKED}',false);
  `)
})

// Runs `sql` as a caller inside a transaction that is always rolled back. `seed` runs first as the owner (no restrictions).
// who: { role, uid } — role 'postgres' means no role switch and no JWT (SQL editor / pg_cron).
async function run(who, sql, seed = '') {
  await db.exec('begin')
  try {
    if (seed) await db.exec(seed)
    if (who.role !== 'postgres') {
      await db.exec(`set local role ${who.role}`)
      const claims = JSON.stringify(who.uid ? { sub: who.uid, role: who.role } : { role: who.role })
      await db.exec(`select set_config('request.jwt.claims', '${claims}', true)`)
    }
    await db.exec(sql)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const player = (uid = U1) => ({ role: 'authenticated', uid })
const admin = { role: 'authenticated', uid: AD }
const service = { role: 'service_role', uid: null }
const anon = { role: 'anon', uid: null }
const editor = { role: 'postgres', uid: null }

const insPick = (u, race, runner) => `insert into picks(user_id,race_id,runner_id) values ('${u}','${race}','${runner}')`
const seedPick = (race, runner, u = U1) => `insert into picks(id,user_id,race_id,runner_id) values ('${PICK}','${u}','${race}','${runner}')`
const updPick = runner => `update picks set runner_id='${runner}' where id='${PICK}'`
const delPick = `delete from picks where id='${PICK}'`
const insF = (u, race, runner) => `insert into festival_picks(user_id,festival_race_id,runner_id) values ('${u}','${race}','${runner}')`
const seedF = (race, runner, u = U1) => `insert into festival_picks(id,user_id,festival_race_id,runner_id) values ('${PICK}','${u}','${race}','${runner}')`
const updF = runner => `update festival_picks set runner_id='${runner}' where id='${PICK}'`
const delF = `delete from festival_picks where id='${PICK}'`

const allowed = async (who, sql, seed) => { const r = await run(who, sql, seed); assert.equal(r.ok, true, r.message) }
const refused = async (who, sql, seed, text) => {
  const r = await run(who, sql, seed)
  assert.equal(r.ok, false, 'expected the write to be refused')
  assert.match(r.message, new RegExp(text))
}
const LOCKED_MSG = 'Picks are locked for this race day'

// ── Saturday picks ───────────────────────────────────────────────────────────────────────────────────────────
test('player before the lock: insert, update and delete all work', async () => {
  await allowed(player(), insPick(U1, OPEN1, R_OK))
  await allowed(player(), updPick(R_OK), seedPick(OPEN1, R_OK))
  await allowed(player(), delPick, seedPick(OPEN1, R_OK))
})

test('player after the lock: insert, update and delete are all refused with the lock message', async () => {
  await refused(player(), insPick(U1, LOCKED, R_LOCKED), '', LOCKED_MSG)
  await refused(player(), updPick(R_LOCKED), seedPick(LOCKED, R_LOCKED), LOCKED_MSG)
  await refused(player(), delPick, seedPick(LOCKED, R_LOCKED), LOCKED_MSG)
})

test('admin after the lock: insert, update and delete work', async () => {
  await allowed(admin, insPick(U1, LOCKED, R_LOCKED))
  await allowed(admin, updPick(R_LOCKED), seedPick(LOCKED, R_LOCKED))
  await allowed(admin, delPick, seedPick(LOCKED, R_LOCKED))
})

test('service role after the lock: insert, update and delete work (agent-api, Edge Functions)', async () => {
  await allowed(service, insPick(U1, LOCKED, R_LOCKED))
  await allowed(service, updPick(R_LOCKED), seedPick(LOCKED, R_LOCKED))
  await allowed(service, delPick, seedPick(LOCKED, R_LOCKED))
})

test('the SQL editor / pg_cron (no JWT at all) is not blocked', async () => {
  await allowed(editor, insPick(U1, LOCKED, R_LOCKED))
})

test('anonymous visitors are refused', async () => {
  await refused(anon, insPick(U1, OPEN1, R_OK), '', 'signed in')
})

test("a player cannot write, change or delete another player's pick", async () => {
  await refused(player(), insPick(U2, OPEN1, R_OK), '', 'only change your own')
  await refused(player(U2), updPick(R_OK), seedPick(OPEN1, R_OK), 'only change your own')
  await refused(player(U2), delPick, seedPick(OPEN1, R_OK), 'only change your own')
})

test('a player cannot pick a withdrawn horse, a horse from another race, or move a pick to another race', async () => {
  await refused(player(), insPick(U1, OPEN1, R_WITHDRAWN), '', 'withdrawn')
  await refused(player(), insPick(U1, OPEN1, R_OTHER_RACE), '', 'not running in this race')
  await refused(player(), `update picks set race_id='${OPEN2}', runner_id='${R_OTHER_RACE}' where id='${PICK}'`, seedPick(OPEN1, R_OK), 'another race')
})

test('the server (service role) can still put a pick on a withdrawn horse, and move picks away from one', async () => {
  await allowed(service, insPick(U1, OPEN1, R_WITHDRAWN))
  await allowed(service, updPick(R_OK), seedPick(OPEN1, R_WITHDRAWN))
})

test('removing a profile still removes its locked picks (cascade delete)', async () => {
  await allowed(admin, `delete from profiles where id='${U1}'`, seedPick(LOCKED, R_LOCKED))
})

test('a week with no deadline locks at 12:00 UK on its race day', async () => {
  const noon = (await db.query(`select (now() at time zone 'Europe/London')::time >= time '12:00' as past`)).rows[0].past
  const seed = `update race_weeks set picks_deadline = null where id = '10000000-0000-0000-0000-000000000001'`
  const r = await run(player(), insPick(U1, OPEN1, R_OK), seed)
  if (noon) { assert.equal(r.ok, false); assert.match(r.message, new RegExp(LOCKED_MSG)) }
  else assert.equal(r.ok, true, r.message)
})

// ── Festival picks ───────────────────────────────────────────────────────────────────────────────────────────
test('festival: player before the lock works, after the lock is refused, a flagged day is refused', async () => {
  await allowed(player(), insF(U1, F_OPEN, FR_OPEN))
  await allowed(player(), delF, seedF(F_OPEN, FR_OPEN))
  await refused(player(), insF(U1, F_LOCKED, FR_LOCKED), '', LOCKED_MSG)
  await refused(player(), updF(FR_LOCKED), seedF(F_LOCKED, FR_LOCKED), LOCKED_MSG)
  await refused(player(), delF, seedF(F_LOCKED, FR_LOCKED), LOCKED_MSG)
  await refused(player(), insF(U1, F_FLAG, FR_FLAG), '', LOCKED_MSG)
})

test('festival: admin and service role after the lock work', async () => {
  await allowed(admin, updF(FR_LOCKED), seedF(F_LOCKED, FR_LOCKED))
  await allowed(service, delF, seedF(F_LOCKED, FR_LOCKED))
  await allowed(service, insF(U1, F_LOCKED, FR_LOCKED))
})

test("festival: another player's row and a horse from another race are refused", async () => {
  await refused(player(U2), delF, seedF(F_OPEN, FR_OPEN), 'only change your own')
  await refused(player(), insF(U1, F_OPEN, FR_LOCKED), '', 'not running')
})
