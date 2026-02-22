import { parseTx } from '../parser/tx-parser.js';
import { classifyOutputScript } from '../script/classify-output.js';
import { classifyInputScript } from '../script/classify-input.js';
import { addressFromScript } from '../script/address.js';
import { disassemble, extractOpReturnData } from '../script/disassemble.js';
import type {
  FixtureInput, PrevoutInfo, TxAnalysisResult, VinEntry, VoutEntry,
  SegwitSavings, RelativeTimelock, ErrorResult, ParsedInput
} from './types.js';

const SEQUENCE_DISABLE_FLAG = 0x80000000;
const SEQUENCE_TYPE_FLAG = 0x00400000;
const SEQUENCE_MASK = 0x0000ffff;
const RBF_SEQUENCE_THRESHOLD = 0xfffffffe; // < this = RBF

export function analyzeTx(fixture: FixtureInput): TxAnalysisResult | ErrorResult {
  try {
    const parsed = parseTx(fixture.raw_tx) as any;
    const { version, inputs, outputs, locktime, isSegwit } = parsed;

    // ── Prevout matching ──────────────────────────────────────────────────
    const prevoutMap = new Map<string, PrevoutInfo>();
    for (const p of fixture.prevouts) {
      const key = `${p.txid.toLowerCase()}:${p.vout}`;
      if (prevoutMap.has(key)) {
        return errorResult('INVALID_PREVOUTS', `Duplicate prevout: ${key}`);
      }
      prevoutMap.set(key, p);
    }

    const resolvedPrevouts: PrevoutInfo[] = [];
    for (const inp of inputs) {
      const key = `${inp.txid.toLowerCase()}:${inp.vout}`;
      const p = prevoutMap.get(key);
      if (!p) {
        return errorResult('MISSING_PREVOUT', `Missing prevout for input ${inp.txid}:${inp.vout}`);
      }
      resolvedPrevouts.push(p);
    }
    if (prevoutMap.size !== inputs.length) {
      return errorResult('INVALID_PREVOUTS', 'Prevout count does not match input count');
    }

    // ── Accounting ────────────────────────────────────────────────────────
    const totalInputSats = resolvedPrevouts.reduce((s, p) => s + p.value_sats, 0);
    const totalOutputSats = outputs.reduce((s: number, o: any) => s + Number(o.value), 0);
    const feeSats = totalInputSats - totalOutputSats;
    if (feeSats < 0) {
      return errorResult('INVALID_TX', 'Output value exceeds input value');
    }

    // ── Size / Weight ──────────────────────────────────────────────────────
    const sizeBytes: number = parsed.sizeBytes;
    const baseSize: number = parsed.baseSize;
    const witnessSize: number = parsed.witnessSize;
    const weight: number = parsed.weight;
    const vbytes: number = parsed.vbytes;

    // ── RBF ───────────────────────────────────────────────────────────────
    const rbfSignaling = inputs.some((inp: ParsedInput) => inp.sequence < RBF_SEQUENCE_THRESHOLD);

    // ── Locktime type ─────────────────────────────────────────────────────
    let locktimeType: 'none' | 'block_height' | 'unix_timestamp' = 'none';
    if (locktime > 0) {
      locktimeType = locktime < 500_000_000 ? 'block_height' : 'unix_timestamp';
    }

    // ── SegWit savings ────────────────────────────────────────────────────
    let segwitSavings: SegwitSavings | null = null;
    if (isSegwit) {
      // witness_bytes = everything in the witness section (marker + flag + stacks)
      // non_witness_bytes = total_bytes - witness_bytes
      const witnessBytes = witnessSize;
      const nonWitnessBytes = sizeBytes - witnessBytes;
      const weightIfLegacy = sizeBytes * 4;
      const savingsPct = Math.round(((weightIfLegacy - weight) / weightIfLegacy) * 10000) / 100;
      segwitSavings = {
        witness_bytes: witnessBytes,
        non_witness_bytes: nonWitnessBytes,
        total_bytes: sizeBytes,
        weight_actual: weight,
        weight_if_legacy: weightIfLegacy,
        savings_pct: savingsPct,
      };
    }

    // ── Build vin[] ───────────────────────────────────────────────────────
    const vin: VinEntry[] = inputs.map((inp: ParsedInput, i: number) => {
      const prevout = resolvedPrevouts[i];
      const prevoutScript = Buffer.from(prevout.script_pubkey_hex, 'hex');
      const scriptType = classifyInputScript(prevoutScript, inp.scriptSig, inp.witness);
      const address = addressFromScript(prevoutScript);
      const scriptSigHex = inp.scriptSig.toString('hex');
      const scriptAsm = disassemble(inp.scriptSig);
      const witnessHex = inp.witness.map((w: Buffer) => w.toString('hex'));

      // Relative timelock (BIP68)
      const rtl = parseRelativeTimelock(inp.sequence, version);

      const vinEntry: VinEntry = {
        txid: inp.txid,
        vout: inp.vout,
        sequence: inp.sequence,
        script_sig_hex: scriptSigHex,
        script_asm: scriptAsm,
        witness: witnessHex,
        script_type: scriptType,
        address,
        prevout: {
          value_sats: prevout.value_sats,
          script_pubkey_hex: prevout.script_pubkey_hex,
        },
        relative_timelock: rtl,
      };

      // witness_script_asm for p2wsh / p2sh-p2wsh
      if ((scriptType === 'p2wsh' || scriptType === 'p2sh-p2wsh') && inp.witness.length > 0) {
        const witnessScript = inp.witness[inp.witness.length - 1];
        vinEntry.witness_script_asm = disassemble(witnessScript);
      }

      return vinEntry;
    });

    // ── Build vout[] ──────────────────────────────────────────────────────
    const vout: VoutEntry[] = outputs.map((out: any, n: number) => {
      const script = out.scriptPubKey as Buffer;
      const scriptType = classifyOutputScript(script);
      const scriptPubKeyHex = script.toString('hex');
      const scriptAsm = disassemble(script);
      const address = addressFromScript(script);
      const valueSats = Number(out.value);

      const voutEntry: VoutEntry = {
        n,
        value_sats: valueSats,
        script_pubkey_hex: scriptPubKeyHex,
        script_asm: scriptAsm,
        script_type: scriptType,
        address,
      };

      if (scriptType === 'op_return') {
        const data = extractOpReturnData(script);
        const dataHex = data.toString('hex');
        let dataUtf8: string | null = null;
        try { dataUtf8 = data.toString('utf8'); } catch { dataUtf8 = null; }
        // Validate UTF-8 (Buffer.toString doesn't throw, check for replacement char heuristic)
        if (data.length > 0 && !Buffer.from(dataUtf8 ?? '', 'utf8').equals(data)) {
          dataUtf8 = null;
        }
        let protocol = 'unknown';
        if (dataHex.startsWith('6f6d6e69')) protocol = 'omni';
        else if (dataHex.startsWith('0109f91102')) protocol = 'opentimestamps';

        voutEntry.op_return_data_hex = dataHex;
        voutEntry.op_return_data_utf8 = dataUtf8;
        voutEntry.op_return_protocol = protocol;
        voutEntry.address = null;
      }

      return voutEntry;
    });

    // ── Warnings ──────────────────────────────────────────────────────────
    const warnings: { code: string }[] = [];
    const feeRateSatVb = vbytes > 0 ? Math.round((feeSats / vbytes) * 100) / 100 : 0;

    if (feeSats > 1_000_000 || feeRateSatVb > 200) {
      warnings.push({ code: 'HIGH_FEE' });
    }
    if (vout.some(o => o.script_type !== 'op_return' && o.value_sats < 546)) {
      warnings.push({ code: 'DUST_OUTPUT' });
    }
    if (vout.some(o => o.script_type === 'unknown')) {
      warnings.push({ code: 'UNKNOWN_OUTPUT_SCRIPT' });
    }
    if (rbfSignaling) {
      warnings.push({ code: 'RBF_SIGNALING' });
    }

    return {
      ok: true,
      network: fixture.network,
      segwit: isSegwit,
      txid: parsed.txid,
      wtxid: parsed.wtxid ?? null,
      version,
      locktime,
      size_bytes: sizeBytes,
      weight,
      vbytes,
      total_input_sats: totalInputSats,
      total_output_sats: totalOutputSats,
      fee_sats: feeSats,
      fee_rate_sat_vb: feeRateSatVb,
      rbf_signaling: rbfSignaling,
      locktime_type: locktimeType,
      locktime_value: locktime,
      segwit_savings: segwitSavings,
      vin,
      vout,
      warnings,
    };
  } catch (e: any) {
    return errorResult('PARSE_ERROR', e?.message ?? 'Unknown parse error');
  }
}

function parseRelativeTimelock(sequence: number, version: number): RelativeTimelock {
  if (version < 2 || (sequence & SEQUENCE_DISABLE_FLAG) !== 0) {
    return { enabled: false };
  }
  if ((sequence & SEQUENCE_TYPE_FLAG) !== 0) {
    const value = (sequence & SEQUENCE_MASK) * 512; // seconds
    return { enabled: true, type: 'time', value };
  }
  const value = sequence & SEQUENCE_MASK;
  return { enabled: true, type: 'blocks', value };
}

function errorResult(code: string, message: string): ErrorResult {
  return { ok: false, error: { code, message } };
}
