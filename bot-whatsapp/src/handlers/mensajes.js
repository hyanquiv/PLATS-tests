'use strict';

const dayjs = require('dayjs');
const plats = require('../services/plats');
const meet = require('../services/googleMeet');
const rustdesk = require('../services/rustdesk');
const logger = require('../utils/logger');

// Números autorizados (sin +, con código de país: 51xxxxxxxxx)
const NUMEROS_AUTORIZADOS = new Set(
  (process.env.ALLOWED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean)
);

// Estado de conversación por usuario (flujo multi-paso)
const estados = new Map();

// ─────────────────────────────────────────────
// AUTORIZACIÓN
// ─────────────────────────────────────────────
function esAutorizado(jid) {
  if (NUMEROS_AUTORIZADOS.size === 0) return true; // sin restricción si no hay lista
  const numero = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
  return NUMEROS_AUTORIZADOS.has(numero);
}

// ─────────────────────────────────────────────
// PROCESADOR PRINCIPAL
// ─────────────────────────────────────────────
async function procesarMensaje(jid, texto, responder) {
  if (!esAutorizado(jid)) return;

  const msg = texto?.trim();
  if (!msg) return;

  const cmd = msg.toUpperCase().split(' ')[0];
  const args = msg.split(' ').slice(1);

  logger.info({ jid, cmd, args }, 'Mensaje recibido');

  try {
    switch (cmd) {
      case 'AYUDA':
      case '/AYUDA':
      case 'HELP':
        return await responder(textoAyuda());

      case 'AGENDA':
        return await cmdConsultarAgenda(jid, args, responder);

      case 'AUDIENCIA':
        return await cmdConsultarAudiencia(jid, args, responder);

      case 'AGENDAR':
        return await cmdAgendar(jid, args, responder);

      case 'MEET':
        return await cmdGenerarMeet(jid, args, responder);

      case 'CONECTAR':
        return await cmdConectarPenal(jid, args, responder);

      case 'CANCELAR':
        estados.delete(jid);
        return await responder('✅ Operación cancelada.');

      default:
        // Flujo multi-paso activo
        if (estados.has(jid)) {
          return await continuarFlujo(jid, msg, responder);
        }
        return await responder(
          '❓ Comando no reconocido. Escribe *AYUDA* para ver los comandos disponibles.'
        );
    }
  } catch (err) {
    logger.error({ err, jid, cmd }, 'Error procesando mensaje');
    await responder('⚠️ Ocurrió un error. Intenta de nuevo o contacta al informático.');
  }
}

// ─────────────────────────────────────────────
// AYUDA
// ─────────────────────────────────────────────
function textoAyuda() {
  return `🏛️ *PLATS Bot - Corte Superior Arequipa*

*Consultas:*
• \`AGENDA\` — Ver audiencias de hoy
• \`AGENDA 2026-05-10\` — Ver agenda de una fecha
• \`AUDIENCIA 09167-2025-90\` — Buscar por expediente

*Agendamiento:*
• \`AGENDAR\` — Iniciar flujo guiado de agendamiento

*Google Meet:*
• \`MEET <id_audiencia>\` — Generar y enviar link Meet

*Penal:*
• \`CONECTAR <id_sala> <link_meet>\` — Abrir Meet en penal remoto

Escribe \`CANCELAR\` para salir de cualquier flujo.`;
}

// ─────────────────────────────────────────────
// CONSULTAR AGENDA DEL DÍA
// ─────────────────────────────────────────────
async function cmdConsultarAgenda(jid, args, responder) {
  const fecha = args[0] || dayjs().format('YYYY-MM-DD');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return await responder('📅 Formato de fecha inválido. Usa: AGENDA YYYY-MM-DD');
  }

  await responder('🔍 Consultando agenda...');
  const data = await plats.getAudienciasPorFecha(fecha);

  if (!data?.audiencias?.length) {
    return await responder(`📋 No hay audiencias programadas para *${data?.fechaTexto || fecha}*`);
  }

  const salas = await plats.getSalas();
  const porSala = {};
  data.audiencias.forEach(a => {
    const nombre = salas.find(s => s.id == a.idSala)?.nombre || `Sala ${a.idSala}`;
    if (!porSala[nombre]) porSala[nombre] = [];
    porSala[nombre].push(a);
  });

  let txt = `📋 *Agenda ${data.fechaTexto}*\n\n`;
  for (const [sala, audiencias] of Object.entries(porSala)) {
    txt += `🏠 *${sala}*\n`;
    audiencias
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .forEach(a => {
        txt += `  • ${a.inicio}–${a.fin} | EXP. ${a.descripcion || a.expediente || '—'}\n`;
        if (a.link) txt += `    🎥 ${a.link}\n`;
      });
    txt += '\n';
  }

  return await responder(txt);
}

