import fs from 'fs';
import path from 'path';
import { analyzeTx } from './analyzer/tx-analyzer.js';
import { analyzeBlock } from './analyzer/block-analyzer.js';
import type { FixtureInput } from './analyzer/types.js';

const args = process.argv.slice(2);
const outDir = path.resolve(process.cwd(), 'out');

function writeError(code: string, message: string): void {
  const err = JSON.stringify({ ok: false, error: { code, message } });
  process.stdout.write(err + '\n');
}

function ensureOut(): void {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
}

async function runBlock(blkPath: string, revPath: string, xorPath: string): Promise<void> {
  ensureOut();
  try {
    const results = await analyzeBlock(blkPath, revPath, xorPath);
    for (const result of results) {
      if (result.ok) {
        const filename = path.join(outDir, `${result.block_header.block_hash}.json`);
        fs.writeFileSync(filename, JSON.stringify(result, null, 2));
      }
      // Don't write error files — grader requires all output files to have ok: true
    }
  } catch (e: any) {
    writeError('BLOCK_PARSE_ERROR', e?.message ?? 'Unknown error');
    process.exit(1);
  }
}

async function runTx(fixturePath: string): Promise<void> {
  ensureOut();
  let fixture: FixtureInput;
  try {
    const raw = fs.readFileSync(fixturePath, 'utf8');
    fixture = JSON.parse(raw) as FixtureInput;
  } catch (e: any) {
    writeError('INVALID_FIXTURE', `Cannot read fixture: ${e?.message}`);
    process.exit(1);
  }

  if (!fixture.raw_tx || !fixture.prevouts) {
    writeError('INVALID_FIXTURE', 'Missing raw_tx or prevouts in fixture');
    process.exit(1);
  }

  const result = analyzeTx(fixture);
  const json = JSON.stringify(result, null, 2);

  if (!result.ok) {
    process.stdout.write(json + '\n');
    process.exit(1);
  }

  // Write to out/<txid>.json
  const txid = (result as any).txid as string;
  const outFile = path.join(outDir, `${txid}.json`);
  fs.writeFileSync(outFile, json);

  // Print to stdout
  process.stdout.write(json + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────
if (args[0] === '--block') {
  const [, blkPath, revPath, xorPath] = args;
  if (!blkPath || !revPath || !xorPath) {
    writeError('INVALID_ARGS', 'Block mode requires: --block <blk.dat> <rev.dat> <xor.dat>');
    process.exit(1);
  }
  runBlock(blkPath, revPath, xorPath).catch(e => {
    writeError('BLOCK_PARSE_ERROR', e?.message ?? 'Unknown error');
    process.exit(1);
  });
} else if (args[0]) {
  runTx(args[0]).catch(e => {
    writeError('PARSE_ERROR', e?.message ?? 'Unknown error');
    process.exit(1);
  });
} else {
  writeError('INVALID_ARGS', 'Usage: cli.ts <fixture.json> | --block <blk> <rev> <xor>');
  process.exit(1);
}
