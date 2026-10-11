-- Local PostgreSQL harness, never run on Supabase. Minimal Auth/Storage interfaces.
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;end $$;
do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;end $$;
do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end $$;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}');
alter table storage.objects enable row level security;
grant select on storage.buckets to authenticated,anon,service_role;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
grant usage on schema public,storage to anon,authenticated,service_role;
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated,service_role;
