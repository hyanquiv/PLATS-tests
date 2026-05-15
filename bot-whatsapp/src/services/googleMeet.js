'use strict';

const { google } = require('googleapis');
const logger = require('../utils/logger');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

/**
 * Crea un evento en Google Calendar con Meet automático.
 * @returns {{ link: string, eventId: string }}
 */
async function crearEventoMeet({ titulo, fecha, inicio, fin, descripcion, asistentes }) {
  try {
    // Convertir fecha y horas a ISO con zona horaria Perú (UTC-5)
    const fechaInicio = `${fecha}T${inicio}:00-05:00`;
    const fechaFin = `${fecha}T${fin}:00-05:00`;

    const evento = {
      summary: titulo || 'Audiencia Judicial',
      description: descripcion || '',
      start: { dateTime: fechaInicio, timeZone: 'America/Lima' },
      end:   { dateTime: fechaFin,   timeZone: 'America/Lima' },
      conferenceData: {
        createRequest: {
          requestId: `plats-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      attendees: asistentes?.map(email => ({ email })) || [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'popup', minutes: 10 }
        ]
      }
    };

    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      resource: evento,
      conferenceDataVersion: 1,
      sendUpdates: 'none'
    });

    const meetLink = res.data.conferenceData?.entryPoints?.find(
      ep => ep.entryPointType === 'video'
    )?.uri;

    logger.info({ eventId: res.data.id, meetLink }, 'Evento Meet creado');

    return {
      link: meetLink || res.data.htmlLink,
      eventId: res.data.id,
      htmlLink: res.data.htmlLink
    };

  } catch (err) {
    logger.error({ err }, 'Error al crear evento en Google Calendar');
    throw err;
  }
}

/**
 * Elimina un evento de Google Calendar.
 */
async function eliminarEvento(eventId) {
  try {
    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      eventId
    });
  } catch (err) {
    logger.warn({ err }, 'No se pudo eliminar el evento de Calendar');
  }
}

module.exports = { crearEventoMeet, eliminarEvento };
