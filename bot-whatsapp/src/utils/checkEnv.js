'use strict';

const required = ['PLATS_USER', 'PLATS_PASS'];
const missing = required.filter(k => !process.env[k]);

if (missing.length) {
  console.error(`❌ Faltan variables de entorno: ${missing.join(', ')}`);
  console.error('Copia .env.example a .env y configura los valores.');
  process.exit(1);
}
