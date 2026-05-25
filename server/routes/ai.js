import express from 'express';
const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

if (!GROQ_API_KEY || !TRELLO_API_KEY || !TRELLO_TOKEN) {
  console.error('[AI ROUTES] WARNING: Missing AI API keys in environment');
}

export async function groqRequest(messages) {
  if (!GROQ_API_KEY) return { error: 'GROQ_API_KEY not configured' };
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages,
      temperature: 0.7
    })
  });
  return await response.json();
}

export async function trelloRequest(method, endpoint, data) {
  if (!TRELLO_API_KEY || !TRELLO_TOKEN) return { error: 'TRELLO_API_KEY or TRELLO_TOKEN not configured' };
  const url = `https://api.trello.com/1${endpoint}?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined
  });
  return await response.json();
}

router.post('/groq/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ success: false, message: 'Messages required' });
    const result = await groqRequest(messages);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/trello/card', async (req, res) => {
  try {
    const { idList, name, desc } = req.body;
    if (!idList || !name) return res.status(400).json({ success: false, message: 'idList and name required' });
    const result = await trelloRequest('POST', '/cards', { idList, name, desc });
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;