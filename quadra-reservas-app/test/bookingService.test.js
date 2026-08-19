// Cada arquivo de teste roda em processo separado com `node --test`, então
// isolamos o banco por arquivo apontando DB_PATH pra um SQLite temporário
// ANTES de exigir src/db.js pela primeira vez.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = path.join(os.tmpdir(), `quadra-test-booking-${crypto.randomUUID()}.db`);

const db = require('../src/db');
const userService = require('../src/services/userService');
const settingsService = require('../src/services/settingsService');
const bookingService = require('../src/services/bookingService');
const { todayISO, addDays } = require('../src/utils/dateHelpers');

test.after(() => {
  db.close();
  fs.rmSync(process.env.DB_PATH, { force: true });
  fs.rmSync(process.env.DB_PATH + '-wal', { force: true });
  fs.rmSync(process.env.DB_PATH + '-shm', { force: true });
});

const court = db.prepare('SELECT * FROM courts LIMIT 1').get();
const ana = userService.createUser({ name: 'Ana', email: 'ana@t.local', password: 'x', apartment: '1' });
const bruno = userService.createUser({ name: 'Bruno', email: 'bruno@t.local', password: 'x', apartment: '2' });

test('só aceita horas cheias dentro do funcionamento (sem horário quebrado)', () => {
  assert.throws(() => bookingService.assertValidHour(11.5), { code: 'invalid_hour' });
  assert.throws(() => bookingService.assertValidHour(23), { code: 'invalid_hour' }); // fora do horário (fecha 22h)
  assert.doesNotThrow(() => bookingService.assertValidHour(8));
});

test('cria reserva avulsa e bloqueia o mesmo horário pra outro morador', () => {
  const date = addDays(todayISO(), 1);
  bookingService.createAvulsaBooking(ana.id, court.id, date, 9);
  assert.ok(bookingService.isSlotTaken(court.id, date, 9));
  assert.throws(() => bookingService.createAvulsaBooking(bruno.id, court.id, date, 9), { code: 'slot_taken' });
});

test('aplica o limite semanal de reservas por morador', () => {
  settingsService.set('weekly_limit', 2);
  const base = addDays(todayISO(), 8); // outra semana, isolada dos outros testes
  bookingService.createAvulsaBooking(ana.id, court.id, base, 8);
  bookingService.createAvulsaBooking(ana.id, court.id, addDays(base, 1), 8);
  assert.throws(
    () => bookingService.createAvulsaBooking(ana.id, court.id, addDays(base, 2), 8),
    { code: 'weekly_limit' }
  );
  // outro morador não é afetado pelo limite da Ana
  assert.doesNotThrow(() => bookingService.createAvulsaBooking(bruno.id, court.id, addDays(base, 2), 8));
});

test('cancelar libera o horário para outro morador', () => {
  const date = addDays(todayISO(), 3);
  const id = bookingService.createAvulsaBooking(ana.id, court.id, date, 10);
  assert.throws(() => bookingService.createAvulsaBooking(bruno.id, court.id, date, 10), { code: 'slot_taken' });
  bookingService.cancelBooking(id, { byUserId: ana.id });
  assert.doesNotThrow(() => bookingService.createAvulsaBooking(bruno.id, court.id, date, 10));
});

test('morador não pode cancelar reserva de outro morador', () => {
  const date = addDays(todayISO(), 4);
  const id = bookingService.createAvulsaBooking(ana.id, court.id, date, 11);
  assert.throws(() => bookingService.cancelBooking(id, { byUserId: bruno.id }), { code: 'forbidden' });
});

test('não permite reservar fora do horizonte de antecedência', () => {
  const farAway = addDays(todayISO(), 400);
  assert.throws(() => bookingService.createAvulsaBooking(ana.id, court.id, farAway, 9), { code: 'out_of_horizon' });
});
