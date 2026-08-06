const API_KEY = 'process.env.BREVO_API_KEY';

async function getStats() {
  try {
    const listResponse = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      headers: { 'api-key': API_KEY }
    });
    
    if (!listResponse.ok) throw new Error('Could not fetch campaigns');
    
    const listData = await listResponse.json();
    const sentCampaigns = listData.campaigns.filter(c => c.status === 'sent');
    
    console.log(`Found ${sentCampaigns.length} sent campaigns. Analyzing open times...`);
    
    const allOpenHours = [];
    
    for (const campaign of sentCampaigns) {
      // Get detailed events for each campaign
      // Note: This might be many events, let's limit it if needed
      // Actually, we can get statistics per year/month/day/hour but only for aggregate SMTP
      // For specific campaign, we might need to query the events endpoint
      
      const eventResponse = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?event=opened&emailCampaignId=${campaign.id}&limit=100`, {
        headers: { 'api-key': API_KEY }
      });
      
      if (eventResponse.ok) {
        const eventData = await eventResponse.json();
        if (eventData.events) {
          eventData.events.forEach(e => {
            const date = new Date(e.date);
            allOpenHours.push(date.getHours());
          });
        }
      }
    }
    
    if (allOpenHours.length === 0) {
      console.log('No open events found in the last 100 events per campaign.');
      return;
    }
    
    const hourCounts = {};
    allOpenHours.forEach(h => {
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    });
    
    console.log('--- HOURLY OPEN STATISTICS ---');
    Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1]) // Sort by frequency
      .forEach(([hour, count]) => {
        console.log(`${hour}:00 - ${count} opens`);
      });
      
  } catch (err) {
    console.error('Error:', err.message);
  }
}

getStats();
