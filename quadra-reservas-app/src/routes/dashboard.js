const express = require('express');
const bookingService = require('../services/bookingService');
const courtService = require('../services/courtService');
const quarterService = require('../services/quarterService');
const notificationService = require('../services/notificationService');
const { todayISO, addDays, weekdayName, weekdayOf } = require('../utils/dateHelpers');

const router = express.Router();

function pickCourt(req) {
  const courts = courtService.listCourts();
  const requested = req.query.quadra ? Number(req.query.quadra) : null;
  return courts.find(c => c.id === requested) || courts[0];
}

router.get('/', (req, res) => {
  const courts = courtService.listCourts();
  const court = pickCourt(req);
  const startDate = req.query.data && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data) ? req.query.data : todayISO();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    days.push({
      date,
      weekday_name: weekdayName(weekdayOf(date)),
      slots: bookingService.dayAvailability(court.id, date)
    });
  }
  const used = bookingService.weeklyUsage(req.user.id, startDate);
  const limit = bookingService.weeklyLimit();
  const q = quarterService.currentQuarter();

  res.render('dashboard', {
    courts, court, days, startDate,
    weeklyUsed: used, weeklyLimit: limit,
    currentQuarter: q,
    horizonEnd: bookingService.bookingHorizonEnd(),
    prevStart: addDays(startDate, -7),
    nextStart: addDays(startDate, 7),
    today: todayISO(),
    error: req.query.erro || null,
    ok: req.query.ok || null
  });
});

router.post('/reservas', (req, res) => {
  const courtId = Number(req.body.court_id);
  const { date } = req.body;
  const hour = Number(req.body.hour);
  try {
    bookingService.createAvulsaBooking(req.user.id, courtId, date, hour);
    res.redirect(`/?quadra=${courtId}&data=${date}&ok=` + encodeURIComponent('Horário reservado com sucesso!'));
  } catch (err) {
    res.redirect(`/?quadra=${courtId}&data=${date}&erro=` + encodeURIComponent(err.message));
  }
});

router.get('/minhas-reservas', (req, res) => {
  const bookings = bookingService.listUpcomingForUser(req.user.id);
  const fixedAllocations = quarterService.activeFixedAllocationsForUser(req.user.id);
  res.render('my-bookings', { bookings, fixedAllocations, error: req.query.erro || null, ok: req.query.ok || null });
});

router.post('/reservas/:id/cancelar', (req, res) => {
  try {
    bookingService.cancelBooking(Number(req.params.id), { byUserId: req.user.id });
    res.redirect('/minhas-reservas?ok=' + encodeURIComponent('Reserva cancelada.'));
  } catch (err) {
    res.redirect('/minhas-reservas?erro=' + encodeURIComponent(err.message));
  }
});

router.get('/notificacoes', (req, res) => {
  const list = notificationService.listForUser(req.user.id);
  notificationService.markAllRead(req.user.id);
  res.render('notifications', { notifications: list });
});

module.exports = router;
