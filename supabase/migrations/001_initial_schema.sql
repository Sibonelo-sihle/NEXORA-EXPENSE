-- Initial Schema for NEXORA Expense

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Businesses table
create table businesses (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references auth.users on delete cascade not null,
  name text not null,
  currency text default 'ZAR',
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Categories table
create table categories (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses on delete cascade not null,
  name text not null,
  color text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Expenses table
create table expenses (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses on delete cascade not null,
  category_id uuid references categories on delete set null,
  amount numeric(10, 2) not null,
  merchant text not null,
  description text,
  receipt_url text,
  date date not null,
  status text default 'Pending',
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Row Level Security (RLS) Policies

alter table profiles enable row level security;
alter table businesses enable row level security;
alter table categories enable row level security;
alter table expenses enable row level security;

-- Profiles: Users can read and update their own profile
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Businesses: Users can read and update businesses they own
create policy "Users can view own businesses" on businesses for select using (auth.uid() = owner_id);
create policy "Users can create businesses" on businesses for insert with check (auth.uid() = owner_id);
create policy "Users can update own businesses" on businesses for update using (auth.uid() = owner_id);

-- Categories: Users can access categories of their businesses
create policy "Users can view business categories" on categories for select 
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "Users can manage business categories" on categories for all 
  using (business_id in (select id from businesses where owner_id = auth.uid()));

-- Expenses: Users can access expenses of their businesses
create policy "Users can view business expenses" on expenses for select 
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "Users can insert business expenses" on expenses for insert 
  with check (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "Users can update business expenses" on expenses for update 
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "Users can delete business expenses" on expenses for delete 
  using (business_id in (select id from businesses where owner_id = auth.uid()));

-- Storage Bucket for Receipts
insert into storage.buckets (id, name, public) values ('nexora-receipts', 'nexora-receipts', false);

-- Storage RLS
create policy "Users can upload their own receipts" on storage.objects for insert
  with check (bucket_id = 'nexora-receipts' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can view their own receipts" on storage.objects for select
  using (bucket_id = 'nexora-receipts' and auth.uid()::text = (storage.foldername(name))[1]);
