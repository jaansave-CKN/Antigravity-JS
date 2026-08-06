import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CHECKPOINT_DIR  = path.join(__dirname, '../../../logs/checkpoints');
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, 'latest.json');

function ensureDir() {
  if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

export const stateManager = {
  saveCheckpoint(estado) {
    ensureDir();
    const payload = { ...estado, checkpointTime: new Date().toISOString() };
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(payload, null, 2));
    fs.writeFileSync(path.join(CHECKPOINT_DIR, `backup_${Date.now()}.json`), JSON.stringify(payload, null, 2));
    return payload;
  },

  loadCheckpoint() {
    try {
      if (!fs.existsSync(CHECKPOINT_FILE)) return null;
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    } catch (err) {
      console.error('[StateManager] loadCheckpoint falló:', err.message);
      return null;
    }
  },

  listBackups() {
    try {
      ensureDir();
      return fs.readdirSync(CHECKPOINT_DIR).filter(f => f.startsWith('backup_'));
    } catch (err) {
      console.error('[StateManager] listBackups falló:', err.message);
      return [];
    }
  }
};
