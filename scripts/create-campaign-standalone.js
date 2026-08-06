import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal Dotenv Parser
function loadEnv() {
  const envPath = path.join(path.dirname(__dirname), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const [key, ...value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.join('=').trim();
      }
    });
  }
}

loadEnv();

const BREVO_API_KEY = process.env.BREVO_API_KEY || 'YOUR_API_V3_KEY';

const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function createCampaign() {
  try {
    const response = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        name: "Antigravity_Nueva",
        subject: "My subject",
        sender: { name: "ASFALTICA", email: "asfaltica.comercial@gmail.com" },
        type: "classic",
        htmlContent: "Congratulations! You successfully sent this example campaign via the Brevo API.",
        recipients: { listIds: [28] },
        scheduledAt: "2026-04-10T20:00:00.000Z",
      })
    });

    let result = {};
    if (response.status !== 204) {
      const text = await response.text();
      result = text ? JSON.parse(text) : {};
    }

    if (response.ok || response.status === 201) {
      console.log('✅ Campaign created successfully!');
      console.log('Response:', result);
    } else {
      console.error('❌ Failed to create campaign:', result.message || JSON.stringify(result));
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

createCampaign();
