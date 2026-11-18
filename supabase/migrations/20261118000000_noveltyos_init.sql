-- noveltyOS cloud schema.
-- Each business's data is isolated with row-level security: a signed-in user can only
-- read or write rows of businesses they are a member of.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Businesses and members
-- ---------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  -- Share this code so another phone/person can join the business.
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index members_user_idx on public.members (user_id);

-- security definer so policies can check membership without recursing into members' own policy
create or replace function public.is_member(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.members m where m.business_id = bid and m.user_id = auth.uid());
$$;

create or replace function public.is_owner(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.members m where m.business_id = bid and m.user_id = auth.uid() and m.role = 'owner');
$$;

alter table public.businesses enable row level security;
alter table public.members enable row level security;

create policy "members read their businesses" on public.businesses
  for select to authenticated using (public.is_member(id));
create policy "owners rename their business" on public.businesses
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

create policy "members see co-members" on public.members
  for select to authenticated using (public.is_member(business_id));
create policy "owners remove members" on public.members
  for delete to authenticated using (public.is_owner(business_id));

-- Create a business and become its owner.
create or replace function public.create_business(p_name text)
returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare b public.businesses;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.businesses (name, created_by) values (trim(p_name), auth.uid()) returning * into b;
  insert into public.members (business_id, user_id, role) values (b.id, auth.uid(), 'owner');
  return b;
end;
$$;

-- Join a business with its invite code.
create or replace function public.join_business(p_code text)
returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare b public.businesses;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into b from public.businesses where invite_code = upper(trim(p_code));
  if b.id is null then raise exception 'Invite code not found'; end if;
  insert into public.members (business_id, user_id, role) values (b.id, auth.uid(), 'staff')
    on conflict do nothing;
  return b;
end;
$$;

-- Owner can issue a new invite code (e.g. after an employee leaves).
create or replace function public.rotate_invite_code(p_business uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare code text;
begin
  if not public.is_owner(p_business) then raise exception 'Only the owner can do this'; end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.businesses set invite_code = code where id = p_business;
  return code;
end;
$$;

revoke all on function public.create_business(text), public.join_business(text), public.rotate_invite_code(uuid) from public, anon;
grant execute on function public.create_business(text), public.join_business(text), public.rotate_invite_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Synced business data (mirrors the phone's SQLite tables)
-- Dates are kept as the ISO text written by the phone; server_updated_at is the
-- server's clock and drives incremental sync.
-- ---------------------------------------------------------------------------

create or replace function public.touch_server_updated_at()
returns trigger language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create table public.settings (
  business_id uuid not null references public.businesses (id) on delete cascade,
  key text not null,
  value text not null,
  updated_at text not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, key)
);

create table public.products (
  business_id uuid not null references public.businesses (id) on delete cascade,
  id text not null,
  barcode text,
  name text not null,
  cost bigint not null default 0,
  price bigint not null default 0,
  low_stock integer not null default 3,
  created_at text not null,
  updated_at text not null,
  deleted smallint not null default 0,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, id)
);

create table public.parties (
  business_id uuid not null references public.businesses (id) on delete cascade,
  id text not null,
  type text not null check (type in ('customer', 'supplier')),
  name text not null,
  phone text not null default '',
  opening_balance bigint not null default 0,
  created_at text not null,
  updated_at text not null,
  deleted smallint not null default 0,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, id)
);

create table public.invoices (
  business_id uuid not null references public.businesses (id) on delete cascade,
  id text not null,
  number text not null,
  kind text not null check (kind in ('sale', 'purchase')),
  party_id text,
  date text not null,
  subtotal bigint not null,
  tax bigint not null default 0,
  total bigint not null,
  paid bigint not null,
  method text not null default 'cash' check (method in ('cash', 'card', 'other')),
  note text not null default '',
  updated_at text not null,
  deleted smallint not null default 0,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, id)
);

create table public.invoice_items (
  business_id uuid not null references public.businesses (id) on delete cascade,
  id text not null,
  invoice_id text not null,
  product_id text,
  name text not null,
  barcode text,
  qty integer not null,
  unit_price bigint not null,
  unit_cost bigint not null default 0,
  updated_at text not null,
  deleted smallint not null default 0,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, id)
);

create table public.payments (
  business_id uuid not null references public.businesses (id) on delete cascade,
  id text not null,
  party_id text not null,
  direction text not null check (direction in ('in', 'out')),
  amount bigint not null,
  method text not null default 'cash' check (method in ('cash', 'card', 'other')),
  date text not null,
  note text not null default '',
  updated_at text not null,
  deleted smallint not null default 0,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, id)
);

create table public.stock_adjustments (
  business_id uuid not null references public.businesses (id) on delete cascade,
  id text not null,
  product_id text not null,
  delta integer not null,
  reason text not null default '',
  date text not null,
  updated_at text not null,
  deleted smallint not null default 0,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['settings','products','parties','invoices','invoice_items','payments','stock_adjustments'] loop
    execute format('create index %I on public.%I (business_id, server_updated_at)', t || '_sync_idx', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_server_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(business_id))', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check (public.is_member(business_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id))', t);
    -- No delete policy: records are soft-deleted (deleted = 1) so the change reaches every phone.
  end loop;
end;
$$;
