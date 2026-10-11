begin;
-- Additive owner memberships. Team invitations/roles are not exposed by this release.
create table public.business_memberships (
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'owner' check(role='owner'),
 created_at timestamptz not null default now(),
 primary key(business_id,user_id),
 unique(user_id)
);
alter table public.business_memberships enable row level security;
create policy membership_read on public.business_memberships for select to authenticated
 using(user_id=auth.uid() and public.owns_business(business_id));
revoke all on public.business_memberships from public,anon,authenticated;
grant select on public.business_memberships to authenticated;
grant all on public.business_memberships to service_role;
insert into public.business_memberships(business_id,user_id)
 select id,owner_id from public.businesses on conflict do nothing;

-- Keep the exact named PostgREST argument used by BusinessContext.
create or replace function public.bootstrap_business(business_name text default 'My business')
 returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid; seeded uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
  raise exception 'Verify your email before creating a workspace';end if;
 insert into public.profiles(id,full_name) values(auth.uid(),(select raw_user_meta_data->>'full_name' from auth.users where id=auth.uid())) on conflict(id) do nothing;
 -- Unique owner index arbitrates concurrent logins, not just sequential calls.
 insert into public.businesses(owner_id,name) values(auth.uid(),left(coalesce(nullif(trim(business_name),''),'My business'),120)) on conflict(owner_id) do nothing;
 select id into bid from public.businesses where owner_id=auth.uid();
 insert into public.business_memberships(business_id,user_id) values(bid,auth.uid()) on conflict do nothing;
 insert into public.subscriptions(business_id) values(bid) on conflict do nothing returning business_id into seeded;
 if seeded is not null and not exists(select 1 from public.categories where business_id=bid) then
  insert into public.categories(business_id,name,color) select bid,n,c from (values('Software','#7c3aed'),('Travel','#0284c7'),('Meals','#ea580c'),('Supplies','#16a34a'),('Utilities','#64748b')) v(n,c);
 end if;
 return bid;
end;$$;
revoke all on function public.bootstrap_business(text) from public,anon;
grant execute on function public.bootstrap_business(text) to authenticated;

-- Storage is the source of truth. Clients cannot forge receipt metadata.
create table public.receipts (
 id uuid primary key references storage.objects(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 storage_path text not null unique,
 created_at timestamptz not null default now()
);
alter table public.receipts enable row level security;
create policy receipt_metadata_read on public.receipts for select to authenticated
 using(public.owns_business(business_id));
revoke all on public.receipts from public,anon,authenticated;
grant select on public.receipts to authenticated;
grant all on public.receipts to service_role;
create function public.sync_receipt_metadata() returns trigger language plpgsql security definer set search_path=public as $$
declare bid uuid;
begin
 if new.bucket_id='nexora-receipts' then
  select b.id into bid from public.businesses b
   where b.id=public.receipt_business(new.name) or b.owner_id=public.receipt_business(new.name)
   order by (b.id=public.receipt_business(new.name)) desc limit 1;
  if bid is not null then
   insert into public.receipts(id,business_id,storage_path) values(new.id,bid,new.name)
    on conflict(id) do update set business_id=excluded.business_id,storage_path=excluded.storage_path;
  else
   delete from public.receipts where id=new.id;
  end if;
 else
  delete from public.receipts where id=new.id;
 end if;
 return new;
end;$$;
revoke all on function public.sync_receipt_metadata() from public,anon,authenticated;
create trigger nexora_receipt_metadata after insert or update of name,bucket_id on storage.objects
 for each row execute function public.sync_receipt_metadata();
insert into public.receipts(id,business_id,storage_path)
 select o.id,b.id,o.name from storage.objects o join public.businesses b
 on b.id=public.receipt_business(o.name) or b.owner_id=public.receipt_business(o.name)
 where o.bucket_id='nexora-receipts' on conflict do nothing;
-- Enforce private bucket even if an administrator previously changed its visibility.
update storage.buckets set public=false,file_size_limit=5242880,
 allowed_mime_types=array['image/jpeg','image/png','application/pdf'] where id='nexora-receipts';
-- Deny references to nonexistent receipts; unchanged legacy references remain intact.
create or replace function public.check_receipt_path() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and new.receipt_url is not distinct from old.receipt_url then return new;end if;
 if new.receipt_url is not null then
  if split_part(new.receipt_url,'/',1)<>new.business_id::text then raise exception 'Receipt must belong to business';end if;
  if not exists(select 1 from storage.objects where bucket_id='nexora-receipts' and name=new.receipt_url) then
   raise exception 'Receipt must be uploaded before attaching it';end if;
 end if;
 return new;
end;$$;
notify pgrst,'reload schema';
commit;
