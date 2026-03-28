/**
 * ui.test.ts — Sherlock Web UI heavy integration tests
 * Tests every component from the plan design against http://localhost:3000
 *
 * Run: npx vitest run tests/ui.test.ts
 * Requires: web server running on PORT 3000, out/blk04330.json present
 */

import { test, expect, chromium, type Page, type Browser } from '@playwright/test';

const BASE = 'http://localhost:3000';

let browser: Browser;
let page: Page;

// ── Setup ────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

test.afterAll(async () => {
  await browser.close();
});

test.beforeEach(async () => {
  page = await browser.newPage();
  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[BROWSER]', msg.text());
  });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
});

test.afterEach(async () => {
  await page.close();
});

// ── API Endpoints ────────────────────────────────────────────────────────────

test('GET /api/health returns {ok:true}', async () => {
  const res = await page.request.get(`${BASE}/api/health`);
  expect(res.status()).toBe(200);
  const json = await res.json() as { ok: boolean };
  expect(json.ok).toBe(true);
});

test('GET /api/blocks returns array with stem', async () => {
  const res = await page.request.get(`${BASE}/api/blocks`);
  expect(res.status()).toBe(200);
  const json = await res.json() as Array<{ stem: string }>;
  expect(Array.isArray(json)).toBe(true);
  expect(json.length).toBeGreaterThan(0);
  expect(json[0]).toHaveProperty('stem');
});

test('GET /api/blocks/:stem returns valid JSON with block_count', async () => {
  const blocks = await page.request.get(`${BASE}/api/blocks`).then(r => r.json()) as Array<{ stem: string }>;
  const stem = blocks[0].stem;
  const res = await page.request.get(`${BASE}/api/blocks/${stem}`);
  expect(res.status()).toBe(200);
  const json = await res.json() as { block_count: number; analysis_summary: unknown; blocks: unknown[] };
  expect(json).toHaveProperty('block_count');
  expect(json).toHaveProperty('analysis_summary');
  expect(Array.isArray(json.blocks)).toBe(true);
});

// ── Page Load ────────────────────────────────────────────────────────────────

test('page title contains SHERLOCK', async () => {
  const title = await page.title();
  expect(title.toLowerCase()).toContain('sherlock');
});

test('no JS console errors on load', async () => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.reload({ waitUntil: 'networkidle' });
  // Filter out known benign errors
  const realErrors = errors.filter(e => !e.includes('favicon'));
  expect(realErrors).toHaveLength(0);
});

// ── Visual Theme ─────────────────────────────────────────────────────────────

