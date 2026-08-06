const API_KEY = 'process.env.BREVO_API_KEY';

async function fetchAllCampaignEvents() {
    const ids = [10, 9, 8, 5, 4, 3];
    const hourCounts = Array(24).fill(0);
    let totalOpensRecap = 0;

    for (const campaignId of ids) {
        let offset = 0;
        const limit = 2500; // max limit for events
        let hasMore = true;

        console.log(`Fetching events for campaign ID: ${campaignId}...`);

        while (hasMore) {
            // Note: The correct endpoint for campaign specific events is smtp/statistics/events with emailCampaignId parameter
            // but we need to ensure we use the correct startDate since it might be limited by default.
            const url = `https://api.brevo.com/v3/smtp/statistics/events?event=opened&limit=${limit}&offset=${offset}&emailCampaignId=${campaignId}&startDate=2026-03-01&endDate=2026-04-04`;
            
            const response = await fetch(url, {
                headers: { 'api-key': API_KEY, 'accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                const events = data.events || [];
                
                events.forEach(e => {
                    const date = new Date(e.date);
                    const h = date.getHours();
                    hourCounts[h]++;
                    totalOpensRecap++;
                });

                console.log(`- Fetched ${events.length} events for ID ${campaignId}`);
                
                if (events.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            } else {
                console.error(`- Error for campaign ${campaignId}: ${response.status}`, await response.text());
                hasMore = false;
            }
        }
    }

    console.log('\n--- HOURLY DISTRIBUTION REPORT ---');
    console.log('Hour | Opens | Percentage');
    console.log('-----|-------|-----------');
    for (let i = 0; i < 24; i++) {
        const percentage = totalOpensRecap > 0 ? ((hourCounts[i] / totalOpensRecap) * 100).toFixed(2) : '0.00';
        console.log(`${i.toString().padStart(2, '0')}:00 | ${hourCounts[i]} | ${percentage}%`);
    }
    console.log(`\nTotal events analyzed: ${totalOpensRecap}`);
}

fetchAllCampaignEvents();
