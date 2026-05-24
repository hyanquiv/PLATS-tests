import './style.css';

const API = '/plats';

const state = {
  fecha: todayStr(), rooms: [], sedes: [], instancias: [],
  eventsRaw: [], fechaTexto: '',
  calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmt2(n) { return String(n).padStart(2,'0'); }
function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'✅', error:'❌', warning:'⚠️' };
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').prepend(el);
  setTimeout(() => el.remove(), 4000);
}
const TIME_SLOTS = (() => {
  const s = [];
  for (let h=8;h<=17;h++) for (let m=0;m<60;m+=15) s.push(`${fmt2(h)}:${fmt2(m)}`);
  return s;
})();
const EVENT_COLORS = [
  {bg:'#0073E6',text:'#fff'},{bg:'#0A7A6A',text:'#fff'},
  {bg:'#6B35B8',text:'#fff'},{bg:'#C47A00',text:'#fff'},
  {bg:'#A80000',text:'#fff'},
];
function normalizeTime(t) { const [h,m]=t.split(':').map(Number); return `${fmt2(h)}:${fmt2(m)}`; }

// ── VALIDACIÓN inline ────────────────────────────────────────
const PATTERNS = {
  expediente: /^\d{4,6}-\d{4}-\d{2,4}$/,
  internos:   /^[A-Za-záéíóúÁÉÍÓÚüÜñÑ][A-Za-záéíóúÁÉÍÓÚüÜñÑ\s\-,.]{4,120}$/,
  solicitante:/^(Dr\.|Dra\.)?\s?[A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s\.]{4,80}$/,
};

function validarCampo(id, patron) {
  const el = document.getElementById(id);
  if (!el) return true;
  const val = el.value.trim();
  const hint = document.getElementById(id + '-hint');
  if (!val) { el.className = el.className.replace(/ valid| invalid/g,''); if(hint) hint.textContent=''; return false; }
  const ok = patron.test(val);
  el.classList.remove('valid','invalid');
  el.classList.add(ok ? 'valid' : 'invalid');
  if (hint) hint.className = `form-hint ${ok?'':'error'}`;
  if (hint) hint.textContent = ok ? '' : 'Formato inválido';
  return ok;
}

// ── API ──────────────────────────────────────────────────────
async function apiFetch(url, opts={}) {
  const res = await fetch(API+url, { credentials:'include',
    headers:{'Content-Type':'application/json',...opts.headers}, ...opts });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  const ct = res.headers.get('content-type')||'';
  return ct.includes('json') ? res.json() : res.text();
}
async function loadRooms()  { state.rooms  = await apiFetch('/agenda/salas'); }
async function loadSedes()  { state.sedes  = await apiFetch('/sede'); }
async function loadInstancias(id) {
  state.instancias = await apiFetch(`/instancia/${id}`);
  renderInstanciasSelect();
}
async function loadEvents(fecha='', mov='0') {
  const data = await apiFetch(`/agenda/seleccion?fecha=${fecha}&movimiento=${mov}`);
  state.eventsRaw  = data.audiencias||[];
  state.fechaTexto = data.fechaTexto||'';
  state.fecha      = data.fechaSeleccionada||state.fecha;
  return data;
}
async function saveEvent(payload) {
  return apiFetch('/agenda/evento', { method:payload.id?'PUT':'POST', body:JSON.stringify(payload) });
}
async function deleteEvent(id) { return apiFetch(`/agenda/evento/${id}`,{method:'DELETE'}); }
async function getEventDetail(id) { return apiFetch(`/agenda/${id}`); }

