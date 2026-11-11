// supabase/rls_hardening_migration.sql, run for real in an in-memory Postgres (pglite) on top of the picks-lock migration.
// The "before" state is the live policy set from docs/rls-audit.local.txt, recreated so the test proves the old broad
// policies really are replaced. Roles are simulated with SET ROLE + request.jwt.claims (auth.uid() / auth.role() read them).
// Not covered: the real Supabase auth schema and the live data. Run the "checks" at the end of the migration on live.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = f => fs.readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8')
const U1 = '00000000-0000-0000-0000-000000000001'
const U2 = '00000000-0000-0000-0000-000000000002'
const AD = '00000000-0000-0000-0000-0000000000ad'
// Week: race OPEN is in a week that locks in an hour; LOCKED in a week that locked an hour ago.
const OPEN = '20000000-0000-0000-0000-000000000001'
const LOCKED = '20000000-0000-0000-0000-000000000003'
const R_OPEN = '30000000-0000-0000-0000-000000000001'
const R_LOCKED = '30000000-0000-0000-0000-000000000004'
const F_OPEN = '50000000-0000-0000-0000-000000000001'
const F_LOCKED = '50000000-0000-0000-0000-000000000003'
const FR_OPEN = '60000000-0000-0000-0000-000000000001'
const FR_LOCKED = '60000000-0000-0000-0000-000000000003'

