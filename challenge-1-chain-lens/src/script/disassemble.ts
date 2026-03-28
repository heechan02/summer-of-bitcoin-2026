import { opcodeName } from './opcodes.js';

/**
 * Disassemble a Bitcoin script buffer into its ASM string representation.
 */
export function disassemble(script: Buffer): string {
  if (script.length === 0) return '';
  const tokens: string[] = [];
  let i = 0;

  while (i < script.length) {
    const byte = script[i];
    i++;

    if (byte === 0x00) {
      // OP_0
      tokens.push('OP_0');
    } else if (byte >= 0x01 && byte <= 0x4b) {
      // Direct push of N bytes
      const n = byte;
      const data = script.slice(i, i + n).toString('hex');
      tokens.push(`OP_PUSHBYTES_${n} ${data}`);
      i += n;
    } else if (byte === 0x4c) {
      // OP_PUSHDATA1: 1-byte length follows
      const n = script[i]; i++;
      const data = script.slice(i, i + n).toString('hex');
      tokens.push(`OP_PUSHDATA1 ${data}`);
      i += n;
    } else if (byte === 0x4d) {
      // OP_PUSHDATA2: 2-byte LE length follows
      const n = script.readUInt16LE(i); i += 2;
      const data = script.slice(i, i + n).toString('hex');
      tokens.push(`OP_PUSHDATA2 ${data}`);
      i += n;
    } else if (byte === 0x4e) {
      // OP_PUSHDATA4: 4-byte LE length follows
      const n = script.readUInt32LE(i); i += 4;
      const data = script.slice(i, i + n).toString('hex');
      tokens.push(`OP_PUSHDATA4 ${data}`);
      i += n;
    } else if (byte === 0x4f) {
      tokens.push('OP_1NEGATE');
    } else if (byte >= 0x51 && byte <= 0x60) {
      // OP_1 through OP_16
      tokens.push(`OP_${byte - 0x50}`);
    } else {
      tokens.push(opcodeName(byte));
    }
  }

  return tokens.join(' ');
}

/**
 * Extract concatenated data from all push opcodes after OP_RETURN.
 * Handles OP_PUSHDATA1/2/4 and direct pushes.
 */
export function extractOpReturnData(script: Buffer): Buffer {
  if (script.length === 0 || script[0] !== 0x6a) return Buffer.alloc(0);
  let i = 1; // skip OP_RETURN
  const chunks: Buffer[] = [];

  while (i < script.length) {
    const byte = script[i]; i++;
    if (byte === 0x00) {
      chunks.push(Buffer.alloc(0));
    } else if (byte >= 0x01 && byte <= 0x4b) {
      chunks.push(script.slice(i, i + byte));
      i += byte;
    } else if (byte === 0x4c) {
      const n = script[i]; i++;
      chunks.push(script.slice(i, i + n));
      i += n;
    } else if (byte === 0x4d) {
      const n = script.readUInt16LE(i); i += 2;
      chunks.push(script.slice(i, i + n));
      i += n;
    } else if (byte === 0x4e) {
      const n = script.readUInt32LE(i); i += 4;
      chunks.push(script.slice(i, i + n));
      i += n;
    }
    // non-push opcodes after OP_RETURN are ignored
  }

  return Buffer.concat(chunks);
}
