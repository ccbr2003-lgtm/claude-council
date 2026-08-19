const bcrypt = require('bcryptjs');
const db = require('../db');

class UserError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'user_error';
  }
}

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
}

function findById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function listResidents() {
  return db.prepare("SELECT * FROM users WHERE role = 'morador' ORDER BY name").all();
}

function listAll() {
  return db.prepare('SELECT * FROM users ORDER BY role DESC, name').all();
}

function createUser({ name, email, password, apartment, role = 'morador' }) {
  email = String(email).toLowerCase().trim();
  if (!name || !email || !password || !apartment) {
    throw new UserError('Nome, e-mail, apartamento e senha são obrigatórios.', 'missing_fields');
  }
  if (findByEmail(email)) {
    throw new UserError('Já existe um usuário com esse e-mail.', 'duplicate_email');
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (name, email, password_hash, apartment, role) VALUES (?, ?, ?, ?, ?)
  `).run(name, email, hash, apartment, role);
  return findById(info.lastInsertRowid);
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

function setActive(userId, active) {
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, userId);
}

function changePassword(userId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

module.exports = {
  UserError, findByEmail, findById, listResidents, listAll, createUser, verifyPassword, setActive, changePassword
};
