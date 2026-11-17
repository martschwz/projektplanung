-- Projektplan Haus & Hof – Datenbank einrichten
-- In Supabase: SQL Editor → "New query" → diesen Text einfügen → "Run".
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.

-- Eine Tabelle für alles: Projekte, Zeiteinträge und Einstellungen.
-- coll = Art des Eintrags ("projects", "zeiten", "config"), data = Inhalt als JSON.
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  coll       text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, coll, id)
);

-- Zugriffsregeln: Jede angemeldete Person sieht und ändert nur ihre eigenen Daten.
alter table public.docs enable row level security;

drop policy if exists "eigene Daten lesen"   on public.docs;
drop policy if exists "eigene Daten anlegen" on public.docs;
drop policy if exists "eigene Daten aendern" on public.docs;
drop policy if exists "eigene Daten loeschen" on public.docs;

create policy "eigene Daten lesen"    on public.docs for select to authenticated using (auth.uid() = user_id);
create policy "eigene Daten anlegen"  on public.docs for insert to authenticated with check (auth.uid() = user_id);
create policy "eigene Daten aendern"  on public.docs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigene Daten loeschen" on public.docs for delete to authenticated using (auth.uid() = user_id);

-- Live-Aktualisierung: Was du am Handy einträgst, erscheint sofort am PC.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
