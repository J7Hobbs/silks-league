// supabase/picks_read_speed_migration.sql, run for real in an in-memory Postgres (pglite) on top of the two earlier migrations.
// The point of the rewrite is speed with IDENTICAL behaviour, so the main test builds a mix of locked and open days (deadline
// passed, no deadline and a past date, flagged is_locked, still open) and checks that the new policies show a player exactly the
// rows the old per-row policy showed, for a player, an admin and a logged-out visitor. Then the indexes.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = f => fs.readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8')
const U1 = '00000000-0000-0000-0000-000000000001'
const U2 = '00000000-0000-0000-0000-000000000002'
const AD = '00000000-0000-0000-0000-0000000000ad'
const id = (n, i) => `${n}0000000-0000-0000-0000-${String(i).padStart(12, '0')}`

const STUB = `
  create schema auth;
  create role anon; create role authenticated; create role service_role bypassrls;
  create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'sub','')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'role' $$;
  create table profiles(id uuid primary key, is_admin boolean default false);
  create function public.is_admin() returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from profiles where id = auth.uid() and is_admin = true) $$;
  create table seasons(id uuid primary key);
  create table race_weeks(id uuid primary key, season_id uuid references seasons, saturday_date date, picks_deadline timestamptz);
  create table races(id uuid primary key, race_week_id uuid references race_weeks);
  create table runners(id uuid primary key, race_id uuid references races, is_withdrawn boolean default false);
  create table results(id uuid primary key default gen_random_uuid(), race_id uuid references races);
  create table picks(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, race_id uuid references races, runner_id uuid references runners, unique (user_id, race_id));
  create table scores(id uuid primary key default gen_random_uuid(), user_id uuid, race_id uuid, total_points int);
  create table festivals(id uuid primary key);
  create table festival_days(id uuid primary key, festival_id uuid references festivals, race_date date, picks_deadline timestamptz, is_locked boolean default false);
  create table festival_races(id uuid primary key, festival_day_id uuid references festival_days);
  create table festival_runners(id uuid primary key, festival_race_id uuid references festival_races, is_withdrawn boolean default false);
  create table festival_results(id uuid primary key default gen_random_uuid(), festival_race_id uuid references festival_races);
  create table festival_picks(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, festival_race_id uuid references festival_races, runner_id uuid references festival_runners, unique (festival_race_id, user_id));
  create table festival_scores(id uuid primary key default gen_random_uuid(), user_id uuid, festival_race_id uuid, total_points int);
  create table festival_entries(id uuid primary key default gen_random_uuid(), festival_id uuid references festivals, user_id uuid, unique (festival_id, user_id));
  create table festival_day_points(id uuid primary key default gen_random_uuid());
  alter table picks enable row level security; alter table festival_picks enable row level security;
  alter table festival_day_points enable row level security; alter table scores enable row level security;
  grant all on all tables in schema public to authenticated, anon, service_role;
  grant usage on schema auth, public to authenticated, anon, service_role;
  grant execute on all functions in schema auth to authenticated, anon, service_role;
  grant execute on function public.is_admin() to anon, authenticated, service_role;
`
// The live policies before the hardening migration (docs/rls-audit.local.txt), so the hardening migration runs as it did live.
const OLD_POLICIES = `
  create policy "Admins full access festival_picks" on festival_picks for all to authenticated using (is_admin());
  create policy "Public read festival_picks" on festival_picks for select to public using (auth.role() = 'authenticated');
  create policy "Users insert own festival_picks" on festival_picks for insert to authenticated with check (user_id = auth.uid());
  create policy "Admins full access picks" on picks for all to authenticated using (is_admin()) with check (is_admin());
  create policy "Authenticated users read all picks" on picks for select to public using (auth.role() = 'authenticated');
  create policy "Users can manage own picks" on picks for all to public using (auth.uid() = user_id);
  create policy "Public read" on festival_day_points for select to public using (true);
  create policy "Anyone can view scores" on scores for select to authenticated using (true);
`

