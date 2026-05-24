/**
 * db.js — Pool de conexiones PostgreSQL
 * Todas las queries de la aplicación pasan por aquí.
 */
const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'plats-postgres',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB       || 'plats',
  user:     process.env.POSTGRES_USER     || 'plats',
  password: process.env.POSTGRES_PASSWORD || 'plats_secret',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => logger.error({ err }, 'Error en pool PostgreSQL'));

// ── Verificar conexión al arrancar ────────────────────────────
async function conectar() {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  logger.info('✅ PostgreSQL conectado');
}

// ════════════════════════════════════════════════════════════════
//  SALAS
// ════════════════════════════════════════════════════════════════
async function getSalas() {
  const { rows } = await pool.query(
    'SELECT * FROM salas WHERE activa = TRUE ORDER BY id'
  );
  return rows;
}

// ════════════════════════════════════════════════════════════════
//  SEDES
// ════════════════════════════════════════════════════════════════
async function getSedes() {
  const { rows } = await pool.query(
    'SELECT * FROM sedes WHERE activa = TRUE ORDER BY denominacion'
  );
  return rows;
}

// ════════════════════════════════════════════════════════════════
//  JUZGADOS
// ════════════════════════════════════════════════════════════════
async function getJuzgados(idSede) {
  const { rows } = await pool.query(
    'SELECT * FROM juzgados WHERE id_sede = $1 AND activo = TRUE ORDER BY denominacion',
    [idSede]
  );
  return rows;
}

// ════════════════════════════════════════════════════════════════
//  PENALES
// ════════════════════════════════════════════════════════════════
async function getPenales() {
  const { rows } = await pool.query(
    'SELECT * FROM penales WHERE activo = TRUE ORDER BY nombre'
  );
  return rows;
}

async function getPenalByNombre(nombre) {
  const { rows } = await pool.query(
    'SELECT * FROM penales WHERE UPPER(nombre) = UPPER($1)',
    [nombre]
  );
  return rows[0] || null;
}

// ════════════════════════════════════════════════════════════════
//  VALIDADOR DE OVERLAP
// ════════════════════════════════════════════════════════════════
/**
 * Verifica si hay solapamiento de horario en una sala para una fecha.
 * Usa el índice idx_audiencias_overlap — respuesta en < 5ms.
 *
 * Lógica: dos rangos [A,B] y [C,D] se solapan si A < D && B > C
 *
 * @returns {{ disponible: boolean, conflicto: object|null }}
 */
async function verificarDisponibilidad({ idSala, fecha, inicio, fin, excluirId = null }) {
  let query = `
    SELECT
      a.*,
      s.nombre AS sala_nombre,
      j.denominacion AS juzgado_nombre
    FROM audiencias a
    JOIN salas s ON s.id = a.id_sala
    JOIN juzgados j ON j.id = a.id_juzgado
    WHERE
      a.id_sala = $1
      AND a.fecha = $2
      AND a.estado = 'PROGRAMADA'
      AND a.inicio < $4::time
      AND a.fin    > $3::time
  `;
  const params = [idSala, fecha, inicio, fin];

  if (excluirId) {
    query += ` AND a.id != $5`;
    params.push(excluirId);
  }

  const { rows } = await pool.query(query, params);

  if (rows.length === 0) return { disponible: true, conflicto: null };

  return {
    disponible: false,
    conflicto: rows[0],
  };
}

/**
 * Devuelve los slots de 30 min disponibles en una sala para una fecha.
 * Útil para mostrar SOLO horarios libres en el selector WhatsApp.
 */
async function getSlotsDisponibles({ idSala, fecha, horaDesde = '08:00', horaHasta = '17:30', duracionMin = 30 }) {
  // Obtener audiencias programadas en esa sala/fecha
  const { rows: ocupados } = await pool.query(`
    SELECT inicio, fin FROM audiencias
    WHERE id_sala = $1 AND fecha = $2 AND estado = 'PROGRAMADA'
    ORDER BY inicio
  `, [idSala, fecha]);

  // Generar todos los slots posibles
  const slots = [];
  let [h, m] = horaDesde.split(':').map(Number);
  const [hf, mf] = horaHasta.split(':').map(Number);
  const limiteMin = hf * 60 + mf;

  while (true) {
    const inicioMin = h * 60 + m;
    const finMin = inicioMin + duracionMin;
    if (finMin > limiteMin) break;

    const inicioStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const finH = Math.floor(finMin / 60);
    const finM = finMin % 60;
    const finStr = `${String(finH).padStart(2,'0')}:${String(finM).padStart(2,'0')}`;

    // Verificar si este slot choca con algún ocupado
    const choca = ocupados.some(oc => {
      const ocIni = timeToMin(oc.inicio);
      const ocFin = timeToMin(oc.fin);
      return inicioMin < ocFin && finMin > ocIni;
    });

    if (!choca) slots.push({ inicio: inicioStr, fin: finStr, label: `${inicioStr} – ${finStr}` });

    m += 30;
    if (m >= 60) { h++; m -= 60; }
  }

  return slots;
}

