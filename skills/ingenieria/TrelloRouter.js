import express from 'express';
import { db } from '../../src/shared/infrastructure/FirebaseAdmin.js';
import { TrelloProvider } from './TrelloProvider.js';

export function createTrelloRouter() {
  const router = express.Router();

  async function getProvider() {
    const configDoc = await db.collection('settings').doc('trello').get();
    if (!configDoc.exists) {
      throw new Error('CONFIG_MISSING: Trello credentials not found in Cloud Firestore.');
    }
    const { apiKey, token } = configDoc.data();
    return new TrelloProvider(apiKey, token);
  }

  router.get('/status', async (req, res) => {
    try {
      const configDoc = await db.collection('settings').doc('trello').get();
      if (!configDoc.exists) {
        return res.json({ configured: false, message: 'Trello credentials not configured' });
      }
      return res.json({ configured: true, message: 'Trello credentials found in Firestore' });
    } catch (error) {
      res.status(500).json({ configured: false, error: error.message });
    }
  });

  router.get('/boards', async (req, res) => {
    try {
      const provider = await getProvider();
      const boards = await provider.getBoards();
      res.json(boards);
    } catch (error) {
      console.error('[TRELLO] Boards Error:', error.message);
      if (error.message.includes('invalid key') || error.message.includes('not valid')) {
        return res.status(502).json({ 
          error: 'CREDENTIALS_EXPIRED', 
          message: 'Trello API credentials are invalid or expired',
          action: 'Generate new credentials at https://trello.com/app-key',
          steps: [
            '1. Go to https://trello.com/app-key',
            '2. Generate a new API Key',
            '3. Generate a new Token (authorize your account)',
            '4. Update .env with new credentials',
            '5. Run: node scripts/sync_trello.js'
          ]
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/boards/:boardId/lists', async (req, res) => {
    try {
      const provider = await getProvider();
      const lists = await provider.getLists(req.params.boardId);
      res.json(lists);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/boards/:boardId/cards', async (req, res) => {
    try {
      const provider = await getProvider();
      const cards = await provider.getBoardCards(req.params.boardId);
      res.json(cards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/boards/:boardId/labels', async (req, res) => {
    try {
      const provider = await getProvider();
      const labels = await provider.getLabels(req.params.boardId);
      res.json(labels);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/lists/:listId/cards', async (req, res) => {
    try {
      const provider = await getProvider();
      const cards = await provider.getCards(req.params.listId);
      res.json(cards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/cards', async (req, res) => {
    try {
      const { listId, name, desc } = req.body;
      if (!listId || !name) {
        return res.status(400).json({ error: 'listId and name are required' });
      }
      const provider = await getProvider();
      const card = await provider.createCard(listId, name, desc);
      res.json(card);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/cards/:cardId', async (req, res) => {
    try {
      const provider = await getProvider();
      const card = await provider.updateCard(req.params.cardId, req.body);
      res.json(card);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/cards/:cardId', async (req, res) => {
    try {
      const provider = await getProvider();
      const result = await provider.deleteCard(req.params.cardId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/cards/:cardId/labels', async (req, res) => {
    try {
      const { labelId } = req.body;
      if (!labelId) {
        return res.status(400).json({ error: 'labelId is required' });
      }
      const provider = await getProvider();
      const result = await provider.addLabelToCard(req.params.cardId, labelId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}