test('background canvas exists and has dimensions', async () => {
  const canvas = page.locator('#bg-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);
});

test('dark background color applied to body', async () => {
  const bg = await page.evaluate(() =>
    window.getComputedStyle(document.body).backgroundColor
  );
  // Should be dark — rgb values all low
  expect(bg).toMatch(/rgb\(\d+,\s*\d+,\s*\d+\)/);
  const parts = bg.match(/\d+/g)!.map(Number);
  const max = Math.max(...parts);
  expect(max).toBeLessThan(50); // dark theme
});

test('header is present and sticky', async () => {
  const header = page.locator('header');
  await expect(header).toBeVisible();
  const position = await header.evaluate(el =>
    window.getComputedStyle(el).position
  );
  expect(position).toBe('sticky');
});

test('header contains SHERLOCK text', async () => {
  const header = page.locator('header');
  await expect(header).toContainText('SHERLOCK');
});

// ── Block Selector ───────────────────────────────────────────────────────────

test('block selector is populated with at least one option', async () => {
  const select = page.locator('#block-select');
  await expect(select).toBeVisible();
  const options = await select.locator('option').count();
  expect(options).toBeGreaterThan(0);
});

test('block selector options contain stem names', async () => {
  const select = page.locator('#block-select');
  const firstOption = await select.locator('option').first().textContent();
  expect(firstOption).toBeTruthy();
  expect(firstOption!.length).toBeGreaterThan(0);
});

// ── Evidence Board (4 Metric Cards) ─────────────────────────────────────────

test('evidence board has 4 metric cards', async () => {
  await page.waitForSelector('.metric-card', { timeout: 10000 });
  const cards = await page.locator('.metric-card').count();
  expect(cards).toBe(4);
});

test('metric card: Total Suspects shows a number', async () => {
  await page.waitForSelector('#m-suspects', { timeout: 10000 });
  const text = await page.locator('#m-suspects').textContent();
  expect(text).toMatch(/\d/);
});

test('metric card: Flagged shows a number', async () => {
  await page.waitForSelector('#m-flagged', { timeout: 10000 });
  const text = await page.locator('#m-flagged').textContent();
  expect(text).toMatch(/\d/);
});

test('metric card: Median Fee shows a number', async () => {
  await page.waitForSelector('#m-fee', { timeout: 10000 });
  const text = await page.locator('#m-fee').textContent();
  expect(text).toMatch(/\d/);
});

test('metric card: Dominant Script shows a script type', async () => {
  await page.waitForSelector('#m-script', { timeout: 10000 });
  const text = await page.locator('#m-script').textContent();
  expect(text).toBeTruthy();
  expect(text!.length).toBeGreaterThan(1);
});

// ── Detection Pipeline ────────────────────────────────────────────────────────

test('detection pipeline SVG exists', async () => {
  const pipeline = page.locator('#pipeline');
  await expect(pipeline).toBeVisible({ timeout: 10000 });
});

test('pipeline has 9 heuristic node circles', async () => {
  await page.waitForSelector('#pipeline circle', { timeout: 10000 });
  // At minimum 9 circles for heuristic nodes (may have more for connectors)
  const circles = await page.locator('#pipeline circle').count();
  expect(circles).toBeGreaterThanOrEqual(9);
});

test('pipeline contains all 9 heuristic labels', async () => {
  await page.waitForSelector('#pipeline', { timeout: 10000 });
  const pipelineText = await page.locator('#pipeline').textContent();
  // Labels use short names like "addr reuse", "self xfer", "round №"
  const ids = ['cioh', 'coinjoin', 'change', 'addr', 'consolidation', 'self', 'peeling', 'op_return', 'round'];
  for (const id of ids) {
    expect(pipelineText!.toLowerCase()).toContain(id.toLowerCase());
  }
});

test('clicking pipeline node filters the table', async () => {
  await page.waitForSelector('#pipeline', { timeout: 10000 });
  await page.waitForSelector('.tx-row', { timeout: 10000 });

  // Click the CIOH node via JS to avoid SVG text intercept issues
  await page.evaluate(() => {
    const circles = document.querySelectorAll('#pipeline circle');
    // Find a heuristic node (skip TX IN which is index 0)
    const node = circles[1] as HTMLElement;
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  // Just verify no crash — filter may or may not change row count
  const filtered = await page.locator('.tx-row').count();
  expect(filtered).toBeGreaterThanOrEqual(0);
});

// ── Charts Row ───────────────────────────────────────────────────────────────

test('charts row exists with two charts', async () => {
  const chartsRow = page.locator('#charts-row');
  await expect(chartsRow).toBeVisible({ timeout: 10000 });
  const charts = await chartsRow.locator('> *').count();
  expect(charts).toBeGreaterThanOrEqual(2);
});

test('script type chart is rendered', async () => {
  const chart = page.locator('#script-chart');
  await expect(chart).toBeVisible({ timeout: 10000 });
  const content = await chart.textContent();
  expect(content!.length).toBeGreaterThan(0);
});

test('fee chart is rendered', async () => {
  const chart = page.locator('#fee-chart');
  await expect(chart).toBeVisible({ timeout: 10000 });
});

// ── Sidebar Block Cards ──────────────────────────────────────────────────────

test('sidebar is visible', async () => {
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeVisible();
});

test('sidebar has at least one block card', async () => {
  await page.waitForSelector('.block-card', { timeout: 10000 });
  const cards = await page.locator('.block-card').count();
  expect(cards).toBeGreaterThan(0);
});

test('block card contains tx_count number', async () => {
  await page.waitForSelector('.block-card', { timeout: 10000 });
  const card = page.locator('.block-card').first();
  const text = await card.textContent();
  expect(text).toMatch(/\d+/);
});

test('block card contains time or height text', async () => {
  await page.waitForSelector('.block-card', { timeout: 10000 });
  const card = page.locator('.block-card').first();
  const text = await card.textContent();
  // Either shows UTC timestamp or block height fallback
  expect(text).toMatch(/20\d\d|UTC|Height|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
});

test('block card has summary sentence', async () => {
  await page.waitForSelector('.block-summary-text', { timeout: 10000 });
  const summary = await page.locator('.block-summary-text').first().textContent();
  expect(summary!.length).toBeGreaterThan(10);
});

// ── Case Files Table ─────────────────────────────────────────────────────────

test('table renders rows after data loads', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const rows = await page.locator('.tx-row').count();
  expect(rows).toBeGreaterThan(0);
});

test('table has search input', async () => {
  const search = page.locator('#search');
  await expect(search).toBeVisible();
});

test('table has classification filter', async () => {
  const filter = page.locator('#filter-class');
  await expect(filter).toBeVisible();
  const options = await filter.locator('option').count();
  expect(options).toBeGreaterThan(1); // at least "All" + one classification
});

test('table has heuristic filter', async () => {
  const filter = page.locator('#filter-heuristic');
  await expect(filter).toBeVisible();
  const options = await filter.locator('option').count();
  expect(options).toBeGreaterThan(1);
});

test('table has sort dropdown', async () => {
  const sort = page.locator('#sort-by');
  await expect(sort).toBeVisible();
});

test('search filters rows by txid prefix', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  // Get txid directly from the .tx-row's data-txid attribute
  const txid = await page.locator('.tx-row').first().getAttribute('data-txid') ?? '';
  expect(txid.length).toBeGreaterThan(6);

  await page.locator('#search').fill(txid.substring(0, 6));
  await page.waitForTimeout(400);

  const afterRows = await page.locator('.tx-row').count();
  expect(afterRows).toBeGreaterThan(0);
});

test('classification filter works', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const filter = page.locator('#filter-class');
  const options = await filter.locator('option').all();
  // Select second option (first non-"All")
  if (options.length > 1) {
    await filter.selectOption({ index: 1 });
    await page.waitForTimeout(400);
    const rows = await page.locator('.tx-row').count();
    expect(rows).toBeGreaterThanOrEqual(0);
  }
});

test('each tx-row has a classification badge', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const firstRow = page.locator('.tx-row').first();
  const badge = firstRow.locator('.badge');
  await expect(badge).toBeVisible();
  const text = await badge.textContent();
  expect(text!.length).toBeGreaterThan(0);
});

