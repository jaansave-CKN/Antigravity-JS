import { Router } from 'express';
import { validateBody, schemas } from '../../../shared/infrastructure/validation.js';

export function createCommunicationRouter(sendEmailUseCase) {
  const router = Router();

  router.post('/communications/email', validateBody(schemas.sendEmail), async (req, res) => {
    try {
      const { email, subject, content } = req.body;
      const result = await sendEmailUseCase.execute(email, subject || 'Antigravity OS', content);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
