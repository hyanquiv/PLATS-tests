const axios  = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const NodeCache = require('node-cache');
const logger = require('./logger');

const BASE  = process.env.PLATS_BASE_URL || 'http://plats-mock:8080/plats';
const cache = new NodeCache({ stdTTL: 300 });
const jar   = new CookieJar();
const http  = wrapper(axios.create({
  baseURL: BASE, jar, withCredentials: true,
  timeout: 10_000, headers: { 'Content-Type': 'application/json' }
}));
let sesionActiva = false;

async function login() {
  const params = new URLSearchParams({
    username: process.env.PLATS_USER || 'admin',
    password: process.env.PLATS_PASS || 'admin'
  });
  await http.post('/login', params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxRedirects: 5 });
  sesionActiva = true;
  logger.info('✅ Sesión PLATS iniciada');
}

http.interceptors.response.use(res => res, async err => {
  if (err.response?.status === 401 && !err.config._retry) {
    err.config._retry = true; await login(); return http(err.config);
  }
  return Promise.reject(err);
});

async function asegurarSesion() { if (!sesionActiva) await login(); }

async function obtenerSalas() {
  const c = cache.get('salas'); if (c) return c;
  await asegurarSesion();
  const { data } = await http.get('/agenda/salas');
  cache.set('salas', data); return data;
}

async function crearAudiencia(payload) {
  await asegurarSesion();
  const { data } = await http.post('/agenda/evento', {
    id:'', idSala:payload.idSala, idSede:payload.idSede,
    idInstancia:payload.idInstancia, externo:false,
    expediente:payload.expediente, internos:payload.internos,
    comunicacion:payload.comunicacion||'WHATSAPP',
    solicitante:payload.solicitante||'BOT', link:payload.link||'',
    fecha:payload.fecha, inicio:payload.inicio, fin:payload.fin
  });
  return data;
}

module.exports = { login, obtenerSalas, crearAudiencia };
