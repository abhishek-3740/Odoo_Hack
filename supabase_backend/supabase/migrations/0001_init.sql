-- ==============================================================================
-- Migration 0001: Initial Schema for Zito_BC
-- Run automatically when `npx supabase start` or `npx supabase db reset`
-- ==============================================================================

-- Example: users_profiles table (extends Supabase's auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- RLS Policies: users can only see/edit their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================================================
-- TODO: Add your hackathon-specific tables below
-- Examples: sensor_data, predictions, model_results, team_members, etc.
-- ============================================================================