// ─────────────────────────────────────────────
// CONSULTAR AUDIENCIA POR EXPEDIENTE
// ─────────────────────────────────────────────
async function cmdConsultarAudiencia(jid, args, responder) {
  const expediente = args.join(' ').trim();
  if (!expediente) {
    return await responder('📋 Uso: AUDIENCIA <numero_expediente>\nEjemplo: AUDIENCIA 09167-2025-90');
  }

  await responder('🔍 Buscando...');

  // Buscar en los próximos 7 días
  const resultados = [];
  for (let i = 0; i < 7; i++) {
    const fecha = dayjs().add(i, 'day').format('YYYY-MM-DD');
    const encontrados = await plats.buscarPorExpediente(expediente, fecha);
    encontrados.forEach(e => resultados.push({ ...e, fecha }));
  }

  if (!resultados.length) {
    return await responder(`❌ No se encontró el expediente *${expediente}* en los próximos 7 días.`);
  }

  let txt = `📋 *Expediente ${expediente.toUpperCase()}*\n\n`;
  for (const a of resultados) {
    const salaNombre = plats.getSalaNombre(a.idSala);
    txt += `📅 ${dayjs(a.fecha).format('DD/MM/YYYY')}\n`;
    txt += `⏰ ${a.inicio} – ${a.fin}\n`;
    txt += `🏠 ${salaNombre}\n`;
    txt += `🆔 ID: ${a.id}\n`;
    if (a.link) txt += `🎥 Meet: ${a.link}\n`;
    txt += '\n';
  }

  return await responder(txt);
}

// ─────────────────────────────────────────────
// AGENDAR — FLUJO GUIADO MULTI-PASO
// ─────────────────────────────────────────────
async function cmdAgendar(jid, args, responder) {
  const salas = await plats.getSalas();

  // Si viene todo en línea: AGENDAR EXP SALA FECHA INICIO FIN
  if (args.length >= 5) {
    const [expediente, idSala, fecha, inicio, fin] = args;
    return await procesarAgendamiento(jid, { expediente, idSala, fecha, inicio, fin }, responder);
  }

  // Flujo guiado
  estados.set(jid, { paso: 'expediente', datos: {} });

  const listaSalas = salas.map(s => `  • *${s.id}* → ${s.nombre}`).join('\n');
  return await responder(
    `📝 *Nuevo agendamiento*\n\nEscribe el número de expediente:\n_(Ej: 09167-2025-90)_\n\n` +
    `Salas disponibles:\n${listaSalas}\n\nEscribe *CANCELAR* para salir.`
  );
}