function timeToMin(t) {
  // pg devuelve time como "HH:MM:SS" o "HH:MM"
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// ════════════════════════════════════════════════════════════════
//  AUDIENCIAS
// ════════════════════════════════════════════════════════════════
async function getAudienciasPorFecha(fecha) {
  const { rows } = await pool.query(`
    SELECT
      a.*,
      s.nombre        AS sala_nombre,
      se.denominacion AS sede_nombre,
      j.denominacion  AS juzgado_nombre,
      p.nombre        AS penal_nombre
    FROM audiencias a
    JOIN salas    s  ON s.id  = a.id_sala
    JOIN sedes    se ON se.id = a.id_sede
    JOIN juzgados j  ON j.id  = a.id_juzgado
    LEFT JOIN penales p ON p.id = a.id_penal
    WHERE a.fecha = $1 AND a.estado = 'PROGRAMADA'
    ORDER BY a.inicio, a.id_sala
  `, [fecha]);
  return rows;
}

async function getAudienciaPorExpediente(expediente, fecha = null) {
  let query = `
    SELECT
      a.*,
      s.nombre        AS sala_nombre,
      se.denominacion AS sede_nombre,
      j.denominacion  AS juzgado_nombre,
      p.nombre        AS penal_nombre
    FROM audiencias a
    JOIN salas    s  ON s.id  = a.id_sala
    JOIN sedes    se ON se.id = a.id_sede
    JOIN juzgados j  ON j.id  = a.id_juzgado
    LEFT JOIN penales p ON p.id = a.id_penal
    WHERE a.expediente ILIKE $1
  `;
  const params = [`%${expediente}%`];
  if (fecha) { query += ' AND a.fecha = $2'; params.push(fecha); }
  query += ' ORDER BY a.fecha DESC, a.inicio LIMIT 10';
  const { rows } = await pool.query(query, params);
  return rows;
}

async function crearAudiencia({
  idSala, idSede, idJuzgado, idPenal,
  fecha, inicio, fin,
  expediente, internos, solicitante,
  comunicacion = 'WHATSAPP',
  linkMeet = null,
  eventoCalendarId = null,
  agendadoPor = null,
}) {
  const { rows } = await pool.query(`
    INSERT INTO audiencias
      (id_sala, id_sede, id_juzgado, id_penal,
       fecha, inicio, fin,
       expediente, internos, solicitante,
       comunicacion, link_meet, evento_calendar_id, agendado_por)
    VALUES ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10, $11,$12,$13,$14)
    RETURNING *
  `, [
    idSala, idSede, idJuzgado, idPenal,
    fecha, inicio, fin,
    expediente, internos, solicitante,
    comunicacion, linkMeet, eventoCalendarId, agendadoPor,
  ]);
  logger.info({ id: rows[0].id, expediente, fecha }, '📅 Audiencia creada en BD');
  return rows[0];
}

async function actualizarLinkMeet(idAudiencia, linkMeet, eventoCalendarId) {
  await pool.query(
    'UPDATE audiencias SET link_meet=$1, evento_calendar_id=$2 WHERE id=$3',
    [linkMeet, eventoCalendarId, idAudiencia]
  );
}

async function cancelarAudiencia(idAudiencia) {
  await pool.query(
    "UPDATE audiencias SET estado='CANCELADA' WHERE id=$1",
    [idAudiencia]
  );
}

// ════════════════════════════════════════════════════════════════
//  USUARIOS
// ════════════════════════════════════════════════════════════════
async function getUsuario(telefono) {
  const { rows } = await pool.query(
    'SELECT * FROM usuarios WHERE telefono=$1 AND activo=TRUE',
    [telefono]
  );
  return rows[0] || null;
}

async function registrarUsuario(telefono, nombre) {
  const { rows } = await pool.query(`
    INSERT INTO usuarios (telefono, nombre, rol)
    VALUES ($1, $2, 'SECRETARIO')
    ON CONFLICT (telefono) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING *
  `, [telefono, nombre]);
  return rows[0];
}

// ════════════════════════════════════════════════════════════════
//  LOG
// ════════════════════════════════════════════════════════════════
async function logActividad(telefono, accion, detalle = {}) {
  await pool.query(
    'INSERT INTO bot_logs (telefono, accion, detalle) VALUES ($1,$2,$3)',
    [telefono, accion, JSON.stringify(detalle)]
  ).catch(() => {}); // no bloquear el flujo si falla el log
}

module.exports = {
  conectar,
  getSalas,
  getSedes,
  getJuzgados,
  getPenales,
  getPenalByNombre,
  verificarDisponibilidad,
  getSlotsDisponibles,
  getAudienciasPorFecha,
  getAudienciaPorExpediente,
  crearAudiencia,
  actualizarLinkMeet,
  cancelarAudiencia,
  getUsuario,
  registrarUsuario,
  logActividad,
  pool,
};
