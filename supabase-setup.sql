create table if not exists public.dashboard_state (
    user_id uuid primary key references auth.users (id) on delete cascade,
    state jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default clock_timestamp()
);

alter table public.dashboard_state enable row level security;

drop policy if exists "Users can access their own dashboard" on public.dashboard_state;
create policy "Users can access their own dashboard"
    on public.dashboard_state
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update on public.dashboard_state to authenticated;

create or replace function public.save_dashboard_state(
    p_state jsonb,
    p_expected_updated_at timestamptz
)
returns setof public.dashboard_state
language sql
security invoker
set search_path = public
as $$
    insert into public.dashboard_state (user_id, state, updated_at)
    values (auth.uid(), p_state, clock_timestamp())
    on conflict (user_id) do update
        set state = excluded.state,
            updated_at = clock_timestamp()
        where public.dashboard_state.updated_at = p_expected_updated_at
    returning user_id, state, updated_at;
$$;

grant execute on function public.save_dashboard_state(jsonb, timestamptz) to authenticated;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'dashboard_state'
    ) then
        alter publication supabase_realtime add table public.dashboard_state;
    end if;
end;
$$;