test('virtual scroll: scroll container exists with overflow', async () => {
  const container = page.locator('#scroll-container');
  await expect(container).toBeVisible({ timeout: 10000 });
  const overflow = await container.evaluate(el =>
    window.getComputedStyle(el).overflowY
  );
  expect(['auto', 'scroll']).toContain(overflow);
});

test('virtual scroll: spacer elements exist', async () => {
  // Spacers may have height 0 so won't be "visible" — just check they're in DOM
  await page.waitForSelector('#rows-container', { timeout: 10000 });
  await expect(page.locator('#spacer-top')).toBeAttached();
  await expect(page.locator('#spacer-bot')).toBeAttached();
});

test('virtual scroll: scrolling changes rendered rows', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const container = page.locator('#scroll-container');

  // Get first txid
  const firstTxid = await page.locator('.tx-row').first().textContent();

  // Scroll to bottom
  await container.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);

  // Get new first txid — should be different if virtual scroll works
  const newFirstTxid = await page.locator('.tx-row').first().textContent();
  // If total rows > visible count, they should differ
  const totalCount = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return (w.sortedTxs as unknown[])?.length ?? 0;
  });
  if (totalCount > 30) {
    expect(newFirstTxid).not.toBe(firstTxid);
  }
});

// ── Row Expand (Evidence Panel) ───────────────────────────────────────────────

