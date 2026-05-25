/**
 * agenda-image.js
 * Genera un PNG de la agenda del día para enviar por WhatsApp.
 * Usa el paquete 'canvas' (binding nativo de Cairo) — sin Puppeteer,
 * más liviano y sin necesidad de Chrome.
 */
const { createCanvas, registerFont } = require('canvas');
const logger = require('./logger');

// ── Constantes de diseño ──────────────────────────────────────
const W          = 900;
const HEADER_H   = 90;
const SUBHDR_H   = 40;
const ROW_H      = 52;
const COL_TIME_W = 72;
const PADDING     = 20;
const FONT        = 'FreeSans, DejaVu Sans, Noto Sans, sans-serif';

// Colores institucionales
const COLORS = {
  brand:       '#6B0000',
  brandLight:  '#8B0000',
  brandPale:   '#FFF0F0',
  white:       '#FFFFFF',
  gray50:      '#F8F8FA',
  gray100:     '#F2F2F5',
  gray200:     '#E2E2E7',
  gray400:     '#9999A3',
  gray700:     '#2C2C30',
  text:        '#111113',
  textSub:     '#555560',
  // Colores de eventos (uno por sala)
  events: ['#0073E6','#0A7A6A','#6B35B8','#C47A00','#A80000','#1A7A4A','#C41E1E'],
};

const SLOTS_START = 8 * 60;   // 08:00
const SLOTS_END   = 18 * 60;  // 18:00
const SLOT_MINS   = 30;
const TOTAL_SLOTS = (SLOTS_END - SLOTS_START) / SLOT_MINS;

function timeToMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function fmt2(n) { return String(n).padStart(2, '0'); }

function minToLabel(min) {
  return `${fmt2(Math.floor(min / 60))}:${fmt2(min % 60)}`;
}

/**
 * Genera la imagen PNG de la agenda.
 * @param {object[]} audiencias — filas de la BD con sala_nombre, inicio, fin, expediente
 * @param {string}   fecha      — "2026-05-20"
 * @param {object[]} salas      — todas las salas activas
 * @returns {Buffer} — PNG buffer listo para enviar
 */
