'use strict';

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const WebSocket = require('ws');
const dayjs = require('dayjs');
const logger = require('../utils/logger');

const BASE = process.env.PLATS_URL || 'http://172.28.0.150:8080/plats';
const WS_BASE = BASE.replace('http', 'ws');

// Axios con soporte de cookies (mantiene sesión Spring Security)
const jar = new CookieJar();
const http = wrapper(axios.create({
  baseURL: BASE,
  jar,
  withCredentials: true,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
}));

let sessionActive = false;
let salas = [];          // cache de salas
let wsClient = null;     // cliente WebSocket STOMP
let onEventoCb = null;   // callback para eventos en tiempo real

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
async function login() {
  try {
    const params = new URLSearchParams();
    params.append('username', process.env.PLATS_USER);
    params.append('password', process.env.PLATS_PASS);

    await http.post('/login', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 5
    });

    sessionActive = true;
    logger.info('✅ Sesión PLATS iniciada correctamente');
    return true;
  } catch (err) {
    logger.error({ err }, '❌ Error al iniciar sesión en PLATS');
    return false;
  }
}

// Wrapper con auto-relogin si la sesión expira
async function request(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.response?.status === 401 || err?.response?.status === 302) {
      logger.warn('Sesión expirada, reintentando login...');
      await login();
      return await fn();
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// SALAS
// ─────────────────────────────────────────────
async function getSalas() {
  if (salas.length > 0) return salas;
  const { data } = await request(() => http.get('/agenda/salas'));
  salas = data;
  return salas;
}

function getSalaNombre(id) {
  const sala = salas.find(s => String(s.id) === String(id));
  return sala ? sala.nombre : `Sala ${id}`;
}

// ─────────────────────────────────────────────
// CONSULTAR AUDIENCIAS POR FECHA
// ─────────────────────────────────────────────
async function getAudienciasPorFecha(fecha) {
  // fecha en formato YYYY-MM-DD, movimiento=0 = fecha exacta
  const { data } = await request(() =>
    http.get(`/agenda/seleccion?fecha=${fecha}&movimiento=0`)
  );
  return data; // { fechaTexto, fechaSeleccionada, audiencias: [...] }
}

// ─────────────────────────────────────────────
// CONSULTAR AUDIENCIA POR EXPEDIENTE
// ─────────────────────────────────────────────
async function buscarPorExpediente(expediente, fecha) {
  const data = await getAudienciasPorFecha(fecha || dayjs().format('YYYY-MM-DD'));
  if (!data?.audiencias) return [];
  return data.audiencias.filter(a =>
    a.descripcion?.toUpperCase().includes(expediente.toUpperCase()) ||
    a.expediente?.toUpperCase().includes(expediente.toUpperCase())
  );
}

// ─────────────────────────────────────────────
// OBTENER DETALLE DE UNA AUDIENCIA
// ─────────────────────────────────────────────
async function getAudiencia(id) {
  const { data } = await request(() => http.get(`/agenda/${id}`));
  return data;
}

// ─────────────────────────────────────────────
// VERIFICAR DISPONIBILIDAD DE SALA
// ─────────────────────────────────────────────
async function verificarDisponibilidad(idSala, fecha, inicio, fin) {
  const data = await getAudienciasPorFecha(fecha);
  if (!data?.audiencias) return true;

  const toMinutos = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const minInicio = toMinutos(inicio);
  const minFin = toMinutos(fin);

  const conflicto = data.audiencias.find(a => {
    if (String(a.idSala) !== String(idSala)) return false;
    const aInicio = toMinutos(a.inicio);
    const aFin = toMinutos(a.fin);
    return minInicio < aFin && minFin > aInicio;
  });

  return !conflicto;
}

// ─────────────────────────────────────────────
// CREAR AUDIENCIA
// ─────────────────────────────────────────────
async function crearAudiencia({ idSala, idSede, idInstancia, expediente, internos,
                                 comunicacion, solicitante, link, fecha, inicio, fin, externo }) {
  const payload = {
    id: '',
    idSala: String(idSala),
    idSede: idSede || '0401',
    idInstancia: idInstancia || '',
    externo: externo || false,
    expediente: expediente?.toUpperCase(),
    internos: internos?.toUpperCase() || '',
    comunicacion: comunicacion || 'WHATSAPP',
    solicitante: solicitante?.toUpperCase() || '',
    link: link || '',
    fecha,
    inicio,
    fin
  };

  const { data } = await request(() => http.post('/agenda/evento', payload));
  return data;
}

// ─────────────────────────────────────────────
// ACTUALIZAR LINK MEET EN UNA AUDIENCIA
// ─────────────────────────────────────────────
async function actualizarLink(id, link) {
  const audiencia = await getAudiencia(id);
  audiencia.link = link;
  await request(() => http.put('/agenda/evento', audiencia));
}

// ─────────────────────────────────────────────
// ELIMINAR AUDIENCIA
// ─────────────────────────────────────────────
async function eliminarAudiencia(id) {
  await request(() => http.delete(`/agenda/evento/${id}`));
}

// ─────────────────────────────────────────────
// WEBSOCKET STOMP (tiempo real)
// ─────────────────────────────────────────────
function conectarWebSocket(onEvento) {
  onEventoCb = onEvento;

  // SockJS + STOMP manual sobre ws nativo
  const wsUrl = `${WS_BASE}/ws-agenda/websocket`;

  function connect() {
    wsClient = new WebSocket(wsUrl, [], {
      headers: {
        Cookie: jar.toJSON().cookies
          .map(c => `${c.key}=${c.value}`)
          .join('; ')
      }
    });

    wsClient.on('open', () => {
      logger.info('🔌 WebSocket PLATS conectado');
      // STOMP CONNECT frame
      wsClient.send('CONNECT\naccept-version:1.2\nheart-beat:10000,10000\n\n\0');
    });

    wsClient.on('message', raw => {
      const msg = raw.toString();
      if (msg.startsWith('CONNECTED')) {
        // Suscribirse a los 3 topics
        wsClient.send('SUBSCRIBE\nid:sub-0\ndestination:/topic/eventoNuevo\n\n\0');
        wsClient.send('SUBSCRIBE\nid:sub-1\ndestination:/topic/eventoModificado\n\n\0');
        wsClient.send('SUBSCRIBE\nid:sub-2\ndestination:/topic/eventoEliminado\n\n\0');
        return;
      }
      if (msg.includes('/topic/evento') && msg.includes('\n\n')) {
        const body = msg.split('\n\n')[1]?.replace('\0', '');
        if (!body) return;
        try {
          const evento = JSON.parse(body);
          if (onEventoCb) onEventoCb(evento);
        } catch (_) { /* body de eventoEliminado es solo el id */ }
      }
    });

    wsClient.on('close', () => {
      logger.warn('WebSocket PLATS desconectado, reconectando en 5s...');
      setTimeout(connect, 5000);
    });

    wsClient.on('error', err => logger.error({ err }, 'Error WebSocket PLATS'));
  }

  connect();
}

// ─────────────────────────────────────────────
// SEDES (cache para el bot)
// ─────────────────────────────────────────────
async function getSedes() {
  const { data } = await request(() => http.get('/sede'));
  return data;
}

async function getInstancias(idSede) {
  const { data } = await request(() => http.get(`/instancia/${idSede}`));
  return data;
}

module.exports = {
  login,
  getSalas,
  getSalaNombre,
  getAudienciasPorFecha,
  getAudiencia,
  buscarPorExpediente,
  verificarDisponibilidad,
  crearAudiencia,
  actualizarLink,
  eliminarAudiencia,
  conectarWebSocket,
  getSedes,
  getInstancias
};
