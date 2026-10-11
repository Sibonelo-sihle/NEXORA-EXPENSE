-- Run AFTER the entire reconciliation commits successfully.
-- Read-only inspection. Do not paste local test harness files into production.
-- 1: Must show all five tables with RLS=true.
select expected.name as billing_table,c.oid is not null as exists,c.relrowsecurity as rls_enabled
from unnest(array['subscriptions','billing_environment','billing_orders','payment_events','billing_notifications']) expected(name)
left join pg_class c on c.oid=to_regclass('public.'||expected.name)
order by expected.name;
-- 2: Exact RPC structure; SECURITY DEFINER=true, authenticated execute=true, anon execute=false.
select p.oid::regprocedure as rpc,p.proargnames,pg_get_function_result(p.oid) as return_structure,p.prosecdef as security_definer,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_proc p where p.oid in(to_regprocedure('public.billing_access()'),to_regprocedure('public.bootstrap_business(text)'));
-- 3: Expect sandbox and no missing subscriptions.
select mode from public.billing_environment where id=true;
select count(*) as businesses_without_subscription_must_be_zero
from public.businesses b left join public.subscriptions s on s.business_id=b.id where s.business_id is null;
-- Use an existing explicit deadline if present; otherwise original creation date + 30 days.
select b.id,s.trial_ends_at as installed_deadline,
 coalesce((to_jsonb(b)->>'trial_ends_at')::timestamptz,b.created_at+interval '30 days') as original_deadline,
 s.trial_ends_at is not distinct from coalesce((to_jsonb(b)->>'trial_ends_at')::timestamptz,b.created_at+interval '30 days') as deadline_matches
from public.businesses b join public.subscriptions s on s.business_id=b.id;
-- Run this deadline comparison before receiving sandbox payment ITNs, which can legitimately shorten a trial.
-- 4: Every client write/TRUNCATE check below must be false.
select t.name,
 has_table_privilege('authenticated','public.'||t.name,'INSERT,UPDATE,DELETE') as client_billing_write_must_be_false,
 has_table_privilege('authenticated','public.'||t.name,'TRUNCATE') as client_truncate_must_be_false,
 has_table_privilege('anon','public.'||t.name,'TRUNCATE') as anon_truncate_must_be_false
from unnest(array['subscriptions','billing_environment','billing_orders','payment_events','billing_notifications']) t(name);
select has_column_privilege('authenticated','public.subscriptions','provider_token','SELECT') as provider_token_read_must_be_false;
-- 5: Provider mutation RPCs must be service-only.
select p.oid::regprocedure as rpc,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute_must_be_true,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as client_execute_must_be_false,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute_must_be_false
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('record_payment','reserve_checkout','cancel_billing','record_billing_notification');
-- 6: All 11 application tables must have RLS=true. Private receipt bucket must exist.
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;
select id,public as must_be_false,file_size_limit,allowed_mime_types from storage.buckets where id='nexora-receipts';
select schemaname,tablename,policyname,cmd,qual,with_check from pg_policies
where schemaname='public' or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;
-- 7: Application data counts: compare with your BEFORE results below.
select 'profiles' as table_name,count(*) from public.profiles
union all select 'businesses',count(*) from public.businesses
union all select 'categories',count(*) from public.categories
union all select 'expenses',count(*) from public.expenses
union all select 'business_memberships',count(*) from public.business_memberships
union all select 'receipts',count(*) from public.receipts;
-- Membership and receipt counts may increase only by backfilling missing owner/Storage metadata rows.

-- 8: Read-only authenticated-policy simulation for an existing confirmed owner.
-- This DOES NOT prove email delivery or real browser session restoration.
-- Expect one billing_access row if a confirmed owner workspace exists, otherwise zero rows.
begin read only;
select set_config('request.jwt.claim.sub',coalesce((select b.owner_id::text from public.businesses b join auth.users u on u.id=b.owner_id where u.email_confirmed_at is not null order by b.created_at limit 1),''),true);
set local role authenticated;
select * from public.billing_access();
select s.business_id,s.trial_days,s.status,s.can_write,s.trial_ends_at,
 (s.trial_ends_at>now() or (s.status in('active','cancelled') and s.paid_until>now())) as expected_current_access
from public.billing_access() s;
rollback;
-- Finally verify actual login/dashboard/CRUD/private receipts with two confirmed accounts.

