begin;
-- Additive migration: apply after 001. No existing expense data is removed.
create table public.subscriptions (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 trial_ends_at timestamptz not null default now() + interval '30 days',
 status text not null default 'trial' check(status in ('trial','active','cancelled','past_due')),
 paid_until timestamptz,
 cancel_at_period_end boolean not null default false,
 provider_token text unique,
 created_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy subscription_read on public.subscriptions for select using (exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid()));
alter table subscriptions add column provider_mode text check(provider_mode in ('sandbox','live'));
create table billing_environment(id boolean primary key default true check(id),mode text not null default 'sandbox' check(mode in ('sandbox','live')));
insert into billing_environment(id) values(true);
alter table billing_environment enable row level security;
-- Only service role writes billing state. Never grant a browser a billing write policy.
create table public.billing_orders (
 id uuid primary key default uuid_generate_v4(),
 business_id uuid not null references public.businesses(id),
 amount numeric(10,2) not null default 69 check(amount=69),
 mode text not null check(mode in ('sandbox','live')),
 created_at timestamptz not null default now()
);
create unique index one_owner_business on public.businesses(owner_id);
create table public.payment_events (
 provider_payment_id text primary key,
 order_id uuid not null references public.billing_orders(id),
 received_at timestamptz not null default now()
);
alter table public.billing_orders enable row level security;
alter table public.payment_events enable row level security;
create policy orders_read on public.billing_orders for select using(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid()));

