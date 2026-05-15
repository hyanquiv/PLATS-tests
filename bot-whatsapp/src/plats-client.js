/**
 * plats-client.js
 * Cliente HTTP para el backend PLATS (172.28.0.150:8080)
 * Usa la misma API REST que el navegador — extráida del código fuente real.
 */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { formatInTimeZone } = require('date-fns-tz');
const NodeCache = require('node-cache');
const logger = require('./logger');

const BASE = process.env.PLATS_BASE_URL || 'http://172.28.0.150:8080/plats';
const TZ = 'America/Lima';

// Cache de 5 minutos para salas y sedes (no cambian seguido)
const cache = new NodeCache({ stdTTL: 300 });

// Un solo cliente con cookie jar para mantener la sesión
const jar = new CookieJar();
const http = wrapper(axios.create({
  baseURL: BASE,
  jar,
  withCredentials: true,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' }
}));

let sesionActiva = false;

// ─── Login ────────────────────────────────────────────────────────────────────
async function login() {
  try {
    // Spring Security recibe form-urlencoded en /login
    const params = new URLSearchParams({
      username: process.env.PLATS_USER || 'admin',
      password: process.env.PLATS_PASS || 'admin'
    });
    await http.post('/login', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 5
    });
    sesionActiva = true;
    logger.info('✅ Sesión PLATS iniciada');
  } catch (err) {
    sesionActiva = false;
    logger.error({ err }, '❌ Error al iniciar sesión en PLATS');
    throw err;
  }
}

// Interceptor: si responde 401/302 al login, re-autentica
http.interceptors.response.use(
  res => res,
  async err => {
    if (err.response?.status === 401 && !err.config._retry) {
      err.config._retry = true;
      await login();
      return http(err.config);
    }
    return Promise.reject(err);
  }
);

async function asegurarSesion() {
  if (!sesionActiva) await login();
}

// ─── Salas ────────────────────────────────────────────────────────────────────
async function obtenerSalas() {
  const cached = cache.get('salas');
  if (cached) return cached;
  await asegurarSesion();
  const { data } = await http.get('/agenda/salas');
  cache.set('salas', data);
  return data;
}

// ─── Sedes ────────────────────────────────────────────────────────────────────
async function obtenerSedes() {
  const cached = cache.get('sedes');
  if (cached) return cached;
  await asegurarSesion();
  const { data } = await http.get('/sede');
  cache.set('sedes', data);
  return data;
}

// ─── Instancias por sede ──────────────────────────────────────────────────────
async function obtenerInstancias(idSede) {
  await asegurarSesion();
  const { data } = await http.get(`/instancia/${idSede}`);
  return data;
}

// ─── Audiencias del día ───────────────────────────────────────────────────────
async function obtenerAudiencias(fecha = '', movimiento = '0') {
  await asegurarSesion();
  const { data } = await http.get('/agenda/seleccion', {
    params: { fecha, movimiento }
  });
  return data; // { audiencias:[], fechaTexto, fechaSeleccionada, ... }
}

// ─── Detalle de una audiencia ─────────────────────────────────────────────────
async function obtenerAudiencia(id) {
  await asegurarSesion();
  const { data } = await http.get(`/agenda/${id}`);
  return data;
}

// ─── Buscar audiencia por número de expediente ────────────────────────────────
async function buscarPorExpediente(expediente, fecha = '') {
  const resultado = await obtenerAudiencias(fecha);
  const audiencias = resultado.audiencias || [];
  return audiencias.filter(a =>
    a.descripcion?.toUpperCase().includes(expediente.toUpperCase()) ||
    a.expediente?.toUpperCase().includes(expediente.toUpperCase())
  );
}

// ─── Crear audiencia ──────────────────────────────────────────────────────────
// payload: { idSala, idSede, idInstancia, expediente, internos, solicitante,
//            fecha, inicio, fin, link?, comunicacion?, externo? }
async function crearAudiencia(payload) {
  await asegurarSesion();
  const evento = {
    id: '',
    idSala: payload.idSala,
    idSede: payload.idSede,
    idInstancia: payload.idInstancia,
    externo: payload.externo ?? false,
    expediente: payload.expediente,
    internos: payload.internos || '',
    comunicacion: payload.comunicacion || 'WHATSAPP',
    solicitante: payload.solicitante || 'BOT-WHATSAPP',
    link: payload.link || '',
    fecha: payload.fecha,
    inicio: payload.inicio,
    fin: payload.fin
  };
  const { data } = await http.post('/agenda/evento', evento);
  logger.info({ evento }, '📅 Audiencia creada');
  return data;
}

// ─── Modificar audiencia ──────────────────────────────────────────────────────
async function modificarAudiencia(id, payload) {
  await asegurarSesion();
  const evento = { ...payload, id };
  const { data } = await http.put('/agenda/evento', evento);
  return data;
}

// ─── Eliminar audiencia ───────────────────────────────────────────────────────
async function eliminarAudiencia(id) {
  await asegurarSesion();
  await http.delete(`/agenda/evento/${id}`);
  logger.info({ id }, '🗑️ Audiencia eliminada');
}

// ─── Verificar disponibilidad de sala ─────────────────────────────────────────
async function verificarDisponibilidad(idSala, fecha, inicio, fin) {
  const resultado = await obtenerAudiencias(fecha);
  const audiencias = resultado.audiencias || [];

  const toMin = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const minInicio = toMin(inicio);
  const minFin = toMin(fin);

  const conflicto = audiencias.find(a => {
    if (a.idSala !== parseInt(idSala)) return false;
    const aMin = toMin(a.inicio);
    const bMin = toMin(a.fin);
    return minInicio < bMin && minFin > aMin;
  });

  return { disponible: !conflicto, conflicto: conflicto || null };
}

// ─── Nombre de sala por ID ────────────────────────────────────────────────────
async function nombreSala(id) {
  const salas = await obtenerSalas();
  return salas.find(s => s.id === parseInt(id))?.nombre || `Sala ${id}`;
}

module.exports = {
  login,
  obtenerSalas,
  obtenerSedes,
  obtenerInstancias,
  obtenerAudiencias,
  obtenerAudiencia,
  buscarPorExpediente,
  crearAudiencia,
  modificarAudiencia,
  eliminarAudiencia,
  verificarDisponibilidad,
  nombreSala
};
