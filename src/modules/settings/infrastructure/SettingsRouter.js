import { Router } from 'express';

export function createSettingsRouter(saveTrelloUseCase) {
  const router = Router();

  router.post('/trello', async (req, res) => {
    const { apiKey, token } = req.body || {};
    if (typeof apiKey !== 'string' || typeof token !== 'string' || !apiKey.trim() || !token.trim()) {
      return res.status(400).json({ error: 'apiKey y token son requeridos como strings no vacíos.' });
    }
    try {
      const result = await saveTrelloUseCase.execute({ apiKey: apiKey.trim(), token: token.trim() });
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/trello', (_req, res) => {
    res.json({ message: 'Trello settings endpoint activo' });
  });

  return router;
}
