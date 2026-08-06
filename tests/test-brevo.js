const API_KEY = 'process.env.BREVO_API_KEY';

async function testConnection() {
  try {
    const response = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-key': API_KEY
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Connection Successful!');
      console.log('Account Name:', data.companyName);
      console.log('Email:', data.email);
    } else {
      console.error('Connection Failed:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testConnection();
