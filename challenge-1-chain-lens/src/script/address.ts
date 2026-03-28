import { hash256 } from '../lib/hash.js';

// ─── Base58Check ───────────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buf: Buffer): string {
  // Count leading zero bytes
  let leadingZeros = 0;
  for (const b of buf) { if (b !== 0) break; leadingZeros++; }

  // Convert to BigInt and repeatedly divide by 58
  let num = BigInt('0x' + buf.toString('hex'));
  const digits: number[] = [];
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    digits.push(rem);
  }

  // Build result
  const result = '1'.repeat(leadingZeros) + digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
  return result;
}

export function base58check(versionByte: number, payload: Buffer): string {
  const full = Buffer.concat([Buffer.from([versionByte]), payload]);
  const checksum = hash256(full).slice(0, 4);
  return base58Encode(Buffer.concat([full, checksum]));
}

// ─── Bech32 / Bech32m ──────────────────────────────────────────────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function bech32CreateChecksum(hrp: string, data: number[], constant: number): number[] {
  const values = [...bech32HrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ constant;
  return Array.from({ length: 6 }, (_, i) => (polymod >> (5 * (5 - i))) & 31);
}

/** Convert bytes to 5-bit groups. */
function convertbits(data: Buffer, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0, bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const v of data) {
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  return ret;
}

function bech32Encode(hrp: string, witVer: number, witProg: Buffer): string {
  const constant = witVer === 0 ? BECH32_CONST : BECH32M_CONST;
  const data = [witVer, ...convertbits(witProg, 8, 5, true)];
  const checksum = bech32CreateChecksum(hrp, data, constant);
  const combined = [...data, ...checksum];
  return hrp + '1' + combined.map(d => BECH32_CHARSET[d]).join('');
}

// ─── Public API ────────────────────────────────────────────────────────────

export function p2pkhAddress(hash: Buffer): string {
  return base58check(0x00, hash); // mainnet prefix 0x00
}

export function p2shAddress(hash: Buffer): string {
  return base58check(0x05, hash); // mainnet prefix 0x05
}

export function p2wpkhAddress(hash: Buffer): string {
  return bech32Encode('bc', 0, hash);
}

export function p2wshAddress(hash: Buffer): string {
  return bech32Encode('bc', 0, hash);
}

export function p2trAddress(xonlyKey: Buffer): string {
  return bech32Encode('bc', 1, xonlyKey);
}

/** Derive address from scriptPubKey buffer. Returns null for unknown scripts. */
export function addressFromScript(script: Buffer): string | null {
  const len = script.length;

  // P2PKH: 76 a9 14 <20> 88 ac
  if (len === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[2] === 0x14) {
    return p2pkhAddress(script.slice(3, 23));
  }
  // P2SH: a9 14 <20> 87
  if (len === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) {
    return p2shAddress(script.slice(2, 22));
  }
  // P2WPKH: 00 14 <20>
  if (len === 22 && script[0] === 0x00 && script[1] === 0x14) {
    return p2wpkhAddress(script.slice(2, 22));
  }
  // P2WSH: 00 20 <32>
  if (len === 34 && script[0] === 0x00 && script[1] === 0x20) {
    return p2wshAddress(script.slice(2, 34));
  }
  // P2TR: 51 20 <32>
  if (len === 34 && script[0] === 0x51 && script[1] === 0x20) {
    return p2trAddress(script.slice(2, 34));
  }
  return null;
}
