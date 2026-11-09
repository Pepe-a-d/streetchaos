-- Blackbox oficial: perfil del piloto (lo que enseña el ordenador: nombre, moto, tema, récords) y
-- códigos cortos para vincular el ordenador con el móvil sin teclear la clave larga.
-- Las dos tablas solo las toca la función «caja-negra» (clave secreta): nada para anon.

-- 1. Perfil de cada móvil, en la carpeta de su clave (la huella, no la clave)
create table public.bb_profile (
  folder text primary key check (folder ~ '^[0-9a-f]{40}$'),
  profile jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.bb_profile enable row level security;
revoke all on public.bb_profile from anon, authenticated;

-- 2. Códigos de vinculación: 6 letras, valen 10 minutos y un solo uso
create table public.bb_pair (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  key text not null check (key ~ '^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$'),
  expires_at timestamptz not null
);
alter table public.bb_pair enable row level security;
revoke all on public.bb_pair from anon, authenticated;
