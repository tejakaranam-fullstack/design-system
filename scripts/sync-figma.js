import fs from "node:fs";

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.FIGMA_FILE_KEY;

if (!token || !fileKey) {
  console.error("Missing FIGMA_TOKEN or FIGMA_FILE_KEY");
  process.exit(1);
}

const headers = { "X-Figma-Token": token };

async function figmaGet(path) {
  const res = await fetch(`https://api.figma.com/v1${path}`, { headers });
  if (!res.ok) throw new Error(`Figma API ${path} → HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// ── 1. Fetch all local styles ──────────────────────────────────────────────
console.log("Fetching local styles...");
const { meta } = await figmaGet(`/files/${fileKey}/styles`);
const styles = meta?.styles ?? [];

if (styles.length === 0) {
  console.warn("No local styles found in this Figma file.");
  process.exit(0);
}

// ── 2. Fetch node data for all style nodes ─────────────────────────────────
const nodeIds = styles.map((s) => s.node_id).join(",");
console.log(`Fetching ${styles.length} style nodes...`);
const { nodes } = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeIds)}`);

// ── 3. Parse styles into token categories ─────────────────────────────────
const toHex = (r, g, b, a = 1) => {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  return a < 1 ? `#${h(r)}${h(g)}${h(b)}${h(a)}` : `#${h(r)}${h(g)}${h(b)}`;
};

const tokens = { Colors: {}, Typography: {}, Effects: {} };

for (const style of styles) {
  const node = nodes?.[style.node_id]?.document;
  if (!node) continue;

  const name = style.name;

  if (style.style_type === "FILL") {
    const fill = node.fills?.[0];
    if (fill?.type === "SOLID") {
      const { r, g, b } = fill.color;
      const a = fill.opacity ?? fill.color.a ?? 1;
      tokens.Colors[name] = toHex(r, g, b, a);
    }
  }

  if (style.style_type === "TEXT") {
    const s = node.style ?? {};
    tokens.Typography[name] = {
      fontFamily:    s.fontFamily    ?? null,
      fontSize:      s.fontSize      ?? null,
      fontWeight:    s.fontWeight    ?? null,
      lineHeightPx:  s.lineHeightPx  ?? null,
      letterSpacing: s.letterSpacing ?? null,
    };
  }

  if (style.style_type === "EFFECT") {
    const effect = node.effects?.[0];
    if (effect) {
      const { r, g, b, a } = effect.color ?? {};
      tokens.Effects[name] = r !== undefined
        ? `${effect.offset?.x ?? 0}px ${effect.offset?.y ?? 0}px ${effect.radius ?? 0}px ${toHex(r, g, b, a)}`
        : effect.type;
    }
  }
}

// ── 4. Write tokens file ───────────────────────────────────────────────────
fs.mkdirSync("tokens", { recursive: true });
fs.writeFileSync("tokens/figma-variables.json", JSON.stringify(tokens, null, 2));

const colorCount = Object.keys(tokens.Colors).length;
const typoCount  = Object.keys(tokens.Typography).length;
console.log(`Synced → tokens/figma-variables.json (${colorCount} colors, ${typoCount} text styles)`);


