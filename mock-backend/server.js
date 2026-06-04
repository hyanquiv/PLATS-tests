/**
 * mock-backend/server.js
 * Replica exacta de la API REST del backend Java PLATS.
 * Solo para testing — reemplaza el 172.28.0.150:8080
 */
const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let nextId = 100;

const SALAS = [
  { id: 1, nombre: 'SALA 1',   cantidad: 30 },
  { id: 2, nombre: 'SALA 2',   cantidad: 30 },
  { id: 3, nombre: 'SALA 3',   cantidad: 30 },
  { id: 4, nombre: 'CABINA 4', cantidad: 1  },
  { id: 5, nombre: 'CABINA 5', cantidad: 1  },
  { id: 6, nombre: 'CABINA 6', cantidad: 1  },
  { id: 7, nombre: 'MUJERES',  cantidad: 10 },
];

const SEDES = [
  { id: '0401', denominacion: 'PAUCARPATA' },
  { id: '0402', denominacion: 'MIRAFLORES' },
  { id: '0403', denominacion: 'CERRO COLORADO' },
  { id: '0404', denominacion: 'TACNA' },
  { id: '0405', denominacion: 'LIMA' },
  { id: '0406', denominacion: 'CUSCO' },
];

const INSTANCIAS = {
  // Mismos juzgados base para todas las sedes (ajustar según real)
  '0401': [
    { id: '1',  denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '2',  denominacion: '2° JUZGADO PENAL UNIPERSONAL' },
    { id: '3',  denominacion: '3° JUZGADO PENAL UNIPERSONAL' },
    { id: '4',  denominacion: '1° JUZGADO PENAL COLEGIADO' },
    { id: '5',  denominacion: '2° JUZGADO PENAL COLEGIADO' },
    { id: '6',  denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP' },
    { id: '7',  denominacion: 'JUZGADO UNIPERSONAL DE FLAGRANCIA — JUP' },
  ],
  '0402': [
    { id: '8',  denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '9',  denominacion: '2° JUZGADO PENAL UNIPERSONAL' },
    { id: '10', denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP' },
    { id: '11', denominacion: 'JUZGADO UNIPERSONAL DE FLAGRANCIA — JUP' },
  ],
  '0403': [
    { id: '12', denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '13', denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP' },
  ],
  '0404': [
    { id: '14', denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '15', denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP' },
  ],
  '0405': [
    { id: '16', denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '17', denominacion: '2° JUZGADO PENAL UNIPERSONAL' },
    { id: '18', denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP' },
  ],
  '0406': [
    { id: '19', denominacion: '1° JUZGADO PENAL UNIPERSONAL' },
    { id: '20', denominacion: 'JUZGADO DE INVESTIGACIÓN PREPARATORIA — JIP' },
  ],
};

function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
}

function formatFechaTexto(dateStr) {
  const dias  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]} del ${d.getFullYear()}`;
}

let AUDIENCIAS = [
  { id:'1', idSala:1, idSede:'0401', idInstancia:'1',
    expediente:'09167-2024-10', descripcion:'09167-2024-10',
    internos:'CARLOS MAMANI QUISPE', solicitante:'DR. JUAN PÉREZ',
    comunicacion:'WHATSAPP', link:'https://meet.google.com/abc-defg-hij',
    fecha: todayStr(), inicio:'09:00', fin:'10:30', externo:false,
    fechaHoraRegistro:'2026-05-01 08:00', accion:true },
  { id:'2', idSala:2, idSede:'0401', idInstancia:'2',
    expediente:'04521-2025-58', descripcion:'04521-2025-58',
    internos:'ROSA FLORES TICONA', solicitante:'DRA. MARÍA VILCA',
    comunicacion:'PROPIO', link:'',
    fecha: todayStr(), inicio:'10:00', fin:'11:30', externo:false,
    fechaHoraRegistro:'2026-05-01 09:00', accion:true },
  { id:'3', idSala:3, idSede:'0401', idInstancia:'3',
    expediente:'12384-2024-90', descripcion:'12384-2024-90',
    internos:'PEDRO HUANCA LAURA', solicitante:'DR. LUIS CHÁVEZ',
    comunicacion:'WHATSAPP', link:'https://meet.google.com/xyz-uvwx-yz',
    fecha: todayStr(), inicio:'14:00', fin:'16:00', externo:false,
    fechaHoraRegistro:'2026-05-02 07:30', accion:true },
  { id:'4', idSala:4, idSede:'0401', idInstancia:'4',
    expediente:'00891-2025-12', descripcion:'00891-2025-12',
    internos:'ANA CÁCERES RAMOS', solicitante:'DR. JORGE SALAS',
    comunicacion:'EMAIL', link:'',
    fecha: todayStr(), inicio:'11:00', fin:'12:00', externo:false,
    fechaHoraRegistro:'2026-05-02 10:00', accion:true },
  { id:'5', idSala:7, idSede:'0401', idInstancia:'1',
    expediente:'07432-2025-44', descripcion:'07432-2025-44',
    internos:'LUCÍA APAZA CONDORI', solicitante:'DRA. CARMEN LLERENA',
    comunicacion:'WHATSAPP', link:'',
    fecha: todayStr(), inicio:'15:00', fin:'16:30', externo:false,
    fechaHoraRegistro:'2026-05-03 08:00', accion:true },
];

app.post('/plats/login', (_req, res) => {
  res.cookie('JSESSIONID', 'mock-session-' + Date.now(), { httpOnly: true });
  res.redirect(302, '/plats/agenda');
});

app.get('/plats/agenda/salas', (_req, res) => res.json(SALAS));
app.get('/plats/sede',          (_req, res) => res.json(SEDES));
app.get('/plats/instancia/:id', (req, res)  => res.json(INSTANCIAS[req.params.id] || []));

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

app.get('/plats/agenda/:id', (req, res) => {
  const a = AUDIENCIAS.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ message: 'No encontrado' });
  res.json({ ...a, nombreSala: SALAS.find(s => s.id === a.idSala)?.nombre });
});

app.post('/plats/agenda/evento', (req, res) => {
  const ev = { ...req.body, id: String(nextId++), idSala: parseInt(req.body.idSala),
               fechaHoraRegistro: new Date().toLocaleString('es-PE'), accion: true };
  AUDIENCIAS.push(ev);
  console.log(`[MOCK] ✅ Creada: ${ev.expediente} - Sala ${ev.idSala}`);
  res.status(201).json(ev);
});

app.put('/plats/agenda/evento', (req, res) => {
  const idx = AUDIENCIAS.findIndex(a => a.id === req.body.id);
  if (idx === -1) return res.status(404).json({ message: 'No encontrado' });
  AUDIENCIAS[idx] = { ...AUDIENCIAS[idx], ...req.body, idSala: parseInt(req.body.idSala) };
  res.json(AUDIENCIAS[idx]);
});

app.delete('/plats/agenda/evento/:id', (req, res) => {
  const before = AUDIENCIAS.length;
  AUDIENCIAS = AUDIENCIAS.filter(a => a.id !== req.params.id);
  if (AUDIENCIAS.length === before) return res.status(404).json({ message: 'No encontrado' });
  res.status(204).send();
});

app.get('/plats/*', (_req, res) => res.json({ ok: true, mock: true }));

app.listen(8080, '0.0.0.0', () => {
  console.log('');
  console.log('  🏛️  PLATS Mock Backend :8080');
  console.log(`  📅  ${AUDIENCIAS.length} audiencias demo para hoy (${todayStr()})`);
  console.log('');
});