async function continuarFlujo(jid, msg, responder) {
  const estado = estados.get(jid);
  if (!estado) return;

  const { paso, datos } = estado;

  if (paso === 'expediente') {
    datos.expediente = msg.toUpperCase();
    estados.set(jid, { paso: 'sala', datos });
    const salas = await plats.getSalas();
    const lista = salas.map(s => `*${s.id}* → ${s.nombre}`).join('\n');
    return await responder(`✅ Expediente: *${datos.expediente}*\n\n🏠 Elige la sala:\n${lista}`);
  }

  if (paso === 'sala') {
    const salas = await plats.getSalas();
    const sala = salas.find(s => String(s.id) === msg.trim());
    if (!sala) return await responder('❌ Sala inválida. Elige un número de sala de la lista.');
    datos.idSala = sala.id;
    datos.nombreSala = sala.nombre;
    estados.set(jid, { paso: 'fecha', datos });
    return await responder(
      `✅ Sala: *${sala.nombre}*\n\n📅 Escribe la fecha:\n_(Formato: YYYY-MM-DD, Ej: ${dayjs().format('YYYY-MM-DD')})_`
    );
  }

  if (paso === 'fecha') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(msg.trim())) {
      return await responder('❌ Formato de fecha inválido. Usa YYYY-MM-DD (Ej: 2026-05-10)');
    }
    datos.fecha = msg.trim();
    estados.set(jid, { paso: 'inicio', datos });
    return await responder(
      `✅ Fecha: *${dayjs(datos.fecha).format('DD/MM/YYYY')}*\n\n⏰ Hora de inicio:\n_(Formato: HH:MM, Ej: 09:00)_`
    );
  }

  if (paso === 'inicio') {
    if (!/^\d{1,2}:\d{2}$/.test(msg.trim())) {
      return await responder('❌ Formato inválido. Usa HH:MM (Ej: 09:00)');
    }
    datos.inicio = msg.trim();
    // Auto-calcular fin +30min
    const [h, m] = datos.inicio.split(':').map(Number);
    const finMin = h * 60 + m + 30;
    datos.finSugerido = `${Math.floor(finMin / 60).toString().padStart(2, '0')}:${(finMin % 60).toString().padStart(2, '0')}`;
    estados.set(jid, { paso: 'fin', datos });
    return await responder(
      `✅ Inicio: *${datos.inicio}*\n\n⏰ Hora de fin (sugerido: *${datos.finSugerido}*):\n_(Escribe la hora o presiona Enter con el sugerido enviando "OK")_`
    );
  }

  if (paso === 'fin') {
    if (msg.toUpperCase() === 'OK') {
      datos.fin = datos.finSugerido;
    } else if (/^\d{1,2}:\d{2}$/.test(msg.trim())) {
      datos.fin = msg.trim();
    } else {
      return await responder('❌ Formato inválido. Usa HH:MM o escribe OK para usar el sugerido.');
    }
    estados.set(jid, { paso: 'solicitante', datos });
    return await responder(`✅ Fin: *${datos.fin}*\n\n👤 Escribe el nombre del solicitante (juez/secretario):`);
  }

  if (paso === 'solicitante') {
    datos.solicitante = msg.toUpperCase();
    estados.set(jid, { paso: 'confirmar', datos });

    return await responder(
      `📋 *Confirmar agendamiento:*\n\n` +
      `📁 Expediente: *${datos.expediente}*\n` +
      `🏠 Sala: *${datos.nombreSala}*\n` +
      `📅 Fecha: *${dayjs(datos.fecha).format('DD/MM/YYYY')}*\n` +
      `⏰ Horario: *${datos.inicio} – ${datos.fin}*\n` +
      `👤 Solicitante: *${datos.solicitante}*\n\n` +
      `¿Confirmar? Responde *SI* o *NO*`
    );
  }

  if (paso === 'confirmar') {
    if (msg.toUpperCase() === 'SI') {
      estados.delete(jid);
      return await procesarAgendamiento(jid, datos, responder);
    } else {
      estados.delete(jid);
      return await responder('❌ Agendamiento cancelado.');
    }
  }
}

async function procesarAgendamiento(jid, datos, responder) {
  await responder('⏳ Verificando disponibilidad...');

  const disponible = await plats.verificarDisponibilidad(
    datos.idSala, datos.fecha, datos.inicio, datos.fin
  );

  if (!disponible) {
    return await responder(
      `❌ La sala *${datos.nombreSala || datos.idSala}* ya está ocupada en ese horario.\n` +
      `Escribe *AGENDA ${datos.fecha}* para ver disponibilidad.`
    );
  }

  await responder('⏳ Registrando en PLATS...');

  const resultado = await plats.crearAudiencia({
    idSala: datos.idSala,
    expediente: datos.expediente,
    solicitante: datos.solicitante || 'BOT WHATSAPP',
    internos: datos.internos || '',
    fecha: datos.fecha,
    inicio: datos.inicio,
    fin: datos.fin,
    comunicacion: 'WHATSAPP'
  });

  await responder('⏳ Generando enlace Google Meet...');

  let meetLink = '';
  try {
    const eventoMeet = await meet.crearEventoMeet({
      titulo: `Audiencia EXP. ${datos.expediente}`,
      fecha: datos.fecha,
      inicio: datos.inicio,
      fin: datos.fin,
      descripcion: `Expediente: ${datos.expediente}\nSolicitante: ${datos.solicitante || ''}`
    });
    meetLink = eventoMeet.link;

    // Actualizar el link en PLATS
    if (resultado?.id && meetLink) {
      await plats.actualizarLink(resultado.id, meetLink);
    }
  } catch (err) {
    logger.warn({ err }, 'No se pudo generar Meet, continuando sin link');
  }

  let respuesta =
    `✅ *Audiencia agendada exitosamente*\n\n` +
    `📁 Expediente: *${datos.expediente}*\n` +
    `🏠 Sala: *${plats.getSalaNombre(datos.idSala)}*\n` +
    `📅 Fecha: *${dayjs(datos.fecha).format('DD/MM/YYYY')}*\n` +
    `⏰ Horario: *${datos.inicio} – ${datos.fin}*\n`;

  if (meetLink) {
    respuesta += `🎥 Google Meet: ${meetLink}\n`;
  }

  respuesta += `\n_Agendado por bot PLATS_`;
  return await responder(respuesta);
}

