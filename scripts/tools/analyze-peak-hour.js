const API_KEY = 'process.env.BREVO_API_KEY';

async function fetchMoreEvents() {
  try {
    const eventResponse = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?event=opened&limit=500`, {
      headers: { 'api-key': API_KEY }
    });
    
    if (eventResponse.ok) {
        const data = await eventResponse.json();
        const events = data.events || [];
        console.log(`Analyzing ${events.length} open events...`);
        
        const hourCounts = {};
        events.forEach(e => {
            const hour = new Date(e.date).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });
        
        console.log('--- OPEN STATISTICS BY HOUR ---');
        Object.entries(hourCounts)
          .sort((a, b) => b[1] - a[1])
          .forEach(([hour, count]) => {
            console.log(`${hour}:00 - ${count} total opens`);
          });
          
        if (events.length > 0) {
            const sortedByCount = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
            const topHour = sortedByCount[0][0];
            console.log(`\nThe most frequent opening hour is: ${topHour}:00`);
        }
    } else {
        console.error('Failed to fetch events:', await eventResponse.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fetchMoreEvents();
