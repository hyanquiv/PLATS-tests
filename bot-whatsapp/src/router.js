/**
 * router.js
 * Recibe eventos del webhook de OpenWA y despacha al handler correcto.
 *
 * Flujo de agendamiento (7 pasos):
 *  1  → Sede
 *  2  → Juzgado
 *  3  → Fecha
 *  4  → Horario (seleccionar slot inicio, luego puede escribir rango "2-4")
 *  5  → Internos (texto libre validado)
 *  6  → Expediente (texto libre validado)
 *  7/8 → Solicitante (desde perfil WA o manual)
 *  9  → Confirmar
 */
const agendarH   = require('./handlers/agendar');
const consultarH = require('./handlers/consultar');
const wa         = require('./openwa-client');
const { getSession, procesarPaso, clearSession } = require('./utils/session-flow');
const { validar, normalizarExpediente }          = require('./utils/validators');
const db    = require('./db');
const logger = require('./logger');

const AUTORIZADOS = (process.env.PHONES_AUTORIZADOS || '').split(',').map(s => s.trim()).filter(Boolean);

function estaAutorizado(phone) {
  if (!AUTORIZADOS.length) return true;
  const admin = process.env.BOT_ADMIN_PHONE || '';
  return phone === admin || AUTORIZADOS.includes(phone);
}

// ── Intentar obtener nombre del usuario desde perfil WhatsApp ──
async function obtenerNombreWA(phone) {
  try {
    // OpenWA puede exponer el nombre de contacto
    const contacto = await wa.getContact?.(phone);
    if (contacto?.name && contacto.name.length > 2) return contacto.name;
    if (contacto?.pushname && contacto.pushname.length > 2) return contacto.pushname;
  } catch (_) {}
  return null;
}

// ── Entry point ───────────────────────────────────────────────
async function routear(evento) {
  try {
    const { type, from, body, selectedRowId } = extraerDatos(evento);
    const phone      = from;
    const phoneClean = from.replace(/@.*/, '');

    if (!phoneClean || phoneClean === 'status') return;

    logger.info({ phone, type, body: (body || '').substring(0, 50) }, '📩');

    if (!estaAutorizado(phoneClean)) {
      await wa.sendText(phone, '⛔ No tienes permiso para usar este sistema.');
      return;
    }

    await db.logActividad(phoneClean, type, { body, selectedRowId });

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

      const rowId = wa.resolverRespuestaNumerica?.(phone, txt);
      if (rowId) {
        const esBtnDirecto = /^(btn_|confirm_|menu_|cambiar_|consulta_)/.test(rowId);
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
    // PASO 3: ir directo a fecha (sin sala)
    await agendarH.pasoDos_Fecha(phone, idJuzgado, juzgado?.denominacion || String(idJuzgado));
    return;
  }

  // fecha_2026-05-20
  if (rowId.startsWith('fecha_')) {
    const fecha = rowId.replace('fecha_', '');
    const label = new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Lima',
    });
    await agendarH.pasoTres_Horario(phone, fecha, label);
    return;
  }

  // slot_09:00_10:30  — usuario tocó un slot individual (tratarlo como inicio de rango)
  if (rowId.startsWith('slot_')) {
    const parts  = rowId.replace('slot_', '').split('_');
    const inicio = parts[0];
    const fin    = parts[1];
    const session = getSession(phone);
    const slots   = session.datos._slots || [];
    const idx     = slots.findIndex(s => s.inicio === inicio);
    if (idx >= 0) {
      // Seleccionar solo ese slot como rango de 1
      await agendarH.procesarRangoSlots(phone, String(idx + 1));
    } else {
      // Fallback: usar inicio/fin directo
      const nuevosDatos = { ...session.datos, inicio, fin, _slots: undefined };
      const { setSession } = require('./utils/session-flow');
      setSession(phone, { paso: 5, datos: nuevosDatos });
      await wa.sendText(phone,
        `✅ Horario: *${inicio} – ${fin}*\n\n` +
        `👤 *Paso 5 de 7 — Interno(s)*\n\n` +
        `Escribe el nombre completo del interno o internos.\n\n` +
        `Ejemplo: _Carlos Mamani Quispe_`
      );
    }
    return;
  }
}

