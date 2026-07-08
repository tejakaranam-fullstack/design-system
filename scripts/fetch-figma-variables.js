// scripts/fetch-figma-variables.js
 
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
 
const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN;
const FIGMA_FILE_ID = process.env.FIGMA_FILE_ID;
 
if (!FIGMA_API_TOKEN || !FIGMA_FILE_ID) {
  console.error("❌ Missing FIGMA_API_TOKEN or FIGMA_FILE_ID");
  process.exit(1);
}
 
const headers = {
  "X-Figma-Token": FIGMA_API_TOKEN,
}; 
 
const OUTPUT_DIR = "tokens";
   
const COLLECTIONS_TO_EXPORT = {
  GLOBAL: "global (primitive)",
  BRAND_PRIMITIVE: "brand (primitive) (WIP)",
  BRAND_SEMANTIC: "brand semantic (WIP)",
};
 
const BRAND_NAMES = ["giredrestant", "ocrevus"];
 
/* -------------------- Helpers -------------------- */
 
function sanitizeFileName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
 
function mapType(type) {
  switch (type) {
    case "COLOR":
      return "color";
    case "FLOAT":
      return "number";
    case "STRING":
      return "string";
    case "BOOLEAN":
      return "boolean";
    default:
      return String(type || "string").toLowerCase();
  }
}
 
function colorToFigmaTokenValue(value) {
  return {
    colorSpace: "srgb",
    components: [value.r, value.g, value.b],
    alpha: value.a ?? 1,
    hex: rgbToHex(value.r, value.g, value.b),
  };
}
 
