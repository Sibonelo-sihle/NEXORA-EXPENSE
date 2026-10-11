-- READ ONLY: no RPC execution, data changes, credentials or reset.
select current_database(),current_user;
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname;
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position;
select p.oid::regprocedure as function,p.proargnames,p.prosecdef,pg_get_function_result(p.oid) as result,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 pg_get_functiondef(p.oid) as definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('bootstrap_business','billing_access','owns_business','can_write_business','receipt_business','check_receipt_path','record_payment','reserve_checkout','cancel_billing','record_billing_notification') order by p.proname;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='nexora-receipts';