// ── Manejar botón ─────────────────────────────────────────────
async function manejarBoton(phone, btnId) {

  if (btnId === 'menu_agendar') {
    // Intentar obtener nombre de WA para pre-rellenar solicitante
    const nombre = await obtenerNombreWA(phone);
    await agendarH.pasoCero_Sede(phone, nombre);
    return;
  }
  if (btnId === 'menu_consultar') { await consultarH.menuConsultar(phone); return; }
  if (btnId === 'menu_hoy')       { await consultarH.enviarAgendaHoy(phone); return; }
  if (btnId === 'menu_inicio')    { await agendarH.menuPrincipal(phone); return; }

  if (btnId === 'confirm_yes')    { await agendarH.confirmarAgendamiento(phone); return; }
  if (btnId === 'confirm_no') {
    clearSession(phone);
    await agendarH.menuPrincipal(phone);
    return;
  }

  if (btnId === 'cambiar_fecha') {
    const s = getSession(phone);
    await agendarH.pasoDos_Fecha(phone, s.datos.idJuzgado, s.datos.juzgadoNombre);
    return;
  }

  if (btnId === 'consulta_hoy')        { await consultarH.enviarAgendaHoy(phone); return; }
  if (btnId === 'consulta_expediente') { await consultarH.pedirExpediente(phone); return; }
}

// ── Manejar texto libre ───────────────────────────────────────
async function manejarTexto(phone, texto) {
  const session = getSession(phone);
  const paso    = session?.paso;

  // Comandos globales
  const cmd = texto.toLowerCase();
  if (['hola', 'inicio', 'menu', 'menú', '0'].includes(cmd)) {
    await agendarH.menuPrincipal(phone);
    return;
  }
  if (cmd === 'hoy' || cmd === 'agenda') {
    await consultarH.enviarAgendaHoy(phone);
    return;
  }

  // ── Paso 4: esperando rango de slots (ej: "2-4" o "3")
  if (paso === 4) {
    await agendarH.procesarRangoSlots(phone, texto);
    return;
  }

  // ── Paso 5: esperando internos
  if (paso === 5) {
    const result = await procesarPaso(phone, texto);
    await wa.sendText(phone, result.respuesta);
    return;
  }

  // ── Paso 6: esperando expediente
  if (paso === 6) {
    const result = await procesarPaso(phone, texto);
    await wa.sendText(phone, result.respuesta);
    if (result.siguientePaso === 8 && result.mostrarConfirmacion) {
      await agendarH.mostrarConfirmacion(phone);
    } else if (result.siguientePaso === 7) {
      // No hay solicitante de WA, esperar texto manual
    }
    return;
  }

  // ── Paso 7: esperando nombre solicitante (manual)
  if (paso === 7) {
    const result = await procesarPaso(phone, texto);
    await wa.sendText(phone, result.respuesta);
    if (result.mostrarConfirmacion) {
      await agendarH.mostrarConfirmacion(phone);
    }
    return;
  }

  // ── Paso 8: confirmando solicitante detectado de WA
  if (paso === 8) {
    const result = await procesarPaso(phone, texto);
    if (result.respuesta) await wa.sendText(phone, result.respuesta);
    if (result.mostrarConfirmacion) {
      await agendarH.mostrarConfirmacion(phone);
    }
    return;
  }

  // ── Esperando expediente para consulta
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

  // Sin sesión activa
  if (!paso || paso === 0) {
    await agendarH.menuPrincipal(phone);
    return;
  }

  await wa.sendText(phone,
    '👆 Por favor usa las opciones del menú para continuar.\n\nEscribe *menu* para volver al inicio.'
  );
}

// ── Extraer datos del evento OpenWA ──────────────────────────
function extraerDatos(evento) {
  const msg = evento.message || evento;
  return {
    type:          msg.type || 'chat',
    from:          msg.from || msg.chatId || '',
    body:          msg.body || msg.selectedDisplayText || '',
    selectedRowId: msg.selectedRowId || null,
  };
}

module.exports = { routear };
