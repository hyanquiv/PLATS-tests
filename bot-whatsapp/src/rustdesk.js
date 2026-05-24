const axios  = require('axios');
const logger = require('./logger');

const PENALES = {
  'SOCABAYA':   { rustdeskId:'100001', ip:'172.28.1.10', agentPort:3002 },
  'YARABAMBA':  { rustdeskId:'100002', ip:'172.28.1.11', agentPort:3002 },
  'QOCHAPAMPA': { rustdeskId:'100003', ip:'172.28.1.12', agentPort:3002 },
  'CAMANÁ':     { rustdeskId:'100004', ip:'172.28.1.13', agentPort:3002 },
  'CAYLLOMA':   { rustdeskId:'100005', ip:'172.28.1.14', agentPort:3002 },
};

async function conectarPenal(nombrePenal, linkMeet, expediente) {
  const penal = PENALES[nombrePenal.toUpperCase()];
  if (!penal) return { ok: false, error: `Penal "${nombrePenal}" no configurado` };
  try {
    const res = await axios.post(`http://${penal.ip}:${penal.agentPort}/abrir-meet`,
      { link: linkMeet, expediente, timestamp: new Date().toISOString() },
      { timeout: 8000 }
    );
    logger.info({ nombrePenal, linkMeet }, '🔗 Meet enviado al penal');
    return { ok: true, respuesta: res.data };
  } catch (err) {
    if (process.env.RUSTDESK_API_URL && process.env.RUSTDESK_API_KEY) {
      try {
        await axios.post(`${process.env.RUSTDESK_API_URL}/api/connect`,
          { id: penal.rustdeskId, action: 'run_command',
            command: `start "" "${linkMeet}"` },
          { headers: { Authorization: `Bearer ${process.env.RUSTDESK_API_KEY}` }, timeout: 10000 }
        );
        return { ok: true };
      } catch (err2) { return { ok: false, error: err2.message }; }
    }
    return { ok: false, error: err.message };
  }
}

function listaPenales() { return Object.keys(PENALES); }
module.exports = { conectarPenal, listaPenales };
