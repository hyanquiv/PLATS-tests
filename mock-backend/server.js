/**
 * mock-backend/server.js
 * Replica exacta de la API REST del backend Java PLATS.
 * Usada únicamente para testing — reemplaza el 172.28.0.150:8080
 */
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Data en memoria ────────────────────────────────────────────────────────
let nextId = 100;

const SALAS = [
  { id: 1, nombre: 'SALA 1',    capacidad: 30, cantidad: 30 },
  { id: 2, nombre: 'SALA 2',    capacidad: 30, cantidad: 30 },
  { id: 3, nombre: 'SALA 3',    capacidad: 30, cantidad: 30 },
  { id: 4, nombre: 'CABINA 4',  capacidad: 1,  cantidad: 1  },
  { id: 5, nombre: 'CABINA 5',  capacidad: 1,  cantidad: 1  },
  { id: 6, nombre: 'CABINA 6',  capacidad: 1,  cantidad: 1  },
  { id: 7, nombre: 'MUJERES',   capacidad: 10, cantidad: 10 },
];

const SEDES = [
  { id: '0401', denominacion: 'SEDE CENTRAL AREQUIPA' },
  { id: '0402', denominacion: 'SEDE HUNTER' },
];

const INSTANCIAS = {
  '0401': [
    { id: '1', denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '2', denominacion: '2° JUZGADO PENAL UNIPERSONAL' },
    { id: '3', denominacion: '1° JUZGADO PENAL COLEGIADO' },
    { id: '4', denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA' },
  ],
  '0402': [
    { id: '5', denominacion: '1° JUZGADO MIXTO HUNTER' },
    { id: '6', denominacion: '2° JUZGADO MIXTO HUNTER' },
  ],
};

// Audiencias de demo
let AUDIENCIAS = [
  {
    id: '1', idSala: 1, idSede: '0401', idInstancia: '1',
    expediente: '09167-2024-10', descripcion: '09167-2024-10',
    internos: 'CARLOS MAMANI QUISPE',
    solicitante: 'DR. JUAN PÉREZ', comunicacion: 'WHATSAPP',
    link: 'https://meet.google.com/abc-defg-hij',
    fecha: todayStr(), inicio: '09:00', fin: '10:30',
    externo: false, fechaHoraRegistro: '2026-05-01 08:00', accion: true,
  },
  {
    id: '2', idSala: 2, idSede: '0401', idInstancia: '2',
    expediente: '04521-2025-58', descripcion: '04521-2025-58',
    internos: 'ROSA FLORES TICONA',
    solicitante: 'DRA. MARÍA VILCA', comunicacion: 'PROPIO',
    link: '', fecha: todayStr(), inicio: '10:00', fin: '11:30',
    externo: false, fechaHoraRegistro: '2026-05-01 09:00', accion: true,
  },
  {
    id: '3', idSala: 3, idSede: '0401', idInstancia: '3',
    expediente: '12384-2024-90', descripcion: '12384-2024-90',
    internos: 'PEDRO HUANCA LAURA',
    solicitante: 'DR. LUIS CHÁVEZ', comunicacion: 'WHATSAPP',
    link: 'https://meet.google.com/xyz-uvwx-yz',
    fecha: todayStr(), inicio: '14:00', fin: '16:00',
    externo: false, fechaHoraRegistro: '2026-05-02 07:30', accion: true,
  },
  {
    id: '4', idSala: 4, idSede: '0401', idInstancia: '4',
    expediente: '00891-2025-12', descripcion: '00891-2025-12',
    internos: 'ANA CÁCERES RAMOS',
    solicitante: 'DR. JORGE SALAS', comunicacion: 'EMAIL',
    link: '', fecha: todayStr(), inicio: '11:00', fin: '12:00',
    externo: false, fechaHoraRegistro: '2026-05-02 10:00', accion: true,
  },
  {
    id: '5', idSala: 7, idSede: '0401', idInstancia: '1',
    expediente: '07432-2025-44', descripcion: '07432-2025-44',
    internos: 'LUCÍA APAZA CONDORI',
    solicitante: 'DRA. CARMEN LLERENA', comunicacion: 'WHATSAPP',
    link: '', fecha: todayStr(), inicio: '15:00', fin: '16:30',
    externo: false, fechaHoraRegistro: '2026-05-03 08:00', accion: true,
  },
];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatFechaTexto(dateStr) {
  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]} del ${d.getFullYear()}`;
}

// ── Login (Spring Security simulado) ──────────────────────────────────────
app.post('/plats/login', (req, res) => {
  res.cookie('JSESSIONID', 'mock-session-' + Date.now(), { httpOnly: true });
  res.redirect(302, '/plats/agenda');
});

// ── Salas ──────────────────────────────────────────────────────────────────
app.get('/plats/agenda/salas', (_, res) => res.json(SALAS));

// ── Sedes ──────────────────────────────────────────────────────────────────
app.get('/plats/sede', (_, res) => res.json(SEDES));

// ── Instancias ─────────────────────────────────────────────────────────────
app.get('/plats/instancia/:idSede', (req, res) => {
  res.json(INSTANCIAS[req.params.idSede] || []);
});

// ── Audiencias del día (con navegación) ────────────────────────────────────
app.get('/plats/agenda/seleccion', (req, res) => {
  let fecha = req.query.fecha || todayStr();
  const mov = parseInt(req.query.movimiento) || 0;
  if (mov !== 0) fecha = addDays(fecha || todayStr(), mov);
  if (!fecha) fecha = todayStr();

  const audiencias = AUDIENCIAS
    .filter(a => a.fecha === fecha)
    .map(a => ({
      ...a,
      nombreSala: SALAS.find(s => s.id === a.idSala)?.nombre || 'Sala ' + a.idSala
    }));

  res.json({
    audiencias,
    fechaTexto: formatFechaTexto(fecha),
    fechaSeleccionada: fecha,
    totalAudiencias: audiencias.length,
  });
});

// ── Detalle audiencia ──────────────────────────────────────────────────────
app.get('/plats/agenda/:id', (req, res) => {
  const a = AUDIENCIAS.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ message: 'No encontrado' });
  res.json({
    ...a,
    nombreSala: SALAS.find(s => s.id === a.idSala)?.nombre || 'Sala ' + a.idSala
  });
});

// ── Crear audiencia ────────────────────────────────────────────────────────
app.post('/plats/agenda/evento', (req, res) => {
  const ev = {
    ...req.body,
    id: String(nextId++),
    idSala: parseInt(req.body.idSala),
    fechaHoraRegistro: new Date().toLocaleString('es-PE'),
    accion: true,
  };
  AUDIENCIAS.push(ev);
  console.log(`[MOCK] ✅ Audiencia creada: ${ev.expediente} - Sala ${ev.idSala}`);
  res.status(201).json(ev);
});

// ── Modificar audiencia ────────────────────────────────────────────────────
app.put('/plats/agenda/evento', (req, res) => {
  const idx = AUDIENCIAS.findIndex(a => a.id === req.body.id);
  if (idx === -1) return res.status(404).json({ message: 'No encontrado' });
  AUDIENCIAS[idx] = { ...AUDIENCIAS[idx], ...req.body, idSala: parseInt(req.body.idSala) };
  console.log(`[MOCK] ✏️  Audiencia modificada: ${req.body.id}`);
  res.json(AUDIENCIAS[idx]);
});

// ── Eliminar audiencia ─────────────────────────────────────────────────────
app.delete('/plats/agenda/evento/:id', (req, res) => {
  const before = AUDIENCIAS.length;
  AUDIENCIAS = AUDIENCIAS.filter(a => a.id !== req.params.id);
  if (AUDIENCIAS.length === before) return res.status(404).json({ message: 'No encontrado' });
  console.log(`[MOCK] 🗑️  Audiencia eliminada: ${req.params.id}`);
  res.status(204).send();
});

// ── Catch-all para rutas del frontend legacy ───────────────────────────────
app.get('/plats/*', (_, res) => res.json({ ok: true, mock: true }));

app.listen(8080, '0.0.0.0', () => {
  console.log('');
  console.log('  🏛️  PLATS Mock Backend corriendo en :8080');
  console.log(`  📅  ${AUDIENCIAS.length} audiencias de demo para hoy (${todayStr()})`);
  console.log('');
});
