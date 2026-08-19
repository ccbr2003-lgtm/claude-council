// Ciclo trimestral dos horarios fixos: criacao do trimestre, janela de
// manifestacao de interesse e consulta de fase atual. O sorteio em si mora
// em drawService.js (mantido separado por ser a parte mais sensivel/auditavel).
const db = require('../db');
const settings = require('./settingsService');
const bookingService = require('./bookingService');
const {
  addDays, addMonths, todayISO, nowISO, weekdayName, isBeforeOrEqual
} = require('../utils/dateHelpers');

class QuarterError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'quarter_error';
  }
}

// Fases possiveis de um trimestre, na ordem em que acontecem:
// planejado -> interesse_aberto -> aguardando_sorteio -> sorteio_realizado -> ativo -> encerrado
function phaseOf(quarter, now = nowISO()) {
  const today = now.slice(0, 10);
  if (today < quarter.interest_open_at) return 'planejado';
  if (today < quarter.interest_close_at) return 'interesse_aberto';
  if (!quarter.draw_done) return 'aguardando_sorteio';
  if (today < quarter.start_date) return 'sorteio_realizado';
  if (today <= quarter.end_date) return 'ativo';
  return 'encerrado';
}

const PHASE_LABELS = {
  planejado: 'Planejado',
  interesse_aberto: 'Janela de interesse aberta',
  aguardando_sorteio: 'Interesse encerrado - aguardando sorteio',
  sorteio_realizado: 'Sorteio realizado - trimestre ainda não começou',
  ativo: 'Em andamento',
  encerrado: 'Encerrado'
};

function withPhase(quarter) {
  if (!quarter) return quarter;
  const phase = phaseOf(quarter);
  return { ...quarter, phase, phase_label: PHASE_LABELS[phase] };
}

function getQuarter(id) {
  return withPhase(db.prepare('SELECT * FROM quarters WHERE id = ?').get(id));
}

function listQuarters() {
  return db.prepare('SELECT * FROM quarters ORDER BY start_date DESC').all().map(withPhase);
}

function currentQuarter() {
  const today = todayISO();
  const q = db.prepare('SELECT * FROM quarters WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1').get(today, today);
  return withPhase(q);
}

// Trimestre mais recente que ja terminou antes do trimestre dado - usado pelo
// sorteio pra descobrir quem era o "titular" de cada horario fixo.
function previousQuarter(quarter) {
  const q = db.prepare('SELECT * FROM quarters WHERE end_date < ? ORDER BY end_date DESC LIMIT 1').get(quarter.start_date);
  return withPhase(q);
}

// Sugestao de datas para o "proximo" trimestre a ser criado, encadeado a
// partir do ultimo trimestre cadastrado (ou a partir de hoje, se for o primeiro).
function suggestNextQuarterDates() {
  const last = db.prepare('SELECT * FROM quarters ORDER BY end_date DESC LIMIT 1').get();
  const months = settings.getInt('quarter_length_months');
  const openBefore = settings.getInt('interest_open_days_before_start');
  const closeBefore = settings.getInt('interest_close_days_before_start');

  // Se já existe um trimestre anterior, encadeia a partir do fim dele. Se for
  // o primeiro trimestre cadastrado, empurra o início pra frente o suficiente
  // pra a janela de interesse (que fica ANTES do início) caber a partir de hoje.
  const start_date = last ? addDays(last.end_date, 1) : addDays(todayISO(), openBefore);
  const end_date = addDays(addMonths(start_date, months), -1);
  const interest_open_at = addDays(start_date, -openBefore);
  const interest_close_at = addDays(start_date, -closeBefore);
  return { start_date, end_date, interest_open_at, interest_close_at };
}

