-- Schema inspection and PostgREST cache reload. No application data is changed.
-- Run in Supabase SQL Editor after setup; this is not an authenticated user session.
select to_regprocedure('public.bootstrap_business(text)') as workspace_rpc;
select proargnames,prosecdef from pg_proc where oid=to_regprocedure('public.bootstrap_business(text)');
select c.relname as table_name,c.relrowsecurity as rls_enabled
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' order by c.relname;
select tablename,policyname,roles,cmd from pg_policies
 where schemaname='public' or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='nexora-receipts';
select has_function_privilege('anon','public.bootstrap_business(text)','execute') as anonymous_must_be_false,
 has_function_privilege('authenticated','public.bootstrap_business(text)','execute') as authenticated_must_be_true;
select pg_notify('pgrst','reload schema');
