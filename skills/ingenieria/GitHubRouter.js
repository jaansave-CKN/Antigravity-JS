import express from 'express';
import { GitHubProvider } from './GitHubProvider.js';

export function createGitHubRouter() {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      const provider = new GitHubProvider(
        process.env.GITHUB_OWNER,
        process.env.GITHUB_REPO,
        process.env.GITHUB_TOKEN
      );
      const status = await provider.getRepoStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
