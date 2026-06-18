// Application State
let token = localStorage.getItem('aether_token');
let currentUser = null;
let activeChannel = null;
let channels = [];
let ws = null;
let typingTimeout = null;
let isTypingState = false;
let activeTypingUsers = {}; // Map of userId -> { username, timeout }

// UI Elements
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const toggleAuthBtn = document.getElementById('toggle-auth-btn');
const authToggleText = document.getElementById('auth-toggle-text');
const authAlert = document.getElementById('auth-alert');

const channelsList = document.getElementById('channels-list');
const dmsList = document.getElementById('dms-list');
const currentUsernameText = document.getElementById('current-username');
const currentUserAvatar = document.getElementById('current-user-avatar');

const chatWelcome = document.getElementById('chat-welcome');
const chatWindow = document.getElementById('chat-window');
const chatHeaderTitle = document.getElementById('chat-header-title');
const chatHeaderDesc = document.getElementById('chat-header-desc');
const chatHeaderIcon = document.getElementById('chat-header-icon');
const messageFeed = document.getElementById('message-feed');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const typingIndicators = document.getElementById('typing-indicators');

// Modals
const modalSettings = document.getElementById('modal-settings');
const modalCreateChannel = document.getElementById('modal-create-channel');
const modalBrowseChannels = document.getElementById('modal-browse-channels');
const modalCreateDm = document.getElementById('modal-create-dm');

const btnSettings = document.getElementById('btn-settings');
const btnAddChannel = document.getElementById('btn-add-channel');
const btnBrowseChannels = document.getElementById('btn-browse-channels');
const btnAddDm = document.getElementById('btn-add-dm');

const createChannelForm = document.getElementById('create-channel-form');
const welcomeBtnGeneral = document.getElementById('welcome-btn-general');
const welcomeBtnAi = document.getElementById('welcome-btn-ai');

// Quick Emoji
const btnEmojiHelper = document.getElementById('btn-emoji-helper');

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  // Load Theme
  const savedTheme = localStorage.getItem('aether_theme') || 'midnight';
  applyTheme(savedTheme);

  // Check Auth
  if (token) {
    validateSessionAndInitialize();
  } else {
    showAuthScreen();
  }

  setupEventListeners();
});

// THEME MANAGEMENT
function applyTheme(themeName) {
  document.body.className = '';
  document.body.classList.add(`theme-${themeName}`);
  localStorage.setItem('aether_theme', themeName);

  // Update active state in settings grid if settings modal is open
  document.querySelectorAll('.theme-option').forEach(opt => {
    if (opt.dataset.theme === themeName) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });
}

// AUTHENTICATION FLOW
function showAuthScreen() {
  authContainer.classList.remove('hidden');
  appContainer.classList.add('hidden');
  if (ws) {
    ws.close();
    ws = null;
  }
}

function showMainApp(user) {
  currentUser = user;
  currentUsernameText.textContent = user.username;
  currentUserAvatar.textContent = user.username.substring(0, 2).toUpperCase();

  authContainer.classList.add('hidden');
  appContainer.classList.remove('hidden');

  initializeWebSocket();
  loadChannels();
}

async function validateSessionAndInitialize() {
  try {
    const res = await fetch('/api/channels', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      // Decode user from session (by fetching sessions list to find which is current)
      const sessRes = await fetch('/api/sessions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (sessRes.ok) {
        const sessions = await sessRes.json();
        const current = sessions.find(s => s.isCurrent);
        if (current) {
          // Found current session username
          showMainApp({ username: current.userAgent.split(' ')[0] === 'You' ? 'user' : (localStorage.getItem('aether_username') || 'user') });
          // Ensure we have correct stored username
          const savedName = localStorage.getItem('aether_username') || 'Member';
          showMainApp({ username: savedName });
          return;
        }
      }
      showMainApp({ username: localStorage.getItem('aether_username') || 'Member' });
    } else {
      // Token invalid
      logout();
    }
  } catch (err) {
    console.error('Session validation failed:', err);
    showAuthScreen();
  }
}

function logout() {
  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(err => console.error(err));
  }
  localStorage.removeItem('aether_token');
  localStorage.removeItem('aether_username');
  token = null;
  currentUser = null;
  activeChannel = null;
  showAuthScreen();
}

