/**
 * fetch-figma-variables.js
 * Fetches Figma local variables (paid plan) or styles (free plan) and
 * writes the result to tokens/figma-raw.json.
 *
 * Environment variables (set as GitHub Actions secrets):
 *   FIGMA_API_TOKEN  – Figma personal access token (file:read scope)
 *   FIGMA_FILE_ID    – File key from figma.com/design/<FILE_ID>/...
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const TOKEN = process.env.FIGMA_API_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;

if (!TOKEN) { console.error('Missing FIGMA_API_TOKEN'); process.exit(1); }
if (!FILE_ID) { console.error('Missing FIGMA_FILE_ID'); process.exit(1); }

const client = axios.create({
  baseURL: 'https://api.figma.com/v1',
  headers: { 'X-Figma-Token': TOKEN },
});

async function fetchViaVariablesAPI() {
  try {
    console.log('Trying Variables API…');
    const { data } = await client.get(`/files/${FILE_ID}/variables/local`);
    console.log('Variables API succeeded.');
    return { source: 'variables', ...data };
  } catch (err) {
    if (err.response?.status === 404) {
      console.log('Variables API returned 404 — falling back to Styles API.');
      return null;
    }
    console.error('Variables API error:', err.response?.data ?? err.message);
    process.exit(1);
  }
}

async function fetchViaStylesAPI() {
  console.log('Using Styles API (works on all Figma plans)…');

  const { data: stylesData } = await client.get(`/files/${FILE_ID}/styles`).catch((err) => {
    console.error('Styles API error:', err.response?.data ?? err.message);
    process.exit(1);
  });

  const styles = stylesData.meta?.styles ?? [];
  console.log(`Found ${styles.length} styles.`);

  if (!styles.length) {
    console.warn('No published local styles found in this file.');
    return { source: 'styles', styles: [], nodes: {} };
  }

  const BATCH = 50;
  const nodeDetails = {};
  const nodeIds = styles.map((s) => s.node_id);

  for (let i = 0; i < nodeIds.length; i += BATCH) {
    const batch = nodeIds.slice(i, i + BATCH).join(',');
    const { data: nodesData } = await client
      .get(`/files/${FILE_ID}/nodes?ids=${encodeURIComponent(batch)}`)
      .catch((err) => {
        console.error('Nodes API error:', err.response?.data ?? err.message);
        process.exit(1);
      });
    Object.assign(nodeDetails, nodesData.nodes ?? {});
  }

  console.log(`Fetched ${Object.keys(nodeDetails).length} node details.`);
  return { source: 'styles', styles, nodes: nodeDetails };
}

async function main() {
  let data = await fetchViaVariablesAPI();
  if (!data) data = await fetchViaStylesAPI();

  const outPath = path.resolve(__dirname, '../tokens/figma-raw.json');
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeJson(outPath, data, { spaces: 2 });
  console.log(`Written to ${outPath} (source: ${data.source})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
