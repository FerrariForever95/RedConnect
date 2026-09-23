-- Run this once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  phone text not null,
  blood_group text check (blood_group in ('O+','O-','A+','A-','B+','B-','AB+','AB-')),
  city text not null,
  lat double precision,
  lng double precision,
  role text not null check (role in ('donor','patient','organization')),
  available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null, type text not null, phone text not null, email text not null, city text not null,
  address text not null, license text not null unique, lat double precision, lng double precision,
  verified boolean not null default false, created_at timestamptz not null default now()
);

create table if not exists public.blood_requests (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  patient_name text not null, blood_group text not null check (blood_group in ('O+','O-','A+','A-','B+','B-','AB+','AB-')),
  units smallint not null check (units between 1 and 12), component text not null, hospital text not null,
  city text not null, phone text not null, notes text not null default '', needed_by timestamptz not null,
  lat double precision, lng double precision, status text not null default 'open' check (status in ('open','fulfilled','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.organization_inventory (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  blood_group text not null check (blood_group in ('O+','O-','A+','A-','B+','B-','AB+','AB-')),
  units integer not null default 0 check (units >= 0), updated_at timestamptz not null default now(),
  primary key (organization_id,blood_group)
);

create index if not exists profiles_donor_search_idx on public.profiles (blood_group, available) where role='donor';
create index if not exists blood_requests_open_idx on public.blood_requests (needed_by) where status='open';

create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare org_id uuid;
begin
  insert into public.profiles(id,name,phone,blood_group,city,lat,lng,role,available)
  values(new.id,coalesce(new.raw_user_meta_data->>'name','RedConnect member'),coalesce(new.raw_user_meta_data->>'phone',''),new.raw_user_meta_data->>'blood_group',coalesce(new.raw_user_meta_data->>'city',''),nullif(new.raw_user_meta_data->>'lat','')::double precision,nullif(new.raw_user_meta_data->>'lng','')::double precision,coalesce(new.raw_user_meta_data->>'role','patient'),coalesce(new.raw_user_meta_data->>'role','patient')='donor');
  if new.raw_user_meta_data->>'role'='organization' then
    insert into public.organizations(owner_id,name,type,phone,email,city,address,license,lat,lng)
    values(new.id,new.raw_user_meta_data->>'organization_name',coalesce(new.raw_user_meta_data->>'organization_type','Blood bank'),coalesce(new.raw_user_meta_data->>'phone',''),new.email,coalesce(new.raw_user_meta_data->>'city',''),coalesce(new.raw_user_meta_data->>'organization_address',''),new.raw_user_meta_data->>'organization_license',nullif(new.raw_user_meta_data->>'lat','')::double precision,nullif(new.raw_user_meta_data->>'lng','')::double precision)
    returning id into org_id;
  end if;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.blood_requests enable row level security;
alter table public.organization_inventory enable row level security;
revoke all on public.profiles,public.organizations,public.blood_requests,public.organization_inventory from anon,authenticated;
grant select on public.organizations,public.organization_inventory,public.blood_requests to anon,authenticated;
grant select on public.profiles to authenticated;
grant update (name,phone,blood_group,city,lat,lng,available,updated_at) on public.profiles to authenticated;
grant insert,update on public.blood_requests to authenticated;
grant update (name,type,phone,city,address,lat,lng) on public.organizations to authenticated;
grant insert,update,delete on public.organization_inventory to authenticated;

create policy "owners read profile" on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy "members find available donors" on public.profiles for select to authenticated using (role='donor' and available=true);
create policy "owners update profile" on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create policy "public reads verified organizations" on public.organizations for select to anon,authenticated using (verified=true or (select auth.uid())=owner_id);
create policy "owners update organizations" on public.organizations for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy "public reads open requests" on public.blood_requests for select to anon,authenticated using (status='open' or (select auth.uid())=owner_id);
create policy "owners create requests" on public.blood_requests for insert to authenticated with check ((select auth.uid())=owner_id);
create policy "owners update requests" on public.blood_requests for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy "public reads verified inventory" on public.organization_inventory for select to anon,authenticated using (exists(select 1 from public.organizations o where o.id=organization_id and (o.verified=true or o.owner_id=(select auth.uid()))));
create policy "owners create inventory" on public.organization_inventory for insert to authenticated with check (exists(select 1 from public.organizations o where o.id=organization_id and o.owner_id=(select auth.uid())));
create policy "owners update inventory" on public.organization_inventory for update to authenticated using (exists(select 1 from public.organizations o where o.id=organization_id and o.owner_id=(select auth.uid()))) with check (exists(select 1 from public.organizations o where o.id=organization_id and o.owner_id=(select auth.uid())));
create policy "owners delete inventory" on public.organization_inventory for delete to authenticated using (exists(select 1 from public.organizations o where o.id=organization_id and o.owner_id=(select auth.uid())));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='blood_requests') then
    alter publication supabase_realtime add table public.blood_requests;
  end if;
end $$;
