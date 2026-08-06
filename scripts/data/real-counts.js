import dotenv from 'dotenv';
dotenv.config();
const API_KEY = process.env.BREVO_API_KEY;

async function summary() {
  const res = await fetch('https://api.brevo.com/v3/emailCampaigns', { headers: { 'api-key': API_KEY } });
  const data = await res.json();
  data.campaigns.filter(c => c.status === 'sent').forEach(c => {
    const stats = c.statistics.globalStats;
    console.log(`${c.name}: Sent=${stats.sent}, Opens=${stats.viewed}`);
  });
}
summary();
