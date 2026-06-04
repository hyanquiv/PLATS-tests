/**
 * handlers/agendar.js
 * Flujo interactivo de agendamiento — 7 pasos enfocados.
 *
 * CAMPOS REQUERIDOS:
 *  1. Sede solicitante
 *  2. Juzgado (1°, 2°, 3°... JIP, JUP, Colegiado)
 *  3. Fecha
 *  4. Horario (intervalo de slots, ej: 2-4)
 *  5. Internos (nombre con regex)
 *  6. Expediente (12345-AAAA-00)
 *  7. Solicitante (desde perfil WA si disponible, sino fallback manual)
 *  + Enlace Meet (pendiente de automatización — se genera al confirmar)
 */
const wa       = require('../openwa-client');
const db       = require('../db');
const plats    = require('../plats-client');
const { crearMeet }           = require('../google-meet');
const { getSession, setSession, clearSession, generarResumen } = require('../utils/session-flow');
const { validar, normalizarExpediente, normalizarNombre }      = require('../utils/validators');
const { generarImagenAgenda } = require('../agenda-image');
const logger = require('../logger');

// ── Helpers ───────────────────────────────────────────────────
function todayPeru() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
}

function nextDays(n = 7) {
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const str = d.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
    const label = d.toLocaleDateString('es-PE', {
      timeZone: 'America/Lima',
      weekday: 'short', day: 'numeric', month: 'short'
    });
    days.push({
      value: str,
      label: i === 0 ? `Hoy — ${label}` : i === 1 ? `Mañana — ${label}` : label
    });
  }
  return days;
}

function slotLabel(s) { return `${s.inicio} – ${s.fin}`; }