create function public.owns_business(bid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from businesses where id=bid and owner_id=auth.uid());
$$;
create function public.can_write_business(bid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.owns_business(bid) and exists(select 1 from subscriptions where business_id=bid and (trial_ends_at>now() or (status in ('active','cancelled') and paid_until>now() and provider_mode=(select mode from billing_environment where id))));
$$;
create function public.billing_access() returns table(business_id uuid, trial_days integer, trial_ends_at timestamptz,status text,paid_until timestamptz,cancel_at_period_end boolean,can_write boolean,has_subscription boolean)
 language sql stable security definer set search_path=public as $$
 select s.business_id, greatest(0,ceil(extract(epoch from (s.trial_ends_at-now()))/86400))::integer,s.trial_ends_at,case when s.status='active' and s.paid_until<=now() then 'past_due' else s.status end,s.paid_until,s.cancel_at_period_end,public.can_write_business(s.business_id),(s.provider_token is not null and not s.cancel_at_period_end)
 from subscriptions s join businesses b on b.id=s.business_id where b.owner_id=auth.uid();
$$;
revoke all on function public.billing_access() from public;
grant execute on function public.billing_access() to authenticated;

-- Atomic, idempotent onboarding starts exactly one trial. Metadata cannot set dates.
create function public.bootstrap_business(business_name text default 'My business') returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid; seeded uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Verify your email before creating a workspace';end if;
 insert into profiles(id,full_name) values(auth.uid(),(select raw_user_meta_data->>'full_name' from auth.users where id=auth.uid())) on conflict(id) do nothing;
 insert into businesses(owner_id,name) values(auth.uid(),left(coalesce(nullif(trim(business_name),''),'My business'),120)) on conflict(owner_id) do nothing;
 select id into bid from businesses where owner_id=auth.uid();
 insert into subscriptions(business_id) values(bid) on conflict do nothing returning business_id into seeded;
 if seeded is not null and not exists(select 1 from categories where business_id=bid) then
 insert into categories(business_id,name,color) select bid,n,c from (values('Software','#7c3aed'),('Travel','#0284c7'),('Meals','#ea580c'),('Supplies','#16a34a'),('Utilities','#64748b')) v(n,c);
 end if;
 return bid;
end; $$;
revoke all on function public.bootstrap_business(text) from public;
grant execute on function public.bootstrap_business(text) to authenticated;
insert into subscriptions(business_id) select id from businesses on conflict do nothing;
-- Prevent bypass by creating additional businesses/trials.
drop policy "Users can create businesses" on businesses;

alter table expenses add constraint expense_amount_valid check(amount>0);
alter table expenses add constraint expense_status_valid check(status in ('Pending','Approved'));
create unique index categories_tenant_key on categories(business_id,id);
-- Replace cross-tenant category FK with composite relationship; preserve null category.
alter table expenses drop constraint expenses_category_id_fkey;
alter table expenses add constraint expenses_category_tenant_fk foreign key(business_id,category_id) references categories(business_id,id);
create index expense_business_date on expenses(business_id,date desc);
drop policy "Users can insert business expenses" on expenses;
drop policy "Users can update business expenses" on expenses;
drop policy "Users can delete business expenses" on expenses;
create policy expense_insert on expenses for insert with check(public.can_write_business(business_id));
create policy expense_update on expenses for update using(public.can_write_business(business_id)) with check(public.can_write_business(business_id));
create policy expense_delete on expenses for delete using(public.can_write_business(business_id));
drop policy "Users can manage business categories" on categories;
create policy category_insert on categories for insert with check(public.can_write_business(business_id));
create policy category_update on categories for update using(public.can_write_business(business_id)) with check(public.can_write_business(business_id));
create policy category_delete on categories for delete using(public.can_write_business(business_id));
create policy profile_insert on profiles for insert with check(id=auth.uid());

-- Immutable ownership prevents transferring expenses/businesses to bypass a trial.
create function public.immutable_tenant() returns trigger language plpgsql as $$
begin
 if tg_table_name='businesses' then
 if new.owner_id<>old.owner_id then raise exception 'Owner is immutable'; end if;
 else
 if new.business_id<>old.business_id then raise exception 'Business is immutable'; end if;
 end if;
 return new;
end; $$;
create trigger immutable_business before update on businesses for each row execute function public.immutable_tenant();
create trigger immutable_expense before update on expenses for each row execute function public.immutable_tenant();
create trigger immutable_category before update on categories for each row execute function public.immutable_tenant();

-- New private receipt paths: business UUID / random UUID.extension.
-- Legacy owner-ID paths remain readable to their original owner only.
update storage.buckets set file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','application/pdf'] where id='nexora-receipts';
drop policy "Users can upload their own receipts" on storage.objects;
drop policy "Users can view their own receipts" on storage.objects;
create function public.receipt_business(path text) returns uuid language plpgsql immutable as $$
begin return split_part(path,'/',1)::uuid; exception when invalid_text_representation then return null; end; $$;
create policy receipt_insert on storage.objects for insert with check(bucket_id='nexora-receipts' and public.can_write_business(public.receipt_business(name)));
create policy receipt_read on storage.objects for select using(bucket_id='nexora-receipts' and (public.owns_business(public.receipt_business(name)) or split_part(name,'/',1)=auth.uid()::text));
create policy receipt_delete on storage.objects for delete using(bucket_id='nexora-receipts' and public.can_write_business(public.receipt_business(name)) and not exists(select 1 from public.expenses e where e.receipt_url=name));
create function public.check_receipt_path() returns trigger language plpgsql as $$
begin
 if tg_op='UPDATE' and new.receipt_url is not distinct from old.receipt_url then return new; end if;
 if new.receipt_url is not null and split_part(new.receipt_url,'/',1)<>new.business_id::text then raise exception 'Receipt must belong to business'; end if;
 return new;
end; $$;
create trigger receipt_tenant before insert or update of receipt_url on expenses for each row execute function public.check_receipt_path();

-- Called only after all Payfast verification checks. Event + entitlement commit together.
create function public.record_payment(payment_id text,order_ref uuid,token text,expected_mode text) returns void language plpgsql security definer set search_path=public as $$
declare bid uuid; last_event timestamptz;
begin
 select business_id into bid from billing_orders where id=order_ref and mode=expected_mode;
 if bid is null or expected_mode<>(select mode from billing_environment where id) then raise exception 'Unknown billing order or environment mismatch'; end if;
 perform 1 from subscriptions where business_id=bid for update;
 if exists(select 1 from subscriptions where business_id=bid and provider_token is not null and provider_token<>token and not cancel_at_period_end) then raise exception 'Subscription token mismatch'; end if;
 if exists(select 1 from payment_events where provider_payment_id=payment_id) then return; end if;
 -- Multiple ITNs in the same billing period must not grant extra months.
 select max(e.received_at) into last_event from payment_events e join billing_orders o on o.id=e.order_id where o.business_id=bid;
 insert into payment_events(provider_payment_id,order_id) values(payment_id,order_ref);
 if last_event is not null and last_event>now()-interval '20 days' then return; end if;
 update billing_orders set state='active' where id=order_ref and state='pending';
 update subscriptions set provider_mode=expected_mode,trial_ends_at=least(trial_ends_at,now()),status=case when cancel_at_period_end and provider_token=token then 'cancelled' else 'active' end,
 cancel_at_period_end=case when provider_token=token then cancel_at_period_end else false end,provider_token=token,
 paid_until=greatest(now(),coalesce(paid_until,now()))+interval '1 month'
 where business_id=bid;
end; $$;
revoke all on function public.record_payment(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_payment(text,uuid,text,text) to service_role;
alter table billing_orders add column state text not null default 'pending' check(state in ('pending','active','cancelled','expired'));
create unique index one_open_checkout on billing_orders(business_id) where state in ('pending','active');
create function public.reserve_checkout(bid uuid,payment_mode text) returns uuid language plpgsql security definer set search_path=public as $$
declare order_id uuid;
begin
 if payment_mode<>(select mode from billing_environment where id) then raise exception 'Billing environment mismatch';end if;
 perform 1 from subscriptions where business_id=bid for update;
 if exists(select 1 from subscriptions where business_id=bid and provider_token is not null and not cancel_at_period_end) then raise exception 'Cancel the existing subscription before subscribing again'; end if;
 if exists(select 1 from billing_orders where business_id=bid and state='active') then raise exception 'Existing subscription is active'; end if;
 select id into order_id from billing_orders where business_id=bid and state='pending' and mode=payment_mode;
 if order_id is null then insert into billing_orders(business_id,mode) values(bid,payment_mode) returning id into order_id; end if;
 return order_id;
end; $$;
revoke all on function public.reserve_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_checkout(uuid,text) to service_role;
-- No raw provider tokens in browser queries.
revoke select on subscriptions from anon,authenticated;
grant select(business_id,trial_ends_at,status,paid_until,cancel_at_period_end,created_at) on subscriptions to authenticated;
create function public.cancel_billing(bid uuid,expected_token text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from subscriptions where business_id=bid for update;
 update subscriptions set status='cancelled',cancel_at_period_end=true where business_id=bid and provider_token=expected_token;
 if not found then raise exception 'Subscription changed; reconcile with provider'; end if;
 update billing_orders set state='cancelled' where business_id=bid and state='active';
end; $$;
revoke all on function public.cancel_billing(uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_billing(uuid,text) to service_role;
create table public.billing_notifications (
 event_hash text primary key,
 order_id uuid not null references billing_orders(id),
 status text not null check(status in ('FAILED','PENDING','CANCELLED')),
 received_at timestamptz not null default now()
);
alter table public.billing_notifications enable row level security;
create function public.record_billing_notification(event_id text,order_ref uuid,notification_status text,token text,expected_mode text) returns void language plpgsql security definer set search_path=public as $$
declare bid uuid;
begin
 select business_id into bid from billing_orders where id=order_ref and mode=expected_mode;
 if bid is null or expected_mode<>(select mode from billing_environment where id) then raise exception 'Invalid billing environment';end if;
 perform 1 from subscriptions where business_id=bid for update;
 insert into billing_notifications(event_hash,order_id,status) values(event_id,order_ref,notification_status) on conflict do nothing;
 if not found then return;end if;
 if notification_status='FAILED' then
 update subscriptions set status='past_due' where business_id=bid and provider_token=token and paid_until<=now() and not cancel_at_period_end;
 elsif notification_status='CANCELLED' then
 update subscriptions set status='cancelled',cancel_at_period_end=true where business_id=bid and provider_token=token;
 if found then update billing_orders set state='cancelled' where id=order_ref;end if;
 end if;
end; $$;
revoke all on function public.record_billing_notification(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_billing_notification(text,uuid,text,text,text) to service_role;

create policy payment_history_read on payment_events for select using(exists(select 1 from billing_orders o join businesses b on b.id=o.business_id where o.id=order_id and b.owner_id=auth.uid()));
commit;
