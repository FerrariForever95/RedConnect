-- RedConnect production schema. Run in Supabase Dashboard > SQL Editor.
-- Client access uses explicit grants plus Row Level Security on every public table.
create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text not null default '',
  phone_verified boolean not null default false,
  blood_group text check (blood_group in ('O+','O-','A+','A-','B+','B-','AB+','AB-')),
  date_of_birth date,
  gender text,
  city text,
  state text,
  country text not null default 'India',
  last_donated_at date,
  donation_count integer not null default 0 check (donation_count >= 0),
  next_eligible_date date,
  donor_status text not null default 'active' check (donor_status in ('active','paused','ineligible')),
  availability_status text not null default 'unavailable' check (availability_status in ('available','unavailable','temporarily_unavailable')),
  profile_verified boolean not null default false,
  profile_complete boolean not null default false,
  role text not null default 'donor' check (role in ('donor','patient','organization')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_locations (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  city text,
  area text,
  state text,
  country text,
  updated_at timestamptz not null default now()
);

create table if not exists public.donor_availability (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  is_available boolean not null default false,
  status text not null default 'unavailable' check (status in ('available','unavailable','temporarily_unavailable')),
  available_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Safe discovery projection. It never contains phone, birth date, address, or exact coordinates.
create table if not exists public.donor_directory (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  display_name text not null,
  blood_group text not null,
  city text,
  state text,
  country text,
  approximate_latitude numeric(5,2),
  approximate_longitude numeric(6,2),
  last_donated_at date,
  donation_count integer not null default 0,
  availability_status text not null,
  profile_verified boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  phone text not null,
  email text not null,
  city text not null,
  address text not null,
  license text not null unique,
  lat double precision,
  lng double precision,
  verified boolean not null default false,
  emergency_available boolean not null default false,
  open_now boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.organizations add column if not exists emergency_available boolean not null default false;
alter table public.organizations add column if not exists open_now boolean;
alter table public.organizations add column if not exists updated_at timestamptz not null default now();

create table if not exists public.organization_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null default 'Main location',
  address text not null,
  city text not null,
  state text,
  country text not null default 'India',
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_services (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service text not null,
  emergency_available boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, service)
);

create table if not exists public.organization_inventory (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  blood_group text not null check (blood_group in ('O+','O-','A+','A-','B+','B-','AB+','AB-')),
  units integer not null default 0 check (units >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, blood_group)
);

create table if not exists public.blood_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  patient_name text not null,
  blood_group text not null check (blood_group in ('O+','O-','A+','A-','B+','B-','AB+','AB-')),
  units smallint not null check (units between 1 and 12),
  component text not null,
  hospital text not null,
  city text not null,
  phone text not null,
  notes text not null default '',
  needed_by timestamptz not null,
  lat double precision,
  lng double precision,
  status text not null default 'open' check (status in ('open','fulfilled','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe request projection. Patient contact details and exact coordinates never enter this table.
create table if not exists public.blood_request_directory (
  request_id uuid primary key references public.blood_requests(id) on delete cascade,
  blood_group text not null,
  units smallint not null,
  component text not null,
  hospital text not null,
  city text not null,
  needed_by timestamptz not null,
  approximate_latitude numeric(5,2),
  approximate_longitude numeric(6,2),
  created_at timestamptz not null
);

create table if not exists public.donation_history (
  donation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  donated_at timestamptz not null,
  organization_id uuid references public.organizations(id) on delete set null,
  component text not null,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  blood_request_id uuid references public.blood_requests(id) on delete set null,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  shared_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
alter table public.contact_requests add column if not exists shared_phone text;

create unique index if not exists one_pending_contact_request
  on public.contact_requests (requester_id, recipient_id)
  where status = 'pending';

create table if not exists public.request_matches (
  id uuid primary key default gen_random_uuid(),
  blood_request_id uuid not null references public.blood_requests(id) on delete cascade,
  donor_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  match_status text not null default 'suggested' check (match_status in ('suggested','contacted','accepted','declined','completed')),
  distance_km numeric(7,2),
  created_at timestamptz not null default now(),
  check ((donor_id is not null)::integer + (organization_id is not null)::integer = 1)
);

create index if not exists donor_directory_search_idx on public.donor_directory (blood_group, availability_status, city);
create index if not exists blood_requests_open_idx on public.blood_requests (needed_by) where status = 'open';
create index if not exists contact_requests_recipient_idx on public.contact_requests (recipient_id, status, created_at desc);
create index if not exists donation_history_user_idx on public.donation_history (user_id, donated_at desc);

create or replace function private.sync_donor_directory(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare profile public.user_profiles%rowtype;
declare location public.user_locations%rowtype;
declare availability public.donor_availability%rowtype;
declare masked_name text;
begin
  select * into profile from public.user_profiles where user_id = target_user_id;
  if not found or profile.role <> 'donor' then
    delete from public.donor_directory where user_id = target_user_id;
    return;
  end if;
  select * into location from public.user_locations where user_id = target_user_id;
  select * into availability from public.donor_availability where user_id = target_user_id;
  masked_name := case
    when profile.profile_verified then coalesce(profile.full_name, 'Verified donor')
    else concat(split_part(coalesce(profile.full_name, 'Donor'), ' ', 1), ' ', left(split_part(coalesce(profile.full_name, ''), ' ', 2), 1), case when split_part(coalesce(profile.full_name, ''), ' ', 2) <> '' then '.' else '' end)
  end;
  if profile.profile_complete and profile.blood_group is not null then
    insert into public.donor_directory (
      user_id, display_name, blood_group, city, state, country, approximate_latitude, approximate_longitude,
      last_donated_at, donation_count, availability_status, profile_verified, updated_at
    ) values (
      target_user_id, masked_name, profile.blood_group, profile.city, profile.state, profile.country,
      round(location.latitude::numeric, 2), round(location.longitude::numeric, 2),
      profile.last_donated_at, profile.donation_count,
      case when coalesce(availability.is_available, false) then 'available' else 'unavailable' end,
      profile.profile_verified, now()
    ) on conflict (user_id) do update set
      display_name = excluded.display_name,
      blood_group = excluded.blood_group,
      city = excluded.city,
      state = excluded.state,
      country = excluded.country,
      approximate_latitude = excluded.approximate_latitude,
      approximate_longitude = excluded.approximate_longitude,
      last_donated_at = excluded.last_donated_at,
      donation_count = excluded.donation_count,
      availability_status = excluded.availability_status,
      profile_verified = excluded.profile_verified,
      updated_at = now();
  else
    delete from public.donor_directory where user_id = target_user_id;
  end if;
end;
$$;

revoke all on function private.sync_donor_directory(uuid) from public, anon, authenticated;

create or replace function private.sync_donor_directory_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_donor_directory(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.sync_donor_directory_trigger() from public, anon, authenticated;

create or replace function private.sync_blood_request_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'open' and new.needed_by > now() then
    insert into public.blood_request_directory (
      request_id, blood_group, units, component, hospital, city, needed_by,
      approximate_latitude, approximate_longitude, created_at
    ) values (
      new.id, new.blood_group, new.units, new.component, new.hospital, new.city, new.needed_by,
      round(new.lat::numeric, 2), round(new.lng::numeric, 2), new.created_at
    ) on conflict (request_id) do update set
      blood_group = excluded.blood_group,
      units = excluded.units,
      component = excluded.component,
      hospital = excluded.hospital,
      city = excluded.city,
      needed_by = excluded.needed_by,
      approximate_latitude = excluded.approximate_latitude,
      approximate_longitude = excluded.approximate_longitude;
  else
    delete from public.blood_request_directory where request_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_blood_request_directory() from public, anon, authenticated;
drop trigger if exists sync_public_blood_request on public.blood_requests;
create trigger sync_public_blood_request after insert or update on public.blood_requests
for each row execute function private.sync_blood_request_directory();

insert into public.blood_request_directory (
  request_id, blood_group, units, component, hospital, city, needed_by,
  approximate_latitude, approximate_longitude, created_at
)
select id, blood_group, units, component, hospital, city, needed_by,
  round(lat::numeric, 2), round(lng::numeric, 2), created_at
from public.blood_requests
where status = 'open' and needed_by > now()
on conflict (request_id) do update set
  blood_group = excluded.blood_group,
  units = excluded.units,
  component = excluded.component,
  hospital = excluded.hospital,
  city = excluded.city,
  needed_by = excluded.needed_by,
  approximate_latitude = excluded.approximate_latitude,
  approximate_longitude = excluded.approximate_longitude;

create or replace function private.share_approved_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select phone_number into new.shared_phone from public.user_profiles where user_id = new.recipient_id;
  elsif new.status <> 'approved' then
    new.shared_phone := null;
  end if;
  return new;
end;
$$;
revoke all on function private.share_approved_contact() from public, anon, authenticated;
drop trigger if exists share_contact_after_approval on public.contact_requests;
create trigger share_contact_after_approval before update of status on public.contact_requests
for each row execute function private.share_approved_contact();

create or replace function private.apply_verified_donation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification_status = 'verified' and old.verification_status is distinct from 'verified' then
    update public.user_profiles
    set last_donated_at = new.donated_at::date,
        donation_count = donation_count + 1,
        next_eligible_date = new.donated_at::date + 90,
        updated_at = now()
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.apply_verified_donation() from public, anon, authenticated;
drop trigger if exists apply_verified_donation on public.donation_history;
create trigger apply_verified_donation after update of verification_status on public.donation_history
for each row execute function private.apply_verified_donation();

drop trigger if exists sync_directory_from_profile on public.user_profiles;
create trigger sync_directory_from_profile after insert or update or delete on public.user_profiles
for each row execute function private.sync_donor_directory_trigger();
drop trigger if exists sync_directory_from_location on public.user_locations;
create trigger sync_directory_from_location after insert or update or delete on public.user_locations
for each row execute function private.sync_donor_directory_trigger();
drop trigger if exists sync_directory_from_availability on public.donor_availability;
create trigger sync_directory_from_availability after insert or update or delete on public.donor_availability
for each row execute function private.sync_donor_directory_trigger();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (
    user_id, full_name, phone_number, phone_verified, blood_group, city, state, country, role,
    availability_status, profile_complete
  ) values (
    new.id,
    nullif(new.raw_user_meta_data->>'name', ''),
    coalesce(new.phone, new.raw_user_meta_data->>'phone', ''),
    new.phone_confirmed_at is not null,
    nullif(new.raw_user_meta_data->>'blood_group', ''),
    nullif(new.raw_user_meta_data->>'city', ''),
    nullif(new.raw_user_meta_data->>'state', ''),
    coalesce(nullif(new.raw_user_meta_data->>'country', ''), 'India'),
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'donor'),
    'unavailable',
    false
  ) on conflict (user_id) do update set
    phone_number = coalesce(nullif(excluded.phone_number, ''), public.user_profiles.phone_number),
    phone_verified = excluded.phone_verified or public.user_profiles.phone_verified,
    updated_at = now();

  if new.raw_user_meta_data->>'role' = 'organization' then
    insert into public.organizations (owner_id, name, type, phone, email, city, address, license, lat, lng)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'organization_name', 'New organization'),
      coalesce(new.raw_user_meta_data->>'organization_type', 'Blood bank'),
      coalesce(new.raw_user_meta_data->>'phone', ''),
      coalesce(new.email, ''),
      coalesce(new.raw_user_meta_data->>'city', ''),
      coalesce(new.raw_user_meta_data->>'organization_address', ''),
      coalesce(new.raw_user_meta_data->>'organization_license', new.id::text),
      nullif(new.raw_user_meta_data->>'lat', '')::double precision,
      nullif(new.raw_user_meta_data->>'lng', '')::double precision
    ) on conflict (owner_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of phone_confirmed_at on auth.users
for each row execute function private.handle_new_user();

alter table public.user_profiles enable row level security;
alter table public.user_locations enable row level security;
alter table public.donor_availability enable row level security;
alter table public.donor_directory enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_locations enable row level security;
alter table public.organization_services enable row level security;
alter table public.organization_inventory enable row level security;
alter table public.blood_requests enable row level security;
alter table public.blood_request_directory enable row level security;
alter table public.donation_history enable row level security;
alter table public.contact_requests enable row level security;
alter table public.request_matches enable row level security;

revoke all on table public.user_profiles, public.user_locations, public.donor_availability, public.donor_directory,
  public.organizations, public.organization_locations, public.organization_services, public.organization_inventory,
  public.blood_requests, public.blood_request_directory, public.donation_history, public.contact_requests, public.request_matches from anon, authenticated;

grant select on public.donor_directory, public.organizations, public.organization_locations,
  public.organization_services, public.organization_inventory, public.blood_request_directory to anon, authenticated;
grant select on public.user_profiles to authenticated;
grant update (full_name, blood_group, date_of_birth, gender, city, state, country, last_donated_at,
  next_eligible_date, donor_status, availability_status, profile_complete, updated_at) on public.user_profiles to authenticated;
grant select, insert, update on public.user_locations, public.donor_availability to authenticated;
grant insert, update on public.blood_requests to authenticated;
grant select on public.blood_requests to authenticated;
grant select on public.donation_history to authenticated;
grant insert (user_id, donated_at, organization_id, component, verification_status) on public.donation_history to authenticated;
grant update (verification_status, verified_by) on public.donation_history to authenticated;
grant select on public.contact_requests to authenticated;
grant insert (requester_id, recipient_id, blood_request_id, message, status) on public.contact_requests to authenticated;
grant update (status, updated_at) on public.contact_requests to authenticated;
grant select on public.request_matches to authenticated;
grant update (name, type, phone, email, city, address, lat, lng, emergency_available, open_now, updated_at) on public.organizations to authenticated;
grant insert, update, delete on public.organization_locations, public.organization_services, public.organization_inventory to authenticated;

drop policy if exists "owners manage profiles" on public.user_profiles;
drop policy if exists "owners read profiles" on public.user_profiles;
create policy "owners read profiles" on public.user_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "owners insert profiles" on public.user_profiles;
create policy "owners insert profiles" on public.user_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "owners update profiles" on public.user_profiles;
create policy "owners update profiles" on public.user_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "owners manage locations" on public.user_locations;
drop policy if exists "owners read locations" on public.user_locations;
create policy "owners read locations" on public.user_locations for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "owners insert locations" on public.user_locations;
create policy "owners insert locations" on public.user_locations for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "owners update locations" on public.user_locations;
create policy "owners update locations" on public.user_locations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "owners manage availability" on public.donor_availability;
drop policy if exists "owners read availability" on public.donor_availability;
create policy "owners read availability" on public.donor_availability for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "owners insert availability" on public.donor_availability;
create policy "owners insert availability" on public.donor_availability for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "owners update availability" on public.donor_availability;
create policy "owners update availability" on public.donor_availability for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "safe donor directory is public" on public.donor_directory;
create policy "safe donor directory is public" on public.donor_directory for select to anon, authenticated using (true);

drop policy if exists "verified organizations are public" on public.organizations;
create policy "verified organizations are public" on public.organizations for select to anon, authenticated
using (verified = true or (select auth.uid()) = owner_id);
drop policy if exists "owners update organizations" on public.organizations;
create policy "owners update organizations" on public.organizations for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "verified organization locations are public" on public.organization_locations;
create policy "verified organization locations are public" on public.organization_locations for select to anon, authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and (o.verified or o.owner_id = (select auth.uid()))));
drop policy if exists "owners manage organization locations" on public.organization_locations;
drop policy if exists "owners insert organization locations" on public.organization_locations;
create policy "owners insert organization locations" on public.organization_locations for insert to authenticated
with check (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners update organization locations" on public.organization_locations;
create policy "owners update organization locations" on public.organization_locations for update to authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())))
with check (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners delete organization locations" on public.organization_locations;
create policy "owners delete organization locations" on public.organization_locations for delete to authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "verified organization services are public" on public.organization_services;
create policy "verified organization services are public" on public.organization_services for select to anon, authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and (o.verified or o.owner_id = (select auth.uid()))));
drop policy if exists "owners manage organization services" on public.organization_services;
drop policy if exists "owners insert organization services" on public.organization_services;
create policy "owners insert organization services" on public.organization_services for insert to authenticated
with check (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners update organization services" on public.organization_services;
create policy "owners update organization services" on public.organization_services for update to authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())))
with check (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners delete organization services" on public.organization_services;
create policy "owners delete organization services" on public.organization_services for delete to authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "verified organization inventory is public" on public.organization_inventory;
create policy "verified organization inventory is public" on public.organization_inventory for select to anon, authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and (o.verified or o.owner_id = (select auth.uid()))));
drop policy if exists "owners manage inventory" on public.organization_inventory;
drop policy if exists "owners insert inventory" on public.organization_inventory;
create policy "owners insert inventory" on public.organization_inventory for insert to authenticated
with check (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners update inventory" on public.organization_inventory;
create policy "owners update inventory" on public.organization_inventory for update to authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())))
with check (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners delete inventory" on public.organization_inventory;
create policy "owners delete inventory" on public.organization_inventory for delete to authenticated
using (exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));

