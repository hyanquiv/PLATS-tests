/**
 * google-meet.js
 * Crea eventos en Google Calendar con enlace de Google Meet.
 * Requiere: credentials/google.json con refresh_token OAuth2.
 */

const { google } = require('googleapis');
const { readFileSync, existsSync } = require('fs');
const logger = require('./logger');

let calendar = null;

function initGoogle() {
  const credFile = process.env.GOOGLE_CREDENTIALS_FILE || '/app/credentials/google.json';
  if (!existsSync(credFile)) {
    logger.warn('⚠️  No se encontró google.json — Google Meet deshabilitado');
    return false;
  }

  try {
    const creds = JSON.parse(readFileSync(credFile, 'utf8'));
    const auth = new google.auth.OAuth2(
      creds.client_id || process.env.GOOGLE_CLIENT_ID,
      creds.client_secret || process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({
      refresh_token: creds.refresh_token || process.env.GOOGLE_REFRESH_TOKEN
    });
    calendar = google.calendar({ version: 'v3', auth });
    logger.info('✅ Google Calendar inicializado');
    return true;
  } catch (err) {
    logger.error({ err }, '❌ Error inicializando Google Calendar');
    return false;
  }
}

/**
 * Crea un evento en Google Calendar con Meet.
 * @param {Object} opts
 * @param {string} opts.expediente
 * @param {string} opts.sala - nombre de la sala
 * @param {string} opts.fecha - "2026-05-10"
 * @param {string} opts.inicio - "09:00"
 * @param {string} opts.fin   - "11:00"
 * @param {string[]} opts.emails - emails de invitados (opcional)
 * @returns {Promise<{link: string, eventId: string}>}
 */
async function crearMeet({ expediente, sala, fecha, inicio, fin, emails = [] }) {
  if (!calendar) {
    if (!initGoogle()) return { link: '', eventId: '' };
  }

  const startDT = `${fecha}T${inicio.padStart(5, '0')}:00-05:00`; // UTC-5 Lima
  const endDT   = `${fecha}T${fin.padStart(5, '0')}:00-05:00`;

  const event = {
    summary: `Audiencia EXP. ${expediente} — ${sala}`,
    description: `Audiencia judicial agendada por el sistema PLATS\nExpediente: ${expediente}\nSala: ${sala}`,
    start:  { dateTime: startDT, timeZone: 'America/Lima' },
    end:    { dateTime: endDT,   timeZone: 'America/Lima' },
    conferenceData: {
      createRequest: {
        requestId: `plats-${expediente}-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    },
    attendees: emails.map(e => ({ email: e }))
  };

  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: emails.length ? 'all' : 'none'
    });

    const link = res.data.conferenceData?.entryPoints?.[0]?.uri || '';
    const eventId = res.data.id || '';
    logger.info({ expediente, link }, '🎥 Google Meet creado');
    return { link, eventId };
  } catch (err) {
    logger.error({ err }, '❌ Error creando Google Meet');
    return { link: '', eventId: '' };
  }
}

module.exports = { crearMeet, initGoogle };
