// Regras de reserva "avulsa" (nao-fixa): bloco de 1 hora cheia, limite semanal
// por morador, sem sobreposicao. A reserva de horario FIXO (trimestral) vive em
// quarterService/drawService - aqui so tratamos do agendamento avulso do dia a dia
// e das operacoes comuns a qualquer reserva (listar, cancelar).
const db = require('../db');
const settings = require('./settingsService');
const { todayISO, addDays, isoWeekKey, weekdayOf } = require('../utils/dateHelpers');

class BookingError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'booking_error';
  }
}

function operatingHours() {
  const open = settings.getInt('open_hour');
  const close = settings.getInt('close_hour'); // ultimo bloco reservavel = close-1 .. close
  const hours = [];
  for (let h = open; h < close; h++) hours.push(h);
  return { open, close, hours };
}

function assertValidHour(startHour) {
  const { hours } = operatingHours();
  // So aceita hora cheia dentro do funcionamento da quadra - nao existe
  // "11h30" ou "meio-dia e meia" porque start_hour e sempre um inteiro.
  if (!Number.isInteger(startHour) || !hours.includes(startHour)) {
    throw new BookingError(
      `Horário inválido. A quadra só pode ser reservada em blocos de 1 hora cheia, entre ${operatingHours().open}h e ${operatingHours().close}h.`,
      'invalid_hour'
    );
  }
}

function weeklyLimit() {
  return settings.getInt('weekly_limit');
}

// Conta quantas reservas confirmadas (avulsas + fixas, em qualquer quadra) o
// morador ja tem na semana ISO da data informada.
function weeklyUsage(userId, dateISO, excludeBookingId = null) {
  const wk = isoWeekKey(dateISO);
  const rows = db.prepare(`
    SELECT date FROM bookings
    WHERE user_id = ? AND status = 'confirmada'
      AND (? IS NULL OR id != ?)
  `).all(userId, excludeBookingId, excludeBookingId);
  return rows.filter(r => isoWeekKey(r.date) === wk).length;
}

function isSlotTaken(courtId, dateISO, startHour) {
  const row = db.prepare(`
    SELECT id FROM bookings WHERE court_id = ? AND date = ? AND start_hour = ? AND status = 'confirmada'
  `).get(courtId, dateISO, startHour);
  return !!row;
}

function bookingHorizonEnd() {
  return addDays(todayISO(), settings.getInt('booking_horizon_days'));
}

function assertWithinHorizon(dateISO) {
  const today = todayISO();
  if (dateISO < today) {
    throw new BookingError('Não é possível reservar uma data no passado.', 'past_date');
  }
  if (dateISO > bookingHorizonEnd()) {
    throw new BookingError(
      `Reservas avulsas só podem ser feitas com até ${settings.getInt('booking_horizon_days')} dias de antecedência.`,
      'out_of_horizon'
    );
  }
}

// Reserva avulsa criada pelo proprio morador pelo app - substitui o "quem
// chega primeiro na portaria": todo mundo enxerga a mesma grade de horarios
// no app, no mesmo instante, e o SQLite (sincrono) resolve empates de forma
// atomica em vez de depender de quem chegou fisicamente primeiro na guarita.
function createAvulsaBooking(userId, courtId, dateISO, startHour) {
  assertValidHour(startHour);
  assertWithinHorizon(dateISO);

  if (isSlotTaken(courtId, dateISO, startHour)) {
    throw new BookingError('Esse horário acabou de ser reservado por outro morador. Escolha outro horário.', 'slot_taken');
  }

  const limit = weeklyLimit();
  const used = weeklyUsage(userId, dateISO);
  if (used >= limit) {
    throw new BookingError(
      `Você já atingiu o limite de ${limit} reservas nesta semana (contando horários fixos e avulsos).`,
      'weekly_limit'
    );
  }

  try {
    const info = db.prepare(`
      INSERT INTO bookings (court_id, user_id, date, start_hour, type, status)
      VALUES (?, ?, ?, ?, 'avulsa', 'confirmada')
    `).run(courtId, userId, dateISO, startHour);
    return info.lastInsertRowid;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw new BookingError('Esse horário acabou de ser reservado por outro morador. Escolha outro horário.', 'slot_taken');
    }
    throw err;
  }
}

function cancelBooking(bookingId, { byUserId = null, isAdmin = false, reason = null } = {}) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) throw new BookingError('Reserva não encontrada.', 'not_found');
  if (booking.status === 'cancelada') return booking;
  if (!isAdmin && booking.user_id !== byUserId) {
    throw new BookingError('Você só pode cancelar suas próprias reservas.', 'forbidden');
  }
  db.prepare(`UPDATE bookings SET status = 'cancelada', cancel_reason = ? WHERE id = ?`).run(reason, bookingId);
  return { ...booking, status: 'cancelada' };
}

// Grade de disponibilidade de um dia: para cada hora do funcionamento,
// devolve se esta livre ou ocupado (e por quem, se for admin/dono da reserva).
function dayAvailability(courtId, dateISO) {
  const { hours } = operatingHours();
  const bookings = db.prepare(`
    SELECT b.*, u.name AS user_name, u.apartment
    FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.court_id = ? AND b.date = ? AND b.status = 'confirmada'
  `).all(courtId, dateISO);
  const byHour = new Map(bookings.map(b => [b.start_hour, b]));
  return hours.map(h => ({
    hour: h,
    weekday: weekdayOf(dateISO),
    booking: byHour.get(h) || null
  }));
}

function listUpcomingForUser(userId) {
  return db.prepare(`
    SELECT b.*, c.name AS court_name
    FROM bookings b JOIN courts c ON c.id = b.court_id
    WHERE b.user_id = ? AND b.status = 'confirmada' AND b.date >= ?
    ORDER BY b.date ASC, b.start_hour ASC
  `).all(userId, todayISO());
}

function listAllUpcoming({ fromDate = null, toDate = null } = {}) {
  const from = fromDate || todayISO();
  const params = [from];
  let sql = `
    SELECT b.*, u.name AS user_name, u.apartment, c.name AS court_name
    FROM bookings b JOIN users u ON u.id = b.user_id JOIN courts c ON c.id = b.court_id
    WHERE b.status = 'confirmada' AND b.date >= ?
  `;
  if (toDate) { sql += ' AND b.date <= ?'; params.push(toDate); }
  sql += ' ORDER BY b.date ASC, b.start_hour ASC';
  return db.prepare(sql).all(...params);
}

module.exports = {
  BookingError,
  operatingHours,
  assertValidHour,
  weeklyLimit,
  weeklyUsage,
  isSlotTaken,
  bookingHorizonEnd,
  assertWithinHorizon,
  createAvulsaBooking,
  cancelBooking,
  dayAvailability,
  listUpcomingForUser,
  listAllUpcoming
};
