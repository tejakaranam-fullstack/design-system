/**
 * figma-to-dtcg.js
 * Transforms tokens/figma-raw.json (Figma Variables API response)
 * into the W3C Design Token Community Group (DTCG) format and writes
 * the result to tokens/tokens.json.
 *
 * DTCG spec: https://tr.designtokens.org/format/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_PATH = path.resolve(__dirname, '../tokens/figma-raw.json');
const OUT_PATH = path.resolve(__dirname, '../tokens/tokens.json');

/** Map Figma variable resolved type to a DTCG $type */
function mapType(resolvedType) {
  switch (resolvedType) {
    case 'COLOR':
      return 'color';
    case 'FLOAT':
      return 'number';
    case 'STRING':
      return 'string';
    case 'BOOLEAN':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Convert a hex number (Figma color object) to a CSS hex string.
 * Figma provides { r, g, b, a } in 0–1 range.
 */
function figmaColorToHex({ r, g, b, a = 1 }) {
  const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  const alpha = a < 1 ? toHex(a) : '';
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${alpha}`;
}

function resolveValue(variable, modeId) {
  const valuesByMode = variable.valuesByMode ?? {};
  const value = valuesByMode[modeId] ?? Object.values(valuesByMode)[0];

  if (value && typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
    // Reference – will be resolved to a DTCG $value reference by the caller
    return { alias: value.id };
  }

  if (variable.resolvedType === 'COLOR' && value && typeof value === 'object') {
    return figmaColorToHex(value);
  }

  return value;
}

function buildTokenTree(variables, variableCollections) {
  // Build a lookup: variableId → variable
  const varById = Object.fromEntries(variables.map((v) => [v.id, v]));
  const result = {};

  for (const variable of variables) {
    // Use the first mode of the variable's collection
    const collection = variableCollections.find((c) => c.id === variable.variableCollectionId);
    const modeId = collection?.defaultModeId ?? Object.keys(variable.valuesByMode ?? {})[0];

    const rawValue = resolveValue(variable, modeId);

    // Build nested key path from the variable name ("Color/Primary/500" → ["Color","Primary","500"])
    const parts = variable.name.split('/').map((p) => p.trim());
    let node = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    const leaf = parts[parts.length - 1];

    const token = {
      $type: mapType(variable.resolvedType),
    };

    if (rawValue && typeof rawValue === 'object' && 'alias' in rawValue) {
      // Resolve alias to DTCG reference string "{Group.Name}"
      const aliasVar = varById[rawValue.alias];
      if (aliasVar) {
        token.$value = `{${aliasVar.name.replace(/\//g, '.')}}`;
      } else {
        token.$value = rawValue.alias;
      }
    } else {
      token.$value = rawValue;
    }

    if (variable.description) {
      token.$description = variable.description;
    }

    node[leaf] = token;
  }

  return result;
}

function transform() {
  if (!fs.existsSync(RAW_PATH)) {
    console.error(`Raw token file not found: ${RAW_PATH}`);
    console.error('Run "npm run fetch" first to download the Figma variables.');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf-8'));

  const variables = Object.values(raw?.meta?.variables ?? {});
  const variableCollections = Object.values(raw?.meta?.variableCollections ?? {});

  if (!variables.length) {
    console.warn('No variables found in the raw Figma response. Verify your file ID and token scope.');
  }

  const dtcg = buildTokenTree(variables, variableCollections);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(dtcg, null, 2), 'utf-8');

  console.log(`DTCG tokens written to ${OUT_PATH} (${variables.length} variables)`);
}

transform();
