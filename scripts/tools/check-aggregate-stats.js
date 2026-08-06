const API_KEY = 'process.env.BREVO_API_KEY';

async function checkAggregate() {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    const startDate = lastMonth.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    
    // Check aggregated report for campaigns
    const res = await fetch(`https://api.brevo.com/v3/emailCampaigns/statistics/reports?startDate=${startDate}&endDate=${endDate}`, {
        headers: { 'api-key': API_KEY }
    });
    
    if (res.ok) {
        const data = await res.json();
        console.log('--- AGGREGATED CAMPAIGN REPORT ---');
        console.log(JSON.stringify(data, null, 2));
    } else {
        console.log('No aggregated report found or failed fetch.');
    }
}
checkAggregate();
