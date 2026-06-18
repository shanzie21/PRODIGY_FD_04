const config = require('../config');

/**
 * Generate AI response using Google Gemini 1.5 Flash API.
 * If API Key is missing or request fails, falls back to a smart offline mock assistant.
 * 
 * @param {string} promptText - The user prompt
 * @param {Array} history - Previous messages for context (optional)
 * @returns {Promise<string>} Generated text response
 */
async function generateAIResponse(promptText, history = []) {
  const apiKey = config.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      
      const contents = [];
      
      // Inject system instruction for friendly, concise, and conversational tones (messaging style)
      const systemInstruction = "You are Aether AI, a friendly and casual chat assistant in Aether Chat. Talk like a real person in a messaging app—be concise, natural, and helpful. Use emojis occasionally, keep responses short (1-3 sentences), and avoid long bulleted lists, technical jargon, or textbook explanations unless the user asks for a deep dive.";
      
      // Append history
      if (history && history.length > 0) {
        history.slice(-6).forEach(msg => {
          const role = msg.sender.username === 'aetherai' ? 'model' : 'user';
          contents.push({
            role: role,
            parts: [{ text: msg.content }]
          });
        });
      }
      
      // Append current prompt
      contents.push({
        role: 'user',
        parts: [{ text: promptText }]
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            maxOutputTokens: 256, // smaller token count to keep it concise
            temperature: 0.8
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
          const replyText = data.candidates[0].content.parts[0].text;
          if (replyText && replyText.trim().length > 0) {
            return replyText.trim();
          }
        }
      } else {
        const errorText = await response.text();
        console.error('Gemini API returned non-OK status:', response.status, errorText);
      }
    } catch (err) {
      console.error('Gemini API call failed, falling back to mock response:', err);
    }
  }
  // Fallback / Mock generator
  return generateOfflineFallback(promptText);
}

/**
 * Generates concise, casual, human-like responses based on user queries when Gemini is offline.
 */
function generateOfflineFallback(prompt) {
  const p = prompt.toLowerCase().trim();
  // 1. Gratitude & Acknowledgment
  if (p === 'ok' || p === 'okay' || p === 'cool' || p === 'nice' || p === 'great' || p === 'awesome' || p === 'good') {
    const replies = [
      "Awesome! Let me know if you need anything else. 👍",
      "Sweet! Let me know if you want to chat about anything else. 😊",
      "Sounds good! I'm here if you need help with anything."
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  if (p.includes('thank') || p.includes('thanks') || p.includes('ty') || p.includes('thx')) {
    return "You're very welcome! Let me know if there's anything else I can help you with. 😊";
  }
  // 2. Laughing / Humor
  if (p.includes('lol') || p.includes('haha') || p.includes('lmao') || p.includes('xd') || p.includes('funny')) {
    return "Haha! 😂 What's next on your mind?";
  }
  // 3. Casual chit-chat
  if (p.includes('how are you') || p.includes('how are u') || p.includes('how\'s it going') || p.includes('how is it going') || p.includes('what\'s up') || p.includes('sup')) {
    return "I'm doing great, just here chatting with you! How's your day going? Anything you want to check out in Aether Chat? standard things?";
  }
  // 4. Custom Themes & Colors
  if (p.includes('theme') || p.includes('color') || p.includes('appearance') || p.includes('font') || p.includes('customize')) {
    return "Oh, you can totally customize how the app looks! Just click the **Settings** cog in the bottom-left. We have themes like Midnight, Cyber Neon, Royal Purple, and Light Professional. Let me know if you want help picking one! 🎨";
  }
  // 5. Channel Coordination & Rooms
  if (p.includes('channel') || p.includes('room') || p.includes('group') || p.includes('create') || p.includes('dm')) {
    return "For coordinating with your friends, you can make a Group Channel by clicking the **Compass** or the **+** next to 'Group Channels' in the sidebar. If you want a private 1-on-1, click the **+** next to 'Direct Messages' to start a DM chat! 💬";
  }
  // 6. Security, Lockouts & Sessions
  if (p.includes('security') || p.includes('lock') || p.includes('login') || p.includes('session') || p.includes('attempt') || p.includes('password')) {
    return "We take security pretty seriously here! Accounts get locked temporarily after 8 failed login attempts (starting with 15 mins). You can also view all active devices logged into your account under **Settings > Sessions**.";
  }
  // 7. Greeting/General
  if (p.includes('hello') || p.includes('hi') || p.includes('hey') || p.includes('yo') || p.includes('who are you') || p.includes('help') || p.includes('start')) {
    return "Hey! I'm Aether AI, your chat assistant. Ask me anything about themes, creating channels, or security features. What's on your mind? 🚀";
  }
  if (p.includes('app') || p.includes('about') || p.includes('what is this') || p.includes('purpose') || p.includes('feature')) {
    return "Aether Chat is a real-time collaboration space. You can chat in group channels, DM friends, customize your theme, and manage security settings. What would you like to explore? 😊";
  }
  // Default Fallback Response
  return "I hear you! Since I'm currently running in local offline mode, I work best answering questions about Aether Chat (like themes, security settings, or creating channels). What would you like to know? (Or, if you are the dev, add a `GEMINI_API_KEY` to the server's `.env` to give me full AI power!)";
}

module.exports = {
  generateAIResponse
};
