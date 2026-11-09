-- Caja negra en la nube y tramos compartidos (Blackbox).

-- 1. Salidas subidas desde el móvil. Los archivos van al almacén privado «telemetry»; aquí solo la
--    ficha. Nadie con la clave pública puede leer ni escribir: lo hace la función «caja-negra» (con la
--    clave secreta) y solo para quien tenga la clave de sincronización de ese móvil (carpeta = hash).
create table public.bb_cloud (
  folder text not null check (folder ~ '^[0-9a-f]{40}$'),
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  meta jsonb not null,
  size bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (folder, id)
);
alter table public.bb_cloud enable row level security;
revoke all on public.bb_cloud from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('telemetry', 'telemetry', false, 52428800)
on conflict (id) do nothing;

-- 2. Tramos de circuito compartidos y sus tiempos (clasificación). Solo se comparten circuitos
--    cerrados; los tramos de carretera se quedan en el navegador de cada uno.
create table public.bb_segments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 60),
  author text not null default '' check (char_length(author) <= 30),
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 6000),
  length_m real not null check (length_m between 50 and 100000),
  closed boolean not null default false
);
create table public.bb_efforts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  segment_id uuid not null references public.bb_segments(id) on delete cascade,
  rider text not null check (char_length(rider) between 1 and 30),
  bike text not null default '' check (char_length(bike) <= 30),
  time_s real not null check (time_s > 1 and time_s < 36000),
  v_max real check (v_max between 0 and 150),
  lean_max real check (lean_max between 0 and 80),
  ridden_at timestamptz not null,
  device text not null check (char_length(device) between 8 and 64),
  unique (segment_id, device, ridden_at)
);
create index bb_efforts_segment on public.bb_efforts (segment_id, time_s);
alter table public.bb_segments enable row level security;
alter table public.bb_efforts enable row level security;
create policy "ver circuitos" on public.bb_segments for select to anon, authenticated using (true);
create policy "compartir circuito" on public.bb_segments for insert to anon, authenticated with check (char_length(name) between 1 and 60);
create policy "ver tiempos" on public.bb_efforts for select to anon, authenticated using (true);
create policy "publicar tiempo" on public.bb_efforts for insert to anon, authenticated with check (time_s > 1);
revoke update, delete on public.bb_segments, public.bb_efforts from anon, authenticated;
