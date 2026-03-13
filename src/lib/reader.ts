/**
 * BufferReader — cursor-based binary reader for Bitcoin serialization formats.
 */
export class BufferReader {
  private buf: Buffer;
  private pos: number;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.pos = 0;
  }

  get position(): number { return this.pos; }
  get remaining(): number { return this.buf.length - this.pos; }
  get length(): number { return this.buf.length; }

  seek(pos: number): void { this.pos = pos; }
  skip(n: number): void { this.pos += n; }

  readUInt8(): number {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUInt16LE(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readUInt32LE(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readInt32LE(): number {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readUInt64LE(): bigint {
    const lo = BigInt(this.buf.readUInt32LE(this.pos));
    const hi = BigInt(this.buf.readUInt32LE(this.pos + 4));
    this.pos += 8;
    return (hi << 32n) | lo;
  }

  readVarInt(): number {
    const first = this.readUInt8();
    if (first < 0xfd) return first;
    if (first === 0xfd) return this.readUInt16LE();
    if (first === 0xfe) return this.readUInt32LE();
    return Number(this.readUInt64LE());
  }

  /** Bitcoin Core self-terminating VARINT (used in undo/coins serialization). */
  readBitcoinCoreVarInt(): number {
    let n = BigInt(0);
    while (true) {
      const b = this.readUInt8();
      n = (n << BigInt(7)) | BigInt(b & 0x7f);
      if (b & 0x80) { n++; } else { return Number(n); }
    }
  }

  readBytes(n: number): Buffer {
    if (this.pos + n > this.buf.length) {
      throw new Error(`BufferReader: tried to read ${n} bytes at pos ${this.pos} but buffer length is ${this.buf.length}`);
    }
    const slice = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(slice);
  }

  readHex(n: number): string {
    return this.readBytes(n).toString('hex');
  }

  /** Read n bytes and return reversed-hex (for txid/block-hash display convention). */
  readHashLE(n: number = 32): string {
    const bytes = this.readBytes(n);
    return Buffer.from(bytes).reverse().toString('hex');
  }

  peek(n: number = 1): Buffer {
    return this.buf.slice(this.pos, this.pos + n);
  }

  peekUInt8(): number {
    return this.buf.readUInt8(this.pos);
  }

  buffer(): Buffer { return this.buf; }

  slice(start: number, end?: number): Buffer {
    return this.buf.slice(start, end);
  }
}
