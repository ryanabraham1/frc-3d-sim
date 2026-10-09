-- Match logs for imitation / RL training (docs/MATCH-LOGS.md). Only the relay's service-role key touches these:
-- RLS is on with no policies and the bucket is private, so the public anon key can read and write nothing.
-- Run once in the same Supabase project the relay already uses for ranked play (SUPABASE_URL on Render).

insert into storage.buckets (id, name, public)
values ('match-logs', 'match-logs', false)
on conflict (id) do nothing;

create table if not exists public.match_logs (
  id           uuid primary key default gen_random_uuid(),
  path         text not null unique,          -- <season>/<file>.jsonl.gz inside the match-logs bucket
  season       text not null,
  mode         text not null default '',      -- solo | host | headless
  seed         integer not null default 0,
  frames       integer not null default 0,    -- 30 Hz robot frames
  human_robots integer not null default 0,    -- robots a human drove at some point (the demonstrations)
  archetypes   text[] not null default '{}',  -- archetype label of every robot in the match
  totals       jsonb,                         -- final score by alliance
  bytes        integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists match_logs_season_created on public.match_logs (season, created_at desc);

alter table public.match_logs enable row level security;
