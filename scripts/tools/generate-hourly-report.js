import dotenv from 'dotenv';
dotenv.config();
const API_KEY = process.env.BREVO_API_KEY;

async function generateHourlyReport() {
  try {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 90); 
    
    const startDate = lastMonth.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    
    const url = `https://api.brevo.com/v3/smtp/statistics/events?event=opened&limit=2500&startDate=${startDate}&endDate=${endDate}`;
    
    const eventResponse = await fetch(url, {
        method: 'GET',
        headers: {
            'accept': 'application/json',
            'api-key': API_KEY
        }
    });
    
    if (eventResponse.ok) {
        const data = await eventResponse.json();
        const events = data.events || [];
        const totalOpens = events.length;
        
        console.log(`Analyzing ${totalOpens} open events from ${startDate} to ${endDate}...`);
        
        const hourCounts = Array(24).fill(0);
        events.forEach(e => {
            const date = new Date(e.date);
            const h = date.getHours();
            hourCounts[h]++;
        });
        
        console.log('--- HOURLY DISTRIBUTION REPORT ---');
        console.log('Hour | Opens | Percentage');
        console.log('-----|-------|-----------');
        for (let i = 0; i < 24; i++) {
            const percentage = totalOpens > 0 ? ((hourCounts[i] / totalOpens) * 100).toFixed(2) : '0.00';
            console.log(`${i.toString().padStart(2, '0')}:00 | ${hourCounts[i]} | ${percentage}%`);
        }
        
    } else {
        console.error('Failed to fetch events:', eventResponse.status, await eventResponse.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

generateHourlyReport();
