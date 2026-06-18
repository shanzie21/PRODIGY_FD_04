const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const { generateAIResponse } = require('./services/ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Initialize DB
db.initDb();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. No token provided.' });
  }
  const token = authHeader.split(' ')[1];
  const session = db.getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
  }
  req.user = { id: session.userId, username: session.username, token };
  next();
}

// REST API Endpoints

// Auth Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }
  if (username.toLowerCase().trim() === 'aetherai') {
    return res.status(400).json({ error: 'The username "aetherai" is reserved.' });
  }

  try {
    const user = await db.createUser(username, password);
    // Auto-create session on registration
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.socket.remoteAddress;
    const session = db.createSession(user.id, user.username, userAgent, ip);
    return res.status(201).json({
      message: 'User registered successfully',
      token: session.token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Auth Login (incorporates failed attempts & lockout)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.getUserByUsername(username);
  if (!user || user.isBot) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Check Lockout
  if (user.lockoutUntil && user.lockoutUntil > Date.now()) {
    const timeLeftMs = user.lockoutUntil - Date.now();
    const timeLeftMin = Math.ceil(timeLeftMs / 60000);
    return res.status(403).json({
      error: `Account is temporarily locked due to 8 failed login attempts. Try again in ${timeLeftMin} minute(s).`
    });
  }

  // Validate Password
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    const updatedUser = db.recordFailedLoginAttempt(username);
    const attemptsRemaining = 8 - updatedUser.failedAttempts;
    if (attemptsRemaining <= 0) {
      return res.status(403).json({
        error: 'Too many failed attempts. Account has been temporarily locked for 15 minutes.'
      });
    } else {
      return res.status(401).json({
        error: `Invalid password. ${attemptsRemaining} login attempt(s) remaining.`
      });
    }
  }

  // Success: reset attempts & create session
  db.resetFailedAttempts(username);
  const userAgent = req.headers['user-agent'];
  const ip = req.ip || req.socket.remoteAddress;
  const session = db.createSession(user.id, user.username, userAgent, ip);

  return res.json({
    message: 'Logged in successfully',
    token: session.token,
    user: { id: user.id, username: user.username }
  });
});

// Auth Logout
app.post('/api/auth/logout', authenticate, (req, res) => {
  db.revokeSession(req.user.token, req.user.id);
  res.json({ message: 'Logged out successfully' });
});

// Get Active Sessions
app.get('/api/sessions', authenticate, (req, res) => {
  const sessions = db.getUserSessions(req.user.id);
  // Map sessions to hide actual tokens (only show truncated/boolean for current)
  const mapped = sessions.map(s => ({
    id: s.token,
    isCurrent: s.token === req.user.token,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt
  }));
  res.json(mapped);
});

// Revoke Session
app.post('/api/sessions/revoke', authenticate, (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const success = db.revokeSession(token, req.user.id);
  if (success) {
    // Notify the revoked connection if active
    wss.clients.forEach(client => {
      if (client.sessionToken === token) {
        client.send(JSON.stringify({ type: 'session_revoked' }));
        client.close();
      }
    });
    return res.json({ message: 'Session revoked successfully' });
  }
  return res.status(400).json({ error: 'Failed to revoke session. Not found or unauthorized.' });
});

// Get Channels
app.get('/api/channels', authenticate, (req, res) => {
  const channels = db.getChannelsForUser(req.user.id);
  res.json(channels);
});

// Create Channel/DM
app.post('/api/channels', authenticate, (req, res) => {
  const { name, type, members } = req.body;
  
  if (type !== 'channel' && type !== 'dm') {
    return res.status(400).json({ error: 'Invalid channel type.' });
  }

  if (type === 'channel') {
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Channel name is required.' });
    }
    const newChan = db.createChannel(name, 'channel', []);
    // Notify all active users of the new channel
    broadcastToAll({ type: 'channel_created', channel: newChan });
    return res.status(201).json(newChan);
  } else {
    // DM
    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'DM members are required.' });
    }
    // Make sure current user is in the members list
    const dmMembers = Array.from(new Set([...members, req.user.id]));
    
    // Auto-resolve user names for display if it's a DM (e.g. "user1, user2")
    const newChan = db.createChannel(null, 'dm', dmMembers);
    
    // Notify dm members of new DM channel
    broadcastToUsers(dmMembers, { type: 'channel_created', channel: newChan });
    return res.status(201).json(newChan);
  }
});

// Get Messages
app.get('/api/channels/:id/messages', authenticate, (req, res) => {
  const channel = db.getChannel(req.params.id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found.' });
  }

  // If DM, check if user is member
  if (channel.type === 'dm' && !channel.members.includes(req.user.id)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const messages = db.getMessages(req.params.id);
  res.json(messages);
});

// Post Message
app.post('/api/channels/:id/messages', authenticate, async (req, res) => {
  const channelId = req.params.id;
  const { content } = req.body;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Message content is required.' });
  }

  const channel = db.getChannel(channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found.' });
  }

  // Check access for DM
  if (channel.type === 'dm' && !channel.members.includes(req.user.id)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  // Save and broadcast user message
  const msg = db.saveMessage(channelId, req.user, content);
  broadcastToChannel(channel, { type: 'message', message: msg });
  res.status(201).json(msg);

  // Check if AI should reply
  const isDmWithAi = channel.type === 'dm' && channel.members.includes('aetherai');
  const mentionsAi = channel.type === 'channel' && (
    content.toLowerCase().includes('aetherai') || 
    content.includes('@aetherai')
  );

  if (isDmWithAi || mentionsAi) {
    handleAiResponse(channel, content);
  }
});

// User Search (for creating DMs)
app.get('/api/users', authenticate, (req, res) => {
  const dbInst = db.getUserByUsername; // trigger readDb
  const users = require('./db').getUserByUsername ? require('./db').getUserSessions : []; // trick to read database simply
  // Let's do it cleanly: read database
  const fs = require('fs');
  const DB_PATH = path.join(__dirname, 'database.json');
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    // Filter out bots and current user, return simple mappings
    const activeUsers = data.users
      .filter(u => u.id !== req.user.id)
      .map(u => ({ id: u.id, username: u.username, isBot: u.isBot || false }));
    res.json(activeUsers);
  } catch (err) {
    res.json([]);
  }
});

// Handle AI response generation asynchronously
async function handleAiResponse(channel, promptText) {
  const channelId = channel.id;

  // 1. Broadcast typing indicator for AI
  broadcastToChannel(channel, {
    type: 'typing',
    typingUser: { id: 'aetherai', username: 'aetherai' },
    channelId,
    isTyping: true
  });

  // Get message history in the channel (last 6 messages for context)
  const allMessages = db.getMessages(channelId);
  const history = allMessages.slice(-6);

  try {
    // Add artificial short delay to simulate natural human typing response
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500));

    // Generate response
    const replyText = await generateAIResponse(promptText, history);

    // Save and broadcast bot message
    const botMsg = db.saveMessage(channelId, { id: 'aetherai', username: 'aetherai' }, replyText);
    
    // Stop typing indicator and send message
    broadcastToChannel(channel, {
      type: 'typing',
      typingUser: { id: 'aetherai', username: 'aetherai' },
      channelId,
      isTyping: false
    });
    broadcastToChannel(channel, { type: 'message', message: botMsg });
  } catch (err) {
    console.error('Error in AI response loop:', err);
    broadcastToChannel(channel, {
      type: 'typing',
      typingUser: { id: 'aetherai', username: 'aetherai' },
      channelId,
      isTyping: false
    });
  }
}

// WebSocket Connection Handling
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const session = db.getSession(token);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.userId = session.userId;
    ws.username = session.username;
    ws.sessionToken = token;
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  // console.log(`WebSocket connected: ${ws.username} (${ws.userId})`);

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      
      // Handle typing event broadcast
      if (data.type === 'typing') {
        const channel = db.getChannel(data.channelId);
        if (channel) {
          // If DM, make sure sender is part of it
          if (channel.type === 'dm' && !channel.members.includes(ws.userId)) return;

          broadcastToChannel(channel, {
            type: 'typing',
            typingUser: { id: ws.userId, username: ws.username },
            channelId: data.channelId,
            isTyping: data.isTyping
          }, ws.userId); // skip sender
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    // console.log(`WebSocket disconnected: ${ws.username}`);
  });
});

// Helper functions for WebSocket broadcasts
function broadcastToAll(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastToUsers(userIds, data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (userIds.includes(client.userId) && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastToChannel(channel, data, skipUserId = null) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.userId !== skipUserId) {
      if (channel.type === 'channel') {
        // Public channel goes to everyone
        client.send(payload);
      } else if (channel.type === 'dm' && channel.members.includes(client.userId)) {
        // DM only goes to members
        client.send(payload);
      }
    }
  });
}

// Start Server
const PORT = config.PORT;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`AETHER CHAT SERVER RUNNING AT http://localhost:${PORT}`);
  console.log(`Real-time WebSockets enabled.`);
  console.log(`===================================================`);
});