// ── RENDER ───────────────────────────────────────────────────
function renderApp() {
  document.getElementById('app').innerHTML = `
    <div id="toast-container"></div>
    <header class="topbar">
      <img class="topbar-logo" src="/pj.svg" alt="PJ">
      <div class="topbar-brand">
        <h1>CORTE SUPERIOR DE JUSTICIA DE AREQUIPA</h1>
        <p>PLATS v3.0 — Agendamiento y Publicación de Audiencias</p>
      </div>
      <div class="topbar-actions">
        <div class="user-chip"><div class="user-avatar">👤</div><span>Sistema</span></div>
      </div>
    </header>
    <nav class="navbar">
      <button class="nav-link active">📅 Agendamiento</button>
    </nav>
    <div class="app-layout">
      <aside class="sidebar">
        <div id="miniCal"></div>
        <div class="day-summary" id="daySummary"></div>
      </aside>
      <main class="main-panel">
        <div class="panel-header">
          <div class="panel-header-date">
            <h2 id="panelDateTitle">—</h2>
            <p id="panelDateSub">—</p>
          </div>
          <div class="date-nav">
            <button class="date-nav-btn" id="btnPrev">‹</button>
            <button class="btn-secondary" id="btnHoy" style="font-size:12px;padding:6px 12px">Hoy</button>
            <button class="date-nav-btn" id="btnNext">›</button>
          </div>
          <button class="btn-primary" id="btnNueva">+ Nueva audiencia</button>
        </div>
        <div class="schedule-wrapper" id="scheduleWrapper">
          <div class="loading-overlay" id="loadingOverlay"><div class="spinner"></div></div>
          <table class="schedule-table">
            <thead id="scheduleHead"></thead>
            <tbody id="scheduleBody"></tbody>
          </table>
        </div>
      </main>
    </div>
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-badge" id="modalBadge">NUEVO</span>
          <span class="modal-title" id="modalTitle">Nueva audiencia</span>
          <button class="modal-close" id="modalClose">✕</button>
        </div>
        <div class="modal-body" id="divAgenda">
          <input type="hidden" id="txtIdAudiencia">
          <div class="form-group"><label class="form-label">Sala</label>
            <select class="form-select" id="lstSala"></select></div>
          <div class="form-group"><label class="form-label">Fecha</label>
            <input class="form-input" type="date" id="txtFecha"></div>
          <div class="form-group full-width"><label class="form-label">Horario</label>
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
          <div class="form-group full-width"><label class="form-label">N° Expediente</label>
            <input class="form-input" type="text" id="txtExpediente"
              placeholder="00000-AAAA-00" oninput="validarCampo('txtExpediente', PATTERNS.expediente)"
              style="font-size:15px;font-weight:600;letter-spacing:.5px">
            <span class="form-hint" id="txtExpediente-hint"></span></div>
          <div class="form-group full-width"><label class="form-label">Interno(s)</label>
            <input class="form-input" type="text" id="txtInternos"
              placeholder="Carlos Mamani Quispe"
              oninput="validarCampo('txtInternos', PATTERNS.internos)">
            <span class="form-hint" id="txtInternos-hint"></span></div>
          <div class="form-group full-width"><label class="form-label">Solicitante</label>
            <input class="form-input" type="text" id="txtSolicitante"
              placeholder="Dr. Juan Pérez Vargas"
              oninput="validarCampo('txtSolicitante', PATTERNS.solicitante)">
            <span class="form-hint" id="txtSolicitante-hint"></span></div>
          <div class="form-group full-width"><label class="form-label">Enlace Meet</label>
            <div class="link-input-group">
              <input class="form-input" type="text" id="txtLink"
                placeholder="https://meet.google.com/..." style="flex:1">
              <button class="btn-meet" id="btnGenMeet">🎥 Meet</button>
            </div></div>
          <div class="form-group"><label class="form-label">Sede</label>
            <select class="form-select" id="lstSede"></select></div>
          <div class="form-group"><label class="form-label">Juzgado</label>
            <select class="form-select" id="lstInstancia"></select></div>
          <div class="form-group"><label class="form-label">Comunicación</label>
            <select class="form-select" id="lstComunicacion">
              <option value="WHATSAPP">WhatsApp</option>
              <option value="PROPIO">Propio</option>
              <option value="EMAIL">Email</option>
            </select></div>
          <div class="form-group" id="txtFechaRegistroWrap" style="display:none">
            <label class="form-label">Fecha de registro</label>
            <input class="form-input" type="text" id="txtFechaRegistro" readonly></div>
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
    </div>`;

  // exponer globalmente para los oninput inline
  window.PATTERNS = PATTERNS;
  window.validarCampo = validarCampo;
  bindEvents();
}

