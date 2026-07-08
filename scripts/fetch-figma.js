/**
 * fetch-figma.js
 * Fetches design tokens from the Figma Variables API and writes raw output to tokens/figma-raw.json.
 *
 * Required environment variables:
 *   FIGMA_TOKEN   – Personal access token or OAuth token with file:read scope
 *   FIGMA_FILE_KEY – The Figma file key (from the file URL: figma.com/design/<FILE_ID>/…)
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

async function fetchFigmaVariables() {
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/variables/local`;

  console.log(`Fetching variables from Figma file: ${FIGMA_FILE_KEY}`);

  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': FIGMA_TOKEN,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Figma API error ${response.status}: ${body}`);
    if (response.status === 404) {
      console.error(
        '\nTroubleshooting:\n' +
        '  1. Verify FIGMA_FILE_KEY matches the key in your Figma file URL:\n' +
        '     figma.com/design/<FILE_KEY>/...\n' +
        '  2. The Variables REST API (/variables/local) requires a Figma paid plan\n' +
        '     (Professional or above). If you are on the Starter plan, this endpoint\n' +
        '     returns 404 regardless of the file key.\n' +
        '  3. Ensure your FIGMA_TOKEN has file:read scope and can access this file.'
      );
    }
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
