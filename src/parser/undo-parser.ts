import { BufferReader } from '../lib/reader.js';

const MAINNET_MAGIC = 0xd9b4bef9;

export interface UndoPrevout {
  value_sats: number;
  script_pubkey_hex: string;
}

export interface UndoBlock {
  // prevouts indexed by [txIndex][inputIndex] (txIndex excludes coinbase, so starts at tx index 1)
  txPrevouts: UndoPrevout[][];
}

/**
 * Parse all block undo records from a rev*.dat file (already XOR-decoded).
 * Returns one UndoBlock per block in the file, in order.
 */
export function parseUndoFile(data: Buffer): UndoBlock[] {
  const reader = new BufferReader(data);
  const blocks: UndoBlock[] = [];

  while (reader.remaining >= 8) {
    const magic = reader.readUInt32LE();
    if (magic !== MAINNET_MAGIC) break;

    const undoSize = reader.readUInt32LE();
    if (reader.remaining < undoSize) break;

    const undoStart = reader.position;
    const undoData = reader.slice(undoStart, undoStart + undoSize);
    const undoReader = new BufferReader(undoData);

    const block = parseUndoBlock(undoReader);
    blocks.push(block);
    reader.skip(undoSize);
  }

  return blocks;
}

function parseUndoBlock(reader: BufferReader): UndoBlock {
  // Number of transactions in undo (= number of non-coinbase txs in the block)
  const txCount = reader.readVarInt();
  const txPrevouts: UndoPrevout[][] = [];

  for (let t = 0; t < txCount; t++) {
    const inputCount = reader.readVarInt();
    const inputs: UndoPrevout[] = [];

    for (let i = 0; i < inputCount; i++) {
      // Coin data uses Bitcoin Core self-terminating VARINT throughout.
      // Format: coinMeta (VI) + 1 flag byte + compressedAmount (VI) + nSize (VI) + script bytes
      const _coinMeta = reader.readBitcoinCoreVarInt(); // height*2 + isCoinBase
      reader.skip(1); // extra flag byte present in serialized undo data
      const compressedAmount = reader.readBitcoinCoreVarInt();
      const valueSats = decompressAmount(compressedAmount);
      const scriptPubKeyHex = readCompressedScript(reader);
      inputs.push({ value_sats: valueSats, script_pubkey_hex: scriptPubKeyHex });
    }

    txPrevouts.push(inputs);
  }

  return { txPrevouts };
}

/**
 * Bitcoin Core's amount decompression.
 */
function decompressAmount(x: number): number {
  if (x === 0) return 0;
  x--;
  const e = x % 10;
  x = Math.floor(x / 10);
  let n = 0;
  if (e < 9) {
    const d = (x % 9) + 1;
    x = Math.floor(x / 9);
    n = x * 10 + d;
  } else {
    n = x + 1;
  }
  let result = n;
  for (let i = 0; i < e; i++) result *= 10;
  return result;
}

/**
 * Read a compressed script (Bitcoin Core's CScript compression).
 * nSize values:
 *   0 → P2PKH (20-byte hash follows → 76a914<20>88ac)
 *   1 → P2SH  (20-byte hash follows → a914<20>87)
 *   2 → P2PK compressed even (32-byte x-coord → 21 02<32> ac)
 *   3 → P2PK compressed odd  (32-byte x-coord → 21 03<32> ac)
 *   4 → P2PK uncompressed, y even (32-byte x-coord)
 *   5 → P2PK uncompressed, y odd  (32-byte x-coord)
 *  ≥6 → raw script, length = nSize - 6
 */
function readCompressedScript(reader: BufferReader): string {
  const nSize = reader.readBitcoinCoreVarInt();

  if (nSize === 0) {
    // P2PKH
    const hash = reader.readBytes(20);
    const script = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), hash, Buffer.from([0x88, 0xac])]);
    return script.toString('hex');
  }

  if (nSize === 1) {
    // P2SH
    const hash = reader.readBytes(20);
    const script = Buffer.concat([Buffer.from([0xa9, 0x14]), hash, Buffer.from([0x87])]);
    return script.toString('hex');
  }

  if (nSize === 2 || nSize === 3) {
    // P2PK compressed
    const prefix = nSize === 2 ? 0x02 : 0x03;
    const xCoord = reader.readBytes(32);
    const script = Buffer.concat([Buffer.from([0x21, prefix]), xCoord, Buffer.from([0xac])]);
    return script.toString('hex');
  }

  if (nSize === 4 || nSize === 5) {
    // P2PK uncompressed — reconstruct from x-coordinate
    const xCoord = reader.readBytes(32);
    const yCoord = computeYCoord(xCoord, nSize === 5); // odd if nSize === 5
    const pubkey = Buffer.concat([Buffer.from([0x04]), xCoord, yCoord]);
    const script = Buffer.concat([Buffer.from([0x41]), pubkey, Buffer.from([0xac])]);
    return script.toString('hex');
  }

  // Raw script
  const scriptLen = nSize - 6;
  const rawScript = reader.readBytes(scriptLen);
  return rawScript.toString('hex');
}

/**
 * Compute the y-coordinate of a secp256k1 point from x.
 * y^2 = x^3 + 7 (mod p)
 * Since p ≡ 3 (mod 4): y = (x^3 + 7)^((p+1)/4) (mod p)
 */
function computeYCoord(x: Buffer, oddY: boolean): Buffer {
  const p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
  const xBig = BigInt('0x' + x.toString('hex'));
  const rhs = (modPow(xBig, 3n, p) + 7n) % p;
  const exp = (p + 1n) / 4n;
  let y = modPow(rhs, exp, p);

  // Select correct parity
  if ((y % 2n === 1n) !== oddY) {
    y = p - y;
  }

  const yHex = y.toString(16).padStart(64, '0');
  return Buffer.from(yHex, 'hex');
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}
