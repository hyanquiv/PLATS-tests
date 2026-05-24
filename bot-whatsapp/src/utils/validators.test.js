/**
 * validators.test.js — pruebas rápidas sin framework
 * Ejecutar con: node src/utils/validators.test.js
 */
const { validar, normalizarExpediente, normalizarNombre, normalizarTelefono } = require('./validators');

let passed = 0; let failed = 0;

function test(desc, fn) {
  try { fn(); console.log(`  ✅ ${desc}`); passed++; }
  catch(e) { console.log(`  ❌ ${desc}\n     ${e.message}`); failed++; }
}

function expect(val) {
  return {
    toBe: (expected) => { if (val !== expected) throw new Error(`esperaba ${expected}, obtuve ${val}`); },
    toBeTrue:  () => { if (val !== true)  throw new Error(`esperaba true, obtuve ${val}`); },
    toBeFalse: () => { if (val !== false) throw new Error(`esperaba false, obtuve ${val}`); },
  };
}

// ── Expediente ──────────────────────────────────────────────────
console.log('\nExpediente:');
test('válido estándar',       () => expect(validar('expediente','09167-2025-90').ok).toBeTrue());
test('válido corto',          () => expect(validar('expediente','0001-2024-01').ok).toBeTrue());
test('válido largo',          () => expect(validar('expediente','123456-2026-1234').ok).toBeTrue());
test('rechaza barras',        () => expect(validar('expediente','9167/2025/90').ok).toBeFalse());
test('rechaza letras',        () => expect(validar('expediente','ABC-2025-90').ok).toBeFalse());
test('rechaza año corto',     () => expect(validar('expediente','09167-25-90').ok).toBeFalse());
test('rechaza sin guiones',   () => expect(validar('expediente','091672025908').ok).toBeFalse());
test('rechaza vacío',         () => expect(validar('expediente','').ok).toBeFalse());

// ── Normalizar expediente ───────────────────────────────────────
console.log('\nNormalizar expediente:');
test('limpia espacios',       () => expect(normalizarExpediente('09167 - 2025 - 90')).toBe('09167-2025-90'));
test('convierte mayúsculas',  () => expect(normalizarExpediente('09167-2025-90')).toBe('09167-2025-90'));

// ── Internos ────────────────────────────────────────────────────
console.log('\nInternos:');
test('nombre simple',         () => expect(validar('internos','Carlos Mamani Quispe').ok).toBeTrue());
test('con tilde',             () => expect(validar('internos','María Ángel López').ok).toBeTrue());
test('con guión',             () => expect(validar('internos','López-Huanca Carlos').ok).toBeTrue());
test('múltiples con coma',    () => expect(validar('internos','Carlos Mamani, Rosa Flores').ok).toBeTrue());
test('rechaza números',       () => expect(validar('internos','Juan123 Pérez').ok).toBeFalse());
test('rechaza muy corto',     () => expect(validar('internos','J').ok).toBeFalse());
test('rechaza XSS',           () => expect(validar('internos','<script>alert(1)</script>').ok).toBeFalse());
test('rechaza solo espacios', () => expect(validar('internos','     ').ok).toBeFalse());

// ── Normalizar nombre ───────────────────────────────────────────
console.log('\nNormalizar nombre:');
test('capitaliza palabras',   () => expect(normalizarNombre('carlos mamani quispe')).toBe('Carlos Mamani Quispe'));
test('limpia espacios dobles',() => expect(normalizarNombre('Carlos  Mamani')).toBe('Carlos Mamani'));

// ── Teléfono ────────────────────────────────────────────────────
console.log('\nTeléfono:');
test('con código 51',         () => expect(validar('telefono','51987654321').ok).toBeTrue());
test('sin código',            () => expect(validar('telefono','987654321').ok).toBeTrue());
test('con +51',               () => expect(validar('telefono','+51987654321').ok).toBeTrue());
test('rechaza fijo (no 9)',   () => expect(validar('telefono','51054321234').ok).toBeFalse());
test('rechaza muy corto',     () => expect(validar('telefono','123').ok).toBeFalse());

// ── Normalizar teléfono ─────────────────────────────────────────
console.log('\nNormalizar teléfono:');
test('+51 con espacios',      () => expect(normalizarTelefono('+51 987 654 321')).toBe('51987654321'));
test('solo 9 dígitos',        () => expect(normalizarTelefono('987654321')).toBe('51987654321'));

// ── Resumen ─────────────────────────────────────────────────────
console.log(`\n─────────────────────────────`);
console.log(`  ${passed} pasaron  |  ${failed} fallaron`);
if (failed > 0) process.exit(1);
