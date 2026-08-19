// Conexao com o banco SQLite e definicao do schema.
// SQLite + better-sqlite3 = sincrono e single-threaded, o que evita
// naturalmente condicoes de corrida em disputas por horario (duas
// pessoas clicando no mesmo slot ao mesmo tempo): cada requisicao HTTP
// so acessa o banco depois de pegar sua vez no event loop, e cada
// escrita e imediata/sincrona, entao nao existe "leitura suja".
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'quadra.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  apartment TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'morador' CHECK(role IN ('morador','sindico')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quarters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  interest_open_at TEXT NOT NULL,
  interest_close_at TEXT NOT NULL,
  draw_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter_id INTEGER NOT NULL REFERENCES quarters(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  court_id INTEGER NOT NULL REFERENCES courts(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_hour INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(quarter_id, user_id, weekday, start_hour)
);

CREATE TABLE IF NOT EXISTS fixed_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter_id INTEGER NOT NULL REFERENCES quarters(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  court_id INTEGER NOT NULL REFERENCES courts(id),
  weekday INTEGER NOT NULL,
  start_hour INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('unico_interessado','sorteio')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(quarter_id, court_id, weekday, start_hour)
);

CREATE TABLE IF NOT EXISTS draw_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter_id INTEGER NOT NULL REFERENCES quarters(id),
  court_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  start_hour INTEGER NOT NULL,
  candidates_json TEXT NOT NULL,
  incumbent_user_id INTEGER,
  incumbent_excluded INTEGER NOT NULL DEFAULT 0,
  eligible_json TEXT NOT NULL,
  winner_user_id INTEGER,
  random_roll REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  court_id INTEGER NOT NULL REFERENCES courts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  start_hour INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('avulsa','fixa')),
  quarter_id INTEGER REFERENCES quarters(id),
  fixed_allocation_id INTEGER REFERENCES fixed_allocations(id),
  status TEXT NOT NULL DEFAULT 'confirmada' CHECK(status IN ('confirmada','cancelada')),
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Um horario so pode ter UMA reserva confirmada por quadra/data/hora.
-- Indice parcial: reservas canceladas nao contam, entao o slot volta a ficar livre.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_slot_active
  ON bookings(court_id, date, start_hour)
  WHERE status = 'confirmada';

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Configuracoes padrao (regras do condominio). Editaveis pelo sindico em /admin/config.
const DEFAULT_SETTINGS = {
  open_hour: '7',          // quadra abre 07:00
  close_hour: '22',        // ultimo horario reservavel comeca as 21:00 (bloco 21h-22h)
  weekly_limit: '2',       // reservas por morador por semana (avulsas + fixas somadas)
  booking_horizon_days: '14', // ate quantos dias a frente da pra reservar horario avulso
  quarter_length_months: '3',
  interest_open_days_before_start: '20',
  interest_close_days_before_start: '7'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const seedSettings = db.transaction((defaults) => {
  for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);
});
seedSettings(DEFAULT_SETTINGS);

// Garante que existe ao menos uma quadra cadastrada.
const courtCount = db.prepare('SELECT COUNT(*) AS c FROM courts').get().c;
if (courtCount === 0) {
  db.prepare('INSERT INTO courts (name) VALUES (?)').run('Quadra Poliesportiva');
}

module.exports = db;
