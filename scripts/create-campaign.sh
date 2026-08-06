#!/bin/bash

# ------------------
# Create a campaign
# ------------------
curl -H 'api-key: YOUR_API_V3_KEY' \
-X POST -d '{
"name": "Campaign sent via the API",
"subject": "My subject",
"sender": {"name":"From name", "email":"myfromemail@mycompany.com" },
"type": "classic",
"htmlContent": "Congratulations! You successfully sent this example campaign via the Brevo API.",
"recipients": { "listIds": [2,7] },
"scheduledAt": "2018-01-01 00:00:01"
}' \
'https://api.brevo.com/v3/emailCampaigns'