// ─────────────────────────────────────────────
// GENERAR MEET PARA AUDIENCIA EXISTENTE
// ─────────────────────────────────────────────
async function cmdGenerarMeet(jid, args, responder) {
  const id = args[0];
  if (!id) return await responder('🎥 Uso: MEET <id_audiencia>\nEjemplo: MEET 4525');

  await responder('⏳ Obteniendo datos de la audiencia...');

  const audiencia = await plats.getAudiencia(id);
  if (!audiencia) return await responder('❌ Audiencia no encontrada.');

  if (audiencia.link) {
    return await responder(
      `🎥 La audiencia ya tiene Meet:\n${audiencia.link}\n\nEXP. ${audiencia.expediente}`
    );
  }

  await responder('⏳ Generando enlace Meet...');

  const eventoMeet = await meet.crearEventoMeet({
    titulo: `Audiencia EXP. ${audiencia.expediente}`,
    fecha: audiencia.fecha,
    inicio: audiencia.inicio,
    fin: audiencia.fin,
    descripcion: `Expediente: ${audiencia.expediente}`
  });

  await plats.actualizarLink(id, eventoMeet.link);

  return await responder(
    `✅ *Meet generado*\n\n` +
    `📁 EXP. ${audiencia.expediente}\n` +
    `📅 ${dayjs(audiencia.fecha).format('DD/MM/YYYY')} ${audiencia.inicio}–${audiencia.fin}\n` +
    `🎥 ${eventoMeet.link}`
  );
}

// ─────────────────────────────────────────────
// CONECTAR PENAL REMOTO
// ─────────────────────────────────────────────
async function cmdConectarPenal(jid, args, responder) {
  const [idSala, ...linkParts] = args;
  const linkMeet = linkParts.join(' ').trim();

  if (!idSala) {
    return await responder(
      '🔗 Uso: CONECTAR <id_sala> <link_meet>\nEjemplo: CONECTAR 5 https://meet.google.com/xxx'
    );
  }

  // Si no viene link, intentar obtenerlo del PLATS para la próxima audiencia
  let urlFinal = linkMeet;
  if (!urlFinal) {
    const hoy = dayjs().format('YYYY-MM-DD');
    const data = await plats.getAudienciasPorFecha(hoy);
    const ahora = dayjs();
    const proxima = data?.audiencias
      ?.filter(a => String(a.idSala) === String(idSala) && a.link)
      ?.sort((a, b) => a.inicio.localeCompare(b.inicio))
      ?.find(a => {
        const [h, m] = a.inicio.split(':').map(Number);
        const horaAudiencia = dayjs().hour(h).minute(m);
        return horaAudiencia.isAfter(ahora.subtract(30, 'minute'));
      });

    if (proxima?.link) {
      urlFinal = proxima.link;
    } else {
      return await responder('❌ No se encontró Meet para esa sala. Proporciona el link manualmente.');
    }
  }

  await responder(`⏳ Enviando comando al penal (sala ${idSala})...`);

  const resultado = await rustdesk.abrirMeetEnPenal(idSala, urlFinal);

  if (resultado.ok) {
    return await responder(
      `✅ *Penal conectado exitosamente*\n\n` +
      `🏠 Sala: *${plats.getSalaNombre(idSala)}*\n` +
      `🎥 ${urlFinal}`
    );
  } else {
    return await responder(
      `⚠️ No se pudo conectar automáticamente: ${resultado.msg}\n\n` +
      `Envía manualmente el link al personal del penal:\n🎥 ${urlFinal}`
    );
  }
}

// ─────────────────────────────────────────────
// NOTIFICACIÓN AUTOMÁTICA desde WebSocket PLATS
// ─────────────────────────────────────────────
async function notificarEvento(evento, enviarATodos) {
  if (!evento?.id) return;

  const sala = plats.getSalaNombre(evento.idSala);
  const msg =
    `🔔 *Nueva audiencia agendada*\n\n` +
    `📁 EXP. ${evento.descripcion || evento.expediente || '—'}\n` +
    `🏠 ${sala}\n` +
    `⏰ ${evento.inicio} – ${evento.fin}\n` +
    (evento.link ? `🎥 ${evento.link}` : '');

  await enviarATodos(msg);
}

module.exports = { procesarMensaje, notificarEvento };
