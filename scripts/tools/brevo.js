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
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;

async function sendEmail(to, subject, content) {
  if (!BREVO_API_KEY || !SENDER_EMAIL) {
    console.error('Error: BREVO_API_KEY or BREVO_SENDER_EMAIL not found in .env');
    return;
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: 'Antigravity AI', email: SENDER_EMAIL },
        to: [{ email: to }],
        subject: subject,
        textContent: content
      })
    });

    const result = await response.json();
    if (response.ok) {
      console.log('✅ Email sent successfully!');
      console.log('Message ID:', result.messageId);
    } else {
      console.error('❌ Failed to send email:', result.message || JSON.stringify(result));
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

async function createCampaign(name, subject, listIds, htmlContent) {
  if (!BREVO_API_KEY || !SENDER_EMAIL) {
    console.error('Error: BREVO_API_KEY or BREVO_SENDER_EMAIL not found in .env');
    return;
  }

  try {
    const listIdsArray = listIds.split(',').map(id => parseInt(id.trim(), 10));
    
    // Defaulting to a scheduledAt 1 hour from now as in the example curl, 
    // or you could leave it empty to send immediately/not schedule.
    // For exact match with cURL, we can let user schedule later or send now. Let's just create it as draft or schedule in 5 mins.
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        name: name,
        subject: subject,
        sender: { name: 'Antigravity AI', email: SENDER_EMAIL },
        type: 'classic',
        htmlContent: htmlContent,
        recipients: { listIds: listIdsArray },
        scheduledAt: scheduledAt
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

// CLI Argument Handling
const [,, command, ...args] = process.argv;

if (command === 'send') {
  const [to, subject, ...contentParts] = args;
  const content = contentParts.join(' ');
  if (!to || !subject || !content) {
    console.log('Usage: node scripts/cli/brevo.js send <to> <subject> <content>');
  } else {
    sendEmail(to, subject, content);
  }
} else if (command === 'create-campaign') {
  const [name, subject, listIds, ...contentParts] = args;
  const htmlContent = contentParts.join(' ') || 'Congratulations! You successfully sent this example campaign via the Brevo API.';
  if (!name || !subject || !listIds) {
    console.log('Usage: node scripts/cli/brevo.js create-campaign <name> <subject> <comma_separated_list_ids> [htmlContent]');
  } else {
    createCampaign(name, subject, listIds, htmlContent);
  }
} else {
  console.log('--- Brevo CLI Tool ---');
  console.log('Available Commands:');
  console.log('1. send <to> <subject> <content>');
  console.log('2. create-campaign <name> <subject> <listIds> [htmlContent]');
}
