begin;
-- Preserve original records as ZAR. No exchange rates or subscription prices are added.
alter table public.expenses add column currency text not null default 'ZAR' check(currency in ('ZAR','USD','EUR'));
-- Unconstrained numeric plus an explicit check rejects excess precision instead of silently rounding it.
alter table public.expenses alter column amount type numeric;
alter table public.expenses add constraint expense_minor_units check(amount=round(amount,2) and amount<=99999999.99);
update public.businesses set currency='ZAR' where currency is null;
alter table public.businesses alter column currency set not null;
alter table public.businesses add constraint business_currency_supported check(currency in ('ZAR','USD','EUR'));
create index expense_currency_date on public.expenses(business_id,currency,date desc);
-- Explicit privileges avoid dependence on project-wide default grants.
grant select,insert,update,delete on public.profiles,public.businesses,public.categories,public.expenses to authenticated,service_role;
grant select,insert,update,delete on public.subscriptions,public.billing_orders,public.payment_events,public.billing_environment,public.billing_notifications to service_role;
revoke all on public.subscriptions,public.billing_environment,public.billing_notifications from anon,authenticated;
grant select(business_id,trial_ends_at,status,paid_until,cancel_at_period_end,created_at) on public.subscriptions to authenticated;
grant select on public.billing_orders,public.payment_events to authenticated;
revoke insert,update,delete on public.billing_orders,public.payment_events from anon,authenticated;
-- An owner must not be able to reassign a profile or business UUID.
create function public.immutable_record_id() returns trigger language plpgsql set search_path=public as $$begin if new.id<>old.id then raise exception 'Record ID is immutable';end if;return new;end;$$;
create trigger profile_id_immutable before update on public.profiles for each row execute function public.immutable_record_id();
create trigger business_id_immutable before update on public.businesses for each row execute function public.immutable_record_id();
-- Fixed search paths on trigger helpers; billing functions retain service-only grants.
alter function public.immutable_tenant() set search_path=public;
alter function public.receipt_business(text) set search_path=public;
alter function public.check_receipt_path() set search_path=public;
revoke all on function public.owns_business(uuid),public.can_write_business(uuid),public.receipt_business(text) from public;
grant execute on function public.owns_business(uuid),public.can_write_business(uuid),public.receipt_business(text) to authenticated,service_role;
commit;
