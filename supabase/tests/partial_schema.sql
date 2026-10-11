-- Local-only fixture matching the observed production receipt and Storage contracts.
drop policy "Users can view own businesses" on public.businesses;
drop policy "Users can create businesses" on public.businesses;
drop policy "Users can update own businesses" on public.businesses;
drop policy "Users can view business categories" on public.categories;
drop policy "Users can manage business categories" on public.categories;
drop policy "Users can view business expenses" on public.expenses;
drop policy "Users can insert business expenses" on public.expenses;
drop policy "Users can update business expenses" on public.expenses;
drop policy "Users can delete business expenses" on public.expenses;
alter table public.businesses drop column owner_id;
alter table public.categories drop column color;
alter table public.expenses rename column date to expense_date;
alter table public.expenses drop column status;
alter table public.expenses drop column receipt_url;
alter table public.expenses alter column merchant drop not null;
alter table public.expenses add column created_by uuid default auth.uid();
alter table public.expenses add column updated_at timestamptz not null default now();
create table public.business_memberships(
 business_id uuid references public.businesses(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 role text default 'owner' check(role='owner'),
 created_at timestamptz default now(),
 primary key(business_id,user_id),
 unique(user_id)
);
create unique index expenses_id_business_id_key on public.expenses(id,business_id);
create table public.receipts(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 expense_id uuid not null,
 storage_path text not null unique,
 file_name text not null,
 content_type text,
 created_at timestamptz not null default now(),
 constraint receipts_expense_id_business_id_fkey
  foreign key(expense_id,business_id) references public.expenses(id,business_id) on delete cascade
);
delete from storage.buckets where id in('receipts','nexora-receipts');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('nexora-receipts','nexora-receipts',false,10485760,array['image/jpeg','image/png','application/pdf']);
create function public.is_business_member(uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.business_memberships m where m.business_id=$1 and m.user_id=auth.uid());
$$;
create function public.can_access_receipt_path(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select cardinality(string_to_array(p_path,'/'))=3
  and public.is_business_member(split_part(p_path,'/',1)::uuid)
  and exists(select 1 from public.expenses e where e.business_id=split_part(p_path,'/',1)::uuid and e.id=split_part(p_path,'/',2)::uuid);
$$;
drop policy "Users can upload their own receipts" on storage.objects;
drop policy "Users can view their own receipts" on storage.objects;
create policy receipt_storage_read on storage.objects for select to authenticated
 using(bucket_id='nexora-receipts' and can_access_receipt_path(name));
create policy receipt_storage_upload on storage.objects for insert to authenticated
 with check(bucket_id='nexora-receipts' and can_access_receipt_path(name));
create policy receipt_storage_delete on storage.objects for delete to authenticated
 using(bucket_id='nexora-receipts' and can_access_receipt_path(name));

insert into auth.users(id) values('dddddddd-dddd-dddd-dddd-dddddddddddd');
insert into businesses(name,created_at) values('Preserved existing workspace',now()-interval '40 days');
insert into categories(business_id,name,created_at) select id,'Preserved existing category',now()-interval '39 days' from businesses;
insert into expenses(business_id,created_by,merchant,amount,expense_date)
 select id,'dddddddd-dddd-dddd-dddd-dddddddddddd','Preserved existing expense',12.34,current_date from businesses;
insert into profiles(id,full_name) values('dddddddd-dddd-dddd-dddd-dddddddddddd','Existing name');
insert into business_memberships(business_id,user_id) select id,'dddddddd-dddd-dddd-dddd-dddddddddddd' from businesses;
insert into storage.objects(bucket_id,name)
 select 'nexora-receipts',b.id::text||'/'||e.id::text||'/existing.pdf'
 from businesses b join expenses e on e.business_id=b.id;
insert into receipts(business_id,expense_id,storage_path,file_name,content_type,created_at)
 select b.id,e.id,o.name,'existing.pdf','application/pdf',now()-interval '15 days'
 from storage.objects o
 join businesses b on split_part(o.name,'/',1)=b.id::text
 join expenses e on e.business_id=b.id;
create temp table original_rows as
 select 'profiles'::text as table_name,id::text as row_key,to_jsonb(p) as original from profiles p
 union all select 'businesses',id::text,to_jsonb(b) from businesses b
 union all select 'categories',id::text,to_jsonb(c) from categories c
 union all select 'expenses',id::text,to_jsonb(e) from expenses e
 union all select 'business_memberships',business_id::text||'/'||user_id::text,to_jsonb(m) from business_memberships m
 union all select 'receipts',id::text,to_jsonb(r) from receipts r;
-- Model broad hosted-project default grants so reconciliation must actively strip them.
grant all on public.profiles,public.businesses,public.categories,public.expenses,public.business_memberships,public.receipts to public,anon,authenticated;
alter default privileges in schema public grant all on tables to anon,authenticated;
alter default privileges in schema public grant execute on functions to anon,authenticated;
create policy categories_delete_member on public.categories for delete to authenticated using(is_business_member(business_id));
create policy categories_insert_member on public.categories for insert to authenticated with check(is_business_member(business_id));
create policy categories_select_member on public.categories for select to authenticated using(is_business_member(business_id));
create policy categories_update_member on public.categories for update to authenticated using(is_business_member(business_id)) with check(is_business_member(business_id));
create policy expenses_delete_member on public.expenses for delete to authenticated using(is_business_member(business_id));
create policy expenses_insert_member on public.expenses for insert to authenticated with check(is_business_member(business_id) and created_by=(select auth.uid()));
create policy expenses_select_member on public.expenses for select to authenticated using(is_business_member(business_id));
create policy expenses_update_member on public.expenses for update to authenticated using(is_business_member(business_id)) with check(is_business_member(business_id) and created_by=(select auth.uid()));
create policy receipts_delete_member on public.receipts for delete to authenticated using(is_business_member(business_id));
create policy receipts_insert_member on public.receipts for insert to authenticated with check(is_business_member(business_id));
create policy receipts_select_member on public.receipts for select to authenticated using(is_business_member(business_id));
