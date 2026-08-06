const API_KEY = 'process.env.BREVO_API_KEY';

async function getActiveCampaigns() {
  try {
    const response = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-key': API_KEY
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Campaigns found:', data.count);
      
      const statusCounts = {};
      data.campaigns.forEach(c => {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      });
      
      console.log('--- CAMPAIGN SUMMARY ---');
      console.log(`Total: ${data.count}`);
      for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`${status.charAt(0).toUpperCase() + status.slice(1)}: ${count}`);
      }
      
      console.log('--- CAMPAIGN TITLES ---');
      data.campaigns.forEach(c => {
        console.log(`- ${c.name} [${c.status}]`);
      });
    } else {
      console.error('Failed to fetch campaigns:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getActiveCampaigns();
