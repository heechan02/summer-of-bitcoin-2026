import { BufferReader } from '../lib/reader.js';
import { hash256 } from '../lib/hash.js';
import type { ParsedTx } from '../analyzer/types.js';

const MAINNET_MAGIC = 0xd9b4bef9;

export interface BlockHeader {
  version: number;
  prev_block_hash: string;
  merkle_root: string;       // as stored in header (reversed display)
  merkle_root_raw: Buffer;   // raw 32 bytes from header (for verification)
  timestamp: number;
  bits: string;
  nonce: number;
  block_hash: string;
}

export interface ParsedBlock {
  header: BlockHeader;
  transactions: ParsedTx[];
  rawHeaderBytes: Buffer;
}

/**
 * XOR-decode a buffer using a repeating key.
 */
export function xorDecode(data: Buffer, key: Buffer): Buffer {
  if (key.length === 0 || key.every(b => b === 0)) return data;
  const result = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

/**
 * Parse all blocks from a blk*.dat file (already XOR-decoded).
 */
export function parseBlocks(data: Buffer): ParsedBlock[] {
  const reader = new BufferReader(data);
  const blocks: ParsedBlock[] = [];

  while (reader.remaining >= 8) {
    // Magic number
    const magic = reader.readUInt32LE();
    if (magic !== MAINNET_MAGIC) {
      // Skip to next magic or end
      break;
    }

    const blockSize = reader.readUInt32LE();
    if (reader.remaining < blockSize) break;

    const blockStart = reader.position;
    const blockData = reader.slice(blockStart, blockStart + blockSize);
    const blockReader = new BufferReader(blockData);

    // Parse 80-byte header
    const headerStart = blockReader.position;
    const version = blockReader.readInt32LE();
    const prevHashRaw = blockReader.readBytes(32);
    const merkleRootRaw = blockReader.readBytes(32);
    const timestamp = blockReader.readUInt32LE();
    const bits = blockReader.readUInt32LE();
    const nonce = blockReader.readUInt32LE();
    const headerEnd = blockReader.position;

    const rawHeaderBytes = blockData.slice(headerStart, headerEnd);
    const blockHashBytes = hash256(rawHeaderBytes);
    const blockHash = Buffer.from(blockHashBytes).reverse().toString('hex');
    const prevBlockHash = Buffer.from(prevHashRaw).reverse().toString('hex');
    const merkleRoot = Buffer.from(merkleRootRaw).reverse().toString('hex');
    const bitsHex = bits.toString(16).padStart(8, '0');

    const header: BlockHeader = {
      version,
      prev_block_hash: prevBlockHash,
      merkle_root: merkleRoot,
      merkle_root_raw: merkleRootRaw,
      timestamp,
      bits: bitsHex,
      nonce,
      block_hash: blockHash,
    };

    // Parse transactions
    const txCount = blockReader.readVarInt();
    const transactions: ParsedTx[] = [];

    for (let i = 0; i < txCount; i++) {
      const tx = parseTxFromReader(blockReader);
      transactions.push(tx);
    }

    blocks.push({ header, transactions, rawHeaderBytes });
    reader.skip(blockSize);
  }

  return blocks;
}

/**
 * Parse a single transaction from a BufferReader, advancing the reader.
 */
function parseTxFromReader(reader: BufferReader): ParsedTx {
  const start = reader.position;

  const version = reader.readInt32LE();

  let isSegwit = false;
  if (reader.remaining >= 2 && reader.peek(2)[0] === 0x00 && reader.peek(2)[1] === 0x01) {
    isSegwit = true;
    reader.skip(2);
  }

  const vinCount = reader.readVarInt();
  const inputs: any[] = [];
  for (let i = 0; i < vinCount; i++) {
    const txidRaw = reader.readBytes(32);
    const txid = Buffer.from(txidRaw).reverse().toString('hex');
    const vout = reader.readUInt32LE();
    const scriptLen = reader.readVarInt();
    const scriptSig = reader.readBytes(scriptLen);
    const sequence = reader.readUInt32LE();
    inputs.push({ txid, txidRaw, vout, scriptSig, sequence, witness: [] });
  }

  const voutCount = reader.readVarInt();
  const outputs: any[] = [];
  for (let i = 0; i < voutCount; i++) {
    const value = reader.readUInt64LE();
    const scriptLen = reader.readVarInt();
    const scriptPubKey = reader.readBytes(scriptLen);
    outputs.push({ value, scriptPubKey });
  }

  if (isSegwit) {
    for (let i = 0; i < inputs.length; i++) {
      const itemCount = reader.readVarInt();
      const witness: Buffer[] = [];
      for (let j = 0; j < itemCount; j++) {
        const itemLen = reader.readVarInt();
        witness.push(reader.readBytes(itemLen));
      }
      inputs[i].witness = witness;
    }
  }

  const locktime = reader.readUInt32LE();
  const end = reader.position;
  const fullSerialization = reader.slice(start, end);

  // Build txid from non-witness serialization
  const nonWitness = buildNonWitnessSer(version, inputs, outputs, locktime);
  const txidBytes = hash256(nonWitness);
  const txid = Buffer.from(txidBytes).reverse().toString('hex');

  let wtxid: string | null = null;
  if (isSegwit) {
    const wtxidBytes = hash256(fullSerialization);
    wtxid = Buffer.from(wtxidBytes).reverse().toString('hex');
  }

  const sizeBytes = end - start;
  const baseSize = nonWitness.length;
  const witnessSize = sizeBytes - baseSize;
  const weight = baseSize * 4 + witnessSize;
  const vbytes = Math.ceil(weight / 4);

  const tx: any = {
    version, inputs, outputs, locktime, isSegwit,
    nonWitnessSerialization: nonWitness, fullSerialization,
    sizeBytes, baseSize, witnessSize, weight, vbytes,
    txid, wtxid,
  };
  return tx as ParsedTx;
}

function writeVarInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}

