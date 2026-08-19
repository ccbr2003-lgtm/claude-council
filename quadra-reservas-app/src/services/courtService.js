const db = require('../db');

function listCourts() {
  return db.prepare('SELECT * FROM courts ORDER BY id').all();
}

function getCourt(id) {
  return db.prepare('SELECT * FROM courts WHERE id = ?').get(id);
}

function createCourt(name) {
  const info = db.prepare('INSERT INTO courts (name) VALUES (?)').run(name);
  return getCourt(info.lastInsertRowid);
}

function defaultCourt() {
  return db.prepare('SELECT * FROM courts ORDER BY id LIMIT 1').get();
}

module.exports = { listCourts, getCourt, createCourt, defaultCourt };
