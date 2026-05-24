/**
 * router.js
 * Recibe eventos del webhook de OpenWA y despacha al handler correcto.
 *
 * OpenWA envía dos tipos de eventos:
 *  - message.text    → el usuario escribió texto libre
 *  - message.button  → el usuario tocó un botón  (body = id del botón)
 *  - message.list    → el usuario eligió de una lista (selectedRowId)
 */
const agendarH  = require('./handlers/agendar');
const consultarH = require('./handlers/consultar');
const wa         = require('./openwa-client');
const { getSession, procesarPaso, clearSession } = require('./utils/session-flow');
const { validar, normalizarExpediente }          = require('./utils/validators');
const db    = require('./db');
const logger = require('./logger');

// Teléfonos autorizados (vacío = todos)
const AUTORIZADOS = (process.env.PHONES_AUTORIZADOS || '').split(',').map(s => s.trim()).filter(Boolean);

function estaAutorizado(phone) {
  if (!AUTORIZADOS.length) return true;
  const admin = process.env.BOT_ADMIN_PHONE || '';
  return phone === admin || AUTORIZADOS.includes(phone);
}

// ── Entry point ───────────────────────────────────────────────
async function routear(evento) {
  try {
    const { type, from, body, selectedRowId, title } = extraerDatos(evento);
    const phone = from.replace(/@.*/, '');

    if (!phone || phone === 'status') return; // ignorar status broadcast

    logger.info({ phone, type, body: (body||'').substring(0,50) }, '📩');

    if (!estaAutorizado(phone)) {
      await wa.sendText(phone, '⛔ No tienes permiso para usar este sistema.');
      return;
    }

    await db.logActividad(phone, type, { body, selectedRowId });

    // ── Selección de lista ─────────────────────────────────
    if (type === 'list_response' && selectedRowId) {
      await manejarSeleccion(phone, selectedRowId);
      return;
    }

    // ── Respuesta de botón ────────────────────────────────
    if (type === 'button_response' && body) {
      await manejarBoton(phone, body);
      return;
    }

    // ── Texto libre ────────────────────────────────────────
    if (type === 'chat' && body) {
      const txt = body.trim();

      // Intentar resolver respuesta numérica ("1","2"...) a botón/lista
      const rowId = wa.resolverRespuestaNumerica(phone, txt);
      if (rowId) {
        const esBtnDirecto = rowId.startsWith('btn_') || rowId.startsWith('confirm_') ||
          rowId.startsWith('menu_') || rowId.startsWith('cambiar_') ||
          rowId.startsWith('consulta_');
        if (esBtnDirecto) await manejarBoton(phone, rowId);
        else              await manejarSeleccion(phone, rowId);
        return;
      }

      await manejarTexto(phone, txt);
      return;
    }

  } catch (err) {
    logger.error({ err }, '❌ Error en router');
  }
}

// ── Manejar selección de lista ────────────────────────────────
async function manejarSeleccion(phone, rowId) {
  const session = getSession(phone);

  // sede_0401
  if (rowId.startsWith('sede_')) {
    const idSede = rowId.replace('sede_', '');
    const sedes  = await db.getSedes();
    const sede   = sedes.find(s => s.id === idSede);
    await agendarH.pasoUno_Juzgado(phone, idSede, sede?.denominacion || idSede);
    return;
  }

  // juzgado_3
  if (rowId.startsWith('juzgado_')) {
    const idJuzgado = parseInt(rowId.replace('juzgado_', ''));
    const session   = getSession(phone);
    const juzgados  = await db.getJuzgados(session.datos.idSede);
    const juzgado   = juzgados.find(j => j.id === idJuzgado);
    await agendarH.pasoDos_Sala(phone, idJuzgado, juzgado?.denominacion || String(idJuzgado));
    return;
  }

  // sala_1
  if (rowId.startsWith('sala_')) {
    const idSala = parseInt(rowId.replace('sala_', ''));
    const salas  = await db.getSalas();
    const sala   = salas.find(s => s.id === idSala);
    await agendarH.pasoTres_Fecha(phone, idSala, sala?.nombre || `Sala ${idSala}`);
    return;
  }

  // fecha_2026-05-20
  if (rowId.startsWith('fecha_')) {
    const fecha = rowId.replace('fecha_', '');
    const label = new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Lima',
    });
    await agendarH.pasoCuatro_Horario(phone, fecha, label);
    return;
  }

  // slot_09:00_10:30
  if (rowId.startsWith('slot_')) {
    const parts = rowId.replace('slot_', '').split('_');
    const inicio = parts[0], fin = parts[1];
    await agendarH.pasoCinco_Internos(phone, inicio, fin);
    return;
  }

  // penal_1
  if (rowId.startsWith('penal_')) {
    const idPenal = parseInt(rowId.replace('penal_', ''));
    const penales = await db.getPenales();
    const penal   = penales.find(p => p.id === idPenal);
    await agendarH.pasoOcho_Confirmar(
      phone, idPenal,
      penal?.nombre || String(idPenal),
      penal?.email_calendar || null
    );
    return;
  }
}

