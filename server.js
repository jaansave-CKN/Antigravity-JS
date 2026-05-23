import express from 'express';
import { createServer } from 'http';
import { join } from 'path';
import { readFileSync } from 'fs';

const app = express();
const PORT = process.env.PORT || 10000;
const distPath = join(process.cwd(), 'dist');

app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

createServer(app).listen(PORT, () => {
  console.log(`Frontend serving on port ${PORT}`);
});