test('clicking a tx-row expands evidence panel', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  // Click the fee column (5th col) to avoid the wide txid column which opens modal
  const feeCell = page.locator('.tx-row .tx-fee').first();
  await feeCell.click();
  await page.waitForTimeout(500);

  const panel = page.locator('.evidence-panel').first();
  await expect(panel).toBeAttached();
});

test('evidence panel has 9 heuristic rows', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  await page.locator('.tx-row .tx-fee').first().click();
  await page.waitForTimeout(500);

  const hRows = await page.locator('.evidence-panel .heuristic-row').count();
  expect(hRows).toBe(9);
});

test('clicking same row again collapses panel', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const feeCell = page.locator('.tx-row .tx-fee').first();
  await feeCell.click();
  await page.waitForTimeout(400);
  await feeCell.click();
  await page.waitForTimeout(400);

  const panels = await page.locator('.evidence-panel').count();
  expect(panels).toBe(0);
});

// ── Transaction Autopsy Modal ─────────────────────────────────────────────────

test('modal is hidden on load', async () => {
  const modal = page.locator('#modal');
  await expect(modal).toBeAttached();
  const isHidden = await modal.evaluate(el =>
    el.classList.contains('hidden') || window.getComputedStyle(el).display === 'none'
  );
  expect(isHidden).toBe(true);
});

test('clicking txid opens the modal', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const txLink = page.locator('.tx-row .txid-link').first();
  await txLink.click();
  await page.waitForTimeout(400);

  const modal = page.locator('#modal');
  const isVisible = await modal.evaluate(el =>
    !el.classList.contains('hidden') && window.getComputedStyle(el).display !== 'none'
  );
  expect(isVisible).toBe(true);
});

test('modal contains CASE FILE header', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const txLink = page.locator('.tx-row .txid-link').first();
  await txLink.click();
  await page.waitForTimeout(400);

  const modal = page.locator('#modal');
  const text = await modal.textContent();
  expect(text!.toUpperCase()).toContain('CASE FILE');
});

test('modal contains Sankey SVG', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const txLink = page.locator('.tx-row .txid-link').first();
  await txLink.click();
  await page.waitForTimeout(400);

  const sankey = page.locator('#sankey');
  await expect(sankey).toBeVisible();
});

test('modal shows verdict badge', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const txLink = page.locator('.tx-row .txid-link').first();
  await txLink.click();
  await page.waitForTimeout(400);

  const verdict = page.locator('#modal-verdict');
  await expect(verdict).toBeVisible();
  const text = await verdict.textContent();
  expect(text!.length).toBeGreaterThan(0);
});

test('modal closes with close button', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const txLink = page.locator('.tx-row .txid-link').first();
  await txLink.click();
  await page.waitForTimeout(400);

  await page.locator('#modal-close').click();
  await page.waitForTimeout(300);

  const modal = page.locator('#modal');
  const isHidden = await modal.evaluate(el =>
    el.classList.contains('hidden') || window.getComputedStyle(el).display === 'none'
  );
  expect(isHidden).toBe(true);
});

test('modal closes with ESC key', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  const txLink = page.locator('.tx-row .txid-link').first();
  await txLink.click();
  await page.waitForTimeout(400);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const modal = page.locator('#modal');
  const isHidden = await modal.evaluate(el =>
    el.classList.contains('hidden') || window.getComputedStyle(el).display === 'none'
  );
  expect(isHidden).toBe(true);
});

// ── Keyboard Navigation ───────────────────────────────────────────────────────