// Weeks: 1 locked by deadline, 2 no deadline + a past date (locked by the 12:00 fallback), 3 no deadline + a future date (open),
// 4 open by deadline. Festival days: 1 locked by deadline, 2 open by deadline but flagged is_locked, 3 open, 4 no deadline + past date.
const DATA = `
  insert into profiles values ('${U1}',false),('${U2}',false),('${AD}',true);
  insert into seasons values ('${id(9, 1)}');
  insert into race_weeks values
    ('${id(1, 1)}','${id(9, 1)}', current_date - 10, now() - interval '9 days'),
    ('${id(1, 2)}','${id(9, 1)}', current_date - 5, null),
    ('${id(1, 3)}','${id(9, 1)}', current_date + 5, null),
    ('${id(1, 4)}','${id(9, 1)}', current_date + 2, now() + interval '2 days');
  insert into races select '${id(2, 0)}'::uuid, null where false;
  insert into races values ('${id(2, 1)}','${id(1, 1)}'), ('${id(2, 2)}','${id(1, 2)}'), ('${id(2, 3)}','${id(1, 3)}'), ('${id(2, 4)}','${id(1, 4)}');
  insert into festivals values ('${id(8, 1)}');
  insert into festival_days values
    ('${id(4, 1)}','${id(8, 1)}', current_date - 3, now() - interval '3 days', false),
    ('${id(4, 2)}','${id(8, 1)}', current_date + 3, now() + interval '3 days', true),
    ('${id(4, 3)}','${id(8, 1)}', current_date + 4, now() + interval '4 days', false),
    ('${id(4, 4)}','${id(8, 1)}', current_date - 2, null, false);
  insert into festival_races values ('${id(5, 1)}','${id(4, 1)}'), ('${id(5, 2)}','${id(4, 2)}'), ('${id(5, 3)}','${id(4, 3)}'), ('${id(5, 4)}','${id(4, 4)}');
  insert into picks(user_id, race_id) select u, r from (values ('${U1}'::uuid), ('${U2}'::uuid)) us(u), (values ('${id(2, 1)}'::uuid), ('${id(2, 2)}'::uuid), ('${id(2, 3)}'::uuid), ('${id(2, 4)}'::uuid)) rs(r);
  insert into festival_picks(user_id, festival_race_id) select u, r from (values ('${U1}'::uuid), ('${U2}'::uuid)) us(u), (values ('${id(5, 1)}'::uuid), ('${id(5, 2)}'::uuid), ('${id(5, 3)}'::uuid), ('${id(5, 4)}'::uuid)) rs(r);
`

// The policy as it was after rls_hardening_migration.sql: the lock worked out per row. The new one must show exactly what this does.
const PER_ROW = {
  picks: `create policy picks_select on picks for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()) or public.picks_race_visible('week', race_id))`,
  festival_picks: `create policy festival_picks_select on festival_picks for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()) or public.picks_race_visible('festival', festival_race_id))`,
}

let db
before(async () => {
  db = new PGlite()
  await db.exec(STUB)
  await db.exec(OLD_POLICIES)
  await db.exec(read('picks_lock_server_side_migration.sql'))
  await db.exec(DATA)
  await db.exec(read('rls_hardening_migration.sql'))
  await db.exec(read('picks_read_speed_migration.sql'))
})

const player = (uid = U1) => ({ role: 'authenticated', uid })
const admin = { role: 'authenticated', uid: AD }
const anon = { role: 'anon', uid: null }

