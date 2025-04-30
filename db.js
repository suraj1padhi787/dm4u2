// db.js
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'chat.db'));

// Init table
db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    receiver TEXT,
    content TEXT,
    type TEXT,
    time TEXT,
    seen INTEGER,
    replyTo TEXT
  )
`).run();

function insertMessage(sender, receiver, content, type = 'text', replyTo = null) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const stmt = db.prepare(`
    INSERT INTO messages (sender, receiver, content, type, time, seen, replyTo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(sender, receiver, content, type, time, 0, replyTo);
  return result.lastInsertRowid;
}

function fetchConversation(sender, receiver, callback) {
  const stmt = db.prepare(`
    SELECT * FROM messages WHERE 
    (sender = ? AND receiver = ?) OR 
    (sender = ? AND receiver = ?)
    ORDER BY id ASC
  `);
  const messages = stmt.all(sender, receiver, receiver, sender);
  callback(messages);
}

function markMessagesAsSeen(sender, receiver) {
  db.prepare(`
    UPDATE messages SET seen = 1 WHERE sender = ? AND receiver = ? AND seen = 0
  `).run(sender, receiver);
}

function deleteMessageById(id) {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
}

function updateMessageById(id, newContent) {
  db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(newContent + " (edited)", id);
}

module.exports = {
  insertMessage,
  fetchConversation,
  markMessagesAsSeen,
  deleteMessageById,
  updateMessageById
};
