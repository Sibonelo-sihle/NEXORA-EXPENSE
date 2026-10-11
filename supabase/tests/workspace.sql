\set ON_ERROR_STOP on
begin;
do $$begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Application table without RLS';end if;
 if exists(select 1 from storage.buckets where id in('receipts','nexora-receipts') and public) then raise exception 'Public receipt bucket';end if;
 if (select proargnames[1] from pg_proc where oid='public.bootstrap_business(text)'::regprocedure)<>'business_name' then raise exception 'Frontend RPC argument mismatch';end if;
end $$;
insert into auth.users(id) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set local role authenticated;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select bootstrap_business(business_name=>'First workspace') as workspace \gset
select set_config('test.workspace',:'workspace',true);
do $$declare first_trial timestamptz;begin
 select trial_ends_at into first_trial from billing_access();
 if bootstrap_business('A different name')<>current_setting('test.workspace')::uuid then raise exception 'Duplicate workspace';end if;
 if(select count(*) from businesses)<>1 or (select count(*) from business_memberships)<>1 or (select count(*) from profiles)<>1 then raise exception 'Duplicate onboarding rows';end if;
 if(select name from businesses)<>'First workspace' then raise exception 'Login renamed workspace';end if;
 if(select trial_ends_at from billing_access())<>first_trial then raise exception 'Login reset trial';end if;
 if(select count(*) from categories)<>5 then raise exception 'Duplicate seed categories';end if;
 begin insert into business_memberships(business_id,user_id) values(current_setting('test.workspace')::uuid,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');raise exception 'Self-enrolment allowed';exception when insufficient_privilege then null;end;
 begin insert into receipts(id,business_id,storage_path) values(gen_random_uuid(),current_setting('test.workspace')::uuid,'fake');raise exception 'Forged metadata';exception when insufficient_privilege then null;end;
end $$;
insert into storage.objects(bucket_id,name)
 values(case when exists(select 1 from storage.buckets where id='nexora-receipts') then 'nexora-receipts' else 'receipts' end,:'workspace'||'/persist.pdf');
insert into expenses(business_id,merchant,amount,currency,date,receipt_url) values(:'workspace','Persisted USD',12.34,'USD',current_date,:'workspace'||'/persist.pdf');
insert into expenses(business_id,merchant,amount,currency,date) values(:'workspace','Persisted EUR',5.67,'EUR',current_date);
update expenses set amount=12.35 where merchant='Persisted USD';
reset role;
set local role authenticated;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$begin
 if(select amount from expenses where merchant='Persisted USD')<>12.35 then raise exception 'Expense did not persist across role/session reset';end if;
 if(select count(*) from receipts)<>1 then raise exception 'Receipt metadata missing';end if;
 begin insert into expenses(business_id,merchant,amount,date,receipt_url) values(current_setting('test.workspace')::uuid,'Missing file',1,current_date,current_setting('test.workspace')||'/missing.pdf');raise exception 'Missing receipt accepted';exception when raise_exception then if sqlerrm='Missing receipt accepted' then raise;end if;end;
end $$;
set local request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select bootstrap_business('Second account');
do $$declare affected integer;begin
 if(select count(*) from expenses)<>0 or (select count(*) from receipts)<>0 or (select count(*) from storage.objects)<>0 then raise exception 'Cross account read';end if;
 if(select count(*) from business_memberships)<>1 then raise exception 'Membership read leak';end if;
 update expenses set merchant='Intrusion' where business_id=current_setting('test.workspace')::uuid;
 get diagnostics affected=row_count;if affected<>0 then raise exception 'Cross account update';end if;
 delete from expenses where business_id=current_setting('test.workspace')::uuid;
 get diagnostics affected=row_count;if affected<>0 then raise exception 'Cross account delete';end if;
end $$;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from expenses where receipt_url is not null;
delete from storage.objects where name=current_setting('test.workspace')||'/persist.pdf';
do $$begin if(select count(*) from receipts)<>0 then raise exception 'Stale receipt metadata after removal';end if;end $$;
reset role;
set local role anon;
set local request.jwt.claim.sub='';
do $$begin
 begin perform bootstrap_business('Anonymous');raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from receipts;raise exception 'Anonymous metadata allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
\echo 'PASS: RPC contract, verified idempotent onboarding, memberships, persisted currencies, receipt metadata, all-table RLS and cross-account isolation'
