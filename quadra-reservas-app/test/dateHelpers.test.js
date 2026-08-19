const test = require('node:test');
const assert = require('node:assert/strict');
const dh = require('../src/utils/dateHelpers');

test('addDays / addMonths', () => {
  assert.equal(dh.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(dh.addMonths('2026-01-31', 1), '2026-03-03'); // JS Date rollover ok, documented behavior
  assert.equal(dh.addMonths('2026-01-15', 3), '2026-04-15');
});

test('weekdayOf matches known dates', () => {
  // 2026-08-19 é uma quarta-feira
  assert.equal(dh.weekdayOf('2026-08-19'), 3);
  // 2026-08-16 é domingo
  assert.equal(dh.weekdayOf('2026-08-16'), 0);
});

test('isoWeekKey groups the same ISO week together', () => {
  // segunda a domingo da mesma semana devem cair na mesma chave
  const monday = '2026-08-17';
  const sunday = '2026-08-23';
  assert.equal(dh.isoWeekKey(monday), dh.isoWeekKey(sunday));
  // a proxima segunda-feira já é outra semana
  assert.notEqual(dh.isoWeekKey(monday), dh.isoWeekKey('2026-08-24'));
});

test('datesForWeekdayInRange returns exactly the matching weekday occurrences', () => {
  // trimestre de 3 meses (2026-08-19 a 2026-11-18), procurando quarta-feira (3)
  const dates = dh.datesForWeekdayInRange('2026-08-19', '2026-11-18', 3);
  assert.ok(dates.length >= 12 && dates.length <= 14);
  for (const d of dates) assert.equal(dh.weekdayOf(d), 3);
  // datas em ordem crescente, 7 dias de diferença
  for (let i = 1; i < dates.length; i++) {
    assert.equal(dh.addDays(dates[i - 1], 7), dates[i]);
  }
});
