-- Optional read-only baseline BEFORE applying reconciliation. Save these results.
select 'profiles' as table_name,count(*) from public.profiles
union all select 'businesses',count(*) from public.businesses
union all select 'categories',count(*) from public.categories
union all select 'expenses',count(*) from public.expenses
union all select 'business_memberships',count(*) from public.business_memberships
union all select 'receipts',count(*) from public.receipts;
select id,business_id,expense_id,storage_path,file_name,content_type,created_at
from public.receipts order by created_at,id;
select id,bucket_id,name,created_at,updated_at
from storage.objects where bucket_id='nexora-receipts' order by created_at,id;
select id,public,file_size_limit,allowed_mime_types
from storage.buckets where id='nexora-receipts';
select b.id,
 coalesce((to_jsonb(b)->>'owner_id')::uuid,m.user_id) as owner_from_existing_data,
 b.created_at,to_jsonb(b)->>'trial_ends_at' as existing_explicit_deadline,
 b.created_at+interval '30 days' as original_trial_deadline_if_no_explicit_value
from public.businesses b
left join public.business_memberships m on m.business_id=b.id and m.role='owner'
order by b.created_at;
-- Save these original expense dates/receipt references for the post-reconciliation comparison.
select id,business_id,to_jsonb(e)->>'expense_date' as expense_date,
 to_jsonb(e)->>'date' as existing_date,to_jsonb(e)->>'status' as existing_status,
 to_jsonb(e)->>'receipt_url' as existing_receipt_url
from public.expenses e order by created_at,id;
select conname,pg_get_constraintdef(oid) as definition,convalidated
from pg_constraint where conrelid='public.receipts'::regclass order by conname;
