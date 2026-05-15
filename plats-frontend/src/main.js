/**
 * main.js — PLATS v3.0 Frontend
 * Reescritura moderna del frontend manteniendo 100% compatibilidad
 * con el backend Java/Spring Boot existente.
 */
import './style.css';

const API = '/plats'; // proxied por nginx al backend real

// ── Estado global ────────────────────────────────────────────────────────────
const state = {
  fecha: todayStr(),
  rooms: [],
  sedes: [],
  instancias: [],
  events: {},          // key: `${inicio}-${fin}-${roomId}` → eventData
  eventsRaw: [],       // array plano de audiencias del backend
  fechaTexto: '',
  userRole: '',
  userName: '',
  stompClient: null,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmt2(n) { return String(n).padStart(2,'0'); }

function normalizeTime(t) {
  const [h,m] = t.split(':').map(Number);
  return `${fmt2(h)}:${fmt2(m)}`;
}

function timeToMin(t) {
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}

function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'✅', error:'❌', warning:'⚠️' };
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').prepend(el);
  setTimeout(() => el.remove(), 4000);
}

// Slots de 15 min entre 08:00 y 17:45
const TIME_SLOTS = (() => {
  const s = [];
  for (let h = 8; h <= 17; h++)
    for (let m = 0; m < 60; m += 15)
      s.push(`${fmt2(h)}:${fmt2(m)}`);
  return s;
})();

const ROOM_ICONS = { 1:'🏛️', 2:'🏛️', 3:'🏛️', 4:'👤', 5:'👤', 6:'👤', 7:'👤' };
const EVENT_COLORS = [
  { bg:'#0073E6', text:'#fff', border:'#004FA3' },
  { bg:'#0A7A6A', text:'#fff', border:'#065550' },
  { bg:'#6B35B8', text:'#fff', border:'#4A2285' },
  { bg:'#C47A00', text:'#fff', border:'#8B5500' },
  { bg:'#A80000', text:'#fff', border:'#6B0000' },
];

function eventColor(idx) {
  return EVENT_COLORS[idx % EVENT_COLORS.length];
}

