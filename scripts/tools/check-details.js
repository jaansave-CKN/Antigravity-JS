const API_KEY = 'process.env.BREVO_API_KEY';

async function checkDetails() {
  const ids = [39, 38, 37, 35, 34, 33, 31]; // From previous list
  for (const id of ids) {
    const res = await fetch(`https://api.brevo.com/v3/emailCampaigns/${id}`, { headers: { 'api-key': API_KEY } });
    if (res.ok) {
       const data = await res.json();
       console.log(`- ${data.name}: Viewed=${data.statistics.globalStats.viewed}, Unique=${data.statistics.globalStats.uniqueViews}`);
    }
  }
}
checkDetails();
