import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const preflight = `begin;
set local search_path=public,extensions,pg_catalog;
set local lock_timeout='10s';
-- This repair is ONLY for six core tables with ALL billing tables absent.
-- Refuse partial billing state instead of resetting an existing trial/payment.
do $$declare t text; col text; has_expense_date boolean; has_trial_deadline boolean; trial_missing boolean; owner_mismatch boolean;begin
 foreach t in array array['subscriptions','billing_environment','billing_orders','payment_events','billing_notifications'] loop
  if to_regclass('public.'||t) is not null then raise exception 'Billing state already exists (%). Review diagnose_workspace.sql; do not replay this repair.',t;end if;
 end loop;
 foreach t in array array['profiles','businesses','categories','expenses','business_memberships','receipts'] loop
  if to_regclass('public.'||t) is null then raise exception 'Missing core table %. Apply the appropriate reviewed migrations instead.',t;end if;
 end loop;
 foreach t in array array['profiles','businesses','categories','expenses','business_memberships','receipts'] loop execute format('lock table public.%I in share row exclusive mode',t);end loop;
 for t,col in select * from (values ('profiles','id'),('profiles','full_name'),('businesses','id'),('businesses','name'),('businesses','currency'),('businesses','created_at'),('categories','id'),('categories','business_id'),('categories','name'),('expenses','id'),('expenses','business_id'),('expenses','category_id'),('expenses','amount'),('expenses','merchant'),('expenses','description'),('expenses','created_at'),('business_memberships','business_id'),('business_memberships','user_id'),('business_memberships','role'),('business_memberships','created_at'),('receipts','id'),('receipts','business_id'),('receipts','expense_id'),('receipts','storage_path'),('receipts','file_name'),('receipts','created_at')) v(t,c) loop
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name=col) then raise exception 'Contract mismatch: %.%. No repair applied.',t,col;end if;
 end loop;
 if exists(select 1 from (values ('profiles','id','uuid'),('businesses','id','uuid'),('businesses','created_at','timestamptz'),('categories','id','uuid'),('categories','business_id','uuid'),('expenses','id','uuid'),('expenses','business_id','uuid'),('expenses','amount','numeric'),('business_memberships','business_id','uuid'),('business_memberships','user_id','uuid'),('receipts','id','uuid'),('receipts','business_id','uuid'),('receipts','expense_id','uuid')) expected(t,c,u) join information_schema.columns actual on actual.table_schema='public' and actual.table_name=expected.t and actual.column_name=expected.c where actual.udt_name<>expected.u) then raise exception 'Core column types differ from the application contract; review inventory before repair';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='owner_id' and udt_name<>'uuid') then raise exception 'Existing businesses.owner_id is not uuid';end if;
 if exists(select 1 from pg_constraint c where c.conrelid='public.businesses'::regclass and c.conname='businesses_owner_id_fkey'
  and not (c.contype='f' and c.confrelid='auth.users'::regclass
   and c.conkey=array[(select attnum from pg_attribute where attrelid='public.businesses'::regclass and attname='owner_id')]
   and c.confkey=array[(select attnum from pg_attribute where attrelid='auth.users'::regclass and attname='id')])) then
  raise exception 'Existing businesses_owner_id_fkey does not match auth.users(id)';
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='trial_ends_at' and udt_name<>'timestamptz') then raise exception 'Existing businesses.trial_ends_at must be timestamptz';end if;
 select exists(select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='trial_ends_at') into has_trial_deadline;
 if has_trial_deadline then
  execute 'select exists(select 1 from public.businesses where trial_ends_at is null)' into trial_missing;
  if trial_missing then raise exception 'Existing trial_ends_at contains NULL; review explicitly before reconciliation';end if;
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='date' and udt_name<>'date') then raise exception 'Existing expenses.date must be date';end if;
 select exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='expense_date') into has_expense_date;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='date') and not has_expense_date then raise exception 'Neither expenses.date nor expenses.expense_date exists';end if;
 if has_expense_date and exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='expense_date' and udt_name<>'date') then raise exception 'expenses.expense_date must be date to preserve it exactly';end if;
 if exists(select 1 from public.businesses b left join public.business_memberships m on m.business_id=b.id and m.role='owner' group by b.id having count(m.user_id)<>1) then raise exception 'Each business must have exactly one existing owner membership; no owner inferred';end if;
 if exists(select 1 from public.businesses b join public.business_memberships m on m.business_id=b.id where m.role<>'owner') then raise exception 'Unexpected non-owner membership requires manual review';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='owner_id') then
  execute 'select exists(select 1 from public.businesses b join public.business_memberships m on m.business_id=b.id and m.role=''owner'' where b.owner_id is not null and b.owner_id<>m.user_id)' into owner_mismatch;
  if owner_mismatch then raise exception 'Existing owner_id conflicts with the owner membership';end if;
 end if;
 if exists(select user_id from public.business_memberships group by user_id having count(*)>1) then raise exception 'A user belongs to multiple businesses; review before adding the single-owner constraint';end if;
 if exists(select 1 from public.businesses where currency is null) then raise exception 'Business currency is NULL: choose a currency explicitly before repair; no values overwritten';end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname not in ('receipt_storage_read','receipt_storage_upload','receipt_storage_delete')) then raise exception 'Unrecognized Storage policies require review; permissive policies could bypass tenant/trial restrictions';end if;
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('receipt_storage_read','receipt_storage_upload','receipt_storage_delete'))<>3
  or exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and (
   roles<>array['authenticated']::name[] or
   (policyname='receipt_storage_read' and (cmd<>'SELECT' or qual<>'((bucket_id = ''nexora-receipts''::text) AND can_access_receipt_path(name))' or with_check is not null)) or
   (policyname='receipt_storage_upload' and (cmd<>'INSERT' or qual is not null or with_check<>'((bucket_id = ''nexora-receipts''::text) AND can_access_receipt_path(name))')) or
   (policyname='receipt_storage_delete' and (cmd<>'DELETE' or qual<>'((bucket_id = ''nexora-receipts''::text) AND can_access_receipt_path(name))' or with_check is not null))
  )) then raise exception 'Existing Storage policies differ from the reviewed authenticated-only receipt policies';end if;
 if not exists(select 1 from storage.buckets where id='nexora-receipts' and public=false) then raise exception 'The existing nexora-receipts bucket must exist and remain private';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.can_access_receipt_path(text)') and p.prosecdef and coalesce(p.proconfig,'{}') @> array['search_path=""']) then raise exception 'Receipt path helper must be SECURITY DEFINER with an empty search_path';end if;
 if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then raise exception 'Storage RLS must already be enabled';end if;
 if exists(select 1 from public.businesses where created_at is null) then raise exception 'Original workspace creation dates required to preserve trials';end if;
 if to_regclass('public.business_memberships') is not null and not exists(select 1 from pg_constraint where conrelid='public.business_memberships'::regclass and conname='business_memberships_pkey') then raise exception 'Review membership schema before reconciliation';end if;
 if exists(select 1 from public.receipts r left join public.businesses b on b.id=r.business_id where b.id is null) then raise exception 'Receipt rows reference unknown businesses';end if;
 if exists(select 1 from pg_constraint c
  where c.conrelid='public.receipts'::regclass and c.contype='f' and c.confrelid='public.expenses'::regclass
   and c.conkey=array[(select attnum from pg_attribute where attrelid='public.receipts'::regclass and attname='expense_id'),(select attnum from pg_attribute where attrelid='public.receipts'::regclass and attname='business_id')]
   and c.confkey=array[(select attnum from pg_attribute where attrelid='public.expenses'::regclass and attname='id'),(select attnum from pg_attribute where attrelid='public.expenses'::regclass and attname='business_id')]
   and c.confdeltype<>'c') then raise exception 'Existing receipt-to-expense foreign key has unexpected delete behavior';end if;
 if not exists(select 1 from pg_constraint c
  where c.conrelid='public.receipts'::regclass and c.contype='f' and c.confrelid='public.expenses'::regclass
   and c.conkey=array[(select attnum from pg_attribute where attrelid='public.receipts'::regclass and attname='expense_id'),(select attnum from pg_attribute where attrelid='public.receipts'::regclass and attname='business_id')]
   and c.confkey=array[(select attnum from pg_attribute where attrelid='public.expenses'::regclass and attname='id'),(select attnum from pg_attribute where attrelid='public.expenses'::regclass and attname='business_id')]
   and c.confdeltype='c') then raise exception 'Expected tenant-scoped receipt-to-expense foreign key is missing';end if;
 if exists(select 1 from public.receipts r left join public.expenses e on e.id=r.expense_id and e.business_id=r.business_id where e.id is null) then raise exception 'Receipt rows do not match their expense tenant';end if;
 if exists(select 1 from pg_policies where schemaname='public' and policyname not in ('Users can view own profile','Users can update own profile','Users can view own businesses','Users can create businesses','Users can update own businesses','Users can view business categories','Users can manage business categories','Users can view business expenses','Users can insert business expenses','Users can update business expenses','Users can delete business expenses','expense_insert','expense_update','expense_delete','category_insert','category_update','category_delete','profile_insert','membership_read','receipt_metadata_read','memberships_select_own','businesses_select_member','categories_delete_member','categories_insert_member','categories_select_member','categories_update_member','expenses_delete_member','expenses_insert_member','expenses_select_member','expenses_update_member','profiles_insert_own','profiles_select_own','profiles_update_own','receipts_delete_member','receipts_insert_member','receipts_select_member')) then raise exception 'Unrecognized public RLS policies: inspect inventory before altering access';end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename in ('categories','expenses','receipts') and policyname in ('categories_delete_member','categories_insert_member','categories_update_member','expenses_delete_member','expenses_insert_member','expenses_update_member','receipts_delete_member','receipts_insert_member'))<>8
  or exists(select 1 from (values
   ('categories_delete_member','DELETE','is_business_member(business_id)'::text,null::text),
   ('categories_insert_member','INSERT',null::text,'is_business_member(business_id)'::text),
   ('categories_update_member','UPDATE','is_business_member(business_id)'::text,'is_business_member(business_id)'::text),
   ('expenses_delete_member','DELETE','is_business_member(business_id)'::text,null::text),
   ('expenses_insert_member','INSERT',null::text,'(is_business_member(business_id) AND (created_by = ( SELECT auth.uid() AS uid)))'::text),
   ('expenses_update_member','UPDATE','is_business_member(business_id)'::text,'(is_business_member(business_id) AND (created_by = ( SELECT auth.uid() AS uid)))'::text),
   ('receipts_delete_member','DELETE','is_business_member(business_id)'::text,null::text),
   ('receipts_insert_member','INSERT',null::text,'is_business_member(business_id)'::text)
  ) expected(policyname,cmd,qual,with_check)
  left join pg_policies actual on actual.schemaname='public' and actual.policyname=expected.policyname
  where actual.policyname is null or actual.roles<>array['authenticated']::name[] or actual.cmd<>expected.cmd
   or actual.qual is distinct from expected.qual or actual.with_check is distinct from expected.with_check
  ) then raise exception 'Existing permissive write policies differ from the reviewed membership-only policies';end if;
 foreach t in array array['profiles','businesses','categories','expenses','business_memberships','receipts'] loop
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
-- Reconcile legacy column names additively. Source columns and all existing values remain intact.
alter table public.businesses add column if not exists owner_id uuid;
update public.businesses b set owner_id=m.user_id
from public.business_memberships m
where m.business_id=b.id and m.role='owner' and b.owner_id is null;
alter table public.businesses alter column owner_id set not null;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.businesses'::regclass and contype='f'
   and conkey=array[(select attnum from pg_attribute where attrelid='public.businesses'::regclass and attname='owner_id')]
   and confrelid='auth.users'::regclass
   and confkey=array[(select attnum from pg_attribute where attrelid='auth.users'::regclass and attname='id')]
   ) then
  alter table public.businesses add constraint businesses_owner_id_fkey foreign key(owner_id) references auth.users(id) on delete cascade;
 end if;
end $$;
alter table public.businesses add column if not exists trial_ends_at timestamptz;
update public.businesses set trial_ends_at=created_at+interval '30 days' where trial_ends_at is null;
alter table public.categories add column if not exists color text;
alter table public.expenses add column if not exists date date;
do $$begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='expense_date') then
  execute 'update public.expenses set date=expense_date where date is null';
  execute 'alter table public.expenses alter column expense_date drop not null';
 end if;
 if exists(select 1 from public.expenses where date is null) then
  raise exception 'Some expenses have no date or expense_date; no fallback date will be invented';
 end if;
end $$;
alter table public.expenses alter column date set not null;
alter table public.expenses add column if not exists status text default 'Pending';
alter table public.expenses add column if not exists receipt_url text;
-- Restore the known read/update policies even if the partial install omitted them.
drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile" on profiles for select to authenticated using(id=auth.uid());
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "Users can view own businesses" on businesses;
create policy "Users can view own businesses" on businesses for select to authenticated using(owner_id=auth.uid());
drop policy if exists "Users can update own businesses" on businesses;
create policy "Users can update own businesses" on businesses for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists "Users can view business categories" on categories;
create policy "Users can view business categories" on categories for select to authenticated using(business_id in(select id from businesses where owner_id=auth.uid()));
drop policy if exists "Users can view business expenses" on expenses;
create policy "Users can view business expenses" on expenses for select to authenticated using(business_id in(select id from businesses where owner_id=auth.uid()));
`;
let sql = [
  "002_secure_saas.sql",
  "003_currency_and_release_security.sql",
  "004_workspace_and_receipt_metadata.sql",
]
  .map((f) =>
    readFileSync("supabase/migrations/" + f, "utf8")
      .replace(/^begin;\s*$/gm, "")
      .replace(/^commit;\s*$/gm, ""),
  )
  .join("\n");
