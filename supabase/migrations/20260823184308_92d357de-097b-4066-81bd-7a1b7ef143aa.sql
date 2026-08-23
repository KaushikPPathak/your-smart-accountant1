create table public.inventory_manual_valuations (
    id uuid primary key default gen_random_uuid(),
    company_id uuid references public.companies(id) on delete cascade not null,
    as_of_date date not null,
    valuation_paise bigint not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    unique (company_id, as_of_date)
);

grant select, insert, update, delete on public.inventory_manual_valuations to authenticated;
grant all on public.inventory_manual_valuations to service_role;

alter table public.inventory_manual_valuations enable row level security;

create policy "Users can manage valuations for their companies"
on public.inventory_manual_valuations
for all
to authenticated
using (
    exists (
        select 1 from public.company_members
        where company_members.company_id = inventory_manual_valuations.company_id
          and company_members.user_id = auth.uid()
    )
);
