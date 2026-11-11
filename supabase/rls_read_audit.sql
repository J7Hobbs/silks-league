-- ════════════════════════════════════════════════════════════════════════
--  Silks League — read-side RLS audit (READ-ONLY: changes nothing)
--  Run each query in the Supabase SQL Editor on project wfytwcwletznzyayjkrv (the "Dashboard" project) and paste the
--  results back. Run them one at a time (the editor only shows the last result).
-- ════════════════════════════════════════════════════════════════════════

-- 1. Every policy on picks and festival_picks, exactly as stored.
select tablename, policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('picks', 'festival_picks')
 order by tablename, cmd, policyname;


-- 2. Every public table: is RLS on, and which policies let a LOGGED-OUT visitor read it?
--    A policy whose roles include {public} or {anon} applies to logged-out visitors.
--    rls_on = false means the table is wide open to anyone with the public key.
select c.relname as tbl,
       c.relrowsecurity as rls_on,
       coalesce((select string_agg(p.policyname || ' [' || p.cmd || '] roles=' || p.roles::text || ' using=' || coalesce(p.qual, 'true'), E'\n')
                   from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname
                    and p.cmd in ('SELECT', 'ALL')
                    and (p.roles && array['public', 'anon']::name[])), '') as anon_read_policies,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_has_select_grant
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by (not c.relrowsecurity) desc, anon_read_policies <> '' desc, c.relname;


-- 3. Every policy on every other public table (to see who can read what).
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename not in ('picks', 'festival_picks')
 order by tablename, cmd, policyname;


-- 4. Views (a view ignores RLS on its tables unless it is security_invoker) and functions a logged-out visitor can call.
select c.relname as view_name, c.reloptions, has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm')
 order by 1;

select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
 order by anon_can_execute desc, p.proname;
