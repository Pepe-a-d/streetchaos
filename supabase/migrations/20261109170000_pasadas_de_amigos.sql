-- Pasadas de amigos (Blackbox): una pasada empaquetada (trazado y canales a 10 Hz de ese trozo) que
-- otra persona baja con su código de 8 letras para compararla con las suyas. Solo la función
-- «caja-negra» lee y escribe (con la clave secreta): con la clave pública no se pueden listar.
create table public.bb_ghosts (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  created_at timestamptz not null default now(),
  data jsonb not null,
  size integer not null check (size between 1 and 400000)
);
alter table public.bb_ghosts enable row level security;
revoke all on public.bb_ghosts from anon, authenticated;

-- En la clasificación de un circuito, el código de la pasada de cada tiempo (para compararte con él)
alter table public.bb_efforts add column ghost text check (ghost is null or ghost ~ '^[A-Z2-9]{8}$');
