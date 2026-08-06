const API_KEY = 'process.env.BREVO_API_KEY';

async function listAllCampaignStats() {
    console.log("Checking all marketing campaigns with statistics...");
    const res = await fetch('https://api.brevo.com/v3/emailCampaigns?limit=50', {
        headers: { 'api-key': API_KEY }
    });

    if (res.ok) {
        const data = await res.json();
        const campaigns = data.campaigns || [];
        
        console.log(`ID | Name | Viewed | Sent`);
        console.log(`---|---|---|---`);
        campaigns.forEach(c => {
            const stats = c.statistics?.globalStats || {};
            console.log(`${c.id} | ${c.name} | ${stats.viewed || 0} | ${stats.sent || 0}`);
        });
    } else {
        console.error("Error fetching campaigns:", res.status);
    }
}

listAllCampaignStats();
