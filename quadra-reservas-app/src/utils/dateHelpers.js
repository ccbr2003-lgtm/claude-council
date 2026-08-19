// Helpers de data. Datas trafegam sempre como string ISO "YYYY-MM-DD" (sem hora,
// sem timezone) para evitar bugs de fuso horario - a quadra tem um horario local
// unico (o do condominio), entao nao ha motivo pra lidar com timezones.

const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  // meio-dia UTC evita qualquer deslize de dia por causa de DST/timezone
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

function addMonths(iso, months) {
  const d = parseISODate(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return toISODate(d);
}

function weekdayOf(iso) {
  return parseISODate(iso).getUTCDay(); // 0=domingo .. 6=sabado
}

function weekdayName(weekday) {
  return WEEKDAY_NAMES[weekday];
}

function weekdayShort(weekday) {
  return WEEKDAY_SHORT[weekday];
}

// Chave de semana no formato "YYYY-Www" (semana comecando na segunda-feira),
// usada para aplicar o limite de N reservas por morador por semana.
function isoWeekKey(iso) {
  const d = parseISODate(iso);
  // isoWeekday: 1 (segunda) .. 7 (domingo)
  const isoWeekday = (d.getUTCDay() + 6) % 7 + 1;
  d.setUTCDate(d.getUTCDate() + 4 - isoWeekday); // quinta-feira da mesma semana ISO
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function isBeforeOrEqual(isoA, isoB) {
  return isoA <= isoB;
}

function isAfter(isoA, isoB) {
  return isoA > isoB;
}

// Gera todas as datas dentro de [startISO, endISO] (inclusive) que caem num dado
// dia da semana - usado pra materializar as ocorrencias de um horario fixo ao
// longo do trimestre inteiro.
function datesForWeekdayInRange(startISO, endISO, weekday) {
  const out = [];
  let cur = startISO;
  // avanca ate cair no dia da semana certo
  while (weekdayOf(cur) !== weekday) cur = addDays(cur, 1);
  while (isBeforeOrEqual(cur, endISO)) {
    out.push(cur);
    cur = addDays(cur, 7);
  }
  return out;
}

function range(startISO, endISO) {
  const out = [];
  let cur = startISO;
  while (isBeforeOrEqual(cur, endISO)) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

module.exports = {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  todayISO,
  nowISO,
  parseISODate,
  toISODate,
  addDays,
  addMonths,
  weekdayOf,
  weekdayName,
  weekdayShort,
  isoWeekKey,
  isBeforeOrEqual,
  isAfter,
  datesForWeekdayInRange,
  range
};
