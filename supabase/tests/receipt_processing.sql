\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
insert into public.businesses(id,owner_id,name)
 values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Receipt Test'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','Other Workspace');
insert into public.business_memberships(business_id,user_id)
 values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
insert into public.subscriptions(business_id)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.categories(id,business_id,name,color)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Meals','#7c3aed');
insert into storage.objects(id,bucket_id,name,metadata)
 values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
  'nexora-receipts',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111_receipt.pdf',
  '{"mimetype":"application/pdf"}'
 );
select id as receipt_metadata_id from public.receipts
  where storage_object_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac' \gset

set local role service_role;
select public.begin_receipt_processing(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  :'receipt_metadata_id',
 repeat('a',64)
) as started \gset
select set_config('test.receipt_started', :'started', true);
do $$begin
 if (current_setting('test.receipt_started')::jsonb->>'acquired')::boolean is not true then
  raise exception 'Receipt job was not acquired';
 end if;
end $$;
select public.finish_receipt_processing(
 p_business_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 p_receipt_id=>:'receipt_metadata_id',
 p_status=>'completed',
 p_extracted_data=>'{"merchant":"Receipt Cafe","amount":15.25,"currency":"ZAR","date":"2026-10-01"}',
 p_create_expense=>true,
 p_merchant=>'Receipt Cafe',
 p_date=>'2026-10-01',
 p_amount=>15.25,
 p_currency=>'ZAR',
 p_category_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
);
select public.begin_receipt_processing(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 :'receipt_metadata_id',
 repeat('a',64)
) as completed \gset
select set_config('test.receipt_completed', :'completed', true);
select set_config('test.receipt_id', :'receipt_metadata_id', true);
do $$begin
 if (current_setting('test.receipt_completed')::jsonb->>'acquired')::boolean is not false
   or (current_setting('test.receipt_completed')::jsonb->>'status')<>'completed' then
  raise exception 'Completed receipt retry was not idempotent';
 end if;
 if (select count(*) from public.expenses where receipt_url like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%')<>1 then
  raise exception 'Processing retry duplicated its expense';
 end if;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$begin
 if (select count(*) from public.receipt_processing)<>1 then
  raise exception 'Workspace owner cannot read receipt status';
 end if;
 begin
  insert into public.receipt_processing(receipt_id,business_id,source_sha256,status)
  values(current_setting('test.receipt_id')::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),'processing');
  raise exception 'Authenticated user forged receipt status';
 exception when insufficient_privilege then null;
 end;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$begin
 if (select count(*) from public.receipt_processing)<>0 then
  raise exception 'Receipt status leaked across workspaces';
 end if;
end $$;
rollback;
\echo 'PASS: receipt processing is tenant-isolated, service-only writable and idempotent'
