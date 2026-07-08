/**
 * fetch-figma.js
 * Fetches design tokens from the Figma Variables API and writes raw output to tokens/figma-raw.json.
 *
 * Required environment variables:
 *   FIGMA_TOKEN   – Personal access token or OAuth token with file:read scope
 *   FIGMA_FILE_ID – The Figma file key (from the file URL: figma.com/design/<FILE_ID>/…)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_ID = process.env.FIGMA_FILE_ID;

if (!FIGMA_TOKEN) {
  console.error('Error: FIGMA_TOKEN environment variable is not set.');
  process.exit(1);
}
if (!FIGMA_FILE_ID) {
  console.error('Error: FIGMA_FILE_ID environment variable is not set.');
  process.exit(1);
}

async function fetchFigmaVariables() {
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_ID}/variables/local`;

  console.log(`Fetching variables from Figma file: ${FIGMA_FILE_ID}`);

  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': FIGMA_TOKEN,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Figma API error ${response.status}: ${body}`);
    process.exit(1);
  }

  const data = await response.json();

  const outputPath = path.resolve(__dirname, '../tokens/figma-raw.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`Raw Figma variables written to ${outputPath}`);
}

fetchFigmaVariables().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
