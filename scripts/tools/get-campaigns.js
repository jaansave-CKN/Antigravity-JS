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

const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function getCampaigns() {
  if (!BREVO_API_KEY) {
    console.error('Error: BREVO_API_KEY not found in .env');
    return;
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/emailCampaigns?status=sent', {
      headers: {
        'api-key': BREVO_API_KEY,
        'accept': 'application/json'
      }
    });

    const result = await response.json();
    if (response.ok) {
        // Find also 'queued', 'suspended', 'inProcess' statuses if preferred. 
        // But the user asked for 'activas', this might mean 'sent' or 'queued'. 
        // Let's get all and provide a breakdown if possible or just the total.
        console.log(JSON.stringify(result, null, 2));
    } else {
      console.error('❌ Failed to get campaigns:', result.message || JSON.stringify(result));
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

getCampaigns();
