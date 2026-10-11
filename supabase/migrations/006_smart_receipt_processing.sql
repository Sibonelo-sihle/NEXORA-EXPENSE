begin;

alter table public.receipts
  add column if not exists storage_object_id uuid;
update public.receipts r
set storage_object_id = o.id
from storage.objects o
where o.bucket_id = 'nexora-receipts'
  and o.name = r.storage_path
  and r.storage_object_id is null;
update public.receipts r
set storage_object_id = r.id
where r.storage_object_id is null
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'nexora-receipts' and o.id = r.id
  );
create unique index if not exists receipts_storage_object_id_key
  on public.receipts (storage_object_id)
  where storage_object_id is not null;

create or replace function public.sync_receipt_storage_object_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id = 'nexora-receipts' then
    update public.receipts
    set storage_object_id = new.id
    where id = new.id or storage_path = new.name;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_receipt_storage_object_id() from public, anon, authenticated;
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'storage.objects'::regclass
      and tgname = 'zz_sync_receipt_storage_object_id'
      and not tgisinternal
  ) then
    create trigger zz_sync_receipt_storage_object_id
      after insert or update of name, bucket_id on storage.objects
      for each row execute function public.sync_receipt_storage_object_id();
  end if;
end;
$$;

alter table public.receipts
  add constraint receipts_business_id_id_key unique (business_id, id);

create table public.receipt_processing (
  receipt_id uuid primary key,
  business_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('processing', 'needs_review', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 4),
  extracted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted_data) = 'object'),
  error_code text check (error_code is null or error_code in (
    'provider_unavailable',
    'provider_failed',
    'provider_timeout',
    'invalid_document',
    'processing_unavailable'
  )),
  duplicate_of_receipt_id uuid,
  expense_id uuid unique references public.expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, receipt_id)
    references public.receipts(business_id, id) on delete cascade,
  foreign key (business_id, duplicate_of_receipt_id)
    references public.receipts(business_id, id),
  unique (business_id, receipt_id)
);

create index receipt_processing_hash_lookup
  on public.receipt_processing (business_id, source_sha256);
create index receipt_processing_business_updated
  on public.receipt_processing (business_id, updated_at desc);

create table public.receipt_processing_rate_limits (
  business_id uuid not null references public.businesses(id) on delete cascade,
  minute_bucket timestamptz not null,
  request_count smallint not null check (request_count between 1 and 11),
  primary key (business_id, minute_bucket)
);
alter table public.receipt_processing_rate_limits enable row level security;
revoke all on public.receipt_processing_rate_limits from public, anon, authenticated;
grant select, insert, update, delete
  on public.receipt_processing_rate_limits to service_role;

alter table public.receipt_processing enable row level security;
create policy receipt_processing_owner_read
  on public.receipt_processing for select to authenticated
  using (public.owns_business(business_id));

revoke all on public.receipt_processing from public, anon, authenticated;
grant select on public.receipt_processing to authenticated;
grant select, insert, update, delete on public.receipt_processing to service_role;