function displayAuthAlert(message, type = 'error') {
  authAlert.textContent = message;
  authAlert.className = `alert ${type}`;
  authAlert.classList.remove('hidden');
}

// EVENT LISTENERS
function setupEventListeners() {
  // Toggle Auth Modes
  toggleAuthBtn.addEventListener('click', (e) => {
    e.preventDefault();
    authAlert.classList.add('hidden');
    if (loginForm.classList.contains('hidden')) {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      authToggleText.innerHTML = `Don't have an account? <a href="#" id="toggle-auth-btn">Sign Up</a>`;
      document.querySelector('.auth-subtitle').textContent = 'Welcome back. Enter your credentials to access the workspace.';
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      authToggleText.innerHTML = `Already have an account? <a href="#" id="toggle-auth-btn">Sign In</a>`;
      document.querySelector('.auth-subtitle').textContent = 'Create a secure workspace account below.';
    }
    // Re-bind the dynamically changed toggle button
    document.getElementById('toggle-auth-btn').addEventListener('click', (ev) => {
      ev.preventDefault();
      toggleAuthBtn.click();
    });
  });

  // Login Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    authAlert.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        token = data.token;
        localStorage.setItem('aether_token', token);
        localStorage.setItem('aether_username', data.user.username);
        showMainApp(data.user);
        loginForm.reset();
      } else {
        displayAuthAlert(data.error || 'Authentication failed.');
      }
    } catch (err) {
      displayAuthAlert('Server unreachable. Please try again.');
    }
  });

  // Register Submit
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    authAlert.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        token = data.token;
        localStorage.setItem('aether_token', token);
        localStorage.setItem('aether_username', data.user.username);
        showMainApp(data.user);
        registerForm.reset();
      } else {
        displayAuthAlert(data.error || 'Registration failed.');
      }
    } catch (err) {
      displayAuthAlert('Server error occurred during sign up.');
    }
  });

  // Modals Open/Close triggers
  btnSettings.addEventListener('click', () => {
    modalSettings.classList.remove('hidden');
    loadActiveSessions();
  });
  
  btnAddChannel.addEventListener('click', () => {
    modalCreateChannel.classList.remove('hidden');
    document.getElementById('new-channel-name').focus();
  });

  btnBrowseChannels.addEventListener('click', () => {
    modalBrowseChannels.classList.remove('hidden');
    loadBrowseChannelsList();
  });

  btnAddDm.addEventListener('click', () => {
    modalCreateDm.classList.remove('hidden');
    loadDmUsersList();
  });

  // Close modals clicking cross or background
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });

  document.querySelectorAll('.close-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay').classList.add('hidden');
    });
  });

  // Setting tab switching
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Theme option clicks
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      applyTheme(opt.dataset.theme);
    });
  });

  // Create Channel Form Submit
  createChannelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-channel-name').value;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, type: 'channel' })
      });
      if (res.ok) {
        const chan = await res.json();
        modalCreateChannel.classList.add('hidden');
        createChannelForm.reset();
        selectChannel(chan);
        loadChannels();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create channel.');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Chat message submit
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeChannel) return;
    const content = chatInput.value.trim();
    if (content.length === 0) return;

    chatInput.value = '';
    sendTypingIndicator(false);

    try {
      const res = await fetch(`/api/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content })
      });
      if (!res.ok) {
        const err = await res.json();
        console.error(err);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Typing indicators logic
  chatInput.addEventListener('input', () => {
    if (!activeChannel) return;
    
    if (!isTypingState) {
      isTypingState = true;
      sendTypingIndicator(true);
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTypingState = false;
      sendTypingIndicator(false);
    }, 2000);
  });

  // Sign out button
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    modalSettings.classList.add('hidden');
  });

  // Emoji helper
  btnEmojiHelper.addEventListener('click', () => {
    const emojis = ['😊', '👍', '🚀', '🔥', '💻', '💡', '🎉', '🌟', '👀', '👋', '🤖', '🎨'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    chatInput.value += randomEmoji;
    chatInput.focus();
  });

  // Welcome Screen actions
  welcomeBtnGeneral.addEventListener('click', () => {
    const gen = channels.find(c => c.name === 'general');
    if (gen) selectChannel(gen);
  });

  welcomeBtnAi.addEventListener('click', async () => {
    // Check if DM with aetherai already exists
    let aiDm = channels.find(c => c.type === 'dm' && c.members.includes('aetherai'));
    if (!aiDm) {
      // Create it
      try {
        const res = await fetch('/api/channels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ type: 'dm', members: ['aetherai'] })
        });
        if (res.ok) {
          aiDm = await res.json();
          await loadChannels();
        }
      } catch (err) {
        console.error(err);
      }
    }
    if (aiDm) selectChannel(aiDm);
  });
}

// REAL-TIME WEBSOCKET SYNC
function initializeWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${window.location.host}?token=${token}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'session_revoked') {
        alert('This session has been revoked by another device. Logging out.');
        logout();
        return;
      }

      if (data.type === 'message') {
        if (activeChannel && data.message.channelId === activeChannel.id) {
          appendMessage(data.message);
          scrollToBottom();
        }
      } else if (data.type === 'typing') {
        if (activeChannel && data.channelId === activeChannel.id) {
          handleUserTypingUpdate(data.typingUser, data.isTyping);
        }
      } else if (data.type === 'channel_created') {
        loadChannels();
      }
    } catch (err) {
      console.error('WebSocket parsing error:', err);
    }
  };

  ws.onclose = () => {
    // Reconnect after 3 seconds if still authenticated
    if (token) {
      setTimeout(initializeWebSocket, 3000);
    }
  };
}

function sendTypingIndicator(isTyping) {
  if (ws && ws.readyState === WebSocket.OPEN && activeChannel) {
    ws.send(JSON.stringify({
      type: 'typing',
      channelId: activeChannel.id,
      isTyping
    }));
  }
}

function handleUserTypingUpdate(user, isTyping) {
  if (isTyping) {
    if (activeTypingUsers[user.id]) {
      clearTimeout(activeTypingUsers[user.id].timeout);
    }
    
    activeTypingUsers[user.id] = {
      username: user.username,
      timeout: setTimeout(() => {
        delete activeTypingUsers[user.id];
        renderTypingIndicators();
      }, 3000)
    };
  } else {
    if (activeTypingUsers[user.id]) {
      clearTimeout(activeTypingUsers[user.id].timeout);
      delete activeTypingUsers[user.id];
    }
  }
  renderTypingIndicators();
}

function renderTypingIndicators() {
  const users = Object.values(activeTypingUsers);
  if (users.length === 0) {
    typingIndicators.innerHTML = '';
    return;
  }

  let text = '';
  if (users.length === 1) {
    text = `<strong>${users[0].username}</strong> is typing`;
  } else if (users.length === 2) {
    text = `<strong>${users[0].username}</strong> and <strong>${users[1].username}</strong> are typing`;
  } else {
    text = 'Several people are typing';
  }

  typingIndicators.innerHTML = `
    <span>${text}</span>
    <span class="typing-dots">
      <span></span>
      <span></span>
      <span></span>
    </span>
  `;
}

// API INTERACTORS & LIST RENDERING
async function loadChannels() {
  try {
    const res = await fetch('/api/channels', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      channels = await res.json();
      renderChannels();
    }
  } catch (err) {
    console.error(err);
  }
}

function renderChannels() {
  channelsList.innerHTML = '';
  dmsList.innerHTML = '';

  channels.forEach(chan => {
    const isAct = activeChannel && activeChannel.id === chan.id;
    const item = document.createElement('div');
    item.className = `list-item ${isAct ? 'active' : ''}`;
    
    if (chan.type === 'channel') {
      item.innerHTML = `
        <div class="list-item-content">
          <span class="item-icon"><i class="fa-solid fa-hashtag"></i></span>
          <span>${chan.name}</span>
        </div>
      `;
      item.addEventListener('click', () => selectChannel(chan));
      channelsList.appendChild(item);
    } else {
      // DM: Resolve display username
      const otherMembers = chan.members.filter(m => m !== currentUser.username && m !== currentUser.id);
      const displayName = otherMembers.length > 0 ? otherMembers.join(', ') : 'Aether AI';
      
      const isBot = chan.members.includes('aetherai');
      const icon = isBot 
        ? '<i class="fa-solid fa-robot"></i>' 
        : '<i class="fa-solid fa-user"></i>';

      item.innerHTML = `
        <div class="list-item-content">
          <span class="item-icon">${icon}</span>
          <span>${displayName === 'aetherai' ? 'Aether AI' : displayName}</span>
        </div>
      `;
      item.addEventListener('click', () => selectChannel(chan));
      dmsList.appendChild(item);
    }
  });
}

function selectChannel(channel) {
  activeChannel = channel;
  activeTypingUsers = {};
  renderTypingIndicators();
  
  // Highlight active element in list
  renderChannels();

  // Show active view
  chatWelcome.classList.add('hidden');
  chatWindow.classList.remove('hidden');

  // Header settings
  if (channel.type === 'channel') {
    chatHeaderTitle.textContent = channel.name;
    chatHeaderDesc.textContent = `General discussion inside #${channel.name}`;
    chatHeaderIcon.innerHTML = '<i class="fa-solid fa-hashtag"></i>';
    chatInput.placeholder = `Message #${channel.name}... (tag @aetherai for bot responses)`;
  } else {
    const otherMembers = channel.members.filter(m => m !== currentUser.username && m !== currentUser.id);
    const displayName = otherMembers.length > 0 ? otherMembers.join(', ') : 'Aether AI';
    const isBot = channel.members.includes('aetherai');

    chatHeaderTitle.textContent = displayName === 'aetherai' ? 'Aether AI' : displayName;
    chatHeaderDesc.textContent = isBot ? 'Active Aether Assistant Fallback Bot' : 'Direct Conversation (Secure session)';
    chatHeaderIcon.innerHTML = isBot ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>';
    chatInput.placeholder = `Message ${displayName === 'aetherai' ? 'Aether AI' : displayName}...`;
  }

  loadMessages(channel.id);
  chatInput.focus();
}