async function as(who, sql, { before: prep = '' } = {}) {
  await db.exec('begin')
  try {
    if (prep) await db.exec(prep)
    await db.exec(`set local role ${who.role}`)
    const claims = JSON.stringify(who.uid ? { sub: who.uid, role: who.role } : { role: who.role })
    await db.exec(`select set_config('request.jwt.claims', '${claims}', true)`)
    const r = await db.query(sql)
    return { rows: r.rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const idsOf = rows => rows.map(r => r.id).sort()

test('the new read policies show exactly the rows the per-row policy showed (player, other player, admin)', async () => {
  for (const [table, race] of [['picks', 'race_id'], ['festival_picks', 'festival_race_id']]) {
    const swap = `drop policy ${table}_select on ${table}; ${PER_ROW[table]}`
    for (const who of [player(U1), player(U2), admin]) {
      const now = await as(who, `select id from ${table}`)
      const before = await as(who, `select id from ${table}`, { before: swap })
      assert.equal(now.error, undefined, now.error)
      assert.deepEqual(idsOf(now.rows), idsOf(before.rows), `${table} for ${who.uid}`)
    }
    void race
  }
})

test('rules: own always, others only once locked, admin all, logged-out nothing', async () => {
  // Locked: week 1 (deadline) and week 2 (no deadline, past date). Open: weeks 3 and 4. U1 sees all 4 of their own, plus U2's 2 locked.
  const mine = await as(player(U1), `select user_id, race_id from picks`)
  assert.equal(mine.rows.filter(r => r.user_id === U1).length, 4)
  assert.deepEqual(mine.rows.filter(r => r.user_id === U2).map(r => r.race_id).sort(), [id(2, 1), id(2, 2)])
  assert.equal((await as(admin, `select 1 from picks`)).rows.length, 8)
  assert.match((await as(anon, `select 1 from picks`)).error, /permission denied/)
  // Festival: day 1 (deadline), day 2 (is_locked flag, even though its deadline is in the future) and day 4 (no deadline + past date) are locked.
  const f = await as(player(U1), `select user_id, festival_race_id from festival_picks`)
  assert.deepEqual(f.rows.filter(r => r.user_id === U2).map(r => r.festival_race_id).sort(), [id(5, 1), id(5, 2), id(5, 4)])
  assert.equal((await as(admin, `select 1 from festival_picks`)).rows.length, 8)
  assert.match((await as(anon, `select 1 from festival_picks`)).error, /permission denied/)
})

test('the locked-races helper is callable by logged-in users only, and lists locked races only', async () => {
  const ok = await as(player(), `select * from public.picks_locked_race_ids('week')`)
  assert.deepEqual(ok.rows.map(r => r.picks_locked_race_ids).sort(), [id(2, 1), id(2, 2)])
  assert.match((await as(anon, `select * from public.picks_locked_race_ids('week')`)).error, /permission denied/)
})

test('the lock is worked out once per query, not once per pick row', async () => {
  const plan = await as(player(), `explain select id, user_id, race_id from picks`)
  const text = plan.rows.map(r => r['QUERY PLAN']).join('\n')
  assert.match(text, /hashed SubPlan/, 'the locked races are built once and looked up, not recomputed for each row')
  assert.doesNotMatch(text, /picks_race_visible|picks_day_locked/, 'no lock function is called per row')
})

test('there are still exactly 13 policies, all for logged-in users', async () => {
  const r = await db.query(`select roles::text as roles from pg_policies where tablename in ('picks','festival_picks','festival_day_points','scores')`)
  assert.equal(r.rows.length, 13)
  for (const row of r.rows) assert.equal(row.roles, '{authenticated}')
})

// ── Indexes ──────────────────────────────────────────────────────────────────
const SPEC = [
  ['picks', 'race_id'], ['picks', 'user_id'], ['scores', 'race_id'], ['scores', 'user_id'], ['runners', 'race_id'], ['results', 'race_id'],
  ['races', 'race_week_id'], ['race_weeks', 'season_id'], ['festival_picks', 'festival_race_id'], ['festival_picks', 'user_id'],
  ['festival_scores', 'festival_race_id'], ['festival_scores', 'user_id'], ['festival_runners', 'festival_race_id'],
  ['festival_results', 'festival_race_id'], ['festival_races', 'festival_day_id'], ['festival_days', 'festival_id'], ['festival_entries', 'festival_id'],
]
const leading = async () => (await db.query(`
  select c.relname as tbl, a.attname as col, i.relname as idx
    from pg_index x join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
   where c.relnamespace = 'public'::regnamespace`)).rows

test('every column the app filters on has an index that starts with it', async () => {
  const have = await leading()
  for (const [t, c] of SPEC) assert.ok(have.some(h => h.tbl === t && h.col === c), `${t}.${c}`)
})

test('no duplicates: a unique constraint that already starts with the column is enough', async () => {
  const names = (await leading()).map(h => h.idx)
  assert.ok(names.includes('picks_race_id_idx'), 'picks(race_id) had no index, so it is added')
  assert.ok(!names.includes('picks_user_id_idx'), 'picks(user_id) is already the start of the unique (user_id, race_id)')
  assert.ok(!names.includes('festival_picks_festival_race_id_idx'), 'already the start of unique (festival_race_id, user_id)')
  assert.ok(!names.includes('festival_entries_festival_id_idx'), 'already the start of unique (festival_id, user_id)')
})

test('it is safe to run twice: nothing is added the second time', async () => {
  const before = (await leading()).length
  await db.exec(read('picks_read_speed_migration.sql'))
  assert.equal((await leading()).length, before)
})

test('without the earlier hardening migration it stops with "Nothing changed" and changes nothing', async () => {
  const other = new PGlite()
  await other.exec(STUB)
  await other.exec(OLD_POLICIES)
  await other.exec(read('picks_lock_server_side_migration.sql'))
  await assert.rejects(() => other.exec(read('picks_read_speed_migration.sql')), /Nothing changed/)
  await other.exec('rollback').catch(() => {})
  const p = await other.query(`select policyname from pg_policies where tablename = 'picks' order by 1`)
  assert.ok(p.rows.some(r => r.policyname === 'Authenticated users read all picks'), 'the old policies are untouched')
})
