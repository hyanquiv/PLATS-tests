/**
 * validators.js
 * Expresiones regulares para validar los campos libres del flujo de agendamiento.
 * Todos los campos de selección (sala, sede, juzgado, penal, horario) ya están
 * validados estructuralmente por el selector — solo los textos libres necesitan regex.
 */

const PATTERNS = {
  // 09167-2025-90 | 00001-2026-01 | 123456-2024-1234
  expediente: /^\d{4,6}-\d{4}-\d{2,4}$/,

  // Carlos Mamani Quispe | Rosa Flores, Ana Cáceres | María Ángel López-Huanca
  // Acepta: letras con tilde, espacios, guiones, comas y puntos
  // Rechaza: números, <script>, caracteres especiales
  internos: /^[A-Za-záéíóúÁÉÍÓÚüÜñÑ][A-Za-záéíóúÁÉÍÓÚüÜñÑ\s\-,.]{4,120}$/,

  // Dr. Juan Pérez | Dra. María Condori Quispe | Luis Chávez
  solicitante: /^(Dr\.|Dra\.)?\s?[A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s\.]{4,80}$/,

  // 51987654321 | 987654321 | +51987654321
  telefono: /^(\+?51)?[9]\d{8}$/,
  meet: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i,
  horarioIntervalo: /^(\d{1,2})-(\d{1,2})$/,
};

const MENSAJES = {
  expediente: 'Formato esperado: 00000-AAAA-00  ej: 09167-2025-90',
  internos:   'Solo letras, espacios y guiones. Mínimo 5 caracteres. Ej: Carlos Mamani Quispe',
  solicitante:'Solo letras (Dr./Dra. opcional). Ej: Dr. Juan Pérez Vargas',
  telefono:   'Número peruano de 9 dígitos empezando en 9. Ej: 987654321',
  meet: 'Formato esperado: https://meet.google.com/xxx-xxxx-xxx',
  horarioIntervalo: 'Escribe dos números separados por guión. Ej: 2-4 (desde slot 2 hasta slot 4)',
};

/**
 * Valida un campo individual.
 * @returns {{ ok: boolean, mensaje: string }}
 */
function validar(campo, valor) {
  const v = (valor || '').trim();
  if (!v) return { ok: false, mensaje: `El campo ${campo} es obligatorio.` };
  const pattern = PATTERNS[campo];
  if (!pattern) return { ok: true, mensaje: '' };
  const ok = pattern.test(v);
  return { ok, mensaje: ok ? '' : `⚠️ ${MENSAJES[campo]}` };
}

/**
 * Normaliza el expediente: quita espacios, convierte a mayúsculas.
 * "09167 - 2025 - 90" → "09167-2025-90"
 */
function normalizarExpediente(str) {
  return (str || '')
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Normaliza un nombre: capitaliza cada palabra, limpia espacios dobles.
 * "carlos  mamani quispe" → "Carlos Mamani Quispe"
 */
function normalizarNombre(str) {
  return (str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-záéíóúüñ])/g, c => c.toUpperCase());
}

/**
 * Normaliza teléfono: quita +, espacios, guiones → solo dígitos con 51 adelante.
 * "+51 987 654 321" → "51987654321"
 */
function normalizarTelefono(str) {
  const digits = (str || '').replace(/[\s\-+]/g, '');
  if (digits.startsWith('51') && digits.length === 11) return digits;
  if (digits.startsWith('9') && digits.length === 9) return '51' + digits;
  return digits;
}

function validarMeet(url) {
  const v = (url || '').trim();
  if (!v) return { ok: false, mensaje: 'El enlace Meet es obligatorio.' };
  // Aceptar también links con parámetros o variantes
  const ok = v.startsWith('https://meet.google.com/') && v.length > 28;
  return { ok, mensaje: ok ? '' : MENSAJES.meet };
}

function parsearIntervaloHorario(texto, totalSlots) {
  // Acepta "2-4", "2 - 4", "2a4"
  const clean = texto.trim().replace(/\s/g,'').replace(/[aA]/,'-');
  const match = clean.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return { ok: false, inicio: null, fin: null };
  const desde = parseInt(match[1]);
  const hasta  = parseInt(match[2]);
  if (desde < 1 || hasta > totalSlots || desde >= hasta)
    return { ok: false, inicio: null, fin: null };
  return { ok: true, inicio: desde - 1, fin: hasta - 1 }; // índices base-0
}

module.exports = {
  validar,
  normalizarExpediente,
  normalizarNombre,
  normalizarTelefono,
  validarMeet,
  parsearIntervaloHorario,
  PATTERNS,
  MENSAJES,
};
