/**
 * commands.js
 * Parser e intérprete de comandos del bot.
 *
 * COMANDOS SOPORTADOS:
 *   agendar <expediente> <sala> <fecha> <inicio>-<fin>
 *   consultar <expediente> [fecha]
 *   hoy / agenda [fecha]
 *   salas
 *   eliminar <id>
 *   meet <id>        → regenerar/enviar link Meet de una audiencia
 *   penal <nombre> <link>   → conectar equipo del penal a un Meet
 *   ayuda
 */

const plats = require('./plats-client');
const { crearMeet } = require('./google-meet');
const { conectarPenal, listaPenales } = require('./rustdesk');
const { format, parseISO, isValid } = require('date-fns');
const { formatInTimeZone, toZonedTime } = require('date-fns-tz');
const logger = require('./logger');

const TZ = 'America/Lima';
const PHONES_AUTORIZADOS = (process.env.PHONES_AUTORIZADOS || '')
  .split(',').map(p => p.trim()).filter(Boolean);

// ─── Utilidades ───────────────────────────────────────────────────────────────

function fechaHoy() {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
}

function parseFecha(str) {
  // Acepta: hoy, mañana, YYYY-MM-DD, DD/MM/YYYY
  if (!str || str.toLowerCase() === 'hoy') return fechaHoy();
  if (str.toLowerCase() === 'mañana') {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return str; // asumir YYYY-MM-DD
}

function normalizarSala(str) {
  // "sala1" "SALA 1" "sala-1" "cabina4" → id numérico
  const mapa = {
    'sala1': 1, 'sala 1': 1, 's1': 1,
    'sala2': 2, 'sala 2': 2, 's2': 2,
    'sala3': 3, 'sala 3': 3, 's3': 3,
    'cabina4': 4, 'cabina 4': 4, 'c4': 4,
    'cabina5': 5, 'cabina 5': 5, 'c5': 5,
    'cabina6': 6, 'cabina 6': 6, 'c6': 6,
    'mujeres': 7, 'mujer': 7
  };
  return mapa[str.toLowerCase().replace(/-/g, '')] || parseInt(str) || null;
}

function emoji(sala) {
  return sala <= 3 ? '🏛️' : '👤';
}

function formatoAudiencia(a) {
  return `${emoji(a.idSala)} *EXP. ${a.descripcion || a.expediente}*\n` +
    `🕐 ${a.inicio} – ${a.fin} | ${a.nombreSala || 'Sala ' + a.idSala}\n` +
    (a.link ? `🔗 ${a.link}\n` : '') +
    `🆔 ID: ${a.id}`;
}

function estaAutorizado(phone) {
  if (!PHONES_AUTORIZADOS.length) return true; // sin restricción si no hay lista
  const admin = process.env.BOT_ADMIN_PHONE || '';
  return phone === admin || PHONES_AUTORIZADOS.includes(phone);
}

// ─── Procesador principal ─────────────────────────────────────────────────────

async function procesarMensaje(texto, remitente) {
  const txt = texto.trim();
  const phone = remitente.replace(/@.*/, '');

  if (!estaAutorizado(phone)) {
    return '⛔ No tienes permiso para usar este bot.';
  }

  const palabras = txt.split(/\s+/);
  const cmd = palabras[0].toLowerCase();

  try {

    // ── AYUDA ────────────────────────────────────────────────────
    if (cmd === 'ayuda' || cmd === 'help' || cmd === '?') {
      return mensajeAyuda();
    }

    // ── SALAS ────────────────────────────────────────────────────
    if (cmd === 'salas') {
      const salas = await plats.obtenerSalas();
      const lista = salas.map(s => `${emoji(s.id)} *${s.nombre}* (ID ${s.id})`).join('\n');
      return `📋 *Salas disponibles:*\n${lista}`;
    }

    // ── HOY / AGENDA ─────────────────────────────────────────────
    if (cmd === 'hoy' || cmd === 'agenda') {
      const fecha = parseFecha(palabras[1]);
      const res = await plats.obtenerAudiencias(fecha, '0');
      const audiencias = res.audiencias || [];
      if (!audiencias.length) {
        return `📅 No hay audiencias para el *${res.fechaTexto || fecha}*`;
      }
      const lista = audiencias.map(formatoAudiencia).join('\n\n');
      return `📅 *Agenda ${res.fechaTexto || fecha}*\n\n${lista}`;
    }

    // ── CONSULTAR ─────────────────────────────────────────────────
    if (cmd === 'consultar' || cmd === 'buscar') {
      const expediente = palabras[1];
      if (!expediente) return '⚠️ Uso: `consultar <expediente>` ej: `consultar 09167-2025-90`';
      const fecha = parseFecha(palabras[2]);
      const encontrados = await plats.buscarPorExpediente(expediente, fecha);
      if (!encontrados.length) {
        return `🔍 No se encontró el expediente *${expediente}* para el ${fecha}`;
      }
      return `🔍 *Resultado para ${expediente}:*\n\n` + encontrados.map(formatoAudiencia).join('\n\n');
    }

    // ── DETALLE POR ID ────────────────────────────────────────────
    if (cmd === 'detalle') {
      const id = palabras[1];
      if (!id) return '⚠️ Uso: `detalle <id>`';
      const a = await plats.obtenerAudiencia(id);
      return `🗂️ *Detalle audiencia ${id}*\n\n` +
        `📄 Expediente: ${a.expediente || a.descripcion}\n` +
        `🏛️ Sala: ${a.nombreSala || a.idSala}\n` +
        `📅 Fecha: ${a.fecha}\n` +
        `🕐 Horario: ${a.inicio} – ${a.fin}\n` +
        `👤 Interno(s): ${a.internos || '—'}\n` +
        `📞 Solicitante: ${a.solicitante || '—'}\n` +
        `🔗 Meet: ${a.link || '(sin enlace)'}\n` +
        `🕒 Registrado: ${a.fechaHoraRegistro || '—'}`;
    }

    // ── AGENDAR ──────────────────────────────────────────────────
    // Uso: agendar 09167-2025-90 sala1 2026-05-10 09:00-11:00 [internos] [solicitante]
    if (cmd === 'agendar' || cmd === 'nueva') {
      return await cmdAgendar(palabras);
    }

    // ── ELIMINAR ──────────────────────────────────────────────────
    if (cmd === 'eliminar' || cmd === 'cancelar') {
      const id = palabras[1];
      if (!id) return '⚠️ Uso: `eliminar <id>`';
      await plats.eliminarAudiencia(id);
      return `✅ Audiencia ID *${id}* eliminada correctamente.`;
    }

    // ── MEET: regenerar y enviar link ──────────────────────────────
    if (cmd === 'meet') {
      const id = palabras[1];
      if (!id) return '⚠️ Uso: `meet <id_audiencia>`';
      const a = await plats.obtenerAudiencia(id);
      const { link } = await crearMeet({
        expediente: a.expediente || a.descripcion,
        sala: a.nombreSala || `Sala ${a.idSala}`,
        fecha: a.fecha,
        inicio: a.inicio,
        fin: a.fin
      });
      if (!link) return '❌ No se pudo generar el enlace de Meet. Revisa la configuración de Google.';
      // Guardar el link en el PLATS
      await plats.modificarAudiencia(id, { ...a, link });
      return `🎥 *Google Meet generado:*\n${link}\n\n_Guardado en el sistema._`;
    }

    // ── PENAL: conectar equipo ─────────────────────────────────────
    if (cmd === 'penal') {
      // Uso: penal SOCABAYA https://meet.google.com/xxx-xxx-xxx
      const nombre = palabras[1]?.toUpperCase();
      const link = palabras[2];
      if (!nombre || !link) {
        const lista = listaPenales().join(', ');
        return `⚠️ Uso: \`penal <nombre> <link-meet>\`\nPenales configurados: ${lista}`;
      }
      const result = await conectarPenal(nombre, link);
      if (result.ok) return `✅ Enlace enviado al equipo de *${nombre}* — Meet abierto automáticamente.`;
      return `❌ No se pudo conectar con *${nombre}*: ${result.error}`;
    }

    // ── AGENDAR COMPLETO (con Meet + Penal automático) ─────────────
    if (cmd === 'audiencia') {
      return await cmdAudienciaCompleta(palabras);
    }

    return `❓ Comando no reconocido. Escribe *ayuda* para ver los comandos disponibles.`;

  } catch (err) {
    logger.error({ err, txt }, 'Error procesando mensaje');
    return `❌ Error interno: ${err.message}\nIntenta de nuevo o contacta al administrador.`;
  }
}

// ─── Subcomandos ──────────────────────────────────────────────────────────────

async function cmdAgendar(palabras) {
  // agendar <expediente> <sala> [fecha] <inicio>-<fin> [interno] [solicitante]
  if (palabras.length < 4) return mensajeAyudaAgendar();

  const expediente = palabras[1];
  const salaId = normalizarSala(palabras[2]);
  if (!salaId) return `⚠️ Sala no reconocida: "${palabras[2]}"\nEscribe *salas* para ver las disponibles.`;

  // Detectar si palabras[3] es fecha o rango de horas
  let fecha, rango, interno, solicitante;
  if (palabras[3]?.includes('-') && !palabras[3]?.includes(':')) {
    // Es solo fecha como "2026-05-10"
    fecha = parseFecha(palabras[3]);
    rango = palabras[4];
    interno = palabras.slice(5, -1).join(' ') || '';
    solicitante = palabras.at(-1) || 'BOT';
  } else if (palabras[3]?.includes(':')) {
    // Es rango horario directo "09:00-11:00"
    fecha = fechaHoy();
    rango = palabras[3];
    interno = palabras.slice(4).join(' ') || '';
    solicitante = 'BOT';
  } else {
    fecha = parseFecha(palabras[3]);
    rango = palabras[4];
    interno = palabras.slice(5).join(' ') || '';
    solicitante = 'BOT';
  }

  if (!rango || !rango.includes('-')) return mensajeAyudaAgendar();

  const [inicio, fin] = rango.split('-');
  const { disponible, conflicto } = await plats.verificarDisponibilidad(salaId, fecha, inicio, fin);

  if (!disponible) {
    return `⛔ *Conflicto de horario*\nLa sala ya tiene agendado:\n\n${formatoAudiencia(conflicto)}\n\nElige otro horario o sala.`;
  }

  // Obtener primera sede/instancia disponible (simplificado — ajustar según necesidad)
  const sedes = await plats.obtenerSedes();
  const idSede = sedes[0]?.id || '0401';
  const instancias = await plats.obtenerInstancias(idSede);
  const idInstancia = instancias[0]?.id || '1';

  const nueva = await plats.crearAudiencia({
    idSala: salaId,
    idSede,
    idInstancia,
    expediente,
    internos: interno,
    solicitante,
    fecha,
    inicio,
    fin
  });

  const salaNombre = await plats.nombreSala(salaId);
  return `✅ *Audiencia agendada*\n\n` +
    `📄 Expediente: *${expediente}*\n` +
    `🏛️ Sala: ${salaNombre}\n` +
    `📅 Fecha: ${fecha}\n` +
    `🕐 Horario: ${inicio} – ${fin}\n` +
    `🆔 ID: ${nueva?.id || '—'}\n\n` +
    `_Para generar Meet: *meet ${nueva?.id}*_\n` +
    `_Para conectar penal: *penal NOMBRE https://...*_`;
}

async function cmdAudienciaCompleta(palabras) {
  // audiencia <expediente> <sala> <fecha> <inicio>-<fin> <penal> [interno]
  // Flujo completo: agenda + crea Meet + envía al penal en un solo comando
  if (palabras.length < 6) {
    return '⚠️ Uso completo:\n`audiencia <expediente> <sala> <fecha> <HH:MM-HH:MM> <PENAL>`\n\n' +
      'Ejemplo:\n`audiencia 09167-2025-90 sala1 2026-05-10 09:00-11:00 SOCABAYA`';
  }

  const expediente = palabras[1];
  const salaId = normalizarSala(palabras[2]);
  const fecha = parseFecha(palabras[3]);
  const [inicio, fin] = palabras[4].split('-');
  const penalNombre = palabras[5]?.toUpperCase();

  if (!salaId) return `⚠️ Sala no válida: "${palabras[2]}"`;

  const { disponible, conflicto } = await plats.verificarDisponibilidad(salaId, fecha, inicio, fin);
  if (!disponible) return `⛔ Conflicto:\n${formatoAudiencia(conflicto)}`;

  const sedes = await plats.obtenerSedes();
  const idSede = sedes[0]?.id || '0401';
  const instancias = await plats.obtenerInstancias(idSede);
  const idInstancia = instancias[0]?.id || '1';
  const salaNombre = await plats.nombreSala(salaId);

  // 1. Crear audiencia
  const nueva = await plats.crearAudiencia({
    idSala: salaId, idSede, idInstancia,
    expediente, internos: palabras.slice(6).join(' ') || '',
    solicitante: 'BOT', fecha, inicio, fin
  });

  // 2. Crear Google Meet
  const { link } = await crearMeet({ expediente, sala: salaNombre, fecha, inicio, fin });

  // 3. Guardar link en PLATS
  if (link && nueva?.id) {
    await plats.modificarAudiencia(nueva.id, { ...nueva, link });
  }

  // 4. Conectar penal
  let penalMsg = '';
  if (penalNombre) {
    const r = await conectarPenal(penalNombre, link || '(sin Meet)');
    penalMsg = r.ok ? `\n✅ *${penalNombre}* conectado automáticamente.` : `\n⚠️ No se pudo conectar *${penalNombre}*: ${r.error}`;
  }

  return `✅ *Audiencia completa creada*\n\n` +
    `📄 *${expediente}*\n` +
    `🏛️ ${salaNombre} | 📅 ${fecha} | 🕐 ${inicio}–${fin}\n` +
    `🎥 Meet: ${link || '(no generado)'}\n` +
    `🆔 ID: ${nueva?.id || '—'}` +
    penalMsg;
}

// ─── Textos de ayuda ──────────────────────────────────────────────────────────

function mensajeAyuda() {
  return `🏛️ *PLATS Bot — Corte Superior de Justicia de Arequipa*

📋 *Comandos disponibles:*

*hoy* [fecha]
  → Muestra la agenda del día (o de la fecha indicada)
  → Ej: \`hoy\` / \`hoy 2026-05-10\`

*consultar* <expediente> [fecha]
  → Busca audiencias por número de expediente
  → Ej: \`consultar 09167-2025-90\`

*detalle* <id>
  → Detalle completo de una audiencia por ID

*salas*
  → Lista las salas y cabinas disponibles

*agendar* <expediente> <sala> <fecha> <inicio-fin>
  → Agenda una nueva audiencia
  → Ej: \`agendar 09167-2025-90 sala1 2026-05-10 09:00-11:00\`

*audiencia* <expediente> <sala> <fecha> <inicio-fin> <PENAL>
  → Agenda + crea Meet + conecta el penal (todo en uno)
  → Ej: \`audiencia 09167-2025-90 sala1 hoy 09:00-11:00 SOCABAYA\`

*meet* <id>
  → Genera/reenvía el enlace de Google Meet de una audiencia

*penal* <nombre> <link>
  → Envía un enlace Meet directamente al equipo del penal

*eliminar* <id>
  → Cancela y elimina una audiencia

*ayuda*
  → Muestra este mensaje`;
}

function mensajeAyudaAgendar() {
  return `⚠️ *Formato de agendar:*\n\`agendar <expediente> <sala> <fecha> <inicio>-<fin>\`\n\nEjemplos:\n\`agendar 09167-2025-90 sala1 hoy 09:00-11:00\`\n\`agendar 12384-2025-58 cabina4 2026-05-15 14:00-15:30\`\n\nEscribe *salas* para ver las disponibles.`;
}

module.exports = { procesarMensaje };
