const API_KEY = 'process.env.BREVO_API_KEY';

async function fetchAllEvents() {
    const startDate = '2026-03-15';
    const endDate = '2026-04-04';
    let offset = 0;
    const limit = 2500;
    let allEvents = [];
    let hasMore = true;

    console.log(`Fetching events from ${startDate} to ${endDate}...`);

    while (hasMore) {
        const url = `https://api.brevo.com/v3/smtp/statistics/events?event=opened&limit=${limit}&offset=${offset}&startDate=${startDate}&endDate=${endDate}`;
        const response = await fetch(url, {
            headers: { 'api-key': API_KEY }
        });

        if (response.ok) {
            const data = await response.json();
            const events = data.events || [];
            allEvents = allEvents.concat(events);
            console.log(`Fetched ${events.length} events (Current total: ${allEvents.length})`);
            
            if (events.length < limit) {
                hasMore = false;
            } else {
                offset += limit;
            }
        } else {
            console.error('Failed to fetch events:', response.status, await response.text());
            hasMore = false;
        }
    }

    const totalOpens = allEvents.length;
    if (totalOpens === 0) {
        console.log('No events found.');
        return;
    }

    const hourCounts = Array(24).fill(0);
    allEvents.forEach(e => {
        const date = new Date(e.date);
        const h = date.getHours();
        hourCounts[h]++;
    });

    console.log('--- HOURLY DISTRIBUTION REPORT ---');
    console.log('Hour | Opens | Percentage');
    console.log('-----|-------|-----------');
    for (let i = 0; i < 24; i++) {
        const percentage = ((hourCounts[i] / totalOpens) * 100).toFixed(2);
        console.log(`${i.toString().padStart(2, '0')}:00 | ${hourCounts[i]} | ${percentage}%`);
    }
}

fetchAllEvents();
