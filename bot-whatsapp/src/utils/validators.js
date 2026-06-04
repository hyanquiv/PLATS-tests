/**
 * validators.js
 * Expresiones regulares para validar los campos libres del flujo de agendamiento.
 */

const PATTERNS = {
  // 12345-2022-0  hasta  12345-2022-99  (exactamente 5 dígitos, año 4 dígitos, 0-99)
  expediente: /^\d{5}-\d{4}-(\d{1,2})$/,

  // Carlos Mamani Quispe | Rosa Flores, Ana Cáceres | María Ángel López-Huanca
  internos: /^[A-Za-záéíóúÁÉÍÓÚüÜñÑ][A-Za-záéíóúÁÉÍÓÚüÜñÑ\s\-,.]{4,120}$/,

  // Dr. Juan Pérez | Dra. María Condori Quispe | Luis Chávez
  solicitante: /^(Dr\.|Dra\.)?\s?[A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s\.]{4,80}$/,

  // 51987654321 | 987654321 | +51987654321
  telefono: /^(\+?51)?[9]\d{8}$/,
};

const MENSAJES = {
  expediente: 'Formato esperado: 12345-AAAA-00  ej: 09167-2025-90  (5 dígitos - año - 0 a 99)',
  internos:   'Solo letras, espacios y guiones. Mínimo 5 caracteres. Ej: Carlos Mamani Quispe',
  solicitante:'Solo letras (Dr./Dra. opcional). Ej: Dr. Juan Pérez Vargas',
  telefono:   'Número peruano de 9 dígitos empezando en 9. Ej: 987654321',
};

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

function normalizarTelefono(str) {
  const digits = (str || '').replace(/[\s\-+]/g, '');
  if (digits.startsWith('51') && digits.length === 11) return digits;
  if (digits.startsWith('9') && digits.length === 9) return '51' + digits;
  return digits;
}

module.exports = {
  validar,
  normalizarExpediente,
  normalizarNombre,
  normalizarTelefono,
  PATTERNS,
  MENSAJES,
};
