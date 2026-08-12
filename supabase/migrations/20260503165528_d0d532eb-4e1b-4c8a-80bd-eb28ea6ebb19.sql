alter publication supabase_realtime add table public.ledgers;
alter publication supabase_realtime add table public.items;
alter table public.ledgers replica identity full;
alter table public.items replica identity full;