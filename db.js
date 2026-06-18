const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'database.json');

// Initial state of the database
const defaultDb = {
  users: [
    // Pre-populate Aether AI user
    {
      id: 'aetherai',
      username: 'aetherai',
      passwordHash: 'AI_BOT_NO_PASSWORD',
      failedAttempts: 0,
      lockoutUntil: null,
      isBot: true
    }
  ],
  channels: [
    {
      id: 'general',
      name: 'general',
      type: 'channel',
      members: []
    },
    {
      id: 'announcements',
      name: 'announcements',
      type: 'channel',
      members: []
    }
  ],
  messages: [
    {
      id: 'welcome-msg',
      channelId: 'general',
      sender: { id: 'aetherai', username: 'aetherai' },
      content: "Welcome to Aether Chat! 🚀 Try talking to me here by typing my name, or click the + next to Direct Messages to start a private chat with me. Feel free to explore settings to customize your theme!",
      timestamp: Date.now()
    }
  ],
  sessions: []
};

// Read database from file
function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDb(defaultDb);
      return defaultDb;
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file:', err);
    return defaultDb;
  }
}

// Write database to file
function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing database file:', err);
  }
}

// Initialize Database
function initDb() {
  readDb();
}

// User functions
function getUserByUsername(username) {
  const db = readDb();
  return db.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
}

async function createUser(username, password) {
  const db = readDb();
  const normalized = username.toLowerCase().trim();
  
  if (db.users.find(u => u.username.toLowerCase() === normalized)) {
    throw new Error('Username already exists');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  
  const newUser = {
    id: crypto.randomUUID(),
    username: username.trim(),
    passwordHash: passwordHash,
    failedAttempts: 0,
    lockoutUntil: null,
    isBot: false
  };

  db.users.push(newUser);
  writeDb(db);
  return newUser;
}

function recordFailedLoginAttempt(username) {
  const db = readDb();
  const normalized = username.toLowerCase().trim();
  const user = db.users.find(u => u.username.toLowerCase() === normalized);
  if (!user || user.isBot) return null;

  user.failedAttempts = (user.failedAttempts || 0) + 1;
  if (user.failedAttempts >= 8) {
    // Lock account for 15 minutes
    user.lockoutUntil = Date.now() + 15 * 60 * 1000;
  }
  writeDb(db);
  return user;
}

function resetFailedAttempts(username) {
  const db = readDb();
  const normalized = username.toLowerCase().trim();
  const user = db.users.find(u => u.username.toLowerCase() === normalized);
  if (!user) return;

  user.failedAttempts = 0;
  user.lockoutUntil = null;
  writeDb(db);
}

// Session management
function createSession(userId, username, userAgent, ip) {
  const db = readDb();
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    userId,
    username,
    userAgent: userAgent || 'Unknown Device',
    ip: ip || '127.0.0.1',
    createdAt: Date.now()
  };
  db.sessions.push(session);
  writeDb(db);
  return session;
}

function getSession(token) {
  const db = readDb();
  return db.sessions.find(s => s.token === token);
}

function getUserSessions(userId) {
  const db = readDb();
  return db.sessions.filter(s => s.userId === userId);
}

function revokeSession(token, userId) {
  const db = readDb();
  const initialLength = db.sessions.length;
  db.sessions = db.sessions.filter(s => !(s.token === token && s.userId === userId));
  writeDb(db);
  return db.sessions.length < initialLength;
}

// Channel management
function getChannelsForUser(userId) {
  const db = readDb();
  return db.channels.filter(c => {
    if (c.type === 'channel') {
      return true; // All public channels are visible
    }
    // DM or private channel: check members
    return c.members && c.members.includes(userId);
  });
}

function createChannel(name, type, members = []) {
  const db = readDb();
  
  // Check if same type and members DM already exists
  if (type === 'dm') {
    const sortedMembers = [...members].sort();
    const existing = db.channels.find(c => {
      if (c.type !== 'dm') return false;
      const cMembers = [...c.members].sort();
      return JSON.stringify(cMembers) === JSON.stringify(sortedMembers);
    });
    if (existing) {
      return existing;
    }
  }

  const newChannel = {
    id: crypto.randomUUID(),
    name: name ? name.trim().replace(/\s+/g, '-').toLowerCase() : 'dm',
    type,
    members
  };

  db.channels.push(newChannel);
  writeDb(db);
  return newChannel;
}

function getChannel(channelId) {
  const db = readDb();
  return db.channels.find(c => c.id === channelId);
}

// Message management
function getMessages(channelId) {
  const db = readDb();
  return db.messages.filter(m => m.channelId === channelId);
}

function saveMessage(channelId, sender, content) {
  const db = readDb();
  const newMessage = {
    id: crypto.randomUUID(),
    channelId,
    sender: { id: sender.id, username: sender.username },
    content,
    timestamp: Date.now()
  };
  db.messages.push(newMessage);
  writeDb(db);
  return newMessage;
}

module.exports = {
  initDb,
  getUserByUsername,
  createUser,
  recordFailedLoginAttempt,
  resetFailedAttempts,
  createSession,
  getSession,
  getUserSessions,
  revokeSession,
  getChannelsForUser,
  createChannel,
  getChannel,
  getMessages,
  saveMessage
};