function buildNonWitnessSer(version: number, inputs: any[], outputs: any[], locktime: number): Buffer {
  const parts: Buffer[] = [];
  const vBuf = Buffer.alloc(4); vBuf.writeInt32LE(version, 0); parts.push(vBuf);
  parts.push(writeVarInt(inputs.length));
  for (const inp of inputs) {
    parts.push(Buffer.from(inp.txidRaw));
    const vBuf2 = Buffer.alloc(4); vBuf2.writeUInt32LE(inp.vout, 0); parts.push(vBuf2);
    parts.push(writeVarInt(inp.scriptSig.length));
    parts.push(inp.scriptSig);
    const sBuf = Buffer.alloc(4); sBuf.writeUInt32LE(inp.sequence, 0); parts.push(sBuf);
  }
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const vBuf3 = Buffer.alloc(8); vBuf3.writeBigInt64LE(out.value, 0); parts.push(vBuf3);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  const ltBuf = Buffer.alloc(4); ltBuf.writeUInt32LE(locktime, 0); parts.push(ltBuf);
  return Buffer.concat(parts);
}

/**
 * Compute Merkle root from list of txid byte strings (in display order = reversed).
 * Bitcoin uses double-SHA256 on concatenated pairs.
 */
export function computeMerkleRoot(txids: string[]): string {
  if (txids.length === 0) return '0'.repeat(64);

  // Convert display txids to raw bytes (need to re-reverse for hashing)
  let hashes: Buffer<ArrayBufferLike>[] = txids.map(txid => Buffer.from(txid, 'hex').reverse());

  while (hashes.length > 1) {
    const next: Buffer<ArrayBufferLike>[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const a = hashes[i];
      const b = i + 1 < hashes.length ? hashes[i + 1] : hashes[i];
      next.push(hash256(Buffer.concat([a, b])));
    }
    hashes = next;
  }

  // Return in display convention (reversed)
  return Buffer.from(hashes[0]).reverse().toString('hex');
}
