/**
 * overlap.test.js — Prueba la lógica de solapamiento sin BD real
 * node src/utils/overlap.test.js
 */

// Simular la lógica de overlap localmente (sin conectar a pg)
function timeToMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function verificarOverlapLocal(nuevo, existentes) {
  const nIni = timeToMin(nuevo.inicio);
  const nFin = timeToMin(nuevo.fin);

  const conflicto = existentes.find(e => {
    if (e.id_sala !== nuevo.id_sala) return false;
    if (e.fecha !== nuevo.fecha) return false;
    const eIni = timeToMin(e.inicio);
    const eFin = timeToMin(e.fin);
    // Se solapan si: inicio_nuevo < fin_existente && fin_nuevo > inicio_existente
    return nIni < eFin && nFin > eIni;
  });

  return { disponible: !conflicto, conflicto: conflicto || null };
}

function getSlotsDisponiblesLocal(ocupados, idSala, fecha, duracionMin = 30) {
  const slots = [];
  let h = 8, m = 0;
  const limiteMin = 17 * 60 + 30;

  while (true) {
    const inicioMin = h * 60 + m;
    const finMin = inicioMin + duracionMin;
    if (finMin > limiteMin) break;

    const inicioStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const finStr = `${String(Math.floor(finMin/60)).padStart(2,'0')}:${String(finMin%60).padStart(2,'0')}`;

    const choca = ocupados
      .filter(o => o.id_sala === idSala && o.fecha === fecha)
      .some(o => inicioMin < timeToMin(o.fin) && finMin > timeToMin(o.inicio));

    if (!choca) slots.push({ inicio: inicioStr, fin: finStr });

    m += 30;
    if (m >= 60) { h++; m -= 60; }
  }
  return slots;
}

// ── Tests ─────────────────────────────────────────────────────
let passed = 0; let failed = 0;

function test(desc, fn) {
  try { fn(); console.log(`  ✅ ${desc}`); passed++; }
  catch(e) { console.log(`  ❌ ${desc}\n     ${e.message}`); failed++; }
}
function expect(val) {
  return {
    toBeTrue:  () => { if (val !== true)  throw new Error(`esperaba true, obtuve ${val}`); },
    toBeFalse: () => { if (val !== false) throw new Error(`esperaba false, obtuve ${val}`); },
    toBe: (x) => { if (val !== x) throw new Error(`esperaba ${x}, obtuve ${val}`); },
    toBeNull:  () => { if (val !== null)  throw new Error(`esperaba null, obtuve ${val}`); },
  };
}

// Audiencias existentes de prueba
const AUDIENCIAS = [
  { id: 1, id_sala: 1, fecha: '2026-05-20', inicio: '09:00', fin: '10:30', expediente: '09167-2025-90' },
  { id: 2, id_sala: 1, fecha: '2026-05-20', inicio: '11:00', fin: '12:30', expediente: '04521-2025-58' },
  { id: 3, id_sala: 2, fecha: '2026-05-20', inicio: '09:00', fin: '11:00', expediente: '12384-2024-90' },
  { id: 4, id_sala: 1, fecha: '2026-05-21', inicio: '09:00', fin: '11:00', expediente: '00891-2025-12' }, // otro día
];

console.log('\nValidador de solapamiento (overlap):');

test('slot libre — sala 1 a las 14:00',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '14:00', fin: '15:30' },
    AUDIENCIAS
  ).disponible).toBeTrue()
);

test('solapamiento exacto — misma hora',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '09:00', fin: '10:30' },
    AUDIENCIAS
  ).disponible).toBeFalse()
);

test('solapamiento parcial inicio — entra en medio de existente',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '10:00', fin: '11:30' },
    AUDIENCIAS
  ).disponible).toBeFalse()
);

test('solapamiento parcial fin — empieza antes, termina en medio',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '08:00', fin: '09:30' },
    AUDIENCIAS
  ).disponible).toBeFalse()
);

test('solapamiento por contención — nuevo contiene al existente',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '08:00', fin: '11:00' },
    AUDIENCIAS
  ).disponible).toBeFalse()
);

test('adyacente justo después — no debe solapar',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '10:30', fin: '11:00' },
    AUDIENCIAS
  ).disponible).toBeTrue()
);

test('adyacente justo antes — no debe solapar',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-20', inicio: '08:00', fin: '09:00' },
    AUDIENCIAS
  ).disponible).toBeTrue()
);

test('sala diferente — no hay conflicto aunque mismo horario',
  () => expect(verificarOverlapLocal(
    { id_sala: 3, fecha: '2026-05-20', inicio: '09:00', fin: '10:30' },
    AUDIENCIAS
  ).disponible).toBeTrue()
);

test('fecha diferente — no hay conflicto',
  () => expect(verificarOverlapLocal(
    { id_sala: 1, fecha: '2026-05-22', inicio: '09:00', fin: '10:30' },
    AUDIENCIAS
  ).disponible).toBeTrue()
);

test('conflicto devuelve el expediente que choca',
  () => {
    const r = verificarOverlapLocal(
      { id_sala: 1, fecha: '2026-05-20', inicio: '09:00', fin: '10:30' },
      AUDIENCIAS
    );
    expect(r.conflicto.expediente).toBe('09167-2025-90');
  }
);

console.log('\nSlots disponibles:');

const slots = getSlotsDisponiblesLocal(AUDIENCIAS, 1, '2026-05-20');

test('no genera slot que choca con 09:00-10:30',
  () => expect(slots.some(s => s.inicio === '09:00')).toBeFalse()
);

test('no genera slot que choca con 11:00-12:30',
  () => expect(slots.some(s => s.inicio === '11:00')).toBeFalse()
);

test('sí genera slot libre a las 13:00',
  () => expect(slots.some(s => s.inicio === '13:00')).toBeTrue()
);

test('sí genera slot libre a las 10:30 (adyacente)',
  () => expect(slots.some(s => s.inicio === '10:30')).toBeTrue()
);

test('genera slots con formato HH:MM',
  () => expect(/^\d{2}:\d{2}$/.test(slots[0].inicio)).toBeTrue()
);

console.log(`\n─────────────────────────────`);
console.log(`  ${passed} pasaron  |  ${failed} fallaron`);
if (failed > 0) process.exit(1);
