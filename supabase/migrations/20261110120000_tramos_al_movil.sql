-- Datos que el Blackbox y el móvil vinculados se pasan entre ellos (los tramos guardados en el Blackbox,
-- para cronometrarlos en directo en el móvil). Uno por clave de sincronización (carpeta = su huella) y
-- tipo. Solo la función «caja-negra» lee y escribe.
create table public.bb_kv (
  folder text not null check (folder ~ '^[0-9a-f]{40}$'),
  kind text not null check (kind ~ '^[a-z]{1,20}$'),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (folder, kind)
);
alter table public.bb_kv enable row level security;
revoke all on public.bb_kv from anon, authenticated;