drop policy if exists "public reads safe open requests" on public.blood_requests;
drop policy if exists "owners read private requests" on public.blood_requests;
create policy "owners read private requests" on public.blood_requests for select to authenticated
using ((select auth.uid()) = owner_id);
drop policy if exists "public reads request directory" on public.blood_request_directory;
create policy "public reads request directory" on public.blood_request_directory for select to anon, authenticated using (needed_by > now());
drop policy if exists "owners create requests" on public.blood_requests;
create policy "owners create requests" on public.blood_requests for insert to authenticated
with check ((select auth.uid()) = owner_id);
drop policy if exists "owners update requests" on public.blood_requests;
create policy "owners update requests" on public.blood_requests for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "owners read donation history" on public.donation_history;
create policy "owners read donation history" on public.donation_history for select to authenticated
using ((select auth.uid()) = user_id or exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())));
drop policy if exists "owners submit pending donations" on public.donation_history;
create policy "owners submit pending donations" on public.donation_history for insert to authenticated
with check ((select auth.uid()) = user_id and verification_status = 'pending' and verified_by is null);
drop policy if exists "assigned organizations verify donations" on public.donation_history;
create policy "assigned organizations verify donations" on public.donation_history for update to authenticated
using (
  verification_status = 'pending'
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_id = (select auth.uid()) and o.verified = true
  )
)
with check (
  verification_status in ('verified','rejected')
  and verified_by = (select auth.uid())
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_id = (select auth.uid()) and o.verified = true
  )
);

drop policy if exists "participants read contact requests" on public.contact_requests;
create policy "participants read contact requests" on public.contact_requests for select to authenticated
using ((select auth.uid()) in (requester_id, recipient_id));
drop policy if exists "members create contact requests" on public.contact_requests;
create policy "members create contact requests" on public.contact_requests for insert to authenticated
with check (
  (select auth.uid()) = requester_id
  and requester_id <> recipient_id
  and status = 'pending'
  and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.phone_verified = true
  )
);
drop policy if exists "recipients respond to contact requests" on public.contact_requests;
create policy "recipients respond to contact requests" on public.contact_requests for update to authenticated
using ((select auth.uid()) = recipient_id) with check ((select auth.uid()) = recipient_id and status in ('approved','declined'));

drop policy if exists "request owners read matches" on public.request_matches;
create policy "request owners read matches" on public.request_matches for select to authenticated
using (exists (select 1 from public.blood_requests r where r.id = blood_request_id and r.owner_id = (select auth.uid())) or donor_id = (select auth.uid()));

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'blood_request_directory'
  ) then
    alter publication supabase_realtime add table public.blood_request_directory;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contact_requests'
  ) then
    alter publication supabase_realtime add table public.contact_requests;
  end if;
end $$;