async function loadMessages(channelId) {
  messageFeed.innerHTML = '<div style="text-align:center; padding: 20px; color:var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Fetching messages...</div>';
  try {
    const res = await fetch(`/api/channels/${channelId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const messages = await res.json();
      messageFeed.innerHTML = '';
      if (messages.length === 0) {
        messageFeed.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--text-secondary); font-size:0.85rem;">This is the beginning of the chat log. Send a message to start!</div>';
      } else {
        messages.forEach(msg => appendMessage(msg));
        scrollToBottom();
      }
    }
  } catch (err) {
    console.error(err);
    messageFeed.innerHTML = '<div style="text-align:center; padding: 20px; color:var(--danger);">Failed to load messages.</div>';
  }
}

function appendMessage(msg) {
  // Check if loading state placeholder is showing and remove
  const placeholder = messageFeed.querySelector('.fa-spinner');
  if (placeholder) messageFeed.innerHTML = '';

  const isSelf = msg.sender.id === currentUser.id || msg.sender.username === currentUser.username;
  const isBot = msg.sender.username === 'aetherai';
  
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isSelf ? 'self' : 'other'}`;

  const initial = msg.sender.username.substring(0, 2).toUpperCase();
  const avatarHtml = `<div class="msg-avatar" title="${msg.sender.username}">${isBot ? '<i class="fa-solid fa-robot"></i>' : initial}</div>`;
  
  const formattedContent = formatMessageContent(msg.content);
  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const botBadge = isBot ? '<span class="bot-badge">AI</span>' : '';

  wrapper.innerHTML = `
    ${avatarHtml}
    <div class="msg-bubble-container">
      <div class="msg-info">
        <span class="msg-sender">${isBot ? 'Aether AI' : msg.sender.username}</span>
        ${botBadge}
        <span class="msg-time">${timeStr}</span>
      </div>
      <div class="msg-bubble">${formattedContent}</div>
    </div>
  `;

  messageFeed.appendChild(wrapper);
}

function scrollToBottom() {
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

// SIMPLE MARKDOWN PARSER
function formatMessageContent(content) {
  // Prevent XSS
  let text = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Code Blocks: ```code```
  text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Inline Code: `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold markdown: **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic markdown: *text*
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Paragraph breaks
  text = text.replace(/\n/g, '<br>');

  return text;
}

// SESSIONS CONTROL
async function loadActiveSessions() {
  const tbody = document.getElementById('sessions-table-body');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Fetching active sessions...</td></tr>';
  
  try {
    const res = await fetch('/api/sessions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const sessions = await res.json();
      tbody.innerHTML = '';
      
      sessions.forEach(s => {
        const row = document.createElement('tr');
        const badgeClass = s.isCurrent ? 'current' : 'other';
        const badgeText = s.isCurrent ? 'Current' : 'Active';
        const dateText = new Date(s.createdAt).toLocaleString();
        
        let actionHtml = '';
        if (s.isCurrent) {
          actionHtml = `<span style="color:var(--text-secondary); font-style:italic;">Active Session</span>`;
        } else {
          actionHtml = `<button class="btn btn-danger btn-sm" onclick="revokeUserSession('${s.id}')" style="padding: 4px 8px; font-size:0.75rem;"><i class="fa-solid fa-trash"></i> Revoke</button>`;
        }

        row.innerHTML = `
          <td>
            <div style="font-weight:600;">${s.userAgent}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">${dateText}</div>
          </td>
          <td><code>${s.ip}</code></td>
          <td><span class="session-badge ${badgeClass}">${badgeText}</span></td>
          <td>${actionHtml}</td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--danger); text-align:center;">Failed to load sessions.</td></tr>';
  }
}

// Global scope bindings for inline onclick events
window.revokeUserSession = async (tokenToRevoke) => {
  if (!confirm('Are you sure you want to revoke this session? The device will be logged out immediately.')) {
    return;
  }
  try {
    const res = await fetch('/api/sessions/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ token: tokenToRevoke })
    });
    if (res.ok) {
      loadActiveSessions();
    } else {
      alert('Failed to revoke session.');
    }
  } catch (err) {
    console.error(err);
  }
};

