/**
 * fetch-figma.js
 * Fetches design tokens from Figma and writes raw output to tokens/figma-raw.json.
 *
 * Strategy:
 *   1. Try the Variables API  (/v1/files/:key/variables/local) — requires a paid Figma plan.
 *   2. If that returns 404, fall back to the Styles + Nodes API — works on all plans (free & paid).
 *
 * Required environment variables:
 *   FIGMA_TOKEN    – Personal access token with file:read scope
 *   FIGMA_FILE_KEY – The file key from the Figma URL: figma.com/design/<FILE_KEY>/…
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY;

if (!FIGMA_TOKEN) {
  console.error('Error: FIGMA_TOKEN environment variable is not set.');
  process.exit(1);
}
if (!FIGMA_FILE_KEY) {
  console.error('Error: FIGMA_FILE_KEY environment variable is not set.');
  process.exit(1);
}

const BASE = 'https://api.figma.com/v1';
const HEADERS = { 'X-Figma-Token': FIGMA_TOKEN };

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  return { status: res.status, body: await res.json() };
}

// ─── Strategy 1: Variables API (paid plans) ───────────────────────────────────
async function fetchViaVariablesAPI() {
  console.log('Trying Variables API (requires paid Figma plan)…');
  const { status, body } = await get(`${BASE}/files/${FIGMA_FILE_KEY}/variables/local`);

  if (status === 404) {
    console.log('Variables API returned 404 — falling back to Styles API.');
    return null;
  }
  if (status !== 200) {
    console.error(`Variables API error ${status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }

  console.log('Variables API succeeded.');
  return { source: 'variables', ...body };
}

// ─── Strategy 2: Styles + Nodes API (all plans, including free) ───────────────
async function fetchViaStylesAPI() {
  console.log('Using Styles API (works on all Figma plans)…');

  const { status: sStatus, body: sBody } = await get(`${BASE}/files/${FIGMA_FILE_KEY}/styles`);
  if (sStatus !== 200) {
    console.error(`Styles API error ${sStatus}: ${JSON.stringify(sBody)}`);
    process.exit(1);
  }

  const styles = sBody.meta?.styles ?? [];
  console.log(`Found ${styles.length} styles.`);

  if (styles.length === 0) {
    console.warn('No styles found. Make sure the file has published local styles.');
    return { source: 'styles', styles: [], nodes: {} };
  }

  // Fetch node details in batches of 50
  const nodeIds = styles.map((s) => s.node_id);
  const BATCH = 50;
  const nodeDetails = {};

  for (let i = 0; i < nodeIds.length; i += BATCH) {
    const batch = nodeIds.slice(i, i + BATCH).join(',');
    const { status: nStatus, body: nBody } = await get(
      `${BASE}/files/${FIGMA_FILE_KEY}/nodes?ids=${encodeURIComponent(batch)}`
    );
    if (nStatus !== 200) {
      console.error(`Nodes API error ${nStatus}: ${JSON.stringify(nBody)}`);
      process.exit(1);
    }
    Object.assign(nodeDetails, nBody.nodes ?? {});
  }

  console.log(`Fetched node details for ${Object.keys(nodeDetails).length} nodes.`);
  return { source: 'styles', styles, nodes: nodeDetails };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let data = await fetchViaVariablesAPI();
  if (!data) {
    data = await fetchViaStylesAPI();
  }

  const outputPath = path.resolve(__dirname, '../tokens/figma-raw.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`Raw Figma data written to ${outputPath} (source: ${data.source})`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
