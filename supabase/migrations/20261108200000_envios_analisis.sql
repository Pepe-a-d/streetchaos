-- Envíos de pasadas para analizarlas: la app solo puede insertar; leer, solo desde el panel o con la clave de servicio.
create table public.analysis_uploads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  device text not null check (char_length(device) between 1 and 64),
  payload jsonb not null check (pg_column_size(payload) < 3000000)
);

comment on table public.analysis_uploads is 'Pasadas y duelos que el piloto envía desde Garaje → Datos para analizarlos. Solo inserción anónima.';

alter table public.analysis_uploads enable row level security;

create policy "la app puede enviar datos"
  on public.analysis_uploads
  for insert
  to anon
  with check (char_length(device) between 1 and 64);

revoke select, update, delete on public.analysis_uploads from anon, authenticated;
