import express from 'express';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const PORT = process.env['PORT'] ?? '3000';
const OUT_DIR = path.resolve('out');
const PUBLIC_DIR = path.resolve('public');

const app = express();

/** GET /api/health — grader liveness check */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/blocks — list analyzed block stems from out/*.json
 * @returns Array of { stem } objects
 */
app.get('/api/blocks', (_req, res) => {
  try {
    const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json'));
    const stems = files.map(f => ({ stem: f.replace(/\.json$/, '') }));
    res.json(stems);
  } catch {
    res.json([]);
  }
});

/**
 * GET /api/blocks/:stem — full JSON for a single analyzed block file
 * @param stem - filename stem e.g. "blk04330"
 */
app.get('/api/blocks/:stem', async (req, res) => {
  const { stem } = req.params;
  if (!stem || /[/\\.]/.test(stem)) {
    res.status(400).json({ error: 'Invalid stem' });
    return;
  }
  const filePath = path.join(OUT_DIR, `${stem}.json`);
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    res.type('json').send(raw);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

/** GET / — serve the web UI */
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

app.listen(Number(PORT), '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}`);
});
