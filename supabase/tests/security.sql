\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email_confirmed_at) values('33333333-3333-3333-3333-333333333333',null);
set local role authenticated;
set local request.jwt.claim.sub='33333333-3333-3333-3333-333333333333';
do $$begin begin perform bootstrap_business('Unverified');raise exception 'Unverified onboarding allowed';exception when raise_exception then if sqlerrm='Unverified onboarding allowed' then raise;end if;end;end $$;
reset role;
insert into auth.users(id,raw_user_meta_data) values('11111111-1111-1111-1111-111111111111','{"full_name":"Alice"}'),('22222222-2222-2222-2222-222222222222','{"full_name":"Bob"}');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
select bootstrap_business('Alice business') as alice \gset
select bootstrap_business('Alice business') as alice_again \gset
select :'alice' = :'alice_again' as idempotent_onboarding;
set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
select bootstrap_business('Bob business') as bob \gset
reset role;
select set_config('test.alice',:'alice',true),set_config('test.bob',:'bob',true);
select set_config('test.bob_category',(select id::text from categories where business_id=:'bob' limit 1),true);
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
insert into expenses(business_id,merchant,amount,date) values(:'alice','Merchant',0.30,'2026-10-09');
insert into storage.objects(bucket_id,name) values('nexora-receipts',:'alice'||'/receipt.pdf');
do $$
begin
 begin insert into expenses(business_id,merchant,amount,date,currency) values(current_setting('test.alice')::uuid,'Precision',1.001,current_date,'USD');raise exception 'Excess precision allowed';exception when check_violation then null;end;
 begin insert into expenses(business_id,merchant,amount,date,currency) values(current_setting('test.alice')::uuid,'Currency',1,current_date,'GBP');raise exception 'Unsupported currency allowed';exception when check_violation then null;end;
 begin update businesses set id=gen_random_uuid();raise exception 'Business UUID change allowed';exception when raise_exception then if sqlerrm='Business UUID change allowed' then raise;end if;end;
 if (select currency from expenses limit 1)<>'ZAR' then raise exception 'Legacy currency default changed';end if;
 if (select count(*) from businesses)<>1 then raise exception 'Tenant read leak'; end if;
 if (select trial_days from billing_access())<>30 then raise exception 'Trial duration incorrect'; end if;
 if not(select can_write from billing_access()) then raise exception 'Trial should permit write'; end if;
 begin insert into expenses(business_id,merchant,amount,date) values(current_setting('test.bob')::uuid,'Intrusion',69,current_date);raise exception 'Cross tenant insert allowed';exception when insufficient_privilege then null;end;
 begin update businesses set owner_id='22222222-2222-2222-2222-222222222222';raise exception 'Owner transfer allowed';exception when raise_exception then if sqlerrm='Owner transfer allowed' then raise;end if;end;
 begin insert into expenses(business_id,merchant,amount,date,category_id) values(current_setting('test.alice')::uuid,'Wrong category',69,current_date,current_setting('test.bob_category')::uuid);raise exception 'Cross tenant category allowed';exception when foreign_key_violation then null;end;
 begin insert into expenses(business_id,merchant,amount,date,receipt_url) values(current_setting('test.alice')::uuid,'Wrong receipt',69,current_date,current_setting('test.bob')||'/receipt.pdf');raise exception 'Cross tenant receipt reference allowed';exception when raise_exception then if sqlerrm='Cross tenant receipt reference allowed' then raise;end if;end;
 begin insert into expenses(business_id,merchant,amount,date) values(current_setting('test.alice')::uuid,'Negative',-1,current_date);raise exception 'Negative amount allowed';exception when check_violation then null;end;
 begin insert into subscriptions(business_id) values(current_setting('test.bob')::uuid);raise exception 'Billing write allowed';exception when insufficient_privilege then null;end;
 begin perform record_payment('hack',gen_random_uuid(),'token','sandbox');raise exception 'Browser can activate subscription';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name) values('nexora-receipts',current_setting('test.bob')||'/hack.pdf');raise exception 'Cross tenant receipt write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update subscriptions set trial_ends_at=now() where business_id=:'alice';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
do $$
begin
 if(select can_write from billing_access()) then raise exception 'Expired trial allows write';end if;
 if(select count(*) from expenses)<>1 then raise exception 'Expiry deleted/hid expense';end if;
 if(select count(*) from storage.objects)<>1 then raise exception 'Expiry hid receipt';end if;
 if(select trial_days from billing_access())<>0 then raise exception 'Negative trial days';end if;
 begin insert into expenses(business_id,merchant,amount,date) values(current_setting('test.alice')::uuid,'Expired',69,current_date);raise exception 'Expired insert allowed';exception when insufficient_privilege then null;end;
 update expenses set merchant='Expired edit';
 if found then raise exception 'Expired update allowed';end if;
 delete from expenses;
 if found then raise exception 'Expired deletion allowed';end if;
 begin insert into storage.objects(bucket_id,name) values('nexora-receipts',current_setting('test.alice')||'/expired.pdf');raise exception 'Expired upload allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
select reserve_checkout(:'alice','sandbox') as order_id \gset
select record_payment('payment-1',:'order_id','12345678-1234-1234-1234-123456789abc','sandbox');
select record_payment('payment-1',:'order_id','12345678-1234-1234-1234-123456789abc','sandbox');
reset role;
do $$begin
 if(select count(*) from payment_events)<>1 then raise exception 'Duplicate payment';end if;
 if(select paid_until from subscriptions where business_id=current_setting('test.alice')::uuid)>now()+interval '32 days' then raise exception 'Replay extended entitlement';end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
update expenses set merchant='Paid edit';
do $$begin if(select count(*) from payment_events)<>1 then raise exception 'Own billing history missing';end if;end $$;
set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
do $$begin
 if(select count(*) from payment_events)<>0 then raise exception 'Billing history isolation failed';end if;
 if(select count(*) from expenses)<>0 then raise exception 'Expense read isolation failed';end if;
 if(select count(*) from storage.objects)<>0 then raise exception 'Receipt read isolation failed';end if;
 begin insert into expenses(business_id,merchant,amount,date,category_id) values(current_setting('test.bob')::uuid,'Wrong category',69,current_date,(select id from categories limit 1));exception when foreign_key_violation then raise exception 'Own category should work';end;
end $$;
reset role;
select record_billing_notification('failed-event',:'order_id','FAILED','12345678-1234-1234-1234-123456789abc','sandbox');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
do $$begin if not(select can_write from billing_access()) then raise exception 'Failed renewal revoked paid period';end if;end $$;
reset role;
update billing_environment set mode='live';
set local role authenticated;
do $$begin if(select can_write from billing_access()) then raise exception 'Sandbox payment grants live access';end if;end $$;
reset role;
update billing_environment set mode='sandbox';
select cancel_billing(:'alice','12345678-1234-1234-1234-123456789abc');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
do $$begin if not(select can_write from billing_access()) then raise exception 'Cancellation revoked paid period';end if;end $$;
reset role;
update subscriptions set paid_until=now()-interval '1 second' where business_id=:'alice';
set local role authenticated;
do $$begin if(select can_write from billing_access()) then raise exception 'Cancellation expiry permits write';end if;end $$;
rollback;
\echo 'PASS: tenant isolation, trial, receipt policies, payment replay, cancellation and expiry'
