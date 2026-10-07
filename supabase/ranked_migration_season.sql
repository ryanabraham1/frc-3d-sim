-- Run once on a database that already has the first ranked.sql (ratings per mode).
-- Moves to one rating per player per season and drops the old per-mode table.
-- Existing per-mode ratings are collapsed: the rating of the mode with the most games wins, records are summed per mode.

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
alter table public.ranked_season_ratings enable row level security;

do $$
begin
  if to_regclass('public.ranked_ratings') is not null then
    insert into public.ranked_season_ratings (player_id, season, name, rating, games, wins, losses, draws, peak, modes)
    select
      player_id,
      '2026-rebuilt',
      (array_agg(name order by games desc))[1],
      (array_agg(rating order by games desc))[1],
      sum(games), sum(wins), sum(losses), sum(draws), max(peak),
      jsonb_object_agg(mode, jsonb_build_object('games', games, 'wins', wins, 'losses', losses, 'draws', draws))
    from public.ranked_ratings
    group by player_id
    on conflict (player_id, season) do nothing;
    drop table public.ranked_ratings;
  end if;
end $$;
