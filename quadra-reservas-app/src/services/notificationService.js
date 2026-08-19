const db = require('../db');

function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(userId, message);
}

function listForUser(userId, { onlyUnread = false } = {}) {
  const sql = onlyUnread
    ? 'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY id DESC'
    : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50';
  return db.prepare(sql).all(userId);
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c;
}

function markAllRead(userId) {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}

module.exports = { notify, listForUser, unreadCount, markAllRead };
