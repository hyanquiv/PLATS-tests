-- ═══════════════════════════════════════════════════════════════
--  PLATS v3.0 — Esquema PostgreSQL
--  Corte Superior de Justicia de Arequipa
-- ═══════════════════════════════════════════════════════════════

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Salas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salas (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60)  NOT NULL,
  tipo        VARCHAR(20)  NOT NULL DEFAULT 'SALA',   -- SALA | CABINA
  capacidad   INT          NOT NULL DEFAULT 30,
  activa      BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ── Sedes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sedes (
  id            VARCHAR(10)  PRIMARY KEY,
  denominacion  VARCHAR(120) NOT NULL,
  activa        BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ── Juzgados / Instancias ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS juzgados (
  id            SERIAL       PRIMARY KEY,
  id_sede       VARCHAR(10)  NOT NULL REFERENCES sedes(id),
  denominacion  VARCHAR(120) NOT NULL,
  activo        BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ── Penales ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS penales (
  id              SERIAL       PRIMARY KEY,
  nombre          VARCHAR(80)  NOT NULL UNIQUE,
  email_calendar  VARCHAR(120),                        -- penaldesocabaya@gmail.com
  telefono_wa     VARCHAR(20),                         -- 51999999999
  ip_rustdesk     VARCHAR(45),                         -- 172.28.1.10
  id_rustdesk     VARCHAR(20),                         -- 100001
  agent_port      INT          DEFAULT 3002,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ── Usuarios del bot ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL       PRIMARY KEY,
  telefono      VARCHAR(20)  NOT NULL UNIQUE,          -- 51987654321
  nombre        VARCHAR(100),
  rol           VARCHAR(20)  NOT NULL DEFAULT 'SECRETARIO', -- ADMIN | SECRETARIO
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Audiencias ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audiencias (
  id                  SERIAL          PRIMARY KEY,
  -- Origen
  id_plats            VARCHAR(20),                     -- ID del sistema Java (si sincroniza)
  -- Datos principales
  id_sala             INT             NOT NULL REFERENCES salas(id),
  id_sede             VARCHAR(10)     NOT NULL REFERENCES sedes(id),
  id_juzgado          INT             NOT NULL REFERENCES juzgados(id),
  id_penal            INT             REFERENCES penales(id),
  -- Horario
  fecha               DATE            NOT NULL,
  inicio              TIME            NOT NULL,
  fin                 TIME            NOT NULL,
  -- Partes
  expediente          VARCHAR(30)     NOT NULL,
  internos            TEXT            NOT NULL,
  solicitante         VARCHAR(100)    NOT NULL,
  comunicacion        VARCHAR(30)     NOT NULL DEFAULT 'WHATSAPP',
  -- Meet
  link_meet           TEXT,
  evento_calendar_id  TEXT,
  -- Control
  estado              VARCHAR(20)     NOT NULL DEFAULT 'PROGRAMADA', -- PROGRAMADA | CANCELADA | REALIZADA
  agendado_por        INT             REFERENCES usuarios(id),
  agendado_en         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT horario_valido CHECK (fin > inicio),
  CONSTRAINT expediente_formato CHECK (expediente ~ '^\d{4,6}-\d{4}-\d{2,4}$')
);

-- ── Índices críticos para el validador de overlap ─────────────
-- Este índice es el que usa la consulta de solapamiento — debe ser muy rápido
CREATE INDEX IF NOT EXISTS idx_audiencias_overlap
  ON audiencias (id_sala, fecha, inicio, fin)
  WHERE estado = 'PROGRAMADA';

CREATE INDEX IF NOT EXISTS idx_audiencias_fecha
  ON audiencias (fecha, estado);

CREATE INDEX IF NOT EXISTS idx_audiencias_expediente
  ON audiencias (expediente);

-- ── Log de actividad del bot ──────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_logs (
  id          SERIAL       PRIMARY KEY,
  telefono    VARCHAR(20)  NOT NULL,
  accion      VARCHAR(50)  NOT NULL,
  detalle     JSONB,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_telefono
  ON bot_logs (telefono, creado_en DESC);

-- ── Función y trigger: actualizar timestamp ───────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_audiencias_updated
  BEFORE UPDATE ON audiencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  DATOS SEMILLA
-- ═══════════════════════════════════════════════════════════════

-- Salas (igual que el PLATS original)
INSERT INTO salas (id, nombre, tipo, capacidad) VALUES
  (1, 'SALA 1',   'SALA',   30),
  (2, 'SALA 2',   'SALA',   30),
  (3, 'SALA 3',   'SALA',   30),
  (4, 'CABINA 4', 'CABINA',  1),
  (5, 'CABINA 5', 'CABINA',  1),
  (6, 'CABINA 6', 'CABINA',  1),
  (7, 'MUJERES',  'CABINA', 10)
ON CONFLICT (id) DO NOTHING;

-- Resetear secuencia después de insertar IDs manuales
SELECT setval('salas_id_seq', 10);

-- Sedes (Arequipa — ajustar según PLATS real)
INSERT INTO sedes (id, denominacion) VALUES
  ('0401', 'SEDE CENTRAL — AREQUIPA'),
  ('0402', 'SEDE HUNTER'),
  ('0403', 'SEDE PAUCARPATA'),
  ('0404', 'SEDE MIRAFLORES'),
  ('0405', 'SEDE CERRO COLORADO'),
  ('0406', 'SEDE MARIANO MELGAR'),
  ('0407', 'SEDE SOCABAYA')
ON CONFLICT (id) DO NOTHING;

-- Juzgados por sede central
INSERT INTO juzgados (id_sede, denominacion) VALUES
  ('0401', '1° JUZGADO PENAL UNIPERSONAL'),
  ('0401', '2° JUZGADO PENAL UNIPERSONAL'),
  ('0401', '3° JUZGADO PENAL UNIPERSONAL'),
  ('0401', '1° JUZGADO PENAL COLEGIADO'),
  ('0401', '2° JUZGADO PENAL COLEGIADO'),
  ('0401', 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP'),
  ('0401', '1° JUZGADO UNIPERSONAL DE FLAGRANCIA — JUP'),
  ('0401', '2° JUZGADO UNIPERSONAL DE FLAGRANCIA — JUP'),
  ('0402', '1° JUZGADO MIXTO HUNTER'),
  ('0402', '2° JUZGADO MIXTO HUNTER'),
  ('0403', '1° JUZGADO MIXTO PAUCARPATA'),
  ('0404', '1° JUZGADO MIXTO MIRAFLORES'),
  ('0405', '1° JUZGADO MIXTO CERRO COLORADO'),
  ('0406', '1° JUZGADO MIXTO MARIANO MELGAR'),
  ('0407', '1° JUZGADO MIXTO SOCABAYA');

-- Penales de Arequipa (ajustar emails e IPs reales)
INSERT INTO penales (nombre, email_calendar, telefono_wa, ip_rustdesk, id_rustdesk, agent_port) VALUES
  ('SOCABAYA',     'penaldesocabaya@gmail.com',   '51999000001', '172.28.1.10', '100001', 3002),
  ('YARABAMBA',    'penalyarabamba@gmail.com',    '51999000002', '172.28.1.11', '100002', 3002),
  ('QOCHAPAMPA',   'penalqochapampa@gmail.com',   '51999000003', '172.28.1.12', '100003', 3002),
  ('CAMANÁ',       'penalcamana@gmail.com',       '51999000004', '172.28.1.13', '100004', 3002),
  ('CAYLLOMA',     'penalcaylloma@gmail.com',     '51999000005', '172.28.1.14', '100005', 3002)
ON CONFLICT (nombre) DO NOTHING;

-- Usuario admin inicial (ajustar teléfono)
INSERT INTO usuarios (telefono, nombre, rol) VALUES
  ('51999999999', 'Administrador PLATS', 'ADMIN')
ON CONFLICT (telefono) DO NOTHING;
