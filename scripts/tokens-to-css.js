// scripts/tokens-to-css.js
// Converts DTCG token JSON files into CSS custom properties and SCSS variables.

const fs = require("fs-extra");
const path = require("path");

const TOKENS_DIR = "tokens";
const OUTPUT_DIR = "styles/tokens";

/* -------------------- Helpers -------------------- */

/**
 * Convert a dot-separated token path to a CSS/SCSS variable name.
 * e.g. "color.functional.white" → "color-functional-white"
 */
function pathToVarName(tokenPath) {
  return tokenPath.replace(/\./g, "-");
}

/**
 * Convert a DTCG alias reference "{some.path}" to CSS var() or SCSS $var.
 */
function aliasToCSS(value) {
  const inner = value.slice(1, -1); // strip { }
  return `var(--${pathToVarName(inner)})`;
}

function aliasToSCSS(value) {
  const inner = value.slice(1, -1);
  return `$${pathToVarName(inner)}`;
}

function isAlias(value) {
  return typeof value === "string" && value.startsWith("{") && value.endsWith("}");
}

/**
 * Walk a token tree and collect flat entries: { path, $type, $value }
 */
function collectTokens(obj, currentPath = []) {
  const results = [];

  for (const [key, value] of Object.entries(obj)) {
    // Skip metadata keys
    if (key.startsWith("$")) continue;

    const nextPath = [...currentPath, key];

    if (value && typeof value === "object" && "$value" in value) {
      results.push({
        path: nextPath.join("."),
        $type: value.$type || "unknown",
        $value: value.$value,
      });
    } else if (value && typeof value === "object") {
      results.push(...collectTokens(value, nextPath));
    }
  }

  return results;
}

/* -------------------- Formatters -------------------- */

function formatCSSValue(token) {
  const { $value, $type } = token;
  if (isAlias($value)) return aliasToCSS($value);
  if ($type === "number") return String($value);
  return String($value);
}

function formatSCSSValue(token) {
  const { $value, $type } = token;
  if (isAlias($value)) return aliasToSCSS($value);
  if ($type === "number") return String($value);
  return String($value);
}

/**
 * Generate CSS :root block from a list of tokens.
 */
function generateCSS(tokens, selector = ":root") {
  if (tokens.length === 0) return "";
  const lines = tokens.map(
    (t) => `  --${pathToVarName(t.path)}: ${formatCSSValue(t)};`
  );
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

/**
 * Generate SCSS variables from a list of tokens.
 */
function generateSCSS(tokens) {
  if (tokens.length === 0) return "";
  return tokens
    .map((t) => `$${pathToVarName(t.path)}: ${formatSCSSValue(t)};`)
    .join("\n") + "\n";
}

/* -------------------- Per-set file generation -------------------- */

async function processTokenSet(setKey, setData, outputDir) {
  const tokens = collectTokens(setData);
  if (tokens.length === 0) return { css: "", scss: "" };

  const cssContent = generateCSS(tokens);
  const scssContent = generateSCSS(tokens);

  const safeName = setKey.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();

  await fs.writeFile(path.join(outputDir, `${safeName}.css`), cssContent, "utf8");
  await fs.writeFile(path.join(outputDir, `${safeName}.scss`), scssContent, "utf8");

  console.log(`  ✔ ${safeName}.css / ${safeName}.scss  (${tokens.length} tokens)`);

  return { css: cssContent, scss: scssContent };
}

/* -------------------- Main -------------------- */

async function main() {
  const genAllPath = path.join(TOKENS_DIR, "GEN_ALL.tokens.json");

  if (!fs.existsSync(genAllPath)) {
    console.error("❌ GEN_ALL.tokens.json not found. Run fetch-figma-variables.js first.");
    process.exit(1);
  }

  const genAll = await fs.readJson(genAllPath);
  await fs.ensureDir(OUTPUT_DIR);

  const tokenOrder =
    genAll.$metadata?.tokenSetOrder || Object.keys(genAll).filter((k) => k !== "$metadata");

  const allCSS = [];
  const allSCSS = [];

  console.log("🎨 Converting tokens to CSS / SCSS...");

  for (const setKey of tokenOrder) {
    const setData = genAll[setKey];
    if (!setData || typeof setData !== "object") continue;

    const { css, scss } = await processTokenSet(setKey, setData, OUTPUT_DIR);
    if (css) allCSS.push(`/* ---- ${setKey} ---- */\n${css}`);
    if (scss) allSCSS.push(`// ---- ${setKey} ----\n${scss}`);
  }

  // Write combined files
  await fs.writeFile(path.join(OUTPUT_DIR, "tokens.css"), allCSS.join("\n"), "utf8");
  await fs.writeFile(path.join(OUTPUT_DIR, "tokens.scss"), allSCSS.join("\n"), "utf8");

  console.log(`\n✅ Combined tokens.css / tokens.scss written to ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