// ── API calls ────────────────────────────────────────────────────────────────
async function apiFetch(url, opts={}) {
  const res = await fetch(API + url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || `Error ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function loadRooms() {
  state.rooms = await apiFetch('/agenda/salas');
}

async function loadSedes() {
  state.sedes = await apiFetch('/sede');
}

async function loadInstancias(idSede) {
  state.instancias = await apiFetch(`/instancia/${idSede}`);
  renderInstanciasSelect();
}

async function loadEvents(fecha='', movimiento='0') {
  const data = await apiFetch(`/agenda/seleccion?fecha=${fecha}&movimiento=${movimiento}`);
  state.eventsRaw  = data.audiencias || [];
  state.fechaTexto = data.fechaTexto || '';
  state.fecha      = data.fechaSeleccionada || state.fecha;
  return data;
}

async function getEventDetail(id) {
  return apiFetch(`/agenda/${id}`);
}

async function saveEvent(payload) {
  const method = payload.id ? 'PUT' : 'POST';
  return apiFetch('/agenda/evento', {
    method,
    body: JSON.stringify(payload)
  });
}

async function deleteEvent(id) {
  return apiFetch(`/agenda/evento/${id}`, { method: 'DELETE' });
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────────────────────
function renderApp() {
  document.getElementById('app').innerHTML = `
    <div id="toast-container"></div>

    <!-- TOPBAR -->
    <header class="topbar">
      <img class="topbar-logo" src="/pj.svg" alt="PJ">
      <div class="topbar-brand">
        <h1>CORTE SUPERIOR DE JUSTICIA DE AREQUIPA</h1>
        <p>PLATS v3.0 — Agendamiento y Publicación</p>
      </div>
      <div class="topbar-actions">
        <div class="user-chip" id="userChipBtn">
          <div class="user-avatar">👤</div>
          <span id="userNameDisplay">—</span>
        </div>
      </div>
    </header>

    <!-- NAVBAR -->
    <nav class="navbar">
      <button class="nav-link active" data-view="agenda">
        📅 Agendamiento
      </button>
    </nav>

    <!-- MAIN -->
    <div class="app-layout">

      <!-- SIDEBAR -->
      <aside class="sidebar">
        <div class="mini-cal" id="miniCal"></div>
        <div class="day-summary" id="daySummary"></div>
      </aside>

      <!-- PANEL AGENDA -->
      <main class="main-panel">
        <div class="panel-header">
          <div class="panel-header-date">
            <h2 id="panelDateTitle">—</h2>
            <p id="panelDateSub">—</p>
          </div>
          <div class="date-nav">
            <button class="date-nav-btn" id="btnPrev" title="Día anterior">‹</button>
            <button class="btn-secondary" id="btnHoy" style="font-size:12px;padding:6px 12px">Hoy</button>
            <button class="date-nav-btn" id="btnNext" title="Día siguiente">›</button>
          </div>
          <button class="btn-primary" id="btnNueva">
            <span>+</span> Nueva audiencia
          </button>
        </div>

        <div class="schedule-wrapper" id="scheduleWrapper">
          <div class="loading-overlay" id="loadingOverlay">
            <div class="spinner"></div>
          </div>
          <table class="schedule-table" id="scheduleTable">
            <thead id="scheduleHead"></thead>
            <tbody id="scheduleBody"></tbody>
          </table>
        </div>
      </main>
    </div>

    <!-- MODAL AUDIENCIA -->
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal" id="modal">
        <div class="modal-header">
          <span class="modal-badge" id="modalBadge">NUEVO</span>
          <span class="modal-title" id="modalTitle">Nueva audiencia</span>
          <button class="modal-close" id="modalClose">✕</button>
        </div>
        <div class="modal-body" id="divAgenda">
          <input type="hidden" id="txtIdAudiencia">

          <div class="form-group">
            <label class="form-label">Sala</label>
            <select class="form-select" id="lstSala"></select>
          </div>

          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input class="form-input" type="date" id="txtFecha">
          </div>

          <div class="form-group full-width">
            <label class="form-label">Horario</label>
            <div class="time-row">
              <select class="form-select time-select" id="selectHorasInicio"></select>
              <span>:</span>
              <select class="form-select time-select" id="selectMinutosInicio"></select>
              <span class="time-sep">–</span>
              <select class="form-select time-select" id="selectHorasFin"></select>
              <span>:</span>
              <select class="form-select time-select" id="selectMinutosFin"></select>
            </div>
          </div>

          <div class="form-group full-width">
            <label class="form-label">N° Expediente</label>
            <input class="form-input" type="text" id="txtExpediente"
              placeholder="00000-0000-00" style="font-size:15px;font-weight:600;letter-spacing:.5px">
          </div>

          <div class="form-group full-width">
            <label class="form-label">Interno(s)</label>
            <input class="form-input" type="text" id="txtInternos"
              placeholder="Nombres de los internos">
          </div>

          <div class="form-group full-width">
            <label class="form-label">Enlace Meet</label>
            <div class="link-input-group">
              <input class="form-input" type="text" id="txtLink"
                placeholder="https://meet.google.com/..." style="flex:1">
              <button class="btn-meet" id="btnGenMeet" title="Generar Meet">🎥 Meet</button>
            </div>
          </div>

          <div class="form-group" id="divInterno">
            <label class="form-label">Sede</label>
            <select class="form-select" id="lstSede"></select>
          </div>

          <div class="form-group" id="divInstancia">
            <label class="form-label">Instancia / Juzgado</label>
            <select class="form-select" id="lstInstancia"></select>
          </div>

          <div class="form-group">
            <label class="form-label">Comunicación</label>
            <select class="form-select" id="lstComunicacion">
              <option value="WHATSAPP">WhatsApp</option>
              <option value="PROPIO">Propio</option>
              <option value="EMAIL">Email</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Solicitante</label>
            <input class="form-input" type="text" id="txtSolicitante"
              placeholder="Nombre del solicitante">
          </div>

          <div class="form-group full-width" id="txtFechaRegistroWrap" style="display:none">
            <label class="form-label">Fecha de registro</label>
            <input class="form-input" type="text" id="txtFechaRegistro" readonly>
          </div>
        </div>

        <div class="modal-footer">
          <div class="modal-footer-left">
            <button class="btn-danger" id="btnEliminarEvento" style="display:none">🗑 Eliminar</button>
          </div>
          <div class="modal-footer-right">
            <button class="btn-ghost" id="btnCancelarModal">Cancelar</button>
            <button class="btn-primary" id="btnGuardarEvento">💾 Guardar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

// ── RENDER TABLA ─────────────────────────────────────────────────────────────
function renderTableHeader() {
  const head = document.getElementById('scheduleHead');
  const tr = document.createElement('tr');
  const thTime = document.createElement('th');
  thTime.innerHTML = '<span style="font-size:11px;color:#999">HORA</span>';
  tr.appendChild(thTime);

  state.rooms.forEach(room => {
    const th = document.createElement('th');
    const icon = (room.cantidad === 1) ? '👤' : '🏛️';
    th.innerHTML = `<div class="room-header">
      <div class="room-header-icon">${icon}</div>
      <span class="room-header-name">${room.nombre}</span>
    </div>`;
    tr.appendChild(th);
  });
  head.innerHTML = '';
  head.appendChild(tr);
}

function renderTableBody() {
  const body = document.getElementById('scheduleBody');
  body.innerHTML = '';
  state.events = {};

  TIME_SLOTS.forEach(slot => {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.className = 'time-col' + (slot.endsWith(':00') ? ' hour-mark' : '');
    tdTime.textContent = slot;
    tr.appendChild(tdTime);

    state.rooms.forEach(room => {
      const td = document.createElement('td');
      td.dataset.roomId = room.id;
      td.dataset.time = slot;
      td.addEventListener('dblclick', onCellDblClick);
      td.addEventListener('mouseenter', () => highlightCol(room.id, true));
      td.addEventListener('mouseleave', () => highlightCol(room.id, false));
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  // Pintar audiencias
  state.eventsRaw.forEach((ev, idx) => {
    paintEvent(ev, idx);
  });
}

function paintEvent(ev, idx) {
  const startTime = normalizeTime(ev.inicio);
  const endTime   = normalizeTime(ev.fin);
  const roomId    = ev.idSala;
  const color     = eventColor(idx);

  const rows = Array.from(document.getElementById('scheduleBody').children);
  const startIdx = TIME_SLOTS.indexOf(startTime);
  const endIdx   = TIME_SLOTS.indexOf(endTime) - 1;
  if (startIdx < 0 || endIdx < startIdx) return;

  const roomCellIdx = state.rooms.findIndex(r => r.id === roomId) + 1;
  const startRow = rows[startIdx];
  if (!startRow) return;
  const targetCell = startRow.querySelector(`td:nth-child(${roomCellIdx + 1})`);
  if (!targetCell) return;

  const numRows = endIdx - startIdx + 1;
  const rowH = startRow.offsetHeight || 48;
  const totalH = numRows * rowH - 8;

  const block = document.createElement('div');
  block.className = 'event-block';
  block.dataset.eventId = ev.id;
  block.style.cssText = `background:${color.bg};color:${color.text};height:${totalH}px;border-left:3px solid ${color.border}`;
  block.innerHTML = `<div class="event-block-inner">
    <span class="event-time">${ev.inicio} – ${ev.fin}</span>
    <span class="event-exp">EXP. ${ev.descripcion || ev.expediente || '—'}</span>
  </div>`;
  block.addEventListener('dblclick', e => { e.stopPropagation(); openEventModal(ev.id); });
  targetCell.innerHTML = '';
  targetCell.appendChild(block);

  // Marcar celdas ocupadas
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const row = rows[i];
    if (!row) continue;
    const cell = row.querySelector(`td:nth-child(${roomCellIdx + 1})`);
    if (cell) {
      cell.classList.add('event-occupied');
      cell.removeEventListener('dblclick', onCellDblClick);
    }
  }

  const key = `${startTime}-${endTime}-${roomId}`;
  state.events[key] = { ...ev, color };
}

function highlightCol(roomId, on) {
  const idx = state.rooms.findIndex(r => r.id === roomId) + 2; // nth-child is 1-based + time col
  document.querySelectorAll(`#scheduleBody td:nth-child(${idx})`).forEach(
    td => td.classList.toggle('col-highlight', on)
  );
}

// ── MINI CALENDARIO ──────────────────────────────────────────────────────────
function renderMiniCal() {
  const { calYear, calMonth } = state;
  const cal = document.getElementById('miniCal');
  const names = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const first = new Date(calYear, calMonth, 1).getDay();
  const days  = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date(); const todayD = today.getDate();
  const sel   = new Date(state.fecha);

  let html = `<div class="mini-cal">
    <div class="cal-header">
      <button class="cal-nav-btn" id="calPrev">‹</button>
      <span class="cal-title">${monthNames[calMonth]} ${calYear}</span>
      <button class="cal-nav-btn" id="calNext">›</button>
    </div>
    <div class="cal-grid">
      ${names.map(n=>`<div class="cal-day-name">${n}</div>`).join('')}
      ${Array(first).fill('<div class="cal-day cal-day--empty"></div>').join('')}
  `;

  for (let d = 1; d <= days; d++) {
    const isToday = d===todayD && calMonth===today.getMonth() && calYear===today.getFullYear();
    const isSel   = d===sel.getDate()+1 && calMonth===sel.getMonth() && calYear===sel.getFullYear();
    // Fix timezone offset
    const dateStr = `${calYear}-${fmt2(calMonth+1)}-${fmt2(d)}`;
    const isSel2  = dateStr === state.fecha;
    let cls = 'cal-day';
    if (isToday) cls += ' cal-day--today';
    if (isSel2)  cls += ' cal-day--selected';
    html += `<button class="${cls}" data-date="${dateStr}">${d}</button>`;
  }

  html += `</div><button class="cal-today-btn" id="calToday">Hoy</button></div>`;
  cal.innerHTML = html;

  cal.querySelectorAll('.cal-day[data-date]').forEach(btn =>
    btn.addEventListener('click', () => navigateToDate(btn.dataset.date))
  );
  document.getElementById('calPrev').addEventListener('click', () => {
    state.calMonth--; if(state.calMonth<0){state.calMonth=11;state.calYear--;}
    renderMiniCal();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    state.calMonth++; if(state.calMonth>11){state.calMonth=0;state.calYear++;}
    renderMiniCal();
  });
  document.getElementById('calToday').addEventListener('click', () => navigateToDate(todayStr()));
}

function renderDaySummary() {
  const total = state.eventsRaw.length;
  const salas = new Set(state.eventsRaw.map(e=>e.idSala)).size;
  const doc = document.getElementById('daySummary');
  doc.innerHTML = `<h3>Hoy</h3>
    <div class="summary-stat">
      <span class="summary-stat-label">Audiencias</span>
      <span class="summary-stat-value">${total}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">Salas en uso</span>
      <span class="summary-stat-value">${salas}</span>
    </div>`;
}

// ── MODAL ────────────────────────────────────────────────────────────────────
function openModal(mode='new') {
  document.getElementById('modalOverlay').classList.add('open');
  const badge = document.getElementById('modalBadge');
  const title = document.getElementById('modalTitle');
  if (mode==='new')    { badge.textContent='NUEVO';    title.textContent='Nueva audiencia'; }
  if (mode==='edit')   { badge.textContent='MODIFICAR';title.textContent='Editar audiencia'; }
  if (mode==='view')   { badge.textContent='DETALLE';  title.textContent='Detalle audiencia'; }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function prepareNewModal(roomId, startTime) {
  document.getElementById('txtIdAudiencia').value = '';
  document.getElementById('lstSala').value = roomId;
  document.getElementById('txtFecha').value = state.fecha;

  const [h, m] = startTime.split(':');
  document.getElementById('selectHorasInicio').value = h;
  document.getElementById('selectMinutosInicio').value = m;
  calcAutoEnd();

  ['txtExpediente','txtInternos','txtLink','txtSolicitante'].forEach(id =>
    document.getElementById(id).value = ''
  );
  document.getElementById('lstComunicacion').value = 'WHATSAPP';
  document.getElementById('btnEliminarEvento').style.display = 'none';
  document.getElementById('txtFechaRegistroWrap').style.display = 'none';

  setFormReadonly(false);
  openModal('new');
}

async function openEventModal(id) {
  try {
    const data = await getEventDetail(id);
    document.getElementById('txtIdAudiencia').value = data.id;
    document.getElementById('lstSala').value = data.idSala;
    document.getElementById('txtFecha').value = data.fecha || state.fecha;

    const [hI, mI] = normalizeTime(data.inicio).split(':');
    const [hF, mF] = normalizeTime(data.fin).split(':');
    document.getElementById('selectHorasInicio').value = hI;
    document.getElementById('selectMinutosInicio').value = mI;
    document.getElementById('selectHorasFin').value = hF;
    document.getElementById('selectMinutosFin').value = mF;

    document.getElementById('txtExpediente').value = data.expediente || '';
    document.getElementById('txtInternos').value = data.internos || '';
    document.getElementById('txtLink').value = data.link || '';
    document.getElementById('txtSolicitante').value = data.solicitante || '';
    document.getElementById('lstComunicacion').value = data.comunicacion || 'WHATSAPP';

    if (data.idSede) {
      document.getElementById('lstSede').value = data.idSede;
      await loadInstancias(data.idSede);
      document.getElementById('lstInstancia').value = data.idInstancia;
    }

    if (data.fechaHoraRegistro) {
      document.getElementById('txtFechaRegistro').value = data.fechaHoraRegistro;
      document.getElementById('txtFechaRegistroWrap').style.display = '';
    }

    const canEdit = data.accion !== false;
    setFormReadonly(!canEdit);
    document.getElementById('btnEliminarEvento').style.display = canEdit ? '' : 'none';
    document.getElementById('btnGuardarEvento').style.display = canEdit ? '' : 'none';

    openModal(canEdit ? 'edit' : 'view');
  } catch (err) {
    toast('Error cargando audiencia: ' + err.message, 'error');
  }
}

function setFormReadonly(ro) {
  document.querySelectorAll('#divAgenda input, #divAgenda select').forEach(el => {
    if (el.id === 'txtIdAudiencia') return;
    if (el.tagName === 'SELECT') el.disabled = ro;
    else el.readOnly = ro;
  });
}

// ── GUARDAR / ELIMINAR ────────────────────────────────────────────────────────
async function onGuardar() {
  const id = document.getElementById('txtIdAudiencia').value;
  const exp = document.getElementById('txtExpediente').value.trim();
  const sol = document.getElementById('txtSolicitante').value.trim();
  const internos = document.getElementById('txtInternos').value.trim();

  if (!exp || !sol || !internos) {
    toast('Expediente, solicitante e interno(s) son obligatorios.', 'warning');
    return;
  }

  const payload = {
    id,
    idSala: document.getElementById('lstSala').value,
    idSede: document.getElementById('lstSede').value,
    idInstancia: document.getElementById('lstInstancia').value,
    externo: false,
    expediente: exp,
    internos,
    comunicacion: document.getElementById('lstComunicacion').value,
    solicitante: sol,
    link: document.getElementById('txtLink').value.trim(),
    fecha: document.getElementById('txtFecha').value,
    inicio: document.getElementById('selectHorasInicio').value + ':' +
            document.getElementById('selectMinutosInicio').value,
    fin:    document.getElementById('selectHorasFin').value + ':' +
            document.getElementById('selectMinutosFin').value,
  };

  try {
    await saveEvent(payload);
    toast(id ? 'Audiencia actualizada ✓' : 'Audiencia registrada ✓', 'success');
    closeModal();
    await refreshSchedule();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onEliminar() {
  const id = document.getElementById('txtIdAudiencia').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta audiencia?')) return;
  try {
    await deleteEvent(id);
    toast('Audiencia eliminada', 'success');
    closeModal();
    await refreshSchedule();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── NAVEGACIÓN ────────────────────────────────────────────────────────────────
async function navigateToDate(fecha) {
  showLoading(true);
  try {
    const data = await loadEvents(fecha, '0');
    state.fecha      = data.fechaSeleccionada || fecha;
    state.calYear    = new Date(state.fecha).getFullYear();
    state.calMonth   = new Date(state.fecha).getMonth();
    // Fix: Date constructor asume UTC, sumar un día
    const [y,mo,d] = state.fecha.split('-').map(Number);
    state.calYear = y; state.calMonth = mo - 1;

    updatePanelHeader(data.fechaTexto);
    renderTableBody();
    renderMiniCal();
    renderDaySummary();
  } catch(err) {
    toast('Error cargando agenda: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function navigate(delta) {
  showLoading(true);
  try {
    const fecha = document.getElementById('txtFecha')?.value || state.fecha;
    const data = await loadEvents(fecha, String(delta));
    state.fecha = data.fechaSeleccionada;
    const [y,mo] = state.fecha.split('-').map(Number);
    state.calYear = y; state.calMonth = mo - 1;
    updatePanelHeader(data.fechaTexto);
    renderTableBody();
    renderMiniCal();
    renderDaySummary();
  } finally {
    showLoading(false);
  }
}

async function refreshSchedule() {
  showLoading(true);
  try {
    await loadEvents(state.fecha, '0');
    renderTableBody();
    renderDaySummary();
  } finally {
    showLoading(false);
  }
}

function updatePanelHeader(fechaTexto) {
  document.getElementById('panelDateTitle').textContent = fechaTexto || state.fecha;
  document.getElementById('panelDateSub').textContent =
    `${state.eventsRaw.length} audiencia${state.eventsRaw.length !== 1 ? 's' : ''} programada${state.eventsRaw.length !== 1 ? 's' : ''}`;
}

function showLoading(on) {
  const ov = document.getElementById('loadingOverlay');
  if (ov) ov.style.display = on ? 'flex' : 'none';
}

// ── COMBOS HORA ───────────────────────────────────────────────────────────────
function initTimeCombos() {
  const horasI = document.getElementById('selectHorasInicio');
  const horasF = document.getElementById('selectHorasFin');
  const minsI  = document.getElementById('selectMinutosInicio');
  const minsF  = document.getElementById('selectMinutosFin');

  [horasI, horasF].forEach(sel => {
    sel.innerHTML = '';
    for (let h = 8; h <= 17; h++) {
      const opt = new Option(fmt2(h), fmt2(h));
      sel.appendChild(opt);
    }
  });

  ['00','15','30','45'].forEach(m => {
    minsI.appendChild(new Option(m, m));
    minsF.appendChild(new Option(m, m));
  });

  horasI.addEventListener('change', calcAutoEnd);
  minsI.addEventListener('change', calcAutoEnd);
}

function calcAutoEnd() {
  const h = parseInt(document.getElementById('selectHorasInicio').value) || 8;
  const m = parseInt(document.getElementById('selectMinutosInicio').value) || 0;
  let total = h * 60 + m + 30;
  if (total > 17*60+45) total = 17*60+45;
  document.getElementById('selectHorasFin').value   = fmt2(Math.floor(total/60));
  document.getElementById('selectMinutosFin').value = fmt2(total % 60);
}

// ── COMBOS SEDE / INSTANCIA ───────────────────────────────────────────────────
function renderSedesSelect() {
  const sel = document.getElementById('lstSede');
  sel.innerHTML = '';
  state.sedes.forEach(s => sel.appendChild(new Option(s.denominacion, s.id)));
  sel.addEventListener('change', () => loadInstancias(sel.value));
  if (state.sedes.length) loadInstancias(state.sedes[0].id);
}

function renderInstanciasSelect() {
  const sel = document.getElementById('lstInstancia');
  sel.innerHTML = '';
  state.instancias.forEach(i => sel.appendChild(new Option(i.denominacion || i.nombre || i.id, i.id)));
}

function renderSalasSelect() {
  const sel = document.getElementById('lstSala');
  sel.innerHTML = '';
  state.rooms.forEach(r => sel.appendChild(new Option(r.nombre, r.id)));
}

// ── WEBSOCKET STOMP ───────────────────────────────────────────────────────────
function connectWebSocket() {
  if (!window.SockJS || !window.Stomp) return;
  const socket = new SockJS(`${API}/ws-agenda`);
  const client = Stomp.over(socket);
  client.debug = () => {};
  client.connect({}, () => {
    client.subscribe('/topic/eventoNuevo', () => refreshSchedule());
    client.subscribe('/topic/eventoModificado', () => refreshSchedule());
    client.subscribe('/topic/eventoEliminado', () => refreshSchedule());
    state.stompClient = client;
  }, () => setTimeout(connectWebSocket, 5000));
}

// ── CELL CLICK ────────────────────────────────────────────────────────────────
function onCellDblClick(e) {
  const cell = e.currentTarget;
  const roomId = parseInt(cell.dataset.roomId);
  const startTime = cell.dataset.time;
  prepareNewModal(roomId, startTime);
}

// ── BIND EVENTS ───────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btnPrev').addEventListener('click', () => navigate(-1));
  document.getElementById('btnNext').addEventListener('click', () => navigate(1));
  document.getElementById('btnHoy').addEventListener('click', () => navigateToDate(todayStr()));
  document.getElementById('btnNueva').addEventListener('click', () => {
    const sala = state.rooms[0]?.id || 1;
    prepareNewModal(sala, '09:00');
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnCancelarModal').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
  document.getElementById('btnGuardarEvento').addEventListener('click', onGuardar);
  document.getElementById('btnEliminarEvento').addEventListener('click', onEliminar);
  document.getElementById('btnGenMeet').addEventListener('click', () => {
    toast('Integración Google Meet — configura las credenciales en el bot.', 'warning');
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  renderApp();
  showLoading(true);

  try {
    await Promise.all([loadRooms(), loadSedes()]);
    await loadEvents('', '0');

    renderTableHeader();
    renderTableBody();
    renderMiniCal();
    renderDaySummary();
    initTimeCombos();
    renderSalasSelect();
    renderSedesSelect();
    updatePanelHeader(state.fechaTexto);
    connectWebSocket();
  } catch (err) {
    document.getElementById('scheduleWrapper').innerHTML =
      `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p>No se pudo conectar con el backend PLATS.</p>
        <p style="font-size:12px;color:#999">${err.message}</p>
      </div>`;
  } finally {
    showLoading(false);
  }
}

init();