function createQuarter({ label, start_date, end_date, interest_open_at, interest_close_at }) {
  if (!(interest_open_at < interest_close_at && interest_close_at <= start_date && start_date < end_date)) {
    throw new QuarterError(
      'Datas inconsistentes: abertura de interesse < fechamento de interesse <= início do trimestre < fim do trimestre.',
      'invalid_dates'
    );
  }
  const info = db.prepare(`
    INSERT INTO quarters (label, start_date, end_date, interest_open_at, interest_close_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(label, start_date, end_date, interest_open_at, interest_close_at);
  return getQuarter(info.lastInsertRowid);
}

// Interesses ja registrados por um morador para um trimestre (max = limite semanal).
function interestsOfUser(quarterId, userId) {
  return db.prepare('SELECT * FROM interests WHERE quarter_id = ? AND user_id = ? ORDER BY weekday, start_hour').all(quarterId, userId);
}

function allInterests(quarterId) {
  return db.prepare(`
    SELECT i.*, u.name AS user_name, u.apartment
    FROM interests i JOIN users u ON u.id = i.user_id
    WHERE i.quarter_id = ?
    ORDER BY i.weekday, i.start_hour
  `).all(quarterId);
}

function submitInterest(quarterId, userId, courtId, weekday, startHour) {
  const quarter = getQuarter(quarterId);
  if (!quarter) throw new QuarterError('Trimestre não encontrado.', 'not_found');
  if (quarter.phase !== 'interesse_aberto') {
    throw new QuarterError(
      `A janela de manifestação de interesse deste trimestre não está aberta agora (fase atual: ${quarter.phase_label}).`,
      'window_closed'
    );
  }
  bookingService.assertValidHour(startHour);
  if (weekday < 0 || weekday > 6) throw new QuarterError('Dia da semana inválido.', 'invalid_weekday');

  const limit = settings.getInt('weekly_limit');
  const existing = interestsOfUser(quarterId, userId);
  const already = existing.some(i => i.weekday === weekday && i.start_hour === startHour);
  if (already) throw new QuarterError('Você já manifestou interesse nesse horário.', 'duplicate');
  if (existing.length >= limit) {
    throw new QuarterError(
      `Cada morador pode fixar no máximo ${limit} horários por trimestre (mesma regra do limite semanal).`,
      'limit_reached'
    );
  }

  db.prepare(`
    INSERT INTO interests (quarter_id, user_id, court_id, weekday, start_hour) VALUES (?, ?, ?, ?, ?)
  `).run(quarterId, userId, courtId, weekday, startHour);
}

function withdrawInterest(quarterId, userId, interestId) {
  const quarter = getQuarter(quarterId);
  if (quarter.phase !== 'interesse_aberto') {
    throw new QuarterError('A janela de interesse já fechou, não é mais possível alterar.', 'window_closed');
  }
  db.prepare('DELETE FROM interests WHERE id = ? AND quarter_id = ? AND user_id = ?').run(interestId, quarterId, userId);
}

// Horarios fixos vigentes de um morador (do trimestre ATUAL).
function activeFixedAllocationsForUser(userId) {
  const q = currentQuarter();
  if (!q) return [];
  return db.prepare(`
    SELECT fa.*, c.name AS court_name FROM fixed_allocations fa JOIN courts c ON c.id = fa.court_id
    WHERE fa.quarter_id = ? AND fa.user_id = ?
    ORDER BY fa.weekday, fa.start_hour
  `).all(q.id, userId).map(fa => ({ ...fa, weekday_name: weekdayName(fa.weekday) }));
}

function allocationsOfQuarter(quarterId) {
  return db.prepare(`
    SELECT fa.*, u.name AS user_name, u.apartment
    FROM fixed_allocations fa JOIN users u ON u.id = fa.user_id
    WHERE fa.quarter_id = ?
    ORDER BY fa.weekday, fa.start_hour
  `).all(quarterId).map(fa => ({ ...fa, weekday_name: weekdayName(fa.weekday) }));
}

module.exports = {
  QuarterError,
  phaseOf,
  PHASE_LABELS,
  withPhase,
  getQuarter,
  listQuarters,
  currentQuarter,
  previousQuarter,
  suggestNextQuarterDates,
  createQuarter,
  interestsOfUser,
  allInterests,
  submitInterest,
  withdrawInterest,
  activeFixedAllocationsForUser,
  allocationsOfQuarter
};
