-- Ranked play tables (docs/RANKED.md). Only the relay's service-role key touches these:
-- RLS is on with no policies, so the public anon key can read and write nothing.

create table if not exists public.ranked_players (
  player_id  text primary key,
  name       text not null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- One rating per player per season, shared by 1v1, 2v2 and 3v3. `modes` keeps the win/loss record per mode:
-- {"1v1": {"games": 0, "wins": 0, "losses": 0, "draws": 0}, "2v2": {...}, "3v3": {...}}
create table if not exists public.ranked_season_ratings (
  player_id  text not null references public.ranked_players (player_id) on delete cascade,
  season     text not null,
  name       text not null,
  rating     integer not null default 1000,
  games      integer not null default 0,
  wins       integer not null default 0,
  losses     integer not null default 0,
  draws      integer not null default 0,
  peak       integer not null default 1000,
  modes      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (player_id, season)
);
create index if not exists ranked_season_ratings_leaderboard on public.ranked_season_ratings (season, rating desc);

create table if not exists public.ranked_matches (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in ('1v1', '2v2', '3v3')),
  season     text not null,
  outcome    text not null check (outcome in ('red', 'blue', 'tie')),
  red_score  integer,
  blue_score integer,
  status     text not null check (status in ('final', 'abandoned', 'void')),
  players    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ranked_matches_created on public.ranked_matches (created_at desc);

alter table public.ranked_players enable row level security;
alter table public.ranked_season_ratings enable row level security;
alter table public.ranked_matches enable row level security;
