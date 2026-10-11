-- Local-only variant: an original trial deadline already exists outside billing.
alter table businesses add column trial_ends_at timestamptz;
update businesses set trial_ends_at=created_at+interval '20 days';
-- Capture the added column too so preservation assertion includes the exact deadline.
update original_rows o set original=to_jsonb(b) from businesses b where o.table_name='businesses' and o.row_key=b.id::text;
