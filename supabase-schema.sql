create table if not exists public.xxt_votes (
  key text primary key,
  episode_id text not null,
  voter_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists xxt_votes_episode_id_idx on public.xxt_votes (episode_id);
create index if not exists xxt_votes_voter_hash_idx on public.xxt_votes (voter_hash);

create table if not exists public.xxt_messages (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.xxt_votes enable row level security;
alter table public.xxt_messages enable row level security;
