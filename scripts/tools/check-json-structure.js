const API_KEY = 'process.env.BREVO_API_KEY';

async function checkJson() {
  const res = await fetch('https://api.brevo.com/v3/emailCampaigns?limit=1', { headers: { 'api-key': API_KEY } });
  const data = await res.json();
  console.log(JSON.stringify(data.campaigns[0], null, 2));
}
checkJson();
