// ============================================================================
// THE COIN SMITH'S FORGE - CLIENT-SIDE LOGIC
// ============================================================================

// ============================================================================
// STATE
// ============================================================================

let currentTransaction = null;

// Sample fixtures mapping
const SAMPLE_FIXTURES = {
  'basic_change_p2wpkh': 'fixtures/basic_change_p2wpkh.json',
  'send_all_dust_change': 'fixtures/send_all_dust_change.json',
  'rbf_basic': 'fixtures/rbf_basic.json',
  'locktime_block_height': 'fixtures/locktime_block_height.json',
  'anti_fee_sniping': 'fixtures/anti_fee_sniping.json',
  'mixed_input_types': 'fixtures/mixed_input_types.json',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format large numbers with commas
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Truncate hex strings for display
 */
function truncateHex(hex, prefixLen = 8, suffixLen = 8) {
  if (hex.length <= prefixLen + suffixLen) return hex;
  return `${hex.slice(0, prefixLen)}...${hex.slice(-suffixLen)}`;
}

/**
 * Map script type to metal grade
 */
function getMetalType(scriptType) {
  const metals = {
    'p2tr': { name: 'Gold (Taproot)', class: 'metal-gold', emoji: '⚡', vbytes: '~58 vB' },
    'p2wpkh': { name: 'Silver (Native SegWit)', class: 'metal-silver', emoji: '🥈', vbytes: '~68 vB' },
    'p2sh-p2wpkh': { name: 'Bronze (Nested SegWit)', class: 'metal-bronze', emoji: '🥉', vbytes: '~91 vB' },
    'p2pkh': { name: 'Iron (Legacy)', class: 'metal-iron', emoji: '⚫', vbytes: '~148 vB' },
  };
  return metals[scriptType] || { name: 'Unknown', class: 'metal-iron', emoji: '❓', vbytes: '?' };
}

/**
 * Get fire intensity class based on fee rate
 */
function getFireIntensity(feeRate) {
  if (feeRate < 5) return 'cold';
  if (feeRate < 20) return 'warm';
  if (feeRate < 50) return 'hot';
  return 'very-hot';
}

/**
 * Show error message
 */
function showError(title, message) {
  const errorDisplay = document.getElementById('errorDisplay');
  errorDisplay.innerHTML = `
    <h3>❌ ${title}</h3>
    <p>${message}</p>
  `;
  errorDisplay.classList.remove('hidden');
  document.getElementById('transactionView').classList.add('hidden');
}

/**
 * Hide error message
 */
function hideError() {
  document.getElementById('errorDisplay').classList.add('hidden');
}

// ============================================================================
// RENDERING FUNCTIONS
// ============================================================================

/**
 * Render the entire transaction view
 */
function renderTransaction(report) {
  hideError();
  document.getElementById('transactionView').classList.remove('hidden');

  renderInputs(report.selected_inputs);
  renderOutputs(report.outputs, report.change_index);
  renderBalance(report);
  renderFeeInfo(report);
  renderTechniques(report);
  renderWarnings(report.warnings);
  renderPSBT(report.psbt_base64);
}

/**
 * Render input materials
 */
function renderInputs(inputs) {
  const list = document.getElementById('inputsList');
  const total = inputs.reduce((sum, inp) => sum + inp.value_sats, 0);

  list.innerHTML = inputs.map(inp => {
    const metal = getMetalType(inp.script_type);
    return `
      <div class="material-item ${metal.class}">
        <div class="metal-type">${metal.emoji} ${metal.name}</div>
        <div class="value">${formatNumber(inp.value_sats)} sats</div>
        <div class="txid">${truncateHex(inp.txid)}:${inp.vout}</div>
        <div style="font-size: 0.75rem; color: var(--metal-iron); margin-top: 0.25rem;">
          ${metal.vbytes}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('inputsTotal').textContent = formatNumber(total);
}

/**
 * Render output coins
 */
function renderOutputs(outputs, changeIndex) {
  const list = document.getElementById('outputsList');
  const total = outputs.reduce((sum, out) => sum + out.value_sats, 0);

  list.innerHTML = outputs.map((out, idx) => {
    const isChange = idx === changeIndex;
    const metal = getMetalType(out.script_type);
    return `
      <div class="coin-item ${isChange ? 'change' : ''}">
        ${isChange ? '<div class="change-badge">♻️ CHANGE</div>' : ''}
        <div class="metal-type">${metal.emoji} ${isChange ? 'Leftover Metal' : 'Payment'}</div>
        <div class="value">${formatNumber(out.value_sats)} sats</div>
        <div style="font-size: 0.75rem; color: var(--metal-iron); margin-top: 0.25rem;">
          ${metal.name}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('outputsTotal').textContent = formatNumber(total);
}

/**
 * Render balance equation
 */
function renderBalance(report) {
  const totalInputs = report.selected_inputs.reduce((sum, inp) => sum + inp.value_sats, 0);
  const totalOutputs = report.outputs.reduce((sum, out) => sum + out.value_sats, 0);
  const fee = report.fee_sats;

  const eq = document.getElementById('balanceEq');
  eq.innerHTML = `
    <div class="eq-inputs">${formatNumber(totalInputs)} sats</div>
    <div class="eq-equals">=</div>
    <div class="eq-outputs">${formatNumber(totalOutputs)} sats</div>
    <div class="eq-plus">+</div>
    <div class="eq-fee">${formatNumber(fee)} sats fee</div>
  `;
}

/**
 * Render fee and forge fire
 */
function renderFeeInfo(report) {
  const feeRate = report.fee_rate_sat_vb;
  const vbytes = report.vbytes;

  // Update fee rate display
  document.getElementById('feeRateDisplay').textContent = `${feeRate.toFixed(2)} sat/vB`;

  // Update fire intensity
  const fire = document.getElementById('forgefire');
  if (fire) {
    fire.className = 'fire ' + getFireIntensity(feeRate);
  }

  // Update vbytes
  document.getElementById('vbytesDisplay').innerHTML = `
    Transaction Size: <span>${vbytes} vB</span>
  `;
}

/**
 * Render smithing techniques (RBF, Locktime, Strategy)
 */
function renderTechniques(report) {
  // RBF
  const rbfCard = document.getElementById('rbfCard');
  const rbfStatus = rbfCard.querySelector('.technique-status');
  if (report.rbf_signaling) {
    rbfStatus.innerHTML = `
      <div class="status-enabled">✅ Enabled</div>
      <p style="margin-top: 0.5rem; font-size: 0.9rem;">
        This transaction can be "reforged" with a higher fee to confirm faster.
        All inputs use nSequence ≤ 0xFFFFFFFD.
      </p>
    `;
  } else {
    rbfStatus.innerHTML = `
      <div class="status-disabled">❌ Disabled</div>
      <p style="margin-top: 0.5rem; font-size: 0.9rem;">
        This transaction is final and cannot be replaced.
      </p>
    `;
  }

  // Locktime
  const locktimeCard = document.getElementById('locktimeCard');
  const locktimeStatus = locktimeCard.querySelector('.technique-status');
  if (report.locktime_type === 'none') {
    locktimeStatus.innerHTML = `
      <div class="status-disabled">No Cooling Period</div>
      <p style="margin-top: 0.5rem; font-size: 0.9rem;">
        Can be confirmed immediately (nLockTime = 0).
      </p>
    `;
  } else if (report.locktime_type === 'block_height') {
    locktimeStatus.innerHTML = `
      <div class="status-enabled">⏰ Block Height: ${formatNumber(report.locktime)}</div>
      <p style="margin-top: 0.5rem; font-size: 0.9rem;">
        Cannot be confirmed before block ${formatNumber(report.locktime)}.
      </p>
    `;
  } else {
    const date = new Date(report.locktime * 1000);
    locktimeStatus.innerHTML = `
      <div class="status-enabled">⏰ Unix Timestamp: ${formatNumber(report.locktime)}</div>
      <p style="margin-top: 0.5rem; font-size: 0.9rem;">
        Cannot be confirmed before ${date.toLocaleString()}.
      </p>
    `;
  }

  // Strategy
  const strategyCard = document.getElementById('strategyCard');
  const strategyStatus = strategyCard.querySelector('.technique-status');
  const strategyName = report.strategy === 'branch-and-bound' ? 'Branch-and-Bound' : 'Greedy (Largest-First)';
  const strategyDesc = report.strategy === 'branch-and-bound'
    ? 'Found exact match with no change needed (most efficient).'
    : 'Selected largest UTXOs first to meet payment target.';
  strategyStatus.innerHTML = `
    <div class="status-enabled">${strategyName}</div>
    <p style="margin-top: 0.5rem; font-size: 0.9rem;">
      ${strategyDesc}<br>
      Selected ${report.selected_inputs.length} input(s).
    </p>
  `;
}

/**
 * Render warning stamps
 */
function renderWarnings(warnings) {
  const list = document.getElementById('warningsList');

  if (warnings.length === 0) {
    list.innerHTML = '<div class="no-warnings">✅ All Quality Checks Passed</div>';
    return;
  }

  const warningDefs = {
    'HIGH_FEE': {
      title: '🔥 FORGE TOO HOT!',
      desc: 'Fee exceeds 1,000,000 sats or rate > 200 sat/vB. Check if this is intentional.',
    },
    'DUST_CHANGE': {
      title: '✨ METAL FRAGMENT TOO SMALL',
      desc: 'Change output is less than 546 sats (dust threshold). Too small to be useful.',
    },
    'SEND_ALL': {
      title: '💨 ALL METAL CONSUMED',
      desc: 'No change output created. All leftover metal became fuel (fee). This is a send-all transaction.',
    },
    'RBF_SIGNALING': {
      title: '⚡ REWORK ALLOWED',
      desc: 'Transaction signals Replace-By-Fee. Can be reforged with higher fee if needed.',
    },
  };

  list.innerHTML = warnings.map(w => {
    const def = warningDefs[w.code] || { title: w.code, desc: 'No description available.' };
    return `
      <div class="warning-card warning-${w.code}">
        <h4>${def.title}</h4>
        <p>${def.desc}</p>
      </div>
    `;
  }).join('');
}

/**
 * Render PSBT blueprint
 */
function renderPSBT(psbtBase64) {
  document.getElementById('psbtDisplay').value = psbtBase64;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle sample selector change
 */
async function loadSample(sampleName) {
  if (!sampleName) return;

  try {
    const response = await fetch(`/${SAMPLE_FIXTURES[sampleName]}`);
    if (!response.ok) {
      throw new Error(`Failed to load sample: ${response.statusText}`);
    }
    const fixtureJson = await response.json();
    document.getElementById('fixtureInput').value = JSON.stringify(fixtureJson, null, 2);
  } catch (error) {
    showError('Load Error', `Could not load sample fixture: ${error.message}`);
  }
}

/**
 * Handle build button click
 */
async function buildTransaction() {
  const fixtureText = document.getElementById('fixtureInput').value.trim();

  if (!fixtureText) {
    showError('Empty Fixture', 'Please paste a fixture JSON or select a sample.');
    return;
  }

  try {
    // Parse fixture JSON
    const fixtureJson = JSON.parse(fixtureText);

    // Show loading state
    const buildBtn = document.getElementById('buildBtn');
    const originalText = buildBtn.textContent;
    buildBtn.textContent = '⚒️ Forging...';
    buildBtn.disabled = true;

    // Call API
    const response = await fetch('/api/build', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fixtureJson),
    });

    const result = await response.json();

    // Reset button
    buildBtn.textContent = originalText;
    buildBtn.disabled = false;

    if (!result.ok) {
      showError(
        result.error?.code || 'Build Error',
        result.error?.message || 'An unknown error occurred.'
      );
      return;
    }

    // Success! Render transaction
    currentTransaction = result;
    renderTransaction(result);

  } catch (error) {
    showError('Build Error', `Failed to build transaction: ${error.message}`);

    // Reset button
    const buildBtn = document.getElementById('buildBtn');
    buildBtn.textContent = '🔨 Forge Transaction';
    buildBtn.disabled = false;
  }
}

/**
 * Handle PSBT copy button
 */
function copyPSBT() {
  const psbtDisplay = document.getElementById('psbtDisplay');
  psbtDisplay.select();
  psbtDisplay.setSelectionRange(0, 99999); // For mobile

  try {
    document.execCommand('copy');
    const copyBtn = document.getElementById('copyPsbtBtn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (error) {
    alert('Failed to copy PSBT. Please manually select and copy the text.');
  }
}

/**
 * Toggle glossary sidebar
 */
function toggleGlossary() {
  const content = document.getElementById('glossaryContent');
  const isHidden = content.classList.contains('hidden');

  if (isHidden) {
    // Show glossary
    content.classList.remove('hidden');
    content.classList.add('visible');
  } else {
    // Hide glossary
    content.classList.remove('visible');
    content.classList.add('hidden');
  }
}

/**
 * Close glossary sidebar
 */
function closeGlossary() {
  const content = document.getElementById('glossaryContent');
  content.classList.remove('visible');
  content.classList.add('hidden');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Attach event listeners
  document.getElementById('sampleSelector').addEventListener('change', (e) => {
    loadSample(e.target.value);
  });

  document.getElementById('buildBtn').addEventListener('click', buildTransaction);
  document.getElementById('copyPsbtBtn').addEventListener('click', copyPSBT);
  document.getElementById('glossaryToggle').addEventListener('click', toggleGlossary);
  document.getElementById('glossaryClose').addEventListener('click', closeGlossary);

  console.log('🔥 The Coin Smith\'s Forge is ready!');
});
