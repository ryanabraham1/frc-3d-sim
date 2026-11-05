-- Solo leaderboards (docs/LEADERBOARD.md): each driver's best run per season and robot, with its ghost.
-- Only the relay's service-role key touches this: RLS is on with no policies, so the public anon key can do nothing.
-- Run once in the same Supabase project the relay already uses for ranked play.

create table if not exists public.solo_scores (
  id         uuid primary key default gen_random_uuid(),
  season     text not null,
  robot      text not null,                -- SeasonDefinition teamRobots id
  player_id  text not null,                -- hash of the device secret, the same identity as ranked
  name       text not null,
  score      integer not null,
  ghost      text not null,                -- gzip + base64 (src/engine/ghost/format.ts)
  updated_at timestamptz not null default now(),
  unique (season, robot, player_id)
);
create index if not exists solo_scores_board on public.solo_scores (season, robot, score desc, updated_at);

alter table public.solo_scores enable row level security;
