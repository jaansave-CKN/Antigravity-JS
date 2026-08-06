import dotenv from 'dotenv';
dotenv.config();
const API_KEY = process.env.BREVO_API_KEY;

async function checkTransactional() {
  const res = await fetch('https://api.brevo.com/v3/smtp/statistics/reports', { headers: { 'api-key': API_KEY } });
  const data = await res.json();
  console.log('--- TRANSACTIONAL REPORTS ---');
  console.log(JSON.stringify(data, null, 2));
}
checkTransactional();
