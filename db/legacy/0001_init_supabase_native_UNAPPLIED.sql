-- CivicVoice — Supabase schema
--
-- Rebuilt from webapp/mobile/src/lib/database.types.ts, which is the generated
-- type definition for the original Supabase project (ref osvquqtywladyaycycnu).
-- That project's schema was created in the dashboard and never committed here,
-- so this file reconstructs it: 14 tables, 8 enums, indexes and RLS policies.
--
-- Apply to a Supabase project with:
--   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
-- or paste into the Supabase dashboard SQL editor.
--
-- Safe to re-run: every statement is guarded.

-- ---------------------------------------------------------------- enums

do $$ begin
  create type bill_status as enum
    ('introduced','in_committee','passed_house','passed_senate','enacted','vetoed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bill_chamber as enum ('house','senate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bill_category as enum
    ('healthcare','education','environment','economy','civil_rights',
     'defense','immigration','technology','housing','infrastructure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type projected_outcome as enum ('likely_pass','likely_fail','uncertain');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vote_type as enum ('yea','nay');
exception when duplicate_object then null; end $$;

do $$ begin
  create type feed_item_type as enum ('vote','comment','share');
exception when duplicate_object then null; end $$;

do $$ begin
  create type law_relationship as enum ('amends','conflicts','supports','references');
exception when duplicate_object then null; end $$;

do $$ begin
  create type party as enum ('D','R','I');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists system_settings (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- profiles.id mirrors auth.users.id — Supabase Auth owns the identity row.
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text not null unique,
  display_name    text not null,
  email           text not null,
  avatar          text,
  bio             text,
  location        text,
  joined_date     timestamptz not null default now(),
  followers_count integer not null default 0,
  following_count integer not null default 0,
  votes_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists representatives (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  party         party not null,
  state         text not null,
  district      text,
  chamber       bill_chamber not null,
  image_url     text,
  contact_email text,
  contact_phone text,
  website       text,
  twitter       text,
  facebook      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists bills (
  id                     uuid primary key default gen_random_uuid(),
  congress_number        integer not null default 119,
  bill_number            text,
  title                  text not null,
  short_title            text not null,
  status                 bill_status not null default 'introduced',
  chamber                bill_chamber not null,
  sponsor_id             uuid references representatives(id) on delete set null,
  introduced_date        timestamptz not null default now(),
  last_action_date       timestamptz not null default now(),
  category               bill_category not null,
  full_text              text not null,
  simplified_text        text,
  real_world_impact      text,
  projected_outcome      projected_outcome not null default 'uncertain',
  yea_count              integer not null default 0,
  nay_count              integer not null default 0,
  total_votes            integer not null default 0,
  official_yea           integer,
  official_nay           integer,
  official_present       integer,
  official_not_voting    integer,
  is_trending            boolean not null default false,
  view_count             integer not null default 0,
  cosponsor_count        integer not null default 0,
  amendment_count        integer not null default 0,
  weight_score           double precision not null default 0,
  weight_last_calculated timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists related_laws (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references bills(id) on delete cascade,
  law_name     text not null,
  relationship law_relationship not null,
  description  text,
  created_at   timestamptz not null default now()
);

create table if not exists votes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  bill_id    uuid not null references bills(id) on delete cascade,
  vote       vote_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one vote per person per bill; changing your mind updates this row
  unique (user_id, bill_id)
);

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  bill_id     uuid not null references bills(id) on delete cascade,
  content     text not null,
  likes_count integer not null default 0,
  parent_id   uuid references comments(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists feed_items (
  id          uuid primary key default gen_random_uuid(),
  type        feed_item_type not null,
  user_id     uuid not null references profiles(id) on delete cascade,
  bill_id     uuid not null references bills(id) on delete cascade,
  vote_id     uuid references votes(id) on delete cascade,
  comment_id  uuid references comments(id) on delete cascade,
  likes_count integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists feed_likes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  feed_item_id uuid not null references feed_items(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (user_id, feed_item_id)
);

create table if not exists follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references profiles(id) on delete cascade,
  following_id uuid not null references profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists delegations (
  id           uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references profiles(id) on delete cascade,
  to_user_id   uuid not null references profiles(id) on delete cascade,
  category     bill_category,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

-- One active delegation per person per category. Partial unique index because
-- NULL category means "all categories" and must also be constrained.
create unique index if not exists delegations_active_category_uniq
  on delegations (from_user_id, category)
  where is_active;

create unique index if not exists delegations_active_all_uniq
  on delegations (from_user_id)
  where is_active and category is null;

create table if not exists delegate_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references profiles(id) on delete cascade,
  expertise       bill_category[] not null default '{}',
  delegator_count integer not null default 0,
  total_votes     integer not null default 0,
  yea_votes       integer not null default 0,
  nay_votes       integer not null default 0,
  bio             text,
  is_featured     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists bill_cache (
  id           uuid primary key default gen_random_uuid(),
  search_query text,
  bill_id      text not null,
  congress     integer not null,
  bill_type    text not null,
  bill_number  integer not null,
  title        text not null,
  short_title  text not null,
  status       text not null,
  category     text not null,
  date         timestamptz not null,
  source_url   text not null,
  raw_text     text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  unique (congress, bill_type, bill_number)
);

create table if not exists timeline_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  bill_cache_id uuid references bill_cache(id) on delete set null,
  opinion       text,
  likes_count   integer not null default 0,
  shares_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes

create index if not exists bills_category_idx      on bills (category);
create index if not exists bills_status_idx         on bills (status);
create index if not exists bills_trending_idx       on bills (is_trending) where is_trending;
create index if not exists bills_weight_idx         on bills (weight_score desc);
create index if not exists bills_last_action_idx    on bills (last_action_date desc);
create index if not exists votes_bill_idx           on votes (bill_id);
create index if not exists votes_user_idx           on votes (user_id);
create index if not exists comments_bill_idx        on comments (bill_id);
create index if not exists comments_parent_idx      on comments (parent_id);
create index if not exists feed_items_created_idx   on feed_items (created_at desc);
create index if not exists feed_items_user_idx      on feed_items (user_id);
create index if not exists follows_following_idx    on follows (following_id);
create index if not exists delegations_to_idx       on delegations (to_user_id) where is_active;
create index if not exists bill_cache_expires_idx   on bill_cache (expires_at);
create index if not exists bill_cache_query_idx     on bill_cache (search_query);
create index if not exists timeline_created_idx     on timeline_posts (created_at desc);

-- ------------------------------------------------------- search_bills rpc

-- database.types.ts declares search_bills under Tables, but it is consumed as a
-- text search over bills. Exposed as a function so PostgREST can call it via rpc.
create or replace function search_bills(search_term text)
returns setof bills
language sql stable
as $$
  select * from bills
  where title ilike '%' || search_term || '%'
     or short_title ilike '%' || search_term || '%'
     or full_text ilike '%' || search_term || '%'
  order by weight_score desc
  limit 100;
$$;

-- ------------------------------------------------------------------- RLS
--
-- Public reference data (bills, representatives, related_laws, bill_cache,
-- system_settings) is world-readable. Everything tied to a person is readable
-- by all signed-in users but writable only by its owner.

alter table system_settings   enable row level security;
alter table profiles          enable row level security;
alter table representatives   enable row level security;
alter table bills             enable row level security;
alter table related_laws      enable row level security;
alter table votes             enable row level security;
alter table comments          enable row level security;
alter table feed_items        enable row level security;
alter table feed_likes        enable row level security;
alter table follows           enable row level security;
alter table delegations       enable row level security;
alter table delegate_profiles enable row level security;
alter table bill_cache        enable row level security;
alter table timeline_posts    enable row level security;

-- Read-only public tables
do $$
declare t text;
begin
  foreach t in array array['system_settings','representatives','bills',
                           'related_laws','bill_cache','profiles',
                           'delegate_profiles']
  loop
    execute format(
      'drop policy if exists %I_read on %I; create policy %I_read on %I for select using (true);',
      t, t, t, t);
  end loop;
end $$;

-- Owner-writable tables keyed on user_id
do $$
declare t text;
begin
  foreach t in array array['votes','comments','feed_items','feed_likes',
                           'timeline_posts','delegate_profiles']
  loop
    execute format($f$
      drop policy if exists %1$I_read on %1$I;
      create policy %1$I_read on %1$I for select using (true);
      drop policy if exists %1$I_write on %1$I;
      create policy %1$I_write on %1$I for all
        using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $f$, t);
  end loop;
end $$;

-- Profiles: readable by all, writable only by self
drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Follows: keyed on follower_id
drop policy if exists follows_read on follows;
create policy follows_read on follows for select using (true);
drop policy if exists follows_write on follows;
create policy follows_write on follows for all
  using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

-- Delegations: keyed on from_user_id
drop policy if exists delegations_read on delegations;
create policy delegations_read on delegations for select using (true);
drop policy if exists delegations_write on delegations;
create policy delegations_write on delegations for all
  using (auth.uid() = from_user_id) with check (auth.uid() = from_user_id);
