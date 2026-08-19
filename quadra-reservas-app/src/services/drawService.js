// O sorteio (draw) e o coracao da parte "justa" do sistema: substitui o
// "quem chega primeiro na portaria" por um processo auditavel.
//
// Regras aplicadas aqui, na ordem:
//  1. Um horario com 1 unico interessado -> concedido direto (sem sorteio).
//  2. Um horario com 2+ interessados, onde um deles e o TITULAR atual (quem
//     ficou com esse exato horario/dia da semana no trimestre que esta
//     terminando) -> o titular e EXCLUIDO da disputa por aquele horario
//     especifico (regra explicita do sindico: nao pode renovar automatico se
//     tem outro morador interessado). O titular continua concorrendo
//     normalmente aos OUTROS horarios que ele pediu.
//  3. Entre os elegiveis restantes, sorteio aleatorio uniforme (crypto-random,
//     nao Math.random) - cada participante tem a mesma probabilidade.
//  4. Tudo fica registrado em draw_log: quem concorreu, quem foi excluido e
//     por que, quem ganhou e o "numero sorteado" - para o sindico (e qualquer
//     morador) poder auditar depois que nao houve manipulação.
const crypto = require('crypto');
const db = require('../db');
const quarterService = require('./quarterService');
const notificationService = require('./notificationService');
const { datesForWeekdayInRange, weekdayName } = require('../utils/dateHelpers');

class DrawError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'draw_error';
  }
}