// ── Manejar botón ─────────────────────────────────────────────
async function manejarBoton(phone, btnId) {

  if (btnId === 'menu_agendar')   { await agendarH.pasoCero_Sede(phone); return; }
  if (btnId === 'menu_consultar') { await consultarH.menuConsultar(phone); return; }
  if (btnId === 'menu_hoy')       { await consultarH.enviarAgendaHoy(phone); return; }
  if (btnId === 'menu_inicio')    { await agendarH.menuPrincipal(phone); return; }

  if (btnId === 'confirm_yes')    { await agendarH.confirmarAgendamiento(phone); return; }
  if (btnId === 'confirm_no') {
    clearSession(phone);
    await agendarH.menuPrincipal(phone);
    return;
  }

  if (btnId === 'cambiar_sala')  { await agendarH.pasoDos_Sala(phone, ...getJuzgadoDatos(phone)); return; }
  if (btnId === 'cambiar_fecha') {
    const s = getSession(phone);
    await agendarH.pasoTres_Fecha(phone, s.datos.idSala, s.datos.salaNombre);
    return;
  }

  if (btnId === 'consulta_hoy')        { await consultarH.enviarAgendaHoy(phone); return; }
  if (btnId === 'consulta_expediente') { await consultarH.pedirExpediente(phone); return; }
}

// ── Manejar texto libre ───────────────────────────────────────
async function manejarTexto(phone, texto) {
  const session = getSession(phone);
  const paso    = session?.paso;

  // Comandos globales que funcionan desde cualquier estado
  const cmd = texto.toLowerCase();
  if (cmd === 'hola' || cmd === 'inicio' || cmd === 'menu' || cmd === 'menú' || cmd === '0') {
    await agendarH.menuPrincipal(phone);
    return;
  }
  if (cmd === 'hoy' || cmd === 'agenda') {
    await consultarH.enviarAgendaHoy(phone);
    return;
  }

  // Paso 6: esperando internos
  if (paso === 6) {
    const result = await procesarPaso(phone, texto);
    await wa.sendText(phone, result.respuesta);
    if (result.mostrarListaPenales) {
      await agendarH.pasoSiete_Penal(phone);
    }
    return;
  }

  // Paso 7: esperando expediente
  if (paso === 7) {
    const result = await procesarPaso(phone, texto);
    await wa.sendText(phone, result.respuesta);
    if (result.mostrarListaPenales) {
      await agendarH.pasoSiete_Penal(phone);
    }
    return;
  }

  // Esperando expediente para consulta
  if (paso === 'esperando_expediente') {
    const expNorm = normalizarExpediente(texto);
    const { ok, mensaje } = validar('expediente', expNorm);
    if (!ok) {
      await wa.sendText(phone,
        `${mensaje}\n\nEscribe el expediente en formato correcto.\nEjemplo: _09167-2025-90_`
      );
      return;
    }
    clearSession(phone);
    await consultarH.consultarExpediente(phone, expNorm);
    return;
  }

  // Sin sesión activa — mostrar menú
  if (!paso || paso === 0) {
    await agendarH.menuPrincipal(phone);
    return;
  }

  // Texto inesperado durante un flujo de selector
  await wa.sendText(phone,
    '👆 Por favor usa las opciones del menú para continuar.\n\nEscribe *menu* para volver al inicio.'
  );
}

function getJuzgadoDatos(phone) {
  const s = getSession(phone);
  return [s.datos.idJuzgado, s.datos.juzgadoNombre];
}

// ── Extraer datos del evento OpenWA ──────────────────────────
function extraerDatos(evento) {
  // OpenWA puede enviar el evento envuelto en 'message' o directamente
  const msg = evento.message || evento;
  return {
    type:         msg.type || 'chat',
    from:         msg.from || msg.chatId || '',
    body:         msg.body || msg.selectedDisplayText || '',
    selectedRowId: msg.selectedRowId || null,
    title:        msg.title || '',
  };
}

module.exports = { routear };
