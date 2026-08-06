const API_KEY = 'process.env.BREVO_API_KEY';

async function listAll() {
  const res = await fetch('https://api.brevo.com/v3/emailCampaigns?status=all', { headers: { 'api-key': API_KEY } });
  const data = await res.json();
  data.campaigns.forEach(c => {
    console.log(`${c.name} [${c.status}]: Sent=${c.statistics.globalStats.sent}, Opens=${c.statistics.globalStats.viewed}`);
  });
}
listAll();