function groupInterests(interests) {
  const groups = new Map();
  for (const it of interests) {
    const key = `${it.court_id}|${it.weekday}|${it.start_hour}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return groups;
}

function buildIncumbentIndex(prevQuarterId) {
  const idx = new Map();
  if (!prevQuarterId) return idx;
  const rows = db.prepare('SELECT * FROM fixed_allocations WHERE quarter_id = ?').all(prevQuarterId);
  for (const r of rows) idx.set(`${r.court_id}|${r.weekday}|${r.start_hour}`, r.user_id);
  return idx;
}

// Materializa as reservas concretas (uma linha em `bookings` por ocorrencia
// semanal) para um horario fixo recem-sorteado, ao longo de todo o trimestre.
// Se por acaso ja existir uma reserva avulsa conflitante numa dessas datas
// (possivel só perto do inicio do trimestre, dentro do horizonte de reserva
// avulsa), ela e cancelada e o morador afetado e avisado.
function materializeFixedBookings({ quarter, courtId, weekday, startHour, userId, fixedAllocationId }) {
  const dates = datesForWeekdayInRange(quarter.start_date, quarter.end_date, weekday);
  const insertBooking = db.prepare(`
    INSERT INTO bookings (court_id, user_id, date, start_hour, type, quarter_id, fixed_allocation_id, status)
    VALUES (?, ?, ?, ?, 'fixa', ?, ?, 'confirmada')
  `);
  const findConflict = db.prepare(`
    SELECT * FROM bookings WHERE court_id = ? AND date = ? AND start_hour = ? AND status = 'confirmada'
  `);
  const cancelBooking = db.prepare(`UPDATE bookings SET status = 'cancelada', cancel_reason = ? WHERE id = ?`);

  for (const date of dates) {
    const conflict = findConflict.get(courtId, date, startHour);
    if (conflict) {
      if (conflict.user_id === userId) continue; // já é dele mesmo (não deveria acontecer, mas é inofensivo)
      cancelBooking.run('Horário concedido a outro morador pelo sorteio do horário fixo do trimestre.', conflict.id);
      notificationService.notify(
        conflict.user_id,
        `Sua reserva avulsa de ${date} às ${startHour}h foi cancelada: esse horário foi sorteado como fixo para outro morador neste trimestre. Pedimos desculpas pelo transtorno.`
      );
    }
    insertBooking.run(courtId, userId, date, startHour, quarter.id, fixedAllocationId);
  }
}

// rng(n) deve devolver um inteiro aleatorio uniforme em [0, n).
// Por padrao usa crypto.randomInt (criptograficamente forte, nao apenas Math.random).
function defaultRng(n) {
  return crypto.randomInt(n);
}

function runDraw(quarterId, { rng = defaultRng } = {}) {
  const quarter = quarterService.getQuarter(quarterId);
  if (!quarter) throw new DrawError('Trimestre não encontrado.', 'not_found');
  if (quarter.draw_done) throw new DrawError('O sorteio deste trimestre já foi realizado.', 'already_done');
  if (quarter.phase === 'planejado' || quarter.phase === 'interesse_aberto') {
    throw new DrawError(`A janela de interesse ainda não fechou (fase atual: ${quarter.phase_label}).`, 'window_open');
  }

  const prevQuarter = quarterService.previousQuarter(quarter);
  const incumbentIndex = buildIncumbentIndex(prevQuarter ? prevQuarter.id : null);
  const interests = quarterService.allInterests(quarterId);
  const groups = groupInterests(interests);

  const results = [];

  const tx = db.transaction(() => {
    for (const [key, group] of groups) {
      const [courtIdStr, weekdayStr, hourStr] = key.split('|');
      const courtId = Number(courtIdStr), weekday = Number(weekdayStr), startHour = Number(hourStr);

      // candidatos unicos, na ordem em que manifestaram interesse
      const seen = new Set();
      const candidates = [];
      for (const it of group) {
        if (!seen.has(it.user_id)) { seen.add(it.user_id); candidates.push({ id: it.user_id, name: it.user_name, apartment: it.apartment }); }
      }

      const incumbentUserId = incumbentIndex.get(key) || null;
      let eligible = candidates;
      let incumbentExcluded = false;
      if (incumbentUserId && candidates.length > 1 && candidates.some(c => c.id === incumbentUserId)) {
        eligible = candidates.filter(c => c.id !== incumbentUserId);
        incumbentExcluded = true;
      }

      const method = candidates.length > 1 ? 'sorteio' : 'unico_interessado';

      let winner, randomRoll = null;
      if (eligible.length === 1) {
        winner = eligible[0];
      } else {
        const roll = rng(eligible.length);
        randomRoll = roll;
        winner = eligible[roll];
      }

      db.prepare(`
        INSERT INTO draw_log (quarter_id, court_id, weekday, start_hour, candidates_json, incumbent_user_id, incumbent_excluded, eligible_json, winner_user_id, random_roll)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        quarterId, courtId, weekday, startHour,
        JSON.stringify(candidates), incumbentUserId, incumbentExcluded ? 1 : 0,
        JSON.stringify(eligible), winner.id, randomRoll
      );

      const allocInfo = db.prepare(`
        INSERT INTO fixed_allocations (quarter_id, user_id, court_id, weekday, start_hour, method)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(quarterId, winner.id, courtId, weekday, startHour, method);

      materializeFixedBookings({
        quarter, courtId, weekday, startHour, userId: winner.id, fixedAllocationId: allocInfo.lastInsertRowid
      });

      const wdName = weekdayName(weekday);
      notificationService.notify(
        winner.id,
        `Você foi contemplado com o horário fixo de ${wdName} às ${startHour}h para o trimestre "${quarter.label}"` +
        (method === 'sorteio' ? ' (sorteio entre os interessados).' : '.')
      );
      for (const c of candidates) {
        if (c.id === winner.id) continue;
        const isIncumbent = c.id === incumbentUserId;
        const msg = isIncumbent
          ? `Seu horário fixo de ${wdName} às ${startHour}h não foi renovado neste trimestre "${quarter.label}": como havia outro morador interessado no mesmo horário, ele entrou no rodízio e você não concorreu a ele novamente (regra de rodízio justo). Você pode reservar esse horário como avulso quando estiver livre, ou concorrer a outro horário fixo no próximo trimestre.`
          : `Você não foi sorteado para o horário fixo de ${wdName} às ${startHour}h no trimestre "${quarter.label}". Você pode reservar horários avulsos normalmente e concorrer novamente no próximo trimestre.`;
        notificationService.notify(c.id, msg);
      }

      results.push({ courtId, weekday, weekday_name: wdName, startHour, candidates, incumbentUserId, incumbentExcluded, eligible, winner, method, randomRoll });
    }

    db.prepare('UPDATE quarters SET draw_done = 1 WHERE id = ?').run(quarterId);
  });

  tx();

  return { quarter: quarterService.getQuarter(quarterId), slots: results };
}

function drawLogForQuarter(quarterId) {
  const rows = db.prepare('SELECT * FROM draw_log WHERE quarter_id = ? ORDER BY weekday, start_hour').all(quarterId);
  return rows.map(r => ({
    ...r,
    candidates: JSON.parse(r.candidates_json),
    eligible: JSON.parse(r.eligible_json),
    weekday_name: weekdayName(r.weekday)
  }));
}

module.exports = { DrawError, runDraw, drawLogForQuarter };
