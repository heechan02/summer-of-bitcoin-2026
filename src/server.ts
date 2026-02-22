import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeTx } from './analyzer/tx-analyzer.js';
import { analyzeBlock } from './analyzer/block-analyzer.js';
import type { FixtureInput } from './analyzer/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ── Analyze transaction ───────────────────────────────────────────────────
app.post('/api/analyze', (req, res) => {
  const fixture = req.body as FixtureInput;
  if (!fixture || !fixture.raw_tx || !fixture.prevouts) {
    return res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: 'Missing raw_tx or prevouts' } });
  }
  const result = analyzeTx(fixture);
  return res.status(result.ok ? 200 : 400).json(result);
});

// ── Analyze block ─────────────────────────────────────────────────────────
app.post('/api/analyze-block', async (req, res) => {
  const { blk_path, rev_path, xor_path } = req.body as { blk_path?: string; rev_path?: string; xor_path?: string };
  if (!blk_path || !rev_path || !xor_path) {
    return res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: 'Missing blk_path, rev_path, or xor_path' } });
  }
  try {
    const results = await analyzeBlock(blk_path, rev_path, xor_path);
    return res.json({ ok: true, blocks: results });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: { code: 'BLOCK_ERROR', message: e?.message ?? 'Unknown error' } });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  // URL already printed by web.sh before exec
});