-- 9: Compatibility backfills. All results below must be zero/true.
select count(*) as businesses_without_matching_owner_membership_must_be_zero
from public.businesses b
left join public.business_memberships m on m.business_id=b.id and m.role='owner'
where m.user_id is null or b.owner_id is distinct from m.user_id;
select count(*) as subscriptions_with_changed_trial_deadline_must_be_zero
from public.businesses b join public.subscriptions s on s.business_id=b.id
where s.trial_ends_at is distinct from b.trial_ends_at;
select count(*) as expenses_with_changed_legacy_expense_date_must_be_zero
from public.expenses where expense_date is not null and date is distinct from expense_date;
select count(*) as expenses_with_missing_compatibility_values_must_be_zero
from public.expenses where date is null or status is null;
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and
 ((table_name='businesses' and column_name in('owner_id','trial_ends_at')) or
  (table_name='categories' and column_name='color') or
  (table_name='expenses' and column_name in('expense_date','date','status','receipt_url')))
order by table_name,column_name;
select expected.table_name,c.relrowsecurity as rls_enabled
from unnest(array['profiles','businesses','categories','expenses','business_memberships','receipts',
 'subscriptions','billing_environment','billing_orders','payment_events','billing_notifications']) expected(table_name)
left join pg_class c on c.oid=to_regclass('public.'||expected.table_name)
order by expected.table_name;

-- 10: Receipt metadata keeps its tenant-scoped expense link and gains a separate cascading Storage link.
select conrelid::regclass as source_table,conname,pg_get_constraintdef(oid) as definition,
 convalidated as validated,confdeltype='c' as cascades_delete
from pg_constraint
where conrelid='public.receipts'::regclass and contype='f'
order by conname;
select count(*) as linked_receipt_metadata_without_storage_object_must_be_zero
from public.receipts r left join storage.objects o on o.id=r.storage_object_id
where r.storage_object_id is not null and o.id is null;
select count(*) as storage_objects_without_receipt_metadata_must_be_zero
from storage.objects o left join public.receipts r on r.storage_object_id=o.id
where o.bucket_id='nexora-receipts' and r.id is null;
select count(*) as receipt_metadata_without_business_must_be_zero
from public.receipts r left join public.businesses b on b.id=r.business_id
where b.id is null;
select count(*) as receipts_linked_to_wrong_tenant_expense_must_be_zero
from public.receipts r left join public.expenses e
 on e.id=r.expense_id and e.business_id=r.business_id
where r.expense_id is not null and e.id is null;
select count(*) as expense_receipt_urls_without_private_storage_object_must_be_zero
from public.expenses e
where e.receipt_url is not null and not exists(
 select 1 from storage.objects o where o.bucket_id='nexora-receipts' and o.name=e.receipt_url
);
select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='storage' and tablename='objects' and policyname like 'receipt_storage_%'
order by policyname;
select count(*) as membership_only_write_policies_must_be_zero
from pg_policies where schemaname='public' and policyname in(
 'categories_delete_member','categories_insert_member','categories_update_member',
 'expenses_delete_member','expenses_insert_member','expenses_update_member',
 'receipts_delete_member','receipts_insert_member');

-- 11: Tenant category key/FK and write-enforcement function must be present.
select c.conrelid::regclass as table_name,c.conname,c.contype,
 pg_get_constraintdef(c.oid) as definition,c.convalidated
from pg_constraint c
where (c.conrelid='public.expenses'::regclass and c.conname='nexora_reconciled_expenses_category_tenant_fk') or
 (c.conrelid='public.expenses'::regclass and c.conname in(
   'nexora_reconciled_expense_amount_valid','nexora_reconciled_expense_status_valid',
   'nexora_reconciled_expense_minor_units'))
order by c.conrelid::regclass::text,c.conname;
select indexname,indexdef from pg_indexes
where schemaname='public' and tablename='categories' and indexname='categories_tenant_key';
select p.oid::regprocedure as function_signature,p.proargnames,
 pg_get_function_result(p.oid) as result,p.prosecdef as security_definer,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
 'bootstrap_business','billing_access','owns_business','can_write_business',
 'receipt_business','can_access_receipt_path','record_payment','reserve_checkout',
 'cancel_billing','record_billing_notification');
