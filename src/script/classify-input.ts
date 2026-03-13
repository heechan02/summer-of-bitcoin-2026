export type InputScriptType =
  | 'p2pkh'
  | 'p2sh-p2wpkh'
  | 'p2sh-p2wsh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2tr_keypath'
  | 'p2tr_scriptpath'
  | 'unknown';

/**
 * Classify the spend type of an input based on:
 * - prevout scriptPubKey
 * - scriptSig
 * - witness stack
 */
export function classifyInputScript(
  prevoutScript: Buffer,
  scriptSig: Buffer,
  witness: Buffer[]
): InputScriptType {
  const pLen = prevoutScript.length;

  // P2WPKH prevout: 00 14 <20>
  if (pLen === 22 && prevoutScript[0] === 0x00 && prevoutScript[1] === 0x14) {
    return 'p2wpkh';
  }

  // P2WSH prevout: 00 20 <32>
  if (pLen === 34 && prevoutScript[0] === 0x00 && prevoutScript[1] === 0x20) {
    return 'p2wsh';
  }

  // P2TR prevout: 51 20 <32>
  if (pLen === 34 && prevoutScript[0] === 0x51 && prevoutScript[1] === 0x20) {
    // Keypath: 1 witness item, 64 bytes (Schnorr sig) or 65 bytes (with sighash type)
    // Scriptpath: ≥2 witness items; the second-to-last is the script, the last is the control block
    // The control block's first byte has bits 0xfe which must be 0xc0 or 0xc1
    if (witness.length === 0) return 'unknown';

    // Strip annex (last item starting with 0x50)
    let items = [...witness];
    if (items.length >= 2 && items[items.length - 1][0] === 0x50) {
      items = items.slice(0, items.length - 1);
    }

    if (items.length === 1) {
      return 'p2tr_keypath';
    }

    if (items.length >= 2) {
      const controlBlock = items[items.length - 1];
      if (controlBlock.length > 0 && (controlBlock[0] & 0xfe) === 0xc0) {
        return 'p2tr_scriptpath';
      }
      // If it looks like scriptpath but control block doesn't match, still classify as scriptpath
      if (items.length >= 2) return 'p2tr_scriptpath';
    }

    return 'p2tr_keypath';
  }

  // P2SH prevout: a9 14 <20> 87
  if (pLen === 23 && prevoutScript[0] === 0xa9 && prevoutScript[1] === 0x14 && prevoutScript[22] === 0x87) {
    // Look at the last push in scriptSig to determine nested type
    const redeemScript = getLastPush(scriptSig);
    if (redeemScript) {
      const rLen = redeemScript.length;
      // P2WPKH program: 00 14 <20> (22 bytes)
      if (rLen === 22 && redeemScript[0] === 0x00 && redeemScript[1] === 0x14) {
        return 'p2sh-p2wpkh';
      }
      // P2WSH program: 00 20 <32> (34 bytes)
      if (rLen === 34 && redeemScript[0] === 0x00 && redeemScript[1] === 0x20) {
        return 'p2sh-p2wsh';
      }
    }
    return 'unknown';
  }

  // P2PKH prevout: 76 a9 14 <20> 88 ac
  if (pLen === 25 && prevoutScript[0] === 0x76 && prevoutScript[1] === 0xa9 && prevoutScript[2] === 0x14) {
    return 'p2pkh';
  }

  return 'unknown';
}

/** Extract the data from the last push opcode in a script. */
function getLastPush(script: Buffer): Buffer | null {
  if (script.length === 0) return null;
  let i = 0;
  let lastPush: Buffer | null = null;

  while (i < script.length) {
    const byte = script[i]; i++;
    if (byte >= 0x01 && byte <= 0x4b) {
      lastPush = script.slice(i, i + byte);
      i += byte;
    } else if (byte === 0x4c) {
      const n = script[i]; i++;
      lastPush = script.slice(i, i + n);
      i += n;
    } else if (byte === 0x4d) {
      const n = script.readUInt16LE(i); i += 2;
      lastPush = script.slice(i, i + n);
      i += n;
    } else if (byte === 0x4e) {
      const n = script.readUInt32LE(i); i += 4;
      lastPush = script.slice(i, i + n);
      i += n;
    } else {
      // non-push opcode; not a data push
    }
  }

  return lastPush;
}
