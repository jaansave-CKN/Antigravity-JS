const API_KEY = 'process.env.BREVO_API_KEY';

async function checkCampaign10() {
  const res = await fetch('https://api.brevo.com/v3/emailCampaigns/10', { headers: { 'api-key': API_KEY } });
  if (res.ok) {
    const data = await res.json();
    console.log(JSON.stringify(data.statistics, null, 2));
  } else {
    console.log('Failed to fetch campaign 10');
  }
}
checkCampaign10();
