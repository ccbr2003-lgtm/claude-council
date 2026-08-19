const express = require('express');
const bookingService = require('../services/bookingService');
const courtService = require('../services/courtService');
const quarterService = require('../services/quarterService');
const drawService = require('../services/drawService');
const { WEEKDAY_SHORT } = require('../utils/dateHelpers');

const router = express.Router();

// Trimestre mais relevante para o morador manifestar interesse agora: o mais
// proximo cuja janela de interesse esteja aberta ou prestes a abrir.
function upcomingInterestQuarter() {
  const quarters = quarterService.listQuarters();
  return quarters.find(q => q.phase === 'interesse_aberto')
    || quarters.filter(q => q.phase === 'planejado').pop() // o mais antigo planejado
    || null;
}

router.get('/interesse', (req, res) => {
  const court = courtService.defaultCourt();
  const quarter = upcomingInterestQuarter();
  const { hours } = bookingService.operatingHours();
  const myInterests = quarter ? quarterService.interestsOfUser(quarter.id, req.user.id) : [];
  res.render('interest', {
    quarter, court, hours, weekdays: WEEKDAY_SHORT, myInterests,
    limit: bookingService.weeklyLimit(),
    error: req.query.erro || null, ok: req.query.ok || null
  });
});

router.post('/interesse', (req, res) => {
  const quarter = upcomingInterestQuarter();
  const courtId = Number(req.body.court_id);
  const weekday = Number(req.body.weekday);
  const hour = Number(req.body.hour);
  try {
    if (!quarter) throw new Error('Não há janela de interesse aberta no momento.');
    quarterService.submitInterest(quarter.id, req.user.id, courtId, weekday, hour);
    res.redirect('/interesse?ok=' + encodeURIComponent('Interesse registrado!'));
  } catch (err) {
    res.redirect('/interesse?erro=' + encodeURIComponent(err.message));
  }
});

router.post('/interesse/:id/remover', (req, res) => {
  const quarter = upcomingInterestQuarter();
  try {
    if (!quarter) throw new Error('Não há janela de interesse aberta no momento.');
    quarterService.withdrawInterest(quarter.id, req.user.id, Number(req.params.id));
    res.redirect('/interesse?ok=' + encodeURIComponent('Interesse removido.'));
  } catch (err) {
    res.redirect('/interesse?erro=' + encodeURIComponent(err.message));
  }
});

router.get('/sorteios', (req, res) => {
  const quarters = quarterService.listQuarters();
  res.render('draws-list', { quarters });
});

router.get('/sorteios/:quarterId', (req, res) => {
  const quarter = quarterService.getQuarter(Number(req.params.quarterId));
  if (!quarter) return res.status(404).render('error', { title: 'Não encontrado', message: 'Trimestre não encontrado.' });
  const log = quarter.draw_done ? drawService.drawLogForQuarter(quarter.id) : [];
  const allocations = quarter.draw_done ? quarterService.allocationsOfQuarter(quarter.id) : [];
  res.render('draw-detail', { quarter, log, allocations, currentUserId: req.user.id });
});

module.exports = router;