create function public.begin_receipt_processing(
  p_business_id uuid,
  p_receipt_id uuid,
  p_source_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  current_row public.receipt_processing%rowtype;
  inserted_count integer;
  v_minute_bucket timestamptz := date_trunc('minute', clock_timestamp());
  v_request_count smallint;
begin
  if p_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt fingerprint';
  end if;
  if not exists (
    select 1 from public.receipts
    where id = p_receipt_id and business_id = p_business_id
  ) then
    raise exception 'Receipt not found in workspace';
  end if;

  insert into public.receipt_processing_rate_limits (
    business_id, minute_bucket, request_count
  ) values (p_business_id, v_minute_bucket, 1)
  on conflict (business_id, minute_bucket) do update
  set request_count = least(
    public.receipt_processing_rate_limits.request_count + 1,
    11
  )
  returning receipt_processing_rate_limits.request_count into v_request_count;
  delete from public.receipt_processing_rate_limits
  where minute_bucket < now() - interval '1 day';
  if v_request_count > 10 then
    return jsonb_build_object(
      'acquired', false, 'status', 'rate_limited',
      'attempt_count', 0, 'expense_id', null
    );
  end if;

  insert into public.receipt_processing (
    receipt_id, business_id, source_sha256, status, attempt_count
  ) values (
    p_receipt_id, p_business_id, p_source_sha256, 'processing', 1
  )
  on conflict (receipt_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    return jsonb_build_object(
      'acquired', true, 'status', 'processing',
      'attempt_count', 1, 'expense_id', null
    );
  end if;

  select * into current_row
  from public.receipt_processing
  where receipt_id = p_receipt_id
  for update;

  if current_row.business_id <> p_business_id
    or current_row.source_sha256 <> p_source_sha256 then
    raise exception 'Receipt identity changed';
  end if;
  if current_row.status = 'completed' then
    return jsonb_build_object(
      'acquired', false, 'status', current_row.status,
      'attempt_count', current_row.attempt_count,
      'expense_id', current_row.expense_id
    );
  end if;

  if current_row.status = 'processing'
    and current_row.updated_at > now() - interval '5 minutes'
  then
    return jsonb_build_object(
      'acquired', false, 'status', current_row.status,
      'attempt_count', current_row.attempt_count,
      'expense_id', current_row.expense_id
    );
  end if;
  if current_row.attempt_count >= 4 then
    return jsonb_build_object(
      'acquired', false, 'status', 'retry_limit',
      'attempt_count', current_row.attempt_count,
      'expense_id', current_row.expense_id
    );
  end if;

  update public.receipt_processing
  set status = 'processing',
      attempt_count = attempt_count + 1,
      error_code = null,
      updated_at = now()
  where receipt_id = p_receipt_id
  returning * into current_row;

  return jsonb_build_object(
    'acquired', true, 'status', current_row.status,
    'attempt_count', current_row.attempt_count,
    'expense_id', current_row.expense_id
  );
end;
$$;

create function public.finish_receipt_processing(
  p_business_id uuid,
  p_receipt_id uuid,
  p_status text,
  p_extracted_data jsonb,
  p_error_code text default null,
  p_duplicate_of_receipt_id uuid default null,
  p_create_expense boolean default false,
  p_merchant text default null,
  p_date date default null,
  p_amount numeric default null,
  p_currency text default null,
  p_description text default null,
  p_category_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  current_row public.receipt_processing%rowtype;
  receipt_path text;
  linked_expense_id uuid;
begin
  if p_status is null
    or p_status not in ('needs_review', 'completed', 'failed')
    or jsonb_typeof(p_extracted_data) is distinct from 'object' then
    raise exception 'Invalid receipt result';
  end if;
  if p_error_code is not null and p_error_code not in (
    'provider_unavailable', 'provider_failed', 'provider_timeout',
    'invalid_document', 'processing_unavailable'
  ) then
    raise exception 'Invalid receipt error code';
  end if;
  if p_duplicate_of_receipt_id is not null and not exists (
    select 1 from public.receipts
    where id = p_duplicate_of_receipt_id and business_id = p_business_id
  ) then
    raise exception 'Duplicate receipt is outside the workspace';
  end if;

  select * into current_row
  from public.receipt_processing
  where receipt_id = p_receipt_id and business_id = p_business_id
  for update;
  if not found then
    raise exception 'Receipt processing job not found';
  end if;

  if current_row.expense_id is not null then
    return jsonb_build_object(
      'status', 'completed', 'expense_id', current_row.expense_id
    );
  end if;

  select storage_path into receipt_path
  from public.receipts
  where id = p_receipt_id and business_id = p_business_id;

  if p_create_expense then
    if p_status <> 'completed'
      or nullif(trim(p_merchant), '') is null
      or p_date is null
      or p_amount is null
      or p_amount <= 0
      or p_amount > 99999999.99
      or p_amount <> round(p_amount, 2)
      or p_currency is null
      or p_currency not in ('ZAR', 'USD', 'EUR') then
      raise exception 'Reliable expense fields are required';
    end if;

    select id into linked_expense_id
    from public.expenses
    where business_id = p_business_id and receipt_url = receipt_path
    limit 1
    for update;

    if linked_expense_id is null then
      insert into public.expenses (
        business_id, merchant, date, amount, currency, description,
        category_id, receipt_url, status
      ) values (
        p_business_id, left(trim(p_merchant), 200), p_date, p_amount,
        p_currency, nullif(left(trim(coalesce(p_description, '')), 2000), ''),
        p_category_id, receipt_path, 'Pending'
      )
      returning id into linked_expense_id;
    end if;
  elsif p_status = 'completed' then
    raise exception 'Completed processing requires a linked expense';
  end if;

  update public.receipt_processing
  set status = p_status,
      extracted_data = p_extracted_data,
      error_code = p_error_code,
      duplicate_of_receipt_id = p_duplicate_of_receipt_id,
      expense_id = linked_expense_id,
      updated_at = now()
  where receipt_id = p_receipt_id;

  return jsonb_build_object(
    'status', p_status, 'expense_id', linked_expense_id
  );
end;
$$;

revoke all on function public.begin_receipt_processing(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finish_receipt_processing(
  uuid, uuid, text, jsonb, text, uuid, boolean, text, date, numeric,
  text, text, uuid
) from public, anon, authenticated;
grant execute on function public.begin_receipt_processing(uuid, uuid, text)
  to service_role;
grant execute on function public.finish_receipt_processing(
  uuid, uuid, text, jsonb, text, uuid, boolean, text, date, numeric,
  text, text, uuid
) to service_role;

notify pgrst, 'reload schema';
commit;
