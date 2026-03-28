export type OutputScriptType = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'op_return' | 'unknown';

/**
 * Classify an output scriptPubKey into a known Bitcoin script type.
 * Pattern matching on raw bytes — no regex on hex strings.
 */
export function classifyOutputScript(script: Buffer): OutputScriptType {
  const len = script.length;

  // P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
  // 76 a9 14 <20 bytes> 88 ac  (25 bytes total)
  if (len === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[2] === 0x14 && script[23] === 0x88 && script[24] === 0xac) {
    return 'p2pkh';
  }

  // P2SH: OP_HASH160 <20> OP_EQUAL
  // a9 14 <20 bytes> 87  (23 bytes total)
  if (len === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) {
    return 'p2sh';
  }

  // P2WPKH: OP_0 <20>
  // 00 14 <20 bytes>  (22 bytes total)
  if (len === 22 && script[0] === 0x00 && script[1] === 0x14) {
    return 'p2wpkh';
  }

  // P2WSH: OP_0 <32>
  // 00 20 <32 bytes>  (34 bytes total)
  if (len === 34 && script[0] === 0x00 && script[1] === 0x20) {
    return 'p2wsh';
  }

  // P2TR: OP_1 <32>
  // 51 20 <32 bytes>  (34 bytes total)
  if (len === 34 && script[0] === 0x51 && script[1] === 0x20) {
    return 'p2tr';
  }

  // OP_RETURN: starts with 0x6a
  if (len >= 1 && script[0] === 0x6a) {
    return 'op_return';
  }

  return 'unknown';
}
