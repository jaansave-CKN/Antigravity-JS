const API_KEY = 'process.env.BREVO_API_KEY';

async function getIds() {
  const res = await fetch('https://api.brevo.com/v3/emailCampaigns?limit=50', { headers: { 'api-key': API_KEY } });
  const data = await res.json();
  data.campaigns.forEach(c => {
    console.log(`ID: ${c.id}, Name: ${c.name}, Status: ${c.status}`);
  });
}
getIds();