const STUB = `
  create schema auth;
  create role anon; create role authenticated; create role service_role bypassrls;
  create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'sub','')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'role' $$;
  create table profiles(id uuid primary key, is_admin boolean default false);
  create function public.is_admin() returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from profiles where id = auth.uid() and is_admin = true) $$;
  create table race_weeks(id uuid primary key, saturday_date date, picks_deadline timestamptz);
  create table races(id uuid primary key, race_week_id uuid references race_weeks);
  create table runners(id uuid primary key, race_id uuid references races, is_withdrawn boolean default false);
  create table picks(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, race_id uuid references races, runner_id uuid references runners);
  create table festival_days(id uuid primary key, race_date date, picks_deadline timestamptz, is_locked boolean default false);
  create table festival_races(id uuid primary key, festival_day_id uuid references festival_days);
  create table festival_runners(id uuid primary key, festival_race_id uuid references festival_races, is_withdrawn boolean default false);
  create table festival_picks(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, festival_race_id uuid references festival_races, runner_id uuid references festival_runners);
  create table festival_day_points(id uuid primary key default gen_random_uuid(), festival_id uuid, user_id uuid, day_number int, points int);
  create table scores(id uuid primary key default gen_random_uuid(), user_id uuid, race_id uuid, total_points int);
  alter table picks enable row level security; alter table festival_picks enable row level security;
  alter table festival_day_points enable row level security; alter table scores enable row level security;
  grant all on all tables in schema public to authenticated, anon, service_role;
  grant usage on schema auth, public to authenticated, anon, service_role;
  grant execute on all functions in schema auth to authenticated, anon, service_role;
  grant execute on function public.is_admin() to anon, authenticated, service_role;
`
// The live policies before this migration (docs/rls-audit.local.txt).
const OLD_POLICIES = `
  create policy "Admins full access festival_picks" on festival_picks for all to authenticated using (is_admin());
  create policy "Public read festival_picks" on festival_picks for select to public using (auth.role() = 'authenticated');
  create policy "Users insert own festival_picks" on festival_picks for insert to authenticated with check (user_id = auth.uid());
  create policy "Users update own festival_picks" on festival_picks for update to authenticated using (user_id = auth.uid());
  create policy "Admins full access picks" on picks for all to authenticated using (is_admin()) with check (is_admin());
  create policy "Authenticated users read all picks" on picks for select to public using (auth.role() = 'authenticated');
  create policy "Users can manage own picks" on picks for all to public using (auth.uid() = user_id);
  create policy picks_admin_select on picks for select to public using (is_admin());
  create policy picks_user_all on picks for all to public using (auth.uid() = user_id);
  create policy "Admin write" on festival_day_points for all to public using (is_admin());
  create policy "Public read" on festival_day_points for select to public using (true);
  create policy festival_day_points_read on festival_day_points for select to authenticated using (true);
  create policy festival_day_points_write on festival_day_points for all to authenticated using (true) with check (true);
  create policy "Anyone can view scores" on scores for select to authenticated using (true);
  create policy scores_admin_all on scores for all to public using (is_admin());
  create policy scores_delete_admin on scores for delete to public using (auth.role() = 'authenticated');
  create policy scores_insert_admin on scores for insert to public with check (auth.role() = 'authenticated');
  create policy scores_select_all on scores for select to public using (auth.role() = 'authenticated');
  create policy scores_user_select on scores for select to public using (auth.uid() = user_id);
`
const DATA = `
  insert into profiles values ('${U1}',false),('${U2}',false),('${AD}',true);
  insert into race_weeks values ('10000000-0000-0000-0000-000000000001', current_date, now() + interval '1 hour'),
                                ('10000000-0000-0000-0000-000000000002', current_date, now() - interval '1 hour');
  insert into races values ('${OPEN}','10000000-0000-0000-0000-000000000001'), ('${LOCKED}','10000000-0000-0000-0000-000000000002');
  insert into runners values ('${R_OPEN}','${OPEN}',false), ('${R_LOCKED}','${LOCKED}',false);
  insert into festival_days values ('40000000-0000-0000-0000-000000000001', current_date, now() + interval '1 hour', false),
                                   ('40000000-0000-0000-0000-000000000003', current_date, now() - interval '1 hour', false);
  insert into festival_races values ('${F_OPEN}','40000000-0000-0000-0000-000000000001'), ('${F_LOCKED}','40000000-0000-0000-0000-000000000003');
  insert into festival_runners values ('${FR_OPEN}','${F_OPEN}',false), ('${FR_LOCKED}','${F_LOCKED}',false);
  -- U2's picks on an open and a locked day; U1 has their own too.
  insert into picks(user_id,race_id,runner_id) values ('${U2}','${OPEN}','${R_OPEN}'), ('${U2}','${LOCKED}','${R_LOCKED}'), ('${U1}','${OPEN}','${R_OPEN}');
  insert into festival_picks(user_id,festival_race_id,runner_id) values ('${U2}','${F_OPEN}','${FR_OPEN}'), ('${U2}','${F_LOCKED}','${FR_LOCKED}'), ('${U1}','${F_OPEN}','${FR_OPEN}');
  insert into festival_day_points(festival_id,user_id,day_number,points) values (gen_random_uuid(),'${U2}',1,50);
  insert into scores(user_id,race_id,total_points) values ('${U2}','${LOCKED}',100);
`

let db
before(async () => {
  db = new PGlite()
  await db.exec(STUB)
  await db.exec(OLD_POLICIES)
  await db.exec(read('picks_lock_server_side_migration.sql'))
  await db.exec(DATA)
  await db.exec(read('rls_hardening_migration.sql'))
})

const player = (uid = U1) => ({ role: 'authenticated', uid })
const admin = { role: 'authenticated', uid: AD }
const anon = { role: 'anon', uid: null }
const service = { role: 'service_role', uid: null }

