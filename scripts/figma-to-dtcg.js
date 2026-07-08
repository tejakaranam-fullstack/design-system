/**
 * figma-to-dtcg.js
 * Transforms tokens/figma-raw.json into the W3C DTCG format.
 * Handles both sources produced by fetch-figma.js:
 *   - source: 'variables'  (paid plan — Figma Variables API)
 *   - source: 'styles'     (free plan — Styles + Nodes API)
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

// ─── Styles source (free plan) ────────────────────────────────────────────────

function figmaColorToHexFromFills(fills = []) {
  const solid = fills.find((f) => f.type === 'SOLID');
  if (!solid) return null;
  return figmaColorToHex(solid.color);
}

function buildTokenTreeFromStyles(styles, nodes) {
  const result = {};

  for (const style of styles) {
    const nodeEntry = nodes[style.node_id];
    const node = nodeEntry?.document;
    if (!node) continue;

    // Build key path from style name ("Color/Primary/500" → nested object)
    const parts = style.name.split('/').map((p) => p.trim());
    let cursor = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]]) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    const leaf = parts[parts.length - 1];

    const token = {};
    if (style.description) token.$description = style.description;

    switch (style.style_type) {
      case 'FILL': {
        const hex = figmaColorToHexFromFills(node.fills);
        if (hex) {
          token.$type = 'color';
          token.$value = hex;
        }
        break;
      }
      case 'TEXT': {
        token.$type = 'typography';
        token.$value = {
          fontFamily: node.style?.fontFamily,
          fontWeight: node.style?.fontWeight,
          fontSize: node.style?.fontSize,
          lineHeight:
            node.style?.lineHeightUnit === 'PIXELS'
              ? node.style?.lineHeightPx
              : node.style?.lineHeightPercentFontSize
                ? `${node.style.lineHeightPercentFontSize}%`
                : undefined,
          letterSpacing: node.style?.letterSpacing,
        };
        break;
      }
      case 'EFFECT': {
        const shadow = (node.effects ?? []).find((e) =>
          ['DROP_SHADOW', 'INNER_SHADOW'].includes(e.type)
        );
        if (shadow) {
          const { r, g, b, a } = shadow.color;
          const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
          token.$type = 'shadow';
          token.$value = {
            offsetX: shadow.offset?.x ?? 0,
            offsetY: shadow.offset?.y ?? 0,
            blur: shadow.radius ?? 0,
            spread: shadow.spread ?? 0,
            color: `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(a) : ''}`,
            inset: shadow.type === 'INNER_SHADOW',
          };
        }
        break;
      }
      default:
        token.$type = 'string';
        token.$value = style.name;
    }

    if (token.$type) cursor[leaf] = token;
  }

  return result;
}

// ─── Transform entry point ────────────────────────────────────────────────────

function transform() {
  if (!fs.existsSync(RAW_PATH)) {
    console.error(`Raw token file not found: ${RAW_PATH}`);
    console.error('Run "npm run fetch" first to download the Figma data.');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf-8'));
  let dtcg;

  if (raw.source === 'variables') {
    console.log('Transforming Variables API response…');
    const variables = Object.values(raw?.meta?.variables ?? {});
    const variableCollections = Object.values(raw?.meta?.variableCollections ?? {});
    if (!variables.length) {
      console.warn('No variables found in the raw Figma response.');
    }
    dtcg = buildTokenTree(variables, variableCollections);
    console.log(`DTCG tokens written to ${OUT_PATH} (${variables.length} variables)`);
  } else if (raw.source === 'styles') {
    console.log('Transforming Styles API response…');
    dtcg = buildTokenTreeFromStyles(raw.styles ?? [], raw.nodes ?? {});
    const count = raw.styles?.length ?? 0;
    console.log(`DTCG tokens written to ${OUT_PATH} (${count} styles)`);
  } else {
    console.error('Unknown source format in figma-raw.json. Re-run "npm run fetch".');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(dtcg, null, 2), 'utf-8');
}

transform();
