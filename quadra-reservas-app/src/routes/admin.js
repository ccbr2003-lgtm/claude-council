const express = require('express');
const userService = require('../services/userService');
const courtService = require('../services/courtService');
const settingsService = require('../services/settingsService');
const bookingService = require('../services/bookingService');
const quarterService = require('../services/quarterService');
const drawService = require('../services/drawService');

const router = express.Router();

router.get('/admin', (req, res) => {
  const residents = userService.listResidents();
  const courts = courtService.listCourts();
  const quarters = quarterService.listQuarters();
  const upcomingBookings = bookingService.listAllUpcoming().slice(0, 30);
  res.render('admin/index', { residents, courts, quarters, upcomingBookings });
});

// ---- Moradores ----
router.get('/admin/moradores', (req, res) => {
  res.render('admin/residents', {
    residents: userService.listResidents(),
    error: req.query.erro || null, ok: req.query.ok || null
  });
});

router.post('/admin/moradores', (req, res) => {
  const { name, email, apartment, password } = req.body;
  try {
    userService.createUser({ name, email, apartment, password: password || 'moradia123', role: 'morador' });
    res.redirect('/admin/moradores?ok=' + encodeURIComponent(`Morador criado. Senha inicial: ${password || 'moradia123'}`));
  } catch (err) {
    res.redirect('/admin/moradores?erro=' + encodeURIComponent(err.message));
  }
});

router.post('/admin/moradores/:id/desativar', (req, res) => {
  userService.setActive(Number(req.params.id), false);
  res.redirect('/admin/moradores?ok=' + encodeURIComponent('Morador desativado.'));
});

router.post('/admin/moradores/:id/ativar', (req, res) => {
  userService.setActive(Number(req.params.id), true);
  res.redirect('/admin/moradores?ok=' + encodeURIComponent('Morador reativado.'));
});

// ---- Configurações ----
router.get('/admin/config', (req, res) => {
  res.render('admin/config', { settings: settingsService.getAll(), error: req.query.erro || null, ok: req.query.ok || null });
});

router.post('/admin/config', (req, res) => {
  const fields = ['open_hour', 'close_hour', 'weekly_limit', 'booking_horizon_days', 'quarter_length_months', 'interest_open_days_before_start', 'interest_close_days_before_start'];
  const update = {};
  for (const f of fields) {
    if (req.body[f] !== undefined && req.body[f] !== '') update[f] = req.body[f];
  }
  settingsService.setMany(update);
  res.redirect('/admin/config?ok=' + encodeURIComponent('Configurações salvas.'));
});

// ---- Quadras ----
router.post('/admin/quadras', (req, res) => {
  if (req.body.name && req.body.name.trim()) courtService.createCourt(req.body.name.trim());
  res.redirect('/admin?ok=' + encodeURIComponent('Quadra adicionada.'));
});

// ---- Trimestres / sorteio ----
router.get('/admin/trimestres', (req, res) => {
  const suggestion = quarterService.suggestNextQuarterDates();
  res.render('admin/quarters', {
    quarters: quarterService.listQuarters(),
    suggestion,
    error: req.query.erro || null, ok: req.query.ok || null
  });
});

router.post('/admin/trimestres', (req, res) => {
  const { label, start_date, end_date, interest_open_at, interest_close_at } = req.body;
  try {
    quarterService.createQuarter({ label, start_date, end_date, interest_open_at, interest_close_at });
    res.redirect('/admin/trimestres?ok=' + encodeURIComponent('Trimestre criado.'));
  } catch (err) {
    res.redirect('/admin/trimestres?erro=' + encodeURIComponent(err.message));
  }
});

router.post('/admin/trimestres/:id/sorteio', (req, res) => {
  try {
    const result = drawService.runDraw(Number(req.params.id));
    res.redirect(`/sorteios/${result.quarter.id}?ok=` + encodeURIComponent('Sorteio realizado com sucesso.'));
  } catch (err) {
    res.redirect('/admin/trimestres?erro=' + encodeURIComponent(err.message));
  }
});

// ---- Reservas (visão geral / cancelamento administrativo) ----
router.get('/admin/reservas', (req, res) => {
  res.render('admin/bookings', { bookings: bookingService.listAllUpcoming(), error: req.query.erro || null, ok: req.query.ok || null });
});

router.post('/admin/reservas/:id/cancelar', (req, res) => {
  try {
    bookingService.cancelBooking(Number(req.params.id), { isAdmin: true, reason: req.body.motivo || 'Cancelado pela administração.' });
    res.redirect('/admin/reservas?ok=' + encodeURIComponent('Reserva cancelada.'));
  } catch (err) {
    res.redirect('/admin/reservas?erro=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