function rgbToHex(r, g, b) {
  const to255 = (v) => Math.round(v * 255);
  return (
    "#" +
    [to255(r), to255(g), to255(b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
 
function setNestedValue(target, tokenPath, tokenValue) {
  let current = target;
 
  tokenPath.forEach((key, index) => {
    if (index === tokenPath.length - 1) {
      current[key] = tokenValue;
    } else {
      current[key] = current[key] || {};
      current = current[key];
    }
  });
}
 
function getVariablePath(variableName) {
  return variableName.split("/");
}
 
/* -------------------- Figma Fetch -------------------- */
 
async function fetchVariables() {
  const response = await axios.get(
    `https://api.figma.com/v1/files/${FIGMA_FILE_ID}/variables/local`,
    { headers }
  );
 
  return response.data;
}
 
/* -------------------- Lookups -------------------- */
 
function createLookups(figmaData) {
  const collections = Object.values(figmaData.meta.variableCollections || {});
  const variables = Object.values(figmaData.meta.variables || {});
 
  const collectionById = {};
  const collectionByName = {};
  const variableById = {};
  const variableByName = {};
 
  collections.forEach((collection) => {
    collectionById[collection.id] = collection;
    collectionByName[collection.name] = collection;
  });
 
  variables.forEach((variable) => {
    variableById[variable.id] = variable;
    variableByName[variable.name] = variable;
  });
 
  return {
    collections,
    variables,
    collectionById,
    collectionByName,
    variableById,
    variableByName,
  };
}
 
/* -------------------- Value Formatting -------------------- */
 
function resolveAliasValue(rawValue, modeId, variableById, visited = new Set()) {
  if (!rawValue || rawValue.type !== "VARIABLE_ALIAS") {
    return rawValue;
  }
 
  const targetVariable = variableById[rawValue.id];
 
  if (!targetVariable) {
    return rawValue;
  }
 
  if (visited.has(targetVariable.id)) {
    return rawValue;
  }
 
  visited.add(targetVariable.id);
 
  const targetRawValue = targetVariable.valuesByMode?.[modeId];
 
  if (!targetRawValue) {
    return rawValue;
  }
 
  if (targetRawValue.type === "VARIABLE_ALIAS") {
    return resolveAliasValue(targetRawValue, modeId, variableById, visited);
  }
 
  return targetRawValue;
}
 
function formatTokenValue(resolvedValue) {
  if (
    resolvedValue &&
    typeof resolvedValue === "object" &&
    resolvedValue.r !== undefined &&
    resolvedValue.g !== undefined &&
    resolvedValue.b !== undefined
  ) {
    return colorToFigmaTokenValue(resolvedValue);
  }
 
  return resolvedValue;
}
 
function createAliasData(rawValue, variableById, collectionById) {
  if (!rawValue || rawValue.type !== "VARIABLE_ALIAS") {
    return undefined;
  }
 
  const targetVariable = variableById[rawValue.id];
 
  if (!targetVariable) {
    return {
      targetVariableId: rawValue.id,
    };
  }
 
  const targetCollection = collectionById[targetVariable.variableCollectionId];
 
  return {
    targetVariableId: targetVariable.id,
    targetVariableName: targetVariable.name,
    targetVariableSetId: targetVariable.variableCollectionId,
    targetVariableSetName: targetCollection?.name || "",
  };
}
 
function createToken(variable, rawValue, modeId, lookups) {
  const resolvedValue =
    rawValue?.type === "VARIABLE_ALIAS"
      ? resolveAliasValue(rawValue, modeId, lookups.variableById)
      : rawValue;
 
  const token = {
    $type: mapType(variable.resolvedType),
    $value: formatTokenValue(resolvedValue),
    $extensions: {
      "com.figma.variableId": variable.id,
      "com.figma.scopes": variable.scopes?.length
        ? variable.scopes
        : ["ALL_SCOPES"],
    },
  };
 
  if (variable.hiddenFromPublishing !== undefined) {
    token.$extensions["com.figma.hiddenFromPublishing"] =
      variable.hiddenFromPublishing;
  }
 
  if (variable.resolvedType === "STRING") {
    token.$extensions["com.figma.type"] = "string";
  }
 
  const aliasData = createAliasData(
    rawValue,
    lookups.variableById,
    lookups.collectionById
  );
 
  if (aliasData) {
    token.$extensions["com.figma.aliasData"] = aliasData;
  }
 
  return token;
}
 
/* -------------------- Collection Export -------------------- */
 
function buildCollectionTokens(collectionName, lookups) {
  const collection = lookups.collectionByName[collectionName];
 
  if (!collection) {
    console.warn(`⚠️ Collection not found: ${collectionName}`);
    return {};
  }
 
  const collectionVariables = lookups.variables.filter(
    (variable) => variable.variableCollectionId === collection.id
  );
 
  const outputByMode = {};
 
  collection.modes.forEach((mode) => {
    const modeOutput = {};
 
    collectionVariables.forEach((variable) => {
      const rawValue = variable.valuesByMode?.[mode.modeId];
 
      if (rawValue === undefined) return;
 
      const tokenPath = getVariablePath(variable.name);
 
      const token = createToken(variable, rawValue, mode.modeId, lookups);
 
      setNestedValue(modeOutput, tokenPath, token);
    });
 
    modeOutput.$extensions = {
      "com.figma.modeName": mode.name,
      "com.figma.parentVariableSetId": collection.id,
      "com.figma.parentVariableSetName": collection.name,
    };
 
    outputByMode[mode.name] = modeOutput;
  });
 
  return outputByMode;
}
 
/* -------------------- Brand Semantic Split -------------------- */
 
function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}
 
function retargetAliasDataToBrand(obj, brandName) {
  if (!obj || typeof obj !== "object") return;
 
  if (obj.$extensions?.["com.figma.aliasData"]) {
    const aliasData = obj.$extensions["com.figma.aliasData"];
 
    if (
      aliasData.targetVariableName &&
      aliasData.targetVariableName.startsWith("colors/")
    ) {
      const parts = aliasData.targetVariableName.split("/");
 
      /**
       * Example:
       * colors/ocrevus/primary/300
       * becomes:
       * colors/giredrestant/primary/300
       */
      parts[1] = brandName;
 
      aliasData.targetVariableName = parts.join("/");
    }
  }
 
  Object.values(obj).forEach((value) => {
    if (value && typeof value === "object") {
      retargetAliasDataToBrand(value, brandName);
    }
  });
}
 
/* -------------------- Save Files -------------------- */
 
async function saveFiles(figmaData) {
  await fs.ensureDir(OUTPUT_DIR);
  await fs.emptyDir(OUTPUT_DIR);
 
  const lookups = createLookups(figmaData);
 
  /**
   * 1. global (primitive)
   */
  const globalTokens = buildCollectionTokens(
    COLLECTIONS_TO_EXPORT.GLOBAL,
    lookups
  );
 
  await fs.writeJson(
    path.join(OUTPUT_DIR, "global-primitive.tokens.json"),
    globalTokens,
    { spaces: 2 }
  );
 
  /**
   * 2. brand (primitive) (WIP)
   */
  const brandPrimitiveTokens = buildCollectionTokens(
    COLLECTIONS_TO_EXPORT.BRAND_PRIMITIVE,
    lookups
  );
 
  await fs.writeJson(
    path.join(OUTPUT_DIR, "brand-primitive-wip.tokens.json"),
    brandPrimitiveTokens,
    { spaces: 2 }
  );
 
  /**
   * 3. brand semantic (WIP)
   *    - giredrestant
   *    - ocrevus
   */
  const brandSemanticTokens = buildCollectionTokens(
    COLLECTIONS_TO_EXPORT.BRAND_SEMANTIC,
    lookups
  );
 
  const semanticDir = path.join(OUTPUT_DIR, "brand-semantic-wip");
  await fs.ensureDir(semanticDir);
 
  BRAND_NAMES.forEach((brandName) => {
    const brandSemanticOutput = cloneDeep(brandSemanticTokens);
 
    /**
     * Keeps variable alias data,
     * but retargets brand primitive aliases per brand.
     */
    retargetAliasDataToBrand(brandSemanticOutput, brandName);
 
    fs.writeJsonSync(
      path.join(semanticDir, `${sanitizeFileName(brandName)}.tokens.json`),
      brandSemanticOutput,
      { spaces: 2 }
    );
  });
 
  /**
   * Optional combined file
   */
  await fs.writeJson(
    path.join(OUTPUT_DIR, "GEN_ALL.tokens.json"),
    {
      "global (primitive)": globalTokens,
      "brand (primitive) (WIP)": brandPrimitiveTokens,
      "brand semantic (WIP)": {
        giredrestant: cloneDeep(brandSemanticTokens),
        ocrevus: cloneDeep(brandSemanticTokens),
      },
    },
    { spaces: 2 }
  );
 
  console.log("✅ Tokens exported in required brand structure");
}
 
/* -------------------- Main -------------------- */
 
async function main() {
  try {
    console.log("🚀 Fetching Figma variables...");
 
    const figmaData = await fetchVariables();
 
    await saveFiles(figmaData);
 
    console.log("✅ Done");
  } catch (error) {
    console.error("❌ Failed to export Figma variables");
 
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
 
    process.exit(1);
  }
}
 
main();