// CHANNEL EXPLORER / BROWSER
async function loadBrowseChannelsList() {
  const container = document.getElementById('browse-channels-list');
  container.innerHTML = '<div style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

  try {
    const res = await fetch('/api/channels', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const list = await res.json();
      const publicChans = list.filter(c => c.type === 'channel');
      container.innerHTML = '';

      if (publicChans.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary); text-align:center;">No channels available.</div>';
        return;
      }

      publicChans.forEach(c => {
        const item = document.createElement('div');
        item.className = 'browse-item';
        item.innerHTML = `
          <div class="browse-item-info">
            <i class="fa-solid fa-hashtag" style="color:var(--accent);"></i>
            <span style="font-weight:600;">#${c.name}</span>
          </div>
          <button class="btn btn-secondary btn-sm" style="padding:5px 12px; font-size:0.8rem;">Join / View</button>
        `;
        item.querySelector('button').addEventListener('click', () => {
          selectChannel(c);
          modalBrowseChannels.classList.add('hidden');
        });
        container.appendChild(item);
      });
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div style="color:var(--danger); text-align:center;">Error listing channels.</div>';
  }
}

// DIRECT MESSAGE LAUNCHER
async function loadDmUsersList() {
  const container = document.getElementById('dm-users-list');
  container.innerHTML = '<div style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching users...</div>';

  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const users = await res.json();
      container.innerHTML = '';

      // Add a default Aether AI option if it is not in the users search list
      const hasAi = users.find(u => u.username === 'aetherai' || u.id === 'aetherai');
      if (!hasAi) {
        users.unshift({ id: 'aetherai', username: 'aetherai', isBot: true });
      }

      users.forEach(u => {
        const item = document.createElement('div');
        item.className = 'browse-item';
        const displayLabel = u.username === 'aetherai' ? 'Aether AI (Assistant)' : u.username;
        const icon = u.username === 'aetherai' 
          ? '<i class="fa-solid fa-robot" style="color:var(--accent);"></i>' 
          : '<i class="fa-solid fa-user"></i>';

        item.innerHTML = `
          <div class="browse-item-info">
            ${icon}
            <span style="font-weight:600;">${displayLabel}</span>
          </div>
          <button class="btn btn-secondary btn-sm" style="padding:5px 12px; font-size:0.8rem;">Chat</button>
        `;
        item.querySelector('button').addEventListener('click', () => {
          startDmWithUser(u);
        });
        container.appendChild(item);
      });
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div style="color:var(--danger); text-align:center;">Error listing users.</div>';
  }
}

async function startDmWithUser(user) {
  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ type: 'dm', members: [user.id] })
    });
    if (res.ok) {
      const dm = await res.json();
      modalCreateDm.classList.add('hidden');
      await loadChannels();
      selectChannel(dm);
    } else {
      alert('Could not start DM.');
    }
  } catch (err) {
    console.error(err);
  }
}
