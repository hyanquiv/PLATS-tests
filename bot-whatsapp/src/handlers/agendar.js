/**
 * handlers/agendar.js
 * Flujo interactivo de agendamiento en 9 pasos.
 * Cada paso muestra selectores (listas/botones) excepto
 * internos y expediente que se validan con regex.
 */
const wa       = require('../openwa-client');
const db       = require('../db');
const plats    = require('../plats-client');
const { crearMeet }           = require('../google-meet');
const { conectarPenal }       = require('../rustdesk');
const { getSession, setSession, clearSession, generarResumen } = require('../utils/session-flow');
const { validar, normalizarExpediente, normalizarNombre }      = require('../utils/validators');
const { generarImagenAgenda } = require('../agenda-image');
const logger = require('../logger');

// ── Helpers ───────────────────────────────────────────────────
function fmt2(n) { return String(n).padStart(2,'0'); }

function slotLabel(s) { return `${s.inicio} – ${s.fin}`; }

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
    days.push({ value: str, label: i === 0 ? `Hoy — ${label}` : i === 1 ? `Mañana — ${label}` : label });
  }
  return days;
}

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
async function pasoCero_Sede(phone) {
  const sedes = await db.getSedes();
  setSession(phone, { paso: 1, datos: {} });

  await wa.sendList(phone, {
    title:      '📍 Paso 1 de 8 — Sede solicitante',
    body:       'Selecciona la sede judicial desde donde se solicita la audiencia:',
    buttonText: 'Ver sedes',
    sections: [{
      title: 'Sedes disponibles',
      rows:  sedes.map(s => ({
        id:          `sede_${s.id}`,
        title:       s.denominacion,
        description: `Código: ${s.id}`,
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

  // Dividir en secciones si hay muchos
  const rows = juzgados.map(j => ({
    id:    `juzgado_${j.id}`,
    title: j.denominacion,
  }));

  await wa.sendList(phone, {
    title:      '⚖️ Paso 2 de 8 — Juzgado',
    body:       `Sede: *${sedeNombre}*\nSelecciona el juzgado:`,
    buttonText: 'Ver juzgados',
    sections: [{ title: 'Juzgados', rows }],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 3 — Seleccionar sala
// ═════════════════════════════════════════════════════════════
async function pasoDos_Sala(phone, idJuzgado, juzgadoNombre) {
  const salas   = await db.getSalas();
  const session = getSession(phone);
  setSession(phone, { paso: 3, datos: { ...session.datos, idJuzgado, juzgadoNombre } });

  const SALA_ICONS = { SALA: '🏛️', CABINA: '👤' };
  await wa.sendList(phone, {
    title:      '🚪 Paso 3 de 8 — Sala o cabina',
    body:       'Selecciona la sala para la audiencia:',
    buttonText: 'Ver salas',
    sections: [
      {
        title: 'Salas (audiencias colectivas)',
        rows:  salas.filter(s => s.tipo === 'SALA').map(s => ({
          id:          `sala_${s.id}`,
          title:       `${SALA_ICONS.SALA} ${s.nombre}`,
          description: `Capacidad: ${s.capacidad} personas`,
        })),
      },
      {
        title: 'Cabinas (individuales)',
        rows:  salas.filter(s => s.tipo === 'CABINA').map(s => ({
          id:          `sala_${s.id}`,
          title:       `${SALA_ICONS.CABINA} ${s.nombre}`,
          description: 'Conexión individual',
        })),
      },
    ],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 4 — Seleccionar fecha
// ═════════════════════════════════════════════════════════════
async function pasoTres_Fecha(phone, idSala, salaNombre) {
  const session = getSession(phone);
  setSession(phone, { paso: 4, datos: { ...session.datos, idSala, salaNombre } });

  const dias = nextDays(7);
  await wa.sendList(phone, {
    title:      '📅 Paso 4 de 8 — Fecha',
    body:       `Sala: *${salaNombre}*\nSelecciona la fecha de la audiencia:`,
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
//  PASO 5 — Seleccionar horario (solo slots libres)
// ═════════════════════════════════════════════════════════════
async function pasoCuatro_Horario(phone, fecha, fechaLabel) {
  const session = getSession(phone);
  const { idSala, salaNombre } = session.datos;
  setSession(phone, { paso: 5, datos: { ...session.datos, fecha, fechaLabel } });

  const slots = await db.getSlotsDisponibles({ idSala, fecha });

  if (slots.length === 0) {
    await wa.sendButtons(phone, {
      title:  '😔 Sin disponibilidad',
      body:   `*${salaNombre}* no tiene horarios libres el *${fechaLabel}*.\n¿Qué deseas hacer?`,
      buttons: [
        { id: 'cambiar_sala',  text: '🔄 Cambiar sala'  },
        { id: 'cambiar_fecha', text: '📅 Cambiar fecha'  },
        { id: 'menu_inicio',   text: '🏠 Menú principal' },
      ],
    });
    return;
  }

  // Agrupar slots por bloque de mañana/tarde
  const manana = slots.filter(s => parseInt(s.inicio) < 12);
  const tarde  = slots.filter(s => parseInt(s.inicio) >= 12);

  const sections = [];
  if (manana.length) sections.push({
    title: '🌅 Mañana',
    rows:  manana.map(s => ({ id: `slot_${s.inicio}_${s.fin}`, title: slotLabel(s) })),
  });
  if (tarde.length) sections.push({
    title: '🌇 Tarde',
    rows:  tarde.map(s => ({ id: `slot_${s.inicio}_${s.fin}`, title: slotLabel(s) })),
  });

  await wa.sendList(phone, {
    title:      '🕐 Paso 5 de 8 — Horario',
    body:       `Sala: *${salaNombre}* | Fecha: *${fechaLabel}*\nHorarios disponibles (solo los libres):`,
    buttonText: `Ver ${slots.length} horarios libres`,
    sections,
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 6 — Internos (texto libre validado)
// ═════════════════════════════════════════════════════════════
async function pasoCinco_Internos(phone, inicio, fin) {
  const session = getSession(phone);
  setSession(phone, { paso: 6, datos: { ...session.datos, inicio, fin } });

  await wa.sendText(phone,
    `✅ Horario: *${inicio} – ${fin}*\n\n` +
    `👤 *Paso 6 de 8 — Interno(s)*\n\n` +
    `Escribe el nombre completo del interno o internos.\n\n` +
    `📝 Ejemplos:\n` +
    `• _Carlos Mamani Quispe_\n` +
    `• _Rosa Flores, Ana Cáceres Ramos_`
  );
}

// ═════════════════════════════════════════════════════════════
//  PASO 7 — Expediente (texto libre validado)
//  (Esta lógica se maneja en session-flow.js)
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
//  PASO 8 — Seleccionar penal
// ═════════════════════════════════════════════════════════════
async function pasoSiete_Penal(phone) {
  const penales = await db.getPenales();
  const session = getSession(phone);
  setSession(phone, { ...session, paso: 8 });

  await wa.sendList(phone, {
    title:      '🏢 Paso 8 de 8 — Establecimiento penal',
    body:       'Selecciona el penal del interno para enviar la invitación de Google Meet:',
    buttonText: 'Ver penales',
    sections: [{
      title: 'Establecimientos penales',
      rows:  penales.map(p => ({
        id:          `penal_${p.id}`,
        title:       `🏢 ${p.nombre}`,
        description: p.email_calendar || 'Sin email registrado',
      })),
    }],
  });
}

// ═════════════════════════════════════════════════════════════
//  PASO 9 — Confirmar
// ═════════════════════════════════════════════════════════════
async function pasoOcho_Confirmar(phone, idPenal, penalNombre, emailPenal) {
  const session = getSession(phone);
  const datos   = { ...session.datos, idPenal, penalNombre, emailPenal };
  setSession(phone, { paso: 9, datos });

  const resumen = generarResumen(datos);
  await wa.sendConfirm(phone, resumen, 'Esta acción registrará la audiencia en el sistema.');
}

// ═════════════════════════════════════════════════════════════
//  PASO 9 — Guardar todo
// ═════════════════════════════════════════════════════════════
async function confirmarAgendamiento(phone) {
  const session = getSession(phone);
  const d       = session.datos;

  await wa.sendText(phone, '⏳ Registrando audiencia...');

  try {
    // 1. Verificar overlap una última vez (por seguridad)
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
        body:  `Mientras completabas el formulario, alguien agendó:\n\n` +
               `*${conflicto.sala_nombre}* | ${conflicto.inicio} – ${conflicto.fin}\n` +
               `EXP. ${conflicto.expediente}\n\n` +
               `Debes elegir otro horario.`,
        buttons: [
          { id: 'menu_agendar', text: '🔄 Reagendar' },
          { id: 'menu_inicio',  text: '🏠 Menú'       },
        ],
      });
      return;
    }

    // 2. Crear Meet en Google Calendar
    const { link: linkMeet, eventId } = await crearMeet({
      expediente: d.expediente,
      sala:       d.salaNombre,
      fecha:      d.fecha,
      inicio:     d.inicio,
      fin:        d.fin,
      emails:     d.emailPenal ? [d.emailPenal] : [],
    });

    // 3. Guardar en PostgreSQL
    const audiencia = await db.crearAudiencia({
      idSala:          d.idSala,
      idSede:          d.idSede,
      idJuzgado:       d.idJuzgado,
      idPenal:         d.idPenal,
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

    // 3.5 Sincronizar con backend Java PLATS para que la web lo vea
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
      logger.warn({ err }, '⚠️  No se pudo sincronizar con backend Java');
    }

    // 4. Intentar conectar penal automáticamente
    if (d.idPenal && linkMeet) {
      conectarPenal(d.penalNombre, linkMeet, d.expediente)
        .then(r => r.ok
          ? logger.info({ penal: d.penalNombre }, '🔗 Penal conectado')
          : logger.warn({ penal: d.penalNombre, err: r.error }, '⚠️ Penal no conectado')
        );
    }

    // 5. Limpiar sesión
    clearSession(phone);

    // 6. Responder con resumen final
    await wa.sendText(phone,
      `✅ *Audiencia registrada exitosamente*\n\n` +
      `🆔 ID: *${audiencia.id}*\n` +
      `📄 Expediente: *${d.expediente}*\n` +
      `🏛️ Sala: *${d.salaNombre}*\n` +
      `📅 Fecha: *${d.fecha}*\n` +
      `🕐 Horario: *${d.inicio} – ${d.fin}*\n` +
      `👤 Internos: ${d.internos}\n` +
      `🏢 Penal: ${d.penalNombre}\n` +
      (linkMeet ? `\n🎥 *Google Meet:*\n${linkMeet}\n` : '') +
      (d.emailPenal ? `\n📧 Invitación enviada a: ${d.emailPenal}` : '')
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
  pasoDos_Sala,
  pasoTres_Fecha,
  pasoCuatro_Horario,
  pasoCinco_Internos,
  pasoSiete_Penal,
  pasoOcho_Confirmar,
  confirmarAgendamiento,
};