// ═════════════════════════════════════════════════════════════
//  PASO 0 — Menú principal
// ═════════════════════════════════════════════════════════════
async function menuPrincipal(phone) {
  clearSession(phone);
  await wa.sendButtons(phone, {
    title:  '🏛️ PLATS — Corte Superior de Justicia de Arequipa',
    body:   '¿Qué deseas hacer?',
    footer: 'Sistema de Agendamiento de Audiencias',
    buttons: [
      { id: 'menu_agendar',  text: '📅 Nueva audiencia'  },
      { id: 'menu_consultar',text: '🔍 Consultar agenda'  },
      { id: 'menu_hoy',      text: '📋 Agenda de hoy'     },
    ],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 1 — Seleccionar sede
// ═════════════════════════════════════════════════════════════
async function pasoCero_Sede(phone, nombreWhatsApp) {
  const sedes = await db.getSedes();
  // Guardar nombre de WA si disponible para pre-rellenar solicitante
  setSession(phone, {
    paso: 1,
    datos: nombreWhatsApp ? { solicitante: nombreWhatsApp } : {}
  });

  await wa.sendList(phone, {
    title:      '📍 Paso 1 de 7 — Sede solicitante',
    body:       'Selecciona la sede judicial desde donde se solicita la audiencia:',
    buttonText: 'Ver sedes',
    sections: [{
      title: 'Sedes disponibles',
      rows:  sedes.map(s => ({
        id:    `sede_${s.id}`,
        title: s.denominacion,
      })),
    }],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 2 — Seleccionar juzgado
// ═════════════════════════════════════════════════════════════
async function pasoUno_Juzgado(phone, idSede, sedeNombre) {
  const juzgados = await db.getJuzgados(idSede);
  const session  = getSession(phone);
  setSession(phone, { paso: 2, datos: { ...session.datos, idSede, sedeNombre } });

  const rows = juzgados.map(j => ({
    id:    `juzgado_${j.id}`,
    title: j.denominacion,
  }));

  await wa.sendList(phone, {
    title:      '⚖️ Paso 2 de 7 — Juzgado',
    body:       `Sede: *${sedeNombre}*\nSelecciona el juzgado:`,
    buttonText: 'Ver juzgados',
    sections: [{ title: 'Juzgados', rows }],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 3 — Seleccionar fecha
// ═════════════════════════════════════════════════════════════
async function pasoDos_Fecha(phone, idJuzgado, juzgadoNombre) {
  const session = getSession(phone);
  setSession(phone, { paso: 3, datos: { ...session.datos, idJuzgado, juzgadoNombre } });

  const dias = nextDays(7);
  await wa.sendList(phone, {
    title:      '📅 Paso 3 de 7 — Fecha',
    body:       `Sede: *${session.datos.sedeNombre}*\nJuzgado: *${juzgadoNombre}*\nSelecciona la fecha de la audiencia:`,
    buttonText: 'Ver fechas',
    sections: [{
      title: 'Próximos 7 días',
      rows:  dias.map(d => ({
        id:    `fecha_${d.value}`,
        title: d.label,
      })),
    }],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 4 — Seleccionar horario por intervalo de slots
//  El usuario selecciona 2 números (inicio y fin del rango)
//  Ej: slots disponibles numerados 1-8, usuario elige "2-4"
// ═════════════════════════════════════════════════════════════
async function pasoTres_Horario(phone, fecha, fechaLabel) {
  const session = getSession(phone);
  // Para el horario usamos la primera sala disponible de la sede/juzgado
  // (la sala se asigna automáticamente según disponibilidad)
  const { idSede } = session.datos;
  setSession(phone, { paso: 4, datos: { ...session.datos, fecha, fechaLabel } });

  // Obtener slots disponibles del sistema (usamos salas activas de esa sede)
  const salas = await db.getSalas();
  const salaActiva = salas.find(s => s.activa) || salas[0];

  let slots = [];
  if (salaActiva) {
    slots = await db.getSlotsDisponibles({ idSala: salaActiva.id, fecha });
  }

  if (slots.length === 0) {
    await wa.sendButtons(phone, {
      title:  '😔 Sin disponibilidad',
      body:   `No hay horarios libres para el *${fechaLabel}*.\n¿Qué deseas hacer?`,
      buttons: [
        { id: 'cambiar_fecha', text: '📅 Cambiar fecha'  },
        { id: 'menu_inicio',   text: '🏠 Menú principal' },
      ],
    });
    return;
  }

  // Numerar los slots para que el usuario elija un intervalo
  const manana = slots.filter(s => parseInt(s.inicio) < 12);
  const tarde  = slots.filter(s => parseInt(s.inicio) >= 12);

  const sections = [];
  const allSlots = [...manana, ...tarde];

  // Guardar slots en sesión para referencia
  setSession(phone, { paso: 4, datos: { ...session.datos, fecha, fechaLabel, _slots: allSlots } });

  // Mostrar slots numerados con indicación de intervalo
  const slotRows = allSlots.map((s, idx) => ({
    id:          `slot_${s.inicio}_${s.fin}`,
    title:       `${idx + 1}. ${slotLabel(s)}`,
    description: `Slot ${idx + 1}`,
  }));

  const nSlots = allSlots.length;
  await wa.sendList(phone, {
    title:      '🕐 Paso 4 de 7 — Horario',
    body:
      `Fecha: *${fechaLabel}*\n\n` +
      `Selecciona el slot de inicio.\n` +
      `Puedes elegir un rango escribiendo ej: *2-4* para cubrir del slot 2 al 4.\n` +
      `_(${nSlots} horarios disponibles)_`,
    buttonText: `Ver ${nSlots} horarios`,
    sections: [
      ...(manana.length ? [{
        title: '🌅 Mañana',
        rows: manana.map((s, idx) => ({
          id: `slot_${s.inicio}_${s.fin}`,
          title: `${idx + 1}. ${slotLabel(s)}`,
        })),
      }] : []),
      ...(tarde.length ? [{
        title: '🌇 Tarde',
        rows: tarde.map((s, idx) => ({
          id: `slot_${manana.length + idx + 1}_${s.inicio}_${s.fin}`,
          title: `${manana.length + idx + 1}. ${slotLabel(s)}`,
        })),
      }] : []),
    ],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 4b — Procesar rango de slots (ej: "2-4")
//  Llamado desde commands.js cuando el usuario escribe un rango
// ═════════════════════════════════════════════════════════════
async function procesarRangoSlots(phone, textoRango) {
  const session = getSession(phone);
  const { _slots, fecha, fechaLabel } = session.datos;

  if (!_slots || !_slots.length) {
    await wa.sendText(phone, '⚠️ Sesión expirada. Por favor inicia de nuevo.');
    clearSession(phone);
    return false;
  }

  // Parsear "2-4" o "2" (slot único)
  const match = textoRango.trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    await wa.sendText(phone,
      `⚠️ Formato inválido. Escribe el número de slot o un rango.\n` +
      `Ejemplo: *3* para un solo slot, o *2-4* para cubrir del slot 2 al 4.`
    );
    return false;
  }

  const n1 = parseInt(match[1]);
  const n2 = match[2] ? parseInt(match[2]) : n1;

  if (n1 < 1 || n2 > _slots.length || n1 > n2) {
    await wa.sendText(phone,
      `⚠️ Rango inválido. Los slots disponibles son del 1 al ${_slots.length}.\n` +
      `El número inicial debe ser menor o igual al final.`
    );
    return false;
  }

  const slotInicio = _slots[n1 - 1];
  const slotFin    = _slots[n2 - 1];
  const inicio     = slotInicio.inicio;
  const fin        = slotFin.fin;
  const idSala     = slotInicio.id_sala || _slots[0].id_sala;

  const nuevosDatos = { ...session.datos, inicio, fin, idSala, _slots: undefined };
  setSession(phone, { paso: 5, datos: nuevosDatos });

  await wa.sendText(phone,
    `✅ Horario: *${inicio} – ${fin}*\n\n` +
    `👤 *Paso 5 de 7 — Interno(s)*\n\n` +
    `Escribe el nombre completo del interno o internos.\n\n` +
    `📝 Ejemplos:\n` +
    `• _Carlos Mamani Quispe_\n` +
    `• _Rosa Flores, Ana Cáceres Ramos_`
  );
  return true;
}

// ═════════════════════════════════════════════════════════════
//  PASO 5 — Internos (manejado en session-flow.js)
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
//  PASO 6 — Expediente (manejado en session-flow.js)
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
//  CONFIRMAR RESUMEN
// ═════════════════════════════════════════════════════════════
async function mostrarConfirmacion(phone) {
  const session = getSession(phone);
  setSession(phone, { ...session, paso: 9 });
  const resumen = generarResumen(session.datos);
  await wa.sendConfirm(phone, resumen, 'Esta acción registrará la audiencia en el sistema.');
}

// ═════════════════════════════════════════════════════════════
//  CONFIRMAR — Guardar todo
// ═════════════════════════════════════════════════════════════
async function confirmarAgendamiento(phone) {
  const session = getSession(phone);
  const d       = session.datos;

  await wa.sendText(phone, '⏳ Registrando audiencia...');

  try {
    // 1. Verificar overlap
    const { disponible, conflicto } = await db.verificarDisponibilidad({
      idSala: d.idSala,
      fecha:  d.fecha,
      inicio: d.inicio,
      fin:    d.fin,
    });

    if (!disponible) {
      clearSession(phone);
      await wa.sendButtons(phone, {
        title: '⛔ Conflicto de horario',
        body:
          `Mientras completabas el formulario, alguien agendó:\n\n` +
          `${conflicto.inicio} – ${conflicto.fin} | EXP. ${conflicto.expediente}\n\n` +
          `Debes elegir otro horario.`,
        buttons: [
          { id: 'menu_agendar', text: '🔄 Reagendar' },
          { id: 'menu_inicio',  text: '🏠 Menú'       },
        ],
      });
      return;
    }

    // 2. Crear Meet en Google Calendar (pendiente de automatización)
    let linkMeet = null;
    let eventId  = null;
    try {
      const meet = await crearMeet({
        expediente: d.expediente,
        juzgado:    d.juzgadoNombre,
        fecha:      d.fecha,
        inicio:     d.inicio,
        fin:        d.fin,
        emails:     [],
      });
      linkMeet = meet.link;
      eventId  = meet.eventId;
    } catch (err) {
      logger.warn({ err }, '⚠️ Meet no generado — pendiente de configuración de credenciales');
    }

    // 3. Guardar en PostgreSQL
    const audiencia = await db.crearAudiencia({
      idSala:          d.idSala,
      idSede:          d.idSede,
      idJuzgado:       d.idJuzgado,
      fecha:           d.fecha,
      inicio:          d.inicio,
      fin:             d.fin,
      expediente:      d.expediente,
      internos:        d.internos,
      solicitante:     d.solicitante || 'BOT',
      comunicacion:    'WHATSAPP',
      linkMeet,
      eventoCalendarId: eventId,
    });

    // 4. Sincronizar con backend Java PLATS
    try {
      await plats.crearAudiencia({
        idSala:      d.idSala,
        idSede:      d.idSede,
        idInstancia: d.idJuzgado,
        expediente:  d.expediente,
        internos:    d.internos,
        solicitante: d.solicitante || 'BOT',
        fecha:       d.fecha,
        inicio:      d.inicio,
        fin:         d.fin,
        link:        linkMeet,
        comunicacion: 'WHATSAPP',
      });
    } catch (err) {
      logger.warn({ err }, '⚠️ No se pudo sincronizar con backend Java');
    }

    // 5. Limpiar sesión
    clearSession(phone);

    // 6. Respuesta final
    await wa.sendText(phone,
      `✅ *Audiencia registrada exitosamente*\n\n` +
      `🆔 ID: *${audiencia.id}*\n` +
      `📄 Expediente: *${d.expediente}*\n` +
      `🏛️ Sede: *${d.sedeNombre}*\n` +
      `⚖️ Juzgado: *${d.juzgadoNombre}*\n` +
      `📅 Fecha: *${d.fechaLabel || d.fecha}*\n` +
      `🕐 Horario: *${d.inicio} – ${d.fin}*\n` +
      `👤 Internos: ${d.internos}\n` +
      `🙋 Solicitante: ${d.solicitante}\n` +
      (linkMeet
        ? `\n🎥 *Google Meet:*\n${linkMeet}`
        : `\n🎥 Meet: _(pendiente — configura Google credentials en .env)_`)
    );

    logger.info({ audienciaId: audiencia.id, expediente: d.expediente }, '✅ Audiencia confirmada');

  } catch (err) {
    clearSession(phone);
    logger.error({ err }, '❌ Error confirmando audiencia');
    await wa.sendText(phone,
      `❌ Error al registrar la audiencia.\n` +
      `Detalle: ${err.message}\n\n` +
      `Por favor intenta nuevamente o contacta al administrador.`
    );
  }
}

module.exports = {
  menuPrincipal,
  pasoCero_Sede,
  pasoUno_Juzgado,
  pasoDos_Fecha,
  pasoTres_Horario,
  procesarRangoSlots,
  mostrarConfirmacion,
  confirmarAgendamiento,
};