async function generarImagenAgenda(audiencias, fecha, salas) {
  try {
    const COL_W = Math.floor((W - COL_TIME_W - PADDING * 2) / salas.length);
    const GRID_H = TOTAL_SLOTS * ROW_H;
    const H = HEADER_H + SUBHDR_H + GRID_H + PADDING;

    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    // ── Fondo ───────────────────────────────────────────────
    ctx.fillStyle = COLORS.gray50;
    ctx.fillRect(0, 0, W, H);

    // ── Header ──────────────────────────────────────────────
    const grad = ctx.createLinearGradient(0, 0, W, HEADER_H);
    grad.addColorStop(0, COLORS.brand);
    grad.addColorStop(1, COLORS.brandLight);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, HEADER_H);

    // Logo / ícono
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(50, HEADER_H / 2, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.font      = `bold 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('⚖', 50, HEADER_H / 2 + 8);

    // Título
    ctx.fillStyle = COLORS.white;
    ctx.font      = `bold 18px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('CORTE SUPERIOR DE JUSTICIA DE AREQUIPA', 94, 32);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('PLATS — Agenda de Audiencias', 94, 54);

    // Fecha a la derecha
    const fechaLabel = new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Lima',
    });
    ctx.font      = `bold 13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'right';
    ctx.fillText(fechaLabel.toUpperCase(), W - PADDING, 38);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`${audiencias.length} audiencias programadas`, W - PADDING, 58);

    // ── Sub-header de salas ─────────────────────────────────
    const subY = HEADER_H;
    ctx.fillStyle = COLORS.gray700;
    ctx.fillRect(0, subY, W, SUBHDR_H);

    // Columna hora
    ctx.fillStyle = COLORS.gray400;
    ctx.font      = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('HORA', COL_TIME_W / 2 + PADDING, subY + SUBHDR_H / 2 + 4);

    // Columnas salas
    salas.forEach((sala, i) => {
      const x = PADDING + COL_TIME_W + i * COL_W + COL_W / 2;
      ctx.fillStyle = COLORS.white;
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(sala.nombre.toUpperCase(), x, subY + SUBHDR_H / 2 + 4);
    });

    // ── Grilla ──────────────────────────────────────────────
    const gridY = HEADER_H + SUBHDR_H;

    for (let slot = 0; slot <= TOTAL_SLOTS; slot++) {
      const y = gridY + slot * ROW_H;
      const min = SLOTS_START + slot * SLOT_MINS;

      // Línea horizontal
      ctx.strokeStyle = min % 60 === 0 ? COLORS.gray200 : COLORS.gray100;
      ctx.lineWidth   = min % 60 === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(PADDING, y);
      ctx.lineTo(W - PADDING, y);
      ctx.stroke();

      if (slot < TOTAL_SLOTS) {
        // Etiqueta de hora (solo en punto, no en media)
        if (min % 60 === 0) {
          ctx.fillStyle  = COLORS.textSub;
          ctx.font       = `bold 12px ${FONT}`;
          ctx.textAlign  = 'center';
          ctx.fillText(minToLabel(min), PADDING + COL_TIME_W / 2, y + ROW_H / 2 + 4);
        } else {
          ctx.fillStyle  = COLORS.gray400;
          ctx.font       = `10px ${FONT}`;
          ctx.textAlign  = 'center';
          ctx.fillText(minToLabel(min), PADDING + COL_TIME_W / 2, y + ROW_H / 2 + 4);
        }
      }
    }

    // Líneas verticales entre salas
    salas.forEach((_, i) => {
      const x = PADDING + COL_TIME_W + i * COL_W;
      ctx.strokeStyle = COLORS.gray200;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x, gridY);
      ctx.lineTo(x, gridY + GRID_H);
      ctx.stroke();
    });

    // ── Bloques de audiencia ────────────────────────────────
    audiencias.forEach((ev, idx) => {
      const salaIdx = salas.findIndex(s => s.id === ev.id_sala);
      if (salaIdx < 0) return;

      const evIni  = timeToMin(ev.inicio);
      const evFin  = timeToMin(ev.fin);
      const top    = gridY + ((evIni - SLOTS_START) / SLOT_MINS) * ROW_H + 2;
      const height = ((evFin - evIni) / SLOT_MINS) * ROW_H - 4;
      const left   = PADDING + COL_TIME_W + salaIdx * COL_W + 3;
      const width  = COL_W - 6;

      const color = COLORS.events[salaIdx % COLORS.events.length];

      // Sombra
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      roundRect(ctx, left + 2, top + 2, width, height, 6);
      ctx.fill();

      // Fondo del bloque
      ctx.fillStyle = color;
      roundRect(ctx, left, top, width, height, 6);
      ctx.fill();

      // Franja lateral más oscura
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      roundRect(ctx, left, top, 4, height, 3);
      ctx.fill();

      // Texto horario
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font      = `bold 10px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(`${ev.inicio}–${ev.fin}`, left + 8, top + 14);

      // Expediente
      ctx.fillStyle = COLORS.white;
      ctx.font      = `bold 11px ${FONT}`;
      const expText = `EXP. ${ev.expediente || ev.descripcion || '—'}`;
      ctx.fillText(truncate(ctx, expText, width - 14), left + 8, top + 28);

      // Interno (si hay espacio)
      if (height > 50 && ev.internos) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font      = `10px ${FONT}`;
        ctx.fillText(truncate(ctx, ev.internos, width - 14), left + 8, top + 42);
      }
    });

    // ── Footer ──────────────────────────────────────────────
    const footerY = gridY + GRID_H + 6;
    ctx.fillStyle  = COLORS.gray400;
    ctx.font       = `11px ${FONT}`;
    ctx.textAlign  = 'left';
    ctx.fillText(
      `Generado: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}  |  PLATS v3.0`,
      PADDING, footerY + 12
    );

    logger.info({ fecha, total: audiencias.length }, '🖼️ Imagen de agenda generada');
    return canvas.toBuffer('image/png');

  } catch (err) {
    logger.error({ err }, '❌ Error generando imagen de agenda');
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + '…';
}

module.exports = { generarImagenAgenda };
