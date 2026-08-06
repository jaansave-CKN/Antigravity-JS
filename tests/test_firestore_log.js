import { AuditLogger } from '../src/shared/infrastructure/AuditLogger.js';

async function runTest() {
  console.log('[Test] Initiating Firestore Transmission Test...');
  try {
    await AuditLogger.log('TEST_TRANSMISSION', { 
      status: 'VERIFYING_LINK', 
      context: 'Manual Verification via AI Agent',
      environment: 'Google Drive / Windows'
    });
    console.log('[Test] SUCCESS: Data packet received by Firestore handler.');
  } catch (error) {
    console.error('[Test] FAIL: Transmission error:', error.message);
  }
}

runTest();
