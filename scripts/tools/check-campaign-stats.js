const API_KEY = 'process.env.BREVO_API_KEY';

async function checkStats() {
  try {
    const listResponse = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      headers: { 'api-key': API_KEY }
    });
    
    const listData = await listResponse.json();
    const sentCampaigns = listData.campaigns.filter(c => c.status === 'sent');
    
    for (const c of sentCampaigns) {
       console.log(`- ${c.name} (ID: ${c.id})`);
       console.log(`  Stats: `, c.statistics);
    }
    
    // Also check for general events without campaign ID filter
    const eventResponse = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?event=opened&limit=50`, {
      headers: { 'api-key': API_KEY }
    });
    const eventData = await eventResponse.json();
    console.log('--- RECENT OPEN EVENTS ---');
    if (eventData.events) {
       eventData.events.forEach(e => {
         console.log(`- Open event at ${e.date} for campaign: ${e.campaignId || 'N/A'}`);
       });
    } else {
       console.log('No recent open events found.');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkStats();
