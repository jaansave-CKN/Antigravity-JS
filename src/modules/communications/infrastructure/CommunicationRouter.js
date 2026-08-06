import { Router } from 'express';

export function createCommunicationRouter(sendEmailUseCase) {
  const router = Router();

  router.post('/communications/email', async (req, res) => {
    try {
      const { email, subject, content } = req.body;
      if (!email || !content) {
        return res.status(400).json({ error: 'email y content son requeridos' });
      }
      const result = await sendEmailUseCase.execute(email, subject || 'Antigravity OS', content);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