// Runs one statement as `who` in a transaction that is always rolled back. Returns { rows } or { error }.
async function as(who, sql) {
  await db.exec('begin')
  try {
    await db.exec(`set local role ${who.role}`)
    const claims = JSON.stringify(who.uid ? { sub: who.uid, role: who.role } : { role: who.role })
    await db.exec(`select set_config('request.jwt.claims', '${claims}', true)`)
    const r = await db.query(sql)
    return { rows: r.rows, count: r.affectedRows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const ids = rows => rows.map(r => r.user_id).sort()

// ── Picks visibility ─────────────────────────────────────────────────────────────────────────────────────────
test('picks: before the lock a player sees only their own picks', async () => {
  const r = await as(player(), `select user_id from picks where race_id = '${OPEN}'`)
  assert.deepEqual(ids(r.rows), [U1])
})

test("picks: after the lock a player sees everyone's picks", async () => {
  const r = await as(player(), `select user_id from picks where race_id = '${LOCKED}'`)
  assert.deepEqual(ids(r.rows), [U2])
  const own = await as(player(U2), `select user_id from picks where race_id = '${LOCKED}'`)
  assert.deepEqual(ids(own.rows), [U2])
})

test('picks: an admin sees all of them, before and after the lock', async () => {
  const r = await as(admin, `select user_id from picks`)
  assert.equal(r.rows.length, 3)
})

test('picks: a logged-out visitor sees nothing, even after the lock (and has no table access)', async () => {
  const r = await as(anon, `select * from picks`)
  assert.match(r.error, /permission denied/)
  const f = await as(anon, `select * from festival_picks`)
  assert.match(f.error, /permission denied/)
})

test('picks: the service role still sees everything', async () => {
  const r = await as(service, `select user_id from picks`)
  assert.equal(r.rows.length, 3)
})

test('festival_picks: own always, others only once the day is locked, admin all, anon none', async () => {
  assert.deepEqual(ids((await as(player(), `select user_id from festival_picks where festival_race_id = '${F_OPEN}'`)).rows), [U1])
  assert.deepEqual(ids((await as(player(), `select user_id from festival_picks where festival_race_id = '${F_LOCKED}'`)).rows), [U2])
  assert.equal((await as(admin, `select 1 from festival_picks`)).rows.length, 3)
  assert.equal((await as(service, `select 1 from festival_picks`)).rows.length, 3)
})

test('picks: an is_locked festival day shows picks even before its deadline', async () => {
  await db.exec('begin')
  try {
    await db.exec(`update festival_days set is_locked = true where id = '40000000-0000-0000-0000-000000000001'`)
    await db.exec(`set local role authenticated`)
    await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: U1, role: 'authenticated' })}', true)`)
    const r = await db.query(`select user_id from festival_picks where festival_race_id = '${F_OPEN}'`)
    assert.deepEqual(ids(r.rows), [U1, U2])
  } finally { await db.exec('rollback') }
})

// ── Picks writes: exactly as before ──────────────────────────────────────────────────────────────────────────
test('picks writes: a player still inserts, updates and deletes their own pick before the lock', async () => {
  assert.equal((await as(player(), `insert into picks(user_id,race_id,runner_id) values ('${U1}','${LOCKED}','${R_LOCKED}')`)).error?.includes('locked'), true)   // timing is the trigger's job
  assert.equal((await as(player(), `update picks set runner_id = '${R_OPEN}' where user_id = '${U1}' and race_id = '${OPEN}' returning 1`)).error, undefined)
  const del = await as(player(), `delete from picks where user_id = '${U1}' and race_id = '${OPEN}' returning id`)
  assert.equal(del.rows.length, 1)
})

test("picks writes: a player cannot change or delete another player's pick", async () => {
  const u = await as(player(), `update picks set runner_id = '${R_OPEN}' where user_id = '${U2}' and race_id = '${OPEN}' returning id`)
  assert.ok(u.error || u.rows.length === 0, 'update must not touch the other pick')
  const d = await as(player(), `delete from picks where user_id = '${U2}' and race_id = '${LOCKED}' returning id`)
  assert.ok(d.error || d.rows.length === 0, 'delete must not touch the other pick')
})

test('festival_picks writes: a player inserts and updates their own, but cannot delete', async () => {
  const ins = await as(player(), `insert into festival_picks(user_id,festival_race_id,runner_id) values ('${U1}','${F_OPEN}','${FR_OPEN}') on conflict do nothing`)
  assert.equal(ins.error, undefined)
  assert.equal((await as(player(), `update festival_picks set runner_id = '${FR_OPEN}' where user_id = '${U1}' returning id`)).rows.length, 1)
  assert.equal((await as(player(), `delete from festival_picks where user_id = '${U1}' returning id`)).rows.length, 0)
})

test('picks writes: admins can still write (after the lock too)', async () => {
  assert.equal((await as(admin, `insert into picks(user_id,race_id,runner_id) values ('${U1}','${LOCKED}','${R_LOCKED}')`)).error, undefined)
  assert.equal((await as(admin, `delete from picks where race_id = '${LOCKED}' returning id`)).rows.length, 1)
})

// ── festival_day_points and scores ───────────────────────────────────────────────────────────────────────────
test('festival_day_points: players and visitors cannot write; admin and service role can; players read, visitors cannot', async () => {
  const w = `insert into festival_day_points(festival_id,user_id,day_number,points) values (gen_random_uuid(),'${U1}',1,999)`
  assert.match((await as(player(), w)).error, /row-level security/)
  const u = await as(player(), `update festival_day_points set points = 1 returning id`)
  assert.equal(u.rows?.length ?? 0, 0)
  const d = await as(player(), `delete from festival_day_points returning id`)
  assert.equal(d.rows?.length ?? 0, 0)
  assert.ok((await as(anon, w)).error)
  assert.equal((await as(admin, w)).error, undefined)
  assert.equal((await as(admin, `update festival_day_points set points = 1 returning id`)).rows.length, 1)
  assert.equal((await as(service, w)).error, undefined)
  assert.equal((await as(player(), `select 1 from festival_day_points`)).rows.length, 1)
  assert.match((await as(anon, `select 1 from festival_day_points`)).error, /permission denied/)
})

test('scores: players and visitors cannot insert, update or delete; admin and service role can; players read, visitors cannot', async () => {
  const w = `insert into scores(user_id,race_id,total_points) values ('${U1}','${LOCKED}',500)`
  assert.match((await as(player(), w)).error, /row-level security/)
  assert.equal((await as(player(), `update scores set total_points = 0 returning id`)).rows.length, 0)
  assert.equal((await as(player(), `delete from scores returning id`)).rows.length, 0)
  assert.ok((await as(anon, w)).error)
  assert.equal((await as(admin, w)).error, undefined)
  assert.equal((await as(admin, `delete from scores returning id`)).rows.length, 1)
  assert.equal((await as(service, w)).error, undefined)
  assert.equal((await as(player(), `select 1 from scores`)).rows.length, 1)
  assert.match((await as(anon, `select 1 from scores`)).error, /permission denied/)
})

// ── The migration itself ─────────────────────────────────────────────────────────────────────────────────────
test('the old policies are gone: exactly the new set remains, all for logged-in users', async () => {
  const r = await db.query(`select tablename, policyname, roles::text as roles from pg_policies
                             where tablename in ('picks','festival_picks','festival_day_points','scores') order by 1, 2`)
  assert.equal(r.rows.length, 13)
  for (const row of r.rows) assert.equal(row.roles, '{authenticated}', row.policyname)
})

test('the visibility helper is callable by logged-in users only', async () => {
  assert.equal((await as(player(), `select public.picks_race_visible('week', '${LOCKED}') as v`)).rows[0].v, true)
  assert.equal((await as(player(), `select public.picks_race_visible('week', '${OPEN}') as v`)).rows[0].v, false)
  assert.match((await as(anon, `select public.picks_race_visible('week', '${LOCKED}')`)).error, /permission denied/)
  assert.match((await as(player(), `select public.picks_day_locked('week', '${LOCKED}')`)).error, /permission denied/)
})

test('it is safe to run twice', async () => {
  await db.exec(read('rls_hardening_migration.sql'))
  const r = await db.query(`select count(*)::int as n from pg_policies where tablename in ('picks','festival_picks','festival_day_points','scores')`)
  assert.equal(r.rows[0].n, 13)
})

test('on the wrong database it stops with "Nothing changed" and changes nothing', async () => {
  const other = new PGlite()
  await other.exec(`create table picks(id int); create function public.is_admin() returns boolean language sql as 'select false';`)
  await assert.rejects(() => other.exec(read('rls_hardening_migration.sql')), /Nothing changed/)
})
