#!/usr/bin/env bash
set -euo pipefail
# Disposable local cluster only. Never accepts a production database URL.
nexora_test_dir=$(mktemp -d /tmp/nexora-expense-db.XXXXXX)
nexora_test_port=${NEXORA_TEST_DB_PORT:-55441}
cleanup() {
  if [[ -f "$nexora_test_dir/data/postmaster.pid" ]]; then
    pg_ctl -D "$nexora_test_dir/data" -m fast stop >/dev/null || true
  fi
  rm -rf -- "$nexora_test_dir"
}
trap cleanup EXIT
initdb -D "$nexora_test_dir/data" -A trust --no-locale -E UTF8 >/dev/null
pg_ctl -D "$nexora_test_dir/data" -l "$nexora_test_dir/postgres.log" -o "-p $nexora_test_port -k $nexora_test_dir -h ''" start >/dev/null
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d postgres -v ON_ERROR_STOP=1 \
 -f supabase/tests/bootstrap.sql \
 -f supabase/migrations/001_initial_schema.sql \
 -f supabase/migrations/002_secure_saas.sql \
 -f supabase/migrations/003_currency_and_release_security.sql \
 -f supabase/migrations/004_workspace_and_receipt_metadata.sql \
 -f supabase/migrations/006_smart_receipt_processing.sql \
 -f supabase/tests/security.sql \
 -f supabase/tests/workspace.sql \
 -f supabase/tests/receipt_processing.sql
# Real concurrent connections: one owner workspace and trial despite overlapping logins.
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d postgres -v ON_ERROR_STOP=1 -q -c "insert into auth.users(id) values('cccccccc-cccc-cccc-cccc-cccccccccccc')"
for nexora_connection in 1 2; do
 psql -h "$nexora_test_dir" -p "$nexora_test_port" -d postgres -v ON_ERROR_STOP=1 -q -c "begin;set local role authenticated;set local request.jwt.claim.sub='cccccccc-cccc-cccc-cccc-cccccccccccc';select public.bootstrap_business('Concurrent');select pg_sleep(0.2);commit;" >"$nexora_test_dir/concurrent-$nexora_connection.log" &
 nexora_pids[$nexora_connection]=$!
done
wait "${nexora_pids[1]}"
wait "${nexora_pids[2]}"
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
do $$begin
 if(select count(*) from businesses where owner_id='cccccccc-cccc-cccc-cccc-cccccccccccc')<>1 then raise exception 'Concurrent duplicate business';end if;
 if(select count(*) from subscriptions s join businesses b on b.id=s.business_id where b.owner_id='cccccccc-cccc-cccc-cccc-cccccccccccc')<>1 then raise exception 'Concurrent duplicate trial';end if;
 if(select count(*) from categories c join businesses b on b.id=c.business_id where b.owner_id='cccccccc-cccc-cccc-cccc-cccccccccccc')<>5 then raise exception 'Concurrent duplicate categories';end if;
end $$;
SQL
echo 'PASS: concurrent logins create one workspace, one trial and one category seed'
# Apply the SQL Editor bundle independently in a second empty database.
createdb -h "$nexora_test_dir" -p "$nexora_test_port" nexora_bundle
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_bundle -v ON_ERROR_STOP=1 -q -f supabase/tests/bootstrap.sql -f supabase/setup.sql -f supabase/tests/workspace.sql
# Rerunning the empty-schema bundle must abort, not alter an existing installation.
if psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_bundle -v ON_ERROR_STOP=1 -q -f supabase/setup.sql >"$nexora_test_dir/rerun.log" 2>&1; then
 echo 'FAIL: setup bundle accepted an existing schema' >&2
 exit 1