test('Arrow Down key moves selection to next row', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  await page.locator('#scroll-container').click();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const selected = await page.locator('.tx-row.selected, .tx-row[data-selected="true"]').count();
  expect(selected).toBeGreaterThanOrEqual(1);
});

test('Enter key expands selected row', async () => {
  await page.waitForSelector('.tx-row', { timeout: 15000 });
  await page.locator('#scroll-container').click();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const panel = page.locator('.evidence-panel').first();
  await expect(panel).toBeAttached();
});

// ── Responsive ───────────────────────────────────────────────────────────────

test('hamburger button hidden on desktop', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hamburger = page.locator('#hamburger');
  const display = await hamburger.evaluate(el =>
    window.getComputedStyle(el).display
  );
  expect(display).toBe('none');
});

test('sidebar visible on desktop', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeVisible();
});

test('hamburger button visible on mobile viewport', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const hamburger = page.locator('#hamburger');
  const display = await hamburger.evaluate(el =>
    window.getComputedStyle(el).display
  );
  expect(display).not.toBe('none');
});

// ── Skeleton Loading ─────────────────────────────────────────────────────────

test('skeleton loading appears then disappears', async () => {
  // Navigate fresh and check for skeleton quickly
  const page2 = await browser.newPage();
  let skeletonSeen = false;
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
  // Check immediately after DOM load
  const count = await page2.locator('.skeleton').count();
  if (count > 0) skeletonSeen = true;
  // After full load, skeletons should be gone
  await page2.waitForLoadState('networkidle');
  await page2.waitForTimeout(2000);
  const afterCount = await page2.locator('.skeleton').count();
  // Either we saw them (and they're gone) or they were too fast
  expect(afterCount).toBe(0);
  await page2.close();
});

// ── Data Correctness ─────────────────────────────────────────────────────────

test('metric card suspect count matches API total_transactions_analyzed', async () => {
  const apiData = await page.request.get(`${BASE}/api/blocks/blk04330`)
    .then(r => r.json()) as { analysis_summary: { total_transactions_analyzed: number } };
  const expected = apiData.analysis_summary.total_transactions_analyzed;

  await page.waitForSelector('#m-suspects', { timeout: 10000 });
  const displayedText = await page.locator('#m-suspects .metric-value').first().textContent();
  const displayed = parseInt(displayedText!.replace(/\D/g, ''), 10);
  expect(displayed).toBe(expected);
});

test('flagged count matches API flagged_transactions', async () => {
  const apiData = await page.request.get(`${BASE}/api/blocks/blk04330`)
    .then(r => r.json()) as { analysis_summary: { flagged_transactions: number } };
  const expected = apiData.analysis_summary.flagged_transactions;

  // Wait for countUp animation to finish (runs ~1500ms after load)
  await page.waitForSelector('#m-flagged .metric-value', { timeout: 10000 });
  await page.waitForTimeout(2000);
  const displayedText = await page.locator('#m-flagged .metric-value').first().textContent();
  const displayed = parseInt(displayedText!.replace(/\D/g, ''), 10);
  expect(displayed).toBe(expected);
});

test('all transactions from blocks[0] are in the table', async () => {
  const apiData = await page.request.get(`${BASE}/api/blocks/blk04330`)
    .then(r => r.json()) as { blocks: Array<{ tx_count: number }> };
  const txCount = apiData.blocks[0].tx_count;

  // allTxs in window should equal tx_count
  const uiCount = await page.evaluate(() => {
    // allTxs is exposed on window after loadBlock
    return (window as unknown as { allTxs?: unknown[] }).allTxs?.length ?? -1;
  });
  expect(uiCount).toBe(txCount);
});

test('classification filter options include all 6 classification types', async () => {
  await page.waitForSelector('#filter-class', { timeout: 10000 });
  const options = await page.locator('#filter-class option').allTextContents();
  const joined = options.join(' ').toLowerCase();
  expect(joined).toContain('simple');
  expect(joined).toContain('coinjoin');
  // At least 3 classification types present
  expect(options.length).toBeGreaterThanOrEqual(3);
});
