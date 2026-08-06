# SKILL: TRELLO ADMIN AUTO-RECOVERY
# Agente: 10-admin-trello

## CAPABILITIES
1. Auto-diagnosis of Trello API connectivity
2. Credential renewal via .env and Firestore
3. API testing and validation

## AUTO-DIAGNOSIS PROCESS
When Trello endpoint returns "invalid key" or authentication error:

1. Check if credentials exist in .env
2. Test API connectivity with current credentials
3. If "invalid key" error: mark credentials as EXPIRED
4. Return actionable status to user

## TROUBLESHOOTING STEPS
If credentials are invalid:
1. Tell user to generate new credentials at: https://trello.com/app-key
2. After obtaining new credentials, update both .env and Firestore
3. Re-test connectivity

## COMMANDS
- `node scripts/trello_diagnostic.js` - Run auto-diagnosis
- `curl -H "x-local-dev: true" http://localhost:5000/api/trello/status` - Check status