fi
echo 'PASS: setup bundle rejects an existing schema without dropping tables'
# The conditional repair is not part of the normal migration chain.
createdb -h "$nexora_test_dir" -p "$nexora_test_port" nexora_reconcile
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_reconcile -v ON_ERROR_STOP=1 -q -f supabase/tests/bootstrap.sql -f supabase/migrations/001_initial_schema.sql -f supabase/tests/partial_schema.sql -f supabase/reconciliation/005_reconcile_missing_billing.sql -f supabase/migrations/006_smart_receipt_processing.sql -f supabase/tests/reconciliation.sql -f supabase/tests/workspace.sql -f supabase/tests/receipt_processing.sql
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_reconcile -v ON_ERROR_STOP=1 -q <<'SQL'
do $$begin
 if(select count(*) from expenses where merchant='Preserved existing expense' and amount=12.34)<>1 then raise exception 'Existing expense altered';end if;
 if(select count(*) from businesses b join business_memberships m on m.business_id=b.id where b.owner_id=m.user_id and m.user_id='dddddddd-dddd-dddd-dddd-dddddddddddd')<>1 then raise exception 'Owner membership was not copied to businesses.owner_id';end if;
 if(select count(*) from expenses where expense_date is not null and date is distinct from expense_date)<>0 then raise exception 'Original expense_date was not preserved';end if;
 if(select count(*) from expenses where status<>'Pending' or receipt_url is not null)<>0 then raise exception 'Missing expense compatibility columns were not safely initialized';end if;
 if(select count(*) from categories where name='Preserved existing category' and color is null)<>1 then raise exception 'Existing category was altered during color-column repair';end if;
 if(select count(*) from receipts r join storage.objects o on o.id=r.storage_object_id where r.storage_path=o.name and o.name like '%/existing.pdf')<>1 then raise exception 'Existing receipt metadata or Storage object was altered';end if;
 if exists(select 1 from subscriptions s join businesses b on b.id=s.business_id where b.owner_id='dddddddd-dddd-dddd-dddd-dddddddddddd' and s.trial_ends_at<>b.created_at+interval '30 days') then raise exception 'Existing trial reset';end if;
end $$;
SQL
echo 'PASS: six-table reconciliation preserves expenses and original trial deadlines'
if psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_reconcile -v ON_ERROR_STOP=1 -q -f supabase/reconciliation/005_reconcile_missing_billing.sql >"$nexora_test_dir/reconcile-rerun.log" 2>&1; then
 echo 'FAIL: reconciliation accepted existing billing state' >&2
 exit 1
fi
echo 'PASS: reconciliation refuses an existing billing installation'

createdb -h "$nexora_test_dir" -p "$nexora_test_port" nexora_explicit_deadline
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_explicit_deadline -v ON_ERROR_STOP=1 -q -f supabase/tests/bootstrap.sql -f supabase/migrations/001_initial_schema.sql -f supabase/tests/partial_schema.sql -f supabase/tests/explicit_trial_deadline.sql -f supabase/reconciliation/005_reconcile_missing_billing.sql -f supabase/migrations/006_smart_receipt_processing.sql -f supabase/tests/reconciliation.sql -f supabase/tests/receipt_processing.sql
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_explicit_deadline -v ON_ERROR_STOP=1 -q <<'SQL'
do $$begin if exists(select 1 from subscriptions s join businesses b on b.id=s.business_id where s.trial_ends_at is distinct from b.trial_ends_at) then raise exception 'Explicit original deadline changed';end if;end $$;
SQL
echo 'PASS: explicit original trial deadline preserved exactly'
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_reconcile -v ON_ERROR_STOP=1 -q -f supabase/reconciliation/005_verify_missing_billing.sql >"$nexora_test_dir/verification-output.log"
echo 'PASS: complete SQL Editor verification queries execute successfully'
# Existing invalid data must cause a complete rollback, never data cleanup.
createdb -h "$nexora_test_dir" -p "$nexora_test_port" nexora_invalid_data
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_invalid_data -v ON_ERROR_STOP=1 -q -f supabase/tests/bootstrap.sql -f supabase/migrations/001_initial_schema.sql -f supabase/tests/partial_schema.sql -c "insert into expenses(business_id,merchant,amount,expense_date) select id,'Existing invalid amount',-1,current_date from businesses"
if psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_invalid_data -v ON_ERROR_STOP=1 -q -f supabase/reconciliation/005_reconcile_missing_billing.sql >"$nexora_test_dir/invalid-data.log" 2>&1; then
 echo 'FAIL: invalid existing amounts accepted' >&2
 exit 1
fi
rg -q 'check constraint.*violat|violat.*check constraint' "$nexora_test_dir/invalid-data.log"
psql -h "$nexora_test_dir" -p "$nexora_test_port" -d nexora_invalid_data -v ON_ERROR_STOP=1 -q <<'SQL'
do $$begin
 if to_regclass('public.subscriptions') is not null or to_regclass('public.billing_environment') is not null or to_regclass('public.billing_orders') is not null or to_regclass('public.payment_events') is not null or to_regclass('public.billing_notifications') is not null then raise exception 'Failed repair left partial billing tables';end if;
 if(select count(*) from expenses where merchant='Existing invalid amount' and amount=-1)<>1 then raise exception 'Failed repair altered invalid existing data';end if;
 if(select count(*) from expenses where merchant='Preserved existing expense' and amount=12.34)<>1 then raise exception 'Failed repair changed original expense';end if;
end $$;
SQL
echo 'PASS: incompatible existing data rolls back all billing DDL and leaves expenses unchanged'