function renderTableHeader() {
  const tr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.innerHTML = '<span style="font-size:11px;color:#999">HORA</span>';
  tr.appendChild(th0);
  state.rooms.forEach(r => {
    const th = document.createElement('th');
    const icon = r.cantidad === 1 ? '👤' : '🏛️';
    th.innerHTML = `<div class="room-header">
      <div class="room-header-icon">${icon}</div>
      <span class="room-header-name">${r.nombre}</span></div>`;
    tr.appendChild(th);
  });
  const head = document.getElementById('scheduleHead');
  head.innerHTML = ''; head.appendChild(tr);
}

function renderTableBody() {
  const body = document.getElementById('scheduleBody');
  body.innerHTML = '';
  TIME_SLOTS.forEach(slot => {
    const tr = document.createElement('tr');
    const tdT = document.createElement('td');
    tdT.className = 'time-col' + (slot.endsWith(':00') ? ' hour-mark' : '');
    tdT.textContent = slot; tr.appendChild(tdT);
    state.rooms.forEach(r => {
      const td = document.createElement('td');
      td.dataset.roomId = r.id; td.dataset.time = slot;
      td.addEventListener('dblclick', onCellDblClick);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  state.eventsRaw.forEach((ev,i) => paintEvent(ev,i));
}

function paintEvent(ev, idx) {
  const startTime = normalizeTime(ev.inicio);
  const endTime   = normalizeTime(ev.fin);
  const rows  = Array.from(document.getElementById('scheduleBody').children);
  const si    = TIME_SLOTS.indexOf(startTime);
  const ei    = TIME_SLOTS.indexOf(endTime) - 1;
  if (si < 0 || ei < si) return;
  const ri = state.rooms.findIndex(r => r.id === ev.idSala) + 1;
  const startRow = rows[si]; if (!startRow) return;
  const td = startRow.querySelector(`td:nth-child(${ri+1})`); if (!td) return;
  const rowH = startRow.offsetHeight || 48;
  const totalH = (ei-si+1)*rowH - 8;
  const color = EVENT_COLORS[idx % EVENT_COLORS.length];
  const block = document.createElement('div');
  block.className = 'event-block'; block.dataset.eventId = ev.id;
  block.style.cssText = `background:${color.bg};color:${color.text};height:${totalH}px;border-left:3px solid rgba(0,0,0,.2)`;
  block.innerHTML = `<div class="event-block-inner">
    <span class="event-time">${ev.inicio} – ${ev.fin}</span>
    <span class="event-exp">EXP. ${ev.descripcion||ev.expediente||'—'}</span>
  </div>`;
  block.addEventListener('dblclick', e => { e.stopPropagation(); openEventModal(ev.id); });
  td.innerHTML = ''; td.appendChild(block);
  for (let i=si+1;i<=ei;i++) {
    const row=rows[i]; if(!row) continue;
    const c=row.querySelector(`td:nth-child(${ri+1})`);
    if(c) { c.style.pointerEvents='none'; }
  }
}

function renderMiniCal() {
  const { calYear, calMonth } = state;
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const names = ['D','L','M','X','J','V','S'];
  const first = new Date(calYear,calMonth,1).getDay();
  const days  = new Date(calYear,calMonth+1,0).getDate();
  const today = new Date();
  let html = `<div class="mini-cal">
    <div class="cal-header">
      <button class="cal-nav-btn" id="calPrev">‹</button>
      <span class="cal-title">${monthNames[calMonth]} ${calYear}</span>
      <button class="cal-nav-btn" id="calNext">›</button>
    </div>
    <div class="cal-grid">
      ${names.map(n=>`<div class="cal-day-name">${n}</div>`).join('')}
      ${Array(first).fill('<div class="cal-day cal-day--empty"></div>').join('')}`;
  for (let d=1;d<=days;d++) {
    const ds=`${calYear}-${fmt2(calMonth+1)}-${fmt2(d)}`;
    const isToday=d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
    const isSel=ds===state.fecha;
    let cls='cal-day';
    if(isToday) cls+=' cal-day--today';
    if(isSel)   cls+=' cal-day--selected';
    html+=`<button class="${cls}" data-date="${ds}">${d}</button>`;
  }
  html+=`</div><button class="cal-today-btn" id="calToday">Hoy</button></div>`;
  const el=document.getElementById('miniCal');
  el.innerHTML=html;
  el.querySelectorAll('.cal-day[data-date]').forEach(b=>b.addEventListener('click',()=>navigateToDate(b.dataset.date)));
  document.getElementById('calPrev').addEventListener('click',()=>{state.calMonth--;if(state.calMonth<0){state.calMonth=11;state.calYear--;}renderMiniCal();});
  document.getElementById('calNext').addEventListener('click',()=>{state.calMonth++;if(state.calMonth>11){state.calMonth=0;state.calYear++;}renderMiniCal();});
  document.getElementById('calToday').addEventListener('click',()=>navigateToDate(todayStr()));
}

function renderDaySummary() {
  const total=state.eventsRaw.length;
  const salas=new Set(state.eventsRaw.map(e=>e.idSala)).size;
  document.getElementById('daySummary').innerHTML=`<h3>Hoy</h3>
    <div class="summary-stat"><span>Audiencias</span><span class="summary-stat-value">${total}</span></div>
    <div class="summary-stat"><span>Salas en uso</span><span class="summary-stat-value">${salas}</span></div>`;
}

function openModal(mode='new') {
  document.getElementById('modalOverlay').classList.add('open');
  const badge=document.getElementById('modalBadge');
  const title=document.getElementById('modalTitle');
  if(mode==='new')  {badge.textContent='NUEVO';    title.textContent='Nueva audiencia';}
  if(mode==='edit') {badge.textContent='MODIFICAR';title.textContent='Editar audiencia';}
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }

function prepareNewModal(roomId, startTime) {
  document.getElementById('txtIdAudiencia').value='';
  document.getElementById('lstSala').value=roomId;
  document.getElementById('txtFecha').value=state.fecha;
  const [h,m]=startTime.split(':');
  document.getElementById('selectHorasInicio').value=h;
  document.getElementById('selectMinutosInicio').value=m;
  calcAutoEnd();
  ['txtExpediente','txtInternos','txtSolicitante','txtLink'].forEach(id=>{
    const el=document.getElementById(id); if(el) { el.value=''; el.classList.remove('valid','invalid'); }
  });
  const hints=document.querySelectorAll('.form-hint'); hints.forEach(h=>{h.textContent='';h.className='form-hint';});
  document.getElementById('lstComunicacion').value='WHATSAPP';
  document.getElementById('btnEliminarEvento').style.display='none';
  document.getElementById('txtFechaRegistroWrap').style.display='none';
  openModal('new');
}

async function openEventModal(id) {
  try {
    const data=await getEventDetail(id);
    document.getElementById('txtIdAudiencia').value=data.id;
    document.getElementById('lstSala').value=data.idSala;
    document.getElementById('txtFecha').value=data.fecha||state.fecha;
    const [hI,mI]=normalizeTime(data.inicio).split(':');
    const [hF,mF]=normalizeTime(data.fin).split(':');
    document.getElementById('selectHorasInicio').value=hI;
    document.getElementById('selectMinutosInicio').value=mI;
    document.getElementById('selectHorasFin').value=hF;
    document.getElementById('selectMinutosFin').value=mF;
    document.getElementById('txtExpediente').value=data.expediente||'';
    document.getElementById('txtInternos').value=data.internos||'';
    document.getElementById('txtSolicitante').value=data.solicitante||'';
    document.getElementById('txtLink').value=data.link||'';
    document.getElementById('lstComunicacion').value=data.comunicacion||'WHATSAPP';
    if(data.idSede){document.getElementById('lstSede').value=data.idSede;await loadInstancias(data.idSede);document.getElementById('lstInstancia').value=data.idInstancia;}
    if(data.fechaHoraRegistro){document.getElementById('txtFechaRegistro').value=data.fechaHoraRegistro;document.getElementById('txtFechaRegistroWrap').style.display='';}
    document.getElementById('btnEliminarEvento').style.display=data.accion!==false?'':'none';
    openModal('edit');
  } catch(err) { toast('Error cargando audiencia: '+err.message,'error'); }
}

async function onGuardar() {
  const exp=document.getElementById('txtExpediente').value.trim();
  const int=document.getElementById('txtInternos').value.trim();
  const sol=document.getElementById('txtSolicitante').value.trim();
  let valid=true;
  if(!PATTERNS.expediente.test(exp)){validarCampo('txtExpediente',PATTERNS.expediente);valid=false;}
  if(!PATTERNS.internos.test(int)){validarCampo('txtInternos',PATTERNS.internos);valid=false;}
  if(!PATTERNS.solicitante.test(sol)){validarCampo('txtSolicitante',PATTERNS.solicitante);valid=false;}
  if(!valid){toast('Revisa los campos marcados en rojo','warning');return;}
  const payload={
    id: document.getElementById('txtIdAudiencia').value,
    idSala: document.getElementById('lstSala').value,
    idSede: document.getElementById('lstSede').value,
    idInstancia: document.getElementById('lstInstancia').value,
    externo:false, expediente:exp, internos:int, solicitante:sol,
    comunicacion: document.getElementById('lstComunicacion').value,
    link: document.getElementById('txtLink').value.trim(),
    fecha: document.getElementById('txtFecha').value,
    inicio: document.getElementById('selectHorasInicio').value+':'+document.getElementById('selectMinutosInicio').value,
    fin:    document.getElementById('selectHorasFin').value+':'+document.getElementById('selectMinutosFin').value,
  };
  try {
    await saveEvent(payload);
    toast(payload.id?'Audiencia actualizada ✓':'Audiencia registrada ✓','success');
    closeModal(); await refreshSchedule();
  } catch(err) { toast(err.message,'error'); }
}

async function onEliminar() {
  const id=document.getElementById('txtIdAudiencia').value;
  if(!id||!confirm('¿Eliminar esta audiencia?')) return;
  try { await deleteEvent(id); toast('Audiencia eliminada','success'); closeModal(); await refreshSchedule(); }
  catch(err) { toast(err.message,'error'); }
}

async function navigateToDate(fecha) {
  showLoading(true);
  try {
    const data=await loadEvents(fecha,'0');
    state.fecha=data.fechaSeleccionada||fecha;
    const [y,mo]=state.fecha.split('-').map(Number);
    state.calYear=y; state.calMonth=mo-1;
    updatePanelHeader(data.fechaTexto);
    renderTableBody(); renderMiniCal(); renderDaySummary();
  } catch(err){toast('Error: '+err.message,'error');}
  finally{showLoading(false);}
}

async function navigate(delta) {
  showLoading(true);
  try {
    const data=await loadEvents(state.fecha,String(delta));
    state.fecha=data.fechaSeleccionada;
    const [y,mo]=state.fecha.split('-').map(Number);
    state.calYear=y; state.calMonth=mo-1;
    updatePanelHeader(data.fechaTexto);
    renderTableBody(); renderMiniCal(); renderDaySummary();
  } finally{showLoading(false);}
}

async function refreshSchedule() {
  showLoading(true);
  try { await loadEvents(state.fecha,'0'); renderTableBody(); renderDaySummary(); }
  finally{showLoading(false);}
}

function updatePanelHeader(ft) {
  document.getElementById('panelDateTitle').textContent=ft||state.fecha;
  document.getElementById('panelDateSub').textContent=
    `${state.eventsRaw.length} audiencia${state.eventsRaw.length!==1?'s':''} programada${state.eventsRaw.length!==1?'s':''}`;
}
function showLoading(on) { const ov=document.getElementById('loadingOverlay'); if(ov) ov.style.display=on?'flex':'none'; }

function initTimeCombos() {
  const hI=document.getElementById('selectHorasInicio');
  const hF=document.getElementById('selectHorasFin');
  const mI=document.getElementById('selectMinutosInicio');
  const mF=document.getElementById('selectMinutosFin');
  [hI,hF].forEach(s=>{s.innerHTML='';for(let h=8;h<=17;h++)s.appendChild(new Option(fmt2(h),fmt2(h)));});
  ['00','15','30','45'].forEach(m=>{mI.appendChild(new Option(m,m));mF.appendChild(new Option(m,m));});
  hI.addEventListener('change',calcAutoEnd); mI.addEventListener('change',calcAutoEnd);
}
function calcAutoEnd() {
  const h=parseInt(document.getElementById('selectHorasInicio').value)||8;
  const m=parseInt(document.getElementById('selectMinutosInicio').value)||0;
  let t=h*60+m+30; if(t>17*60+45) t=17*60+45;
  document.getElementById('selectHorasFin').value=fmt2(Math.floor(t/60));
  document.getElementById('selectMinutosFin').value=fmt2(t%60);
}
function renderSedesSelect() {
  const sel=document.getElementById('lstSede'); sel.innerHTML='';
  state.sedes.forEach(s=>sel.appendChild(new Option(s.denominacion,s.id)));
  sel.addEventListener('change',()=>loadInstancias(sel.value));
  if(state.sedes.length) loadInstancias(state.sedes[0].id);
}
function renderInstanciasSelect() {
  const sel=document.getElementById('lstInstancia'); sel.innerHTML='';
  state.instancias.forEach(i=>sel.appendChild(new Option(i.denominacion||i.id,i.id)));
}
function renderSalasSelect() {
  const sel=document.getElementById('lstSala'); sel.innerHTML='';
  state.rooms.forEach(r=>sel.appendChild(new Option(r.nombre,r.id)));
}
function onCellDblClick(e) {
  const td=e.currentTarget;
  prepareNewModal(parseInt(td.dataset.roomId),td.dataset.time);
}
function bindEvents() {
  document.getElementById('btnPrev').addEventListener('click',()=>navigate(-1));
  document.getElementById('btnNext').addEventListener('click',()=>navigate(1));
  document.getElementById('btnHoy').addEventListener('click',()=>navigateToDate(todayStr()));
  document.getElementById('btnNueva').addEventListener('click',()=>prepareNewModal(state.rooms[0]?.id||1,'09:00'));
  document.getElementById('modalClose').addEventListener('click',closeModal);
  document.getElementById('btnCancelarModal').addEventListener('click',closeModal);
  document.getElementById('modalOverlay').addEventListener('click',e=>{if(e.target===document.getElementById('modalOverlay'))closeModal();});
  document.getElementById('btnGuardarEvento').addEventListener('click',onGuardar);
  document.getElementById('btnEliminarEvento').addEventListener('click',onEliminar);
  document.getElementById('btnGenMeet').addEventListener('click',()=>toast('Configura Google credentials en .env','warning'));
}

async function init() {
  renderApp(); showLoading(true);
  try {
    await Promise.all([loadRooms(),loadSedes()]);
    await loadEvents('','0');
    renderTableHeader(); renderTableBody();
    renderMiniCal(); renderDaySummary();
    initTimeCombos(); renderSalasSelect(); renderSedesSelect();
    updatePanelHeader(state.fechaTexto);
  } catch(err) {
    document.getElementById('scheduleWrapper').innerHTML=
      `<div class="empty-state"><div style="font-size:32px">⚠️</div>
       <p>No se pudo conectar con el backend PLATS.</p>
       <p style="font-size:12px;color:#999">${err.message}</p></div>`;
  } finally { showLoading(false); }
}
init();
