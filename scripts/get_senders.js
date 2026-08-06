import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(path.dirname(__dirname), '.env');
const content = fs.readFileSync(envPath, 'utf8');
content.split('\n').forEach(line => {
  const [key, ...value] = line.split('=');
  if (key && value) {
    process.env[key.trim()] = value.join('=').trim();
  }
});

const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function getSenders() {
  const response = await fetch('https://api.brevo.com/v3/senders', {
    headers: { 'api-key': BREVO_API_KEY }
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

getSenders();
