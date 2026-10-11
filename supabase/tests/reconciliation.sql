-- Local-only assertions; requires original_rows captured before the repair.
do $$declare old_row record; current_row jsonb; table_name text;begin
 for old_row in select * from original_rows loop
  if old_row.table_name='business_memberships' then
   select to_jsonb(m) into current_row from business_memberships m where m.business_id::text||'/'||m.user_id::text=old_row.row_key;
  else
   execute format('select to_jsonb(t) from public.%I t where id::text=$1',old_row.table_name) into current_row using old_row.row_key;
  end if;
  if current_row is null or not current_row @> old_row.original then raise exception 'Existing data changed: % / %',old_row.table_name,old_row.row_key;end if;
 end loop;
 foreach table_name in array array['profiles','businesses','categories','expenses','business_memberships','receipts','subscriptions','billing_environment','billing_orders','payment_events','billing_notifications'] loop
  if has_table_privilege('authenticated','public.'||table_name,'TRUNCATE') or has_table_privilege('anon','public.'||table_name,'TRUNCATE') then raise exception 'TRUNCATE permitted on %',table_name;end if;
 end loop;
 foreach table_name in array array['subscriptions','billing_environment','billing_orders','payment_events','billing_notifications'] loop
  if not(select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass) then raise exception 'Billing table missing RLS';end if;
  if has_table_privilege('authenticated','public.'||table_name,'INSERT,UPDATE,DELETE') then raise exception 'Client billing write grant';end if;
 end loop;
 if has_column_privilege('authenticated','public.subscriptions','provider_token','SELECT') then raise exception 'Provider token exposed';end if;
 if has_function_privilege('anon','public.billing_access()','EXECUTE') then raise exception 'Anonymous billing RPC';end if;
 if (select mode from billing_environment) <> 'sandbox' then raise exception 'Sandbox not preserved';end if;
 if (select proargnames from pg_proc where oid='public.billing_access()'::regprocedure) <> array['business_id','trial_days','trial_ends_at','status','paid_until','cancel_at_period_end','can_write','has_subscription'] then raise exception 'Billing return fields differ';end if;
 if exists(select 1 from pg_policies where schemaname='public' and policyname in(
   'categories_delete_member','categories_insert_member','categories_update_member',
   'expenses_delete_member','expenses_insert_member','expenses_update_member',
   'receipts_delete_member','receipts_insert_member')) then raise exception 'Membership-only write policy still bypasses billing';end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
   and policyname in('receipt_storage_upload','receipt_storage_delete')
   and coalesce(qual,with_check) not like '%can_write_business%') then raise exception 'Receipt Storage write policy does not enforce billing';end if;
 if not exists(select 1 from receipts r join storage.objects o on o.id=r.storage_object_id
   where r.expense_id is not null and r.storage_path=o.name) then raise exception 'Receipt Storage foreign key/backfill missing';end if;
end $$;
\echo 'PASS: existing data preserved, billing gates replace permissive policies, receipt metadata remains linked, eight billing fields and no client billing/TRUNCATE grants'
