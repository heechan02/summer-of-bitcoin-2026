import { BufferReader } from '../lib/reader.js';
import { hash256 } from '../lib/hash.js';
import type { ParsedTx, ParsedInput, ParsedOutput } from '../analyzer/types.js';

/**
 * Parse a raw Bitcoin transaction from hex or Buffer.
 * Supports both legacy and SegWit (BIP141) formats.
 */
export function parseTx(rawHex: string): ParsedTx {
  const raw = Buffer.from(rawHex, 'hex');
  return parseTxBuffer(raw);
}

export function parseTxBuffer(raw: Buffer): ParsedTx {
  const reader = new BufferReader(raw);

  const version = reader.readInt32LE();

  // Detect SegWit: after version, if next two bytes are 0x00 0x01
  let isSegwit = false;
  if (reader.remaining >= 2 && reader.peek(2)[0] === 0x00 && reader.peek(2)[1] === 0x01) {
    isSegwit = true;
    reader.skip(2); // consume marker and flag
  }

  // Parse inputs
  const vinCount = reader.readVarInt();
  const inputs: ParsedInput[] = [];
  for (let i = 0; i < vinCount; i++) {
    const txidRaw = reader.readBytes(32);
    const txid = Buffer.from(txidRaw).reverse().toString('hex');
    const vout = reader.readUInt32LE();
    const scriptSigLen = reader.readVarInt();
    const scriptSig = reader.readBytes(scriptSigLen);
    const sequence = reader.readUInt32LE();
    inputs.push({ txid, txidRaw, vout, scriptSig, sequence, witness: [] });
  }

  // Parse outputs
  const voutCount = reader.readVarInt();
  const outputs: ParsedOutput[] = [];
  for (let i = 0; i < voutCount; i++) {
    const value = reader.readUInt64LE();
    const scriptLen = reader.readVarInt();
    const scriptPubKey = reader.readBytes(scriptLen);
    outputs.push({ value, scriptPubKey });
  }

  // Parse witness data (one stack per input)
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

  // Full serialization (for wtxid)
  const fullSerialization = Buffer.from(raw.slice(0, reader.position));

  // Non-witness serialization (for txid): version + inputs + outputs + locktime
  // This is the raw tx WITHOUT the segwit marker/flag and WITHOUT witness data
  const nonWitnessSerialization = buildNonWitnessSerialization(version, inputs, outputs, locktime);

  // Compute txid: hash256 of non-witness serialization, bytes reversed
  const txidBytes = hash256(nonWitnessSerialization);
  const txid = Buffer.from(txidBytes).reverse().toString('hex');

  // Compute wtxid: hash256 of full serialization, bytes reversed (null for legacy)
  let wtxid: string | null = null;
  if (isSegwit) {
    const wtxidBytes = hash256(fullSerialization);
    wtxid = Buffer.from(wtxidBytes).reverse().toString('hex');
  }

  // Size metrics
  const sizeBytes = fullSerialization.length;
  const baseSize = nonWitnessSerialization.length;
  // witnessSize = everything that's not in the base size: marker(1) + flag(1) + witness stacks
  const witnessSize = sizeBytes - baseSize;
  // BIP141: weight = baseSize * 3 + totalSize = baseSize * 4 + witnessSize
  const weight = baseSize * 4 + witnessSize;
  const vbytes = Math.ceil(weight / 4);

  // Attach the computed txid to each parsed tx (needed later for the wtxid to match)
  const result: ParsedTx = {
    version,
    inputs,
    outputs,
    locktime,
    isSegwit,
    nonWitnessSerialization,
    fullSerialization,
    sizeBytes,
    baseSize,
    witnessSize,
    weight,
    vbytes,
  } as unknown as ParsedTx & { txid: string; wtxid: string | null };

  (result as any).txid = txid;
  (result as any).wtxid = wtxid;
  (result as any).weight = weight;
  (result as any).vbytes = vbytes;

  return result;
}

function writeVarInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b;
  }
  if (n <= 0xffffffff) {
    const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
  }
  throw new Error('VarInt too large');
}

function buildNonWitnessSerialization(
  version: number,
  inputs: ParsedInput[],
  outputs: ParsedOutput[],
  locktime: number
): Buffer {
  const parts: Buffer[] = [];

  // Version (4 bytes LE)
  const vBuf = Buffer.alloc(4); vBuf.writeInt32LE(version, 0);
  parts.push(vBuf);

  // Inputs
  parts.push(writeVarInt(inputs.length));
  for (const inp of inputs) {
    // txid stored as-is in the raw tx (not reversed)
    parts.push(Buffer.from(inp.txidRaw));
    const voutBuf = Buffer.alloc(4); voutBuf.writeUInt32LE(inp.vout, 0);
    parts.push(voutBuf);
    parts.push(writeVarInt(inp.scriptSig.length));
    parts.push(inp.scriptSig);
    const seqBuf = Buffer.alloc(4); seqBuf.writeUInt32LE(inp.sequence, 0);
    parts.push(seqBuf);
  }

  // Outputs
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const valBuf = Buffer.alloc(8);
    valBuf.writeBigInt64LE(out.value, 0);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }

  // Locktime (4 bytes LE)
  const ltBuf = Buffer.alloc(4); ltBuf.writeUInt32LE(locktime, 0);
  parts.push(ltBuf);

  return Buffer.concat(parts);
}
