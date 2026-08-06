const API_KEY = 'process.env.BREVO_API_KEY';

async function analyzeAllCampaignOpens() {
  const ids = [10, 9, 8, 5, 4, 3, 2];
  const allHours = [];
  
  for (const id of ids) {
    const res = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?event=opened&emailCampaignId=${id}&limit=500`, {
      headers: { 'api-key': API_KEY }
    });
    
    if (res.ok) {
        const data = await res.json();
        (data.events || []).forEach(e => {
            const h = new Date(e.date).getHours();
            allHours.push(h);
        });
    }
  }

  if (allHours.length === 0) {
    console.log('No specific open events found for these campaign IDs.');
    // Check general transactional events as backup
    const transRes = await fetch('https://api.brevo.com/v3/smtp/statistics/events?event=opened&limit=500', {
        headers: { 'api-key': API_KEY }
    });
    if (transRes.ok) {
        const transData = await transRes.json();
        (transData.events || []).forEach(e => {
            allHours.push(new Date(e.date).getHours());
        });
        console.log(`Found ${allHours.length} general open events (including transactional).`);
    }
  }

  const counts = {};
  allHours.forEach(h => counts[h] = (counts[h] || 0) + 1);
  
  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
  if (sorted.length > 0) {
    console.log('PEAK HOURS:');
    sorted.forEach(([h, c]) => console.log(`${h}:00 - ${c} opens`));
  } else {
    console.log('No data available to determine peak hours.');
  }
}

analyzeAllCampaignOpens();