sql = sql
  .replaceAll("'receipts'", "'nexora-receipts'")
  .replace(
    /insert into public\.receipts\(id,business_id,storage_path\)\s+select o\.id,b\.id,o\.name from storage\.objects o join public\.businesses b\s+on b\.id=public\.receipt_business\(o\.name\) or b\.owner_id=public\.receipt_business\(o\.name\)\s+where o\.bucket_id='nexora-receipts' on conflict do nothing;/,
    "-- Receipt rows are backfilled with the live metadata shape below.",
  );
sql = sql
  .replace(/create function /g, "create or replace function ")
  .replace(
    /create table public\.(business_memberships|receipts) /g,
    "create table if not exists public.$1 ",
  );
sql = sql.replace(
  /create (unique )?index (\w+)/g,
  "create $1index if not exists $2",
);
sql = sql.replace(/drop policy "([^"]+)" on/g, 'drop policy if exists "$1" on');
sql = sql.replace(
  /alter table (public\.)?(\w+) add column /g,
  "alter table $1$2 add column if not exists ",
);
sql = sql.replace(
  /alter table expenses drop constraint expenses_category_id_fkey;/,
  "alter table expenses drop constraint if exists expenses_category_id_fkey;",
);
sql = sql.replace(
  /(alter table (?:public\.)?(\w+) add constraint (\w+) [^;]+;)/g,
  (_, statement, table, name) =>
    `do $$begin if not exists(select 1 from pg_constraint where conrelid='public.${table}'::regclass and conname='${name}') then ${statement} end if;end $$;`,
);
sql = sql.replace(
  /create policy (\w+) on (?:public\.)?(\w+)(?=\s)/g,
  "drop policy if exists $1 on public.$2;\ncreate policy $1 on public.$2",
);
sql = sql.replace(
  /create policy (\w+) on storage.objects/g,
  "drop policy if exists $1 on storage.objects;\ncreate policy $1 on storage.objects",
);
sql = sql.replace(
  /create trigger (\w+) ([^;]+?) on ((?:public\.|storage\.)?\w+)/g,
  "drop trigger if exists $1 on $3;\ncreate trigger $1 $2 on $3",
);
sql = sql.replace(
  "insert into subscriptions(business_id) select id from businesses on conflict do nothing;",
  () => `do $$begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='trial_ends_at') then
 execute 'insert into public.subscriptions(business_id,trial_ends_at) select id,trial_ends_at from public.businesses';
 else
 insert into public.subscriptions(business_id,trial_ends_at) select id,created_at+interval '30 days' from public.businesses;
 end if;
end $$;`,
);
// Use PostgreSQL built-in UUID generation; this partial schema may omit uuid-ossp.
sql = sql.replaceAll("uuid_generate_v4()", "gen_random_uuid()");
// Never rewrite existing application field values during this repair.
sql = sql.replace(
  "update public.businesses set currency='ZAR' where currency is null;",
  "-- NULL currencies are rejected by preflight rather than silently rewritten.",
);
// Remove reliance on existing constraint names: install fresh mandatory checks.
sql = sql.replace(
  /\b(expense_amount_valid|expense_status_valid|expense_minor_units|business_currency_supported|expenses_category_tenant_fk)\b/g,
  "nexora_reconciled_$1",
);
// Existing currency columns also need the same enforced contract.
sql += `
 alter table public.expenses alter column currency set not null;
 alter table public.expenses add constraint nexora_reconciled_currency check(currency in ('ZAR','USD','EUR'));
 -- Strip dangerous inherited/default privileges (TRUNCATE bypasses RLS).
 revoke all on public.profiles,public.businesses,public.categories,public.expenses,public.business_memberships,public.receipts,public.subscriptions,public.billing_environment,public.billing_orders,public.payment_events,public.billing_notifications from public,anon,authenticated;
 grant usage on schema public to authenticated,service_role;
 grant select,insert,update,delete on public.profiles,public.businesses,public.categories,public.expenses to authenticated,service_role;
 grant select on public.business_memberships,public.receipts,public.billing_orders,public.payment_events to authenticated;
 grant select(business_id,trial_ends_at,status,paid_until,cancel_at_period_end,created_at) on public.subscriptions to authenticated;
 grant select,insert,update,delete on public.business_memberships,public.receipts,public.subscriptions,public.billing_environment,public.billing_orders,public.payment_events,public.billing_notifications to service_role;
 revoke all on function public.billing_access(),public.bootstrap_business(text),public.owns_business(uuid),public.can_write_business(uuid),public.receipt_business(text) from public,anon,authenticated;
 grant execute on function public.billing_access(),public.bootstrap_business(text) to authenticated;
 grant execute on function public.owns_business(uuid),public.can_write_business(uuid),public.receipt_business(text) to authenticated,service_role;
`;
sql += `
-- Replace the live membership-only write policies. PostgreSQL ORs permissive policies.
drop policy if exists categories_delete_member on public.categories;
drop policy if exists categories_insert_member on public.categories;
drop policy if exists categories_update_member on public.categories;
drop policy if exists expenses_delete_member on public.expenses;
drop policy if exists expenses_insert_member on public.expenses;
drop policy if exists expenses_update_member on public.expenses;
drop policy if exists receipts_delete_member on public.receipts;
drop policy if exists receipts_insert_member on public.receipts;
drop policy if exists expense_insert on public.expenses;
create policy expense_insert on public.expenses for insert to authenticated
 with check(public.can_write_business(business_id) and created_by=auth.uid());
drop policy if exists expense_update on public.expenses;
create policy expense_update on public.expenses for update to authenticated
 using(public.can_write_business(business_id) and created_by=auth.uid())
 with check(public.can_write_business(business_id) and created_by=auth.uid());

-- The live metadata table has a required expense link and no Storage-object FK.
-- Keep its existing tenant-scoped expense FK and add an independent Storage link.
alter table public.receipts alter column expense_id drop not null;
alter table public.receipts add column if not exists storage_object_id uuid;
update public.receipts r set storage_object_id=o.id
from storage.objects o
where o.bucket_id='nexora-receipts' and o.name=r.storage_path and r.storage_object_id is null;
create unique index if not exists receipts_storage_object_id_key
 on public.receipts(storage_object_id) where storage_object_id is not null;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.receipts'::regclass and conname='receipts_storage_object_id_fkey') then
  alter table public.receipts add constraint receipts_storage_object_id_fkey
   foreign key(storage_object_id) references storage.objects(id) on delete cascade not valid;
 end if;
end $$;
alter table public.receipts validate constraint receipts_storage_object_id_fkey;

create or replace function public.can_access_receipt_path(p_path text) returns boolean
 language plpgsql stable security definer set search_path='' as $$
declare parts text[]; business_uuid uuid; expense_uuid uuid;
begin
 if p_path is null then return false; end if;
 parts:=string_to_array(p_path,'/');
 if cardinality(parts)=2 then
  if parts[1]='' or parts[2] in ('','.','..') then return false; end if;
  begin business_uuid:=parts[1]::uuid; exception when invalid_text_representation then return false; end;
  return business_uuid=auth.uid() or public.is_business_member(business_uuid);
 elsif cardinality(parts)=3 then
  if parts[1]='' or parts[2]='' or parts[3] in ('','.','..') then return false; end if;
  begin business_uuid:=parts[1]::uuid; expense_uuid:=parts[2]::uuid;
  exception when invalid_text_representation then return false; end;
  return public.is_business_member(business_uuid) and exists(
   select 1 from public.expenses e where e.id=expense_uuid and e.business_id=business_uuid
  );
 end if;
 return false;
end; $$;
revoke all on function public.can_access_receipt_path(text) from public,anon,authenticated;
grant execute on function public.can_access_receipt_path(text) to authenticated,service_role;

-- Reconcile metadata without changing existing receipt IDs or dropping rows.
insert into public.receipts(business_id,expense_id,storage_path,file_name,content_type,storage_object_id)
select b.id,null,o.name,regexp_replace(o.name,'^.*/',''),o.metadata->>'mimetype',o.id
from storage.objects o
join public.businesses b on b.id=public.receipt_business(o.name) or b.owner_id=public.receipt_business(o.name)
where o.bucket_id='nexora-receipts'
 and not exists(select 1 from public.receipts r where r.storage_path=o.name or r.storage_object_id=o.id)
on conflict(storage_path) do update set
 business_id=excluded.business_id,
 file_name=excluded.file_name,
 content_type=excluded.content_type,
 storage_object_id=excluded.storage_object_id;

create or replace function public.sync_receipt_metadata() returns trigger
 language plpgsql security definer set search_path='' as $$
declare business_uuid uuid; file_label text;
begin
 if tg_op='UPDATE' and old.bucket_id='nexora-receipts' and new.bucket_id<>'nexora-receipts' then
  raise exception 'Receipt objects cannot be moved out of the private receipt bucket';
 end if;
 if new.bucket_id<>'nexora-receipts' then return new; end if;
 business_uuid:=public.receipt_business(new.name);
 select b.id into business_uuid from public.businesses b
  where b.id=business_uuid or b.owner_id=business_uuid
  order by (b.id=business_uuid) desc limit 1;
 file_label:=regexp_replace(new.name,'^.*/','');
 if business_uuid is null or file_label='' then raise exception 'Receipt path is not attached to a business'; end if;

 update public.receipts set business_id=business_uuid,storage_path=new.name,file_name=file_label,
  content_type=new.metadata->>'mimetype',storage_object_id=new.id
 where storage_object_id=new.id;
 if not found then
  update public.receipts set business_id=business_uuid,file_name=file_label,
   content_type=new.metadata->>'mimetype',storage_object_id=new.id
  where storage_path=new.name;
 end if;
 if not found then
  insert into public.receipts(business_id,expense_id,storage_path,file_name,content_type,storage_object_id)
  values(business_uuid,null,new.name,file_label,new.metadata->>'mimetype',new.id);
 end if;
 if tg_op='UPDATE' and old.name is distinct from new.name then
  update public.expenses set receipt_url=new.name
  where business_id=business_uuid and receipt_url=old.name;
 end if;
 return new;
end; $$;
revoke all on function public.sync_receipt_metadata() from public,anon,authenticated;

create or replace function public.sync_expense_receipt_link() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.receipt_url is distinct from new.receipt_url and old.receipt_url is not null then
  update public.receipts set expense_id=null
  where business_id=old.business_id and expense_id=old.id and storage_path=old.receipt_url;
 end if;
 if new.receipt_url is not null then
  update public.receipts set expense_id=new.id
  where business_id=new.business_id and storage_path=new.receipt_url
   and (expense_id is null or expense_id=new.id);
  if not found then raise exception 'Receipt metadata must exist in the same business before attachment'; end if;
 end if;
 return new;
end; $$;
revoke all on function public.sync_expense_receipt_link() from public,anon,authenticated;
drop trigger if exists nexora_expense_receipt_link on public.expenses;
create trigger nexora_expense_receipt_link after insert or update of receipt_url on public.expenses
 for each row execute function public.sync_expense_receipt_link();

create or replace function public.detach_receipt_before_expense_delete() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 update public.receipts set expense_id=null
 where business_id=old.business_id and expense_id=old.id;
 return old;
end; $$;
revoke all on function public.detach_receipt_before_expense_delete() from public,anon,authenticated;
drop trigger if exists nexora_detach_receipt_before_expense_delete on public.expenses;
create trigger nexora_detach_receipt_before_expense_delete before delete on public.expenses
 for each row execute function public.detach_receipt_before_expense_delete();

drop policy if exists receipt_insert on storage.objects;
drop policy if exists receipt_read on storage.objects;
drop policy if exists receipt_delete on storage.objects;
drop policy if exists receipt_storage_read on storage.objects;
drop policy if exists receipt_storage_upload on storage.objects;
drop policy if exists receipt_storage_delete on storage.objects;
create policy receipt_storage_read on storage.objects for select to authenticated
 using(bucket_id='nexora-receipts' and public.can_access_receipt_path(name));
create policy receipt_storage_upload on storage.objects for insert to authenticated
 with check(bucket_id='nexora-receipts' and public.can_access_receipt_path(name)
  and public.can_write_business(public.receipt_business(name)));
create policy receipt_storage_delete on storage.objects for delete to authenticated
 using(bucket_id='nexora-receipts' and public.can_access_receipt_path(name)
  and public.can_write_business(public.receipt_business(name))
  and not exists(select 1 from public.expenses e where e.receipt_url=name)
  and not exists(select 1 from public.receipts r where r.storage_path=name and r.expense_id is not null));
`;
// The existing bucket is retained; no bucket or Storage object is recreated.
sql = sql.replace(
  "-- New private receipt paths:",
  () => "do $$begin if not exists(select 1 from storage.buckets where id='nexora-receipts' and public=false) then raise exception 'Private nexora-receipts bucket missing'; end if; end $$;\n-- New private receipt paths:",
);
mkdirSync("supabase/reconciliation", { recursive: true });
writeFileSync(
  "supabase/reconciliation/005_reconcile_missing_billing.sql",
  "-- CONDITIONAL REPAIR ONLY: NOT part of the normal 001–004 chain.\n-- Generated by scripts/build-reconciliation.mjs. Review live inventory before applying.\n" +
    preflight +
    sql +
    "\nnotify pgrst,'reload schema';\ncommit;\n",
);
console.log("Prepared conditional reconciliation; no database contacted.");
