// Testa a regra central de justiça: o sorteio dos horários fixos trimestrais,
// com exclusão do titular anterior quando há disputa, e a alocação automática
// quando só existe um interessado.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = path.join(os.tmpdir(), `quadra-test-draw-${crypto.randomUUID()}.db`);

const db = require('../src/db');
const userService = require('../src/services/userService');
const quarterService = require('../src/services/quarterService');
const drawService = require('../src/services/drawService');
const bookingService = require('../src/services/bookingService');
const notificationService = require('../src/services/notificationService');
const { addDays, addMonths, weekdayOf, todayISO } = require('../src/utils/dateHelpers');

test.after(() => {
  db.close();
  fs.rmSync(process.env.DB_PATH, { force: true });
  fs.rmSync(process.env.DB_PATH + '-wal', { force: true });
  fs.rmSync(process.env.DB_PATH + '-shm', { force: true });
});

const court = db.prepare('SELECT * FROM courts LIMIT 1').get();
const ana = userService.createUser({ name: 'Ana', email: 'ana@t.local', password: 'x', apartment: '101' });
const bruno = userService.createUser({ name: 'Bruno', email: 'bruno@t.local', password: 'x', apartment: '102' });
const carla = userService.createUser({ name: 'Carla', email: 'carla@t.local', password: 'x', apartment: '103' });

// Um trimestre "anterior" já encerrado, com a Ana como titular fixa de
// terça (2) às 20h.
const q1 = quarterService.createQuarter({
  label: 'Q1 (encerrado)',
  start_date: '2026-01-01',
  end_date: '2026-03-31',
  interest_open_at: '2025-12-01',
  interest_close_at: '2025-12-20'
});
db.prepare(`
  INSERT INTO fixed_allocations (quarter_id, user_id, court_id, weekday, start_hour, method)
  VALUES (?, ?, ?, 2, 20, 'unico_interessado')
`).run(q1.id, ana.id, court.id);

// Trimestre seguinte, com janela de interesse já fechada (pronta pro sorteio).
const q2 = quarterService.createQuarter({
  label: 'Q2 (em disputa)',
  start_date: '2026-04-01',
  end_date: '2026-06-30',
  interest_open_at: '2026-03-01',
  interest_close_at: '2026-03-20'
});

// Terça 20h: Ana (titular anterior) E Bruno querem o mesmo horário -> disputa.
db.prepare(`INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, 2, 20)`).run(q2.id, ana.id, court.id);
db.prepare(`INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, 2, 20)`).run(q2.id, bruno.id, court.id);
// Quinta 18h: só Carla se interessou -> sem disputa, alocação direta.
db.prepare(`INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, 4, 18)`).run(q2.id, carla.id, court.id);

test('sorteio exclui o titular anterior do MESMO horário quando há outro interessado', () => {
  const result = drawService.runDraw(q2.id, { rng: () => 0 }); // rng determinístico: sempre pega o primeiro elegível

  const tuesdaySlot = result.slots.find(s => s.weekday === 2 && s.startHour === 20);
  assert.equal(tuesdaySlot.incumbentUserId, ana.id);
  assert.equal(tuesdaySlot.incumbentExcluded, true, 'titular deveria ser excluído da disputa');
  assert.equal(tuesdaySlot.eligible.length, 1);
  assert.equal(tuesdaySlot.eligible[0].id, bruno.id);
  assert.equal(tuesdaySlot.winner.id, bruno.id, 'Bruno deveria vencer, já que a titular foi excluída');
  assert.equal(tuesdaySlot.method, 'sorteio');

  const thursdaySlot = result.slots.find(s => s.weekday === 4 && s.startHour === 18);
  assert.equal(thursdaySlot.method, 'unico_interessado');
  assert.equal(thursdaySlot.winner.id, carla.id);
  assert.equal(thursdaySlot.incumbentExcluded, false);
});

test('a alocação fixa e as reservas materializadas refletem o resultado do sorteio', () => {
  const allocations = quarterService.allocationsOfQuarter(q2.id);
  const tuesdayAlloc = allocations.find(a => a.weekday === 2 && a.start_hour === 20);
  assert.equal(tuesdayAlloc.user_id, bruno.id);

  const brunoBookings = db.prepare(`
    SELECT * FROM bookings WHERE user_id = ? AND type = 'fixa' AND start_hour = 20
  `).all(bruno.id);
  assert.ok(brunoBookings.length >= 12, 'deveria ter uma reserva por semana ao longo do trimestre');
  for (const b of brunoBookings) assert.equal(weekdayOf(b.date), 2);

  // Ana não tem mais reserva fixa nesse horário no novo trimestre
  const anaTuesdayBookings = db.prepare(`
    SELECT * FROM bookings WHERE user_id = ? AND date >= ? AND date <= ? AND start_hour = 20 AND status = 'confirmada'
  `).all(ana.id, q2.start_date, q2.end_date);
  assert.equal(anaTuesdayBookings.length, 0);
});

test('titular e concorrente perdedor recebem notificações explicando o motivo', () => {
  const anaNotifs = notificationService.listForUser(ana.id).map(n => n.message).join(' | ');
  assert.match(anaNotifs, /não foi renovado/);
  assert.match(anaNotifs, /rodízio/);

  const brunoNotifs = notificationService.listForUser(bruno.id).map(n => n.message).join(' | ');
  assert.match(brunoNotifs, /contemplado/);
});

test('não permite rodar o sorteio duas vezes para o mesmo trimestre', () => {
  assert.throws(() => drawService.runDraw(q2.id), { code: 'already_done' });
});

test('limite de interesses por trimestre segue o mesmo limite semanal', () => {
  const today = todayISO();
  const q3 = quarterService.createQuarter({
    label: 'Q3',
    start_date: addDays(today, 10),
    end_date: addDays(today, 100),
    interest_open_at: addDays(today, -1),
    interest_close_at: addDays(today, 5)
  });
  quarterService.submitInterest(q3.id, carla.id, court.id, 1, 8);
  quarterService.submitInterest(q3.id, carla.id, court.id, 3, 8);
  assert.throws(
    () => quarterService.submitInterest(q3.id, carla.id, court.id, 5, 8),
    { code: 'limit_reached' }
  );
});

test('sorteio com 3 candidatos novos (sem titular) usa o rng pra decidir e registra auditoria', () => {
  const today = todayISO();
  const q4 = quarterService.createQuarter({
    label: 'Q4',
    start_date: addDays(today, 200),
    end_date: addDays(today, 290),
    interest_open_at: addDays(today, -30),
    interest_close_at: addDays(today, -5)
  });
  const dora = userService.createUser({ name: 'Dora', email: 'dora@t.local', password: 'x', apartment: '104' });
  db.prepare(`INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, 5, 19)`).run(q4.id, ana.id, court.id);
  db.prepare(`INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, 5, 19)`).run(q4.id, bruno.id, court.id);
  db.prepare(`INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, 5, 19)`).run(q4.id, dora.id, court.id);

  const result = drawService.runDraw(q4.id, { rng: (n) => { assert.equal(n, 3); return 2; } });
  const slot = result.slots[0];
  assert.equal(slot.eligible.length, 3);
  assert.equal(slot.randomRoll, 2);
  assert.equal(slot.winner.id, dora.id); // terceiro elegível (índice 2)

  const log = drawService.drawLogForQuarter(q4.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].winner_user_id, dora.id);
  assert.equal(log[0].candidates.length, 3);
});
