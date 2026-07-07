import fs from "fs";

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.FIGMA_FILE_KEY;

if (!token || !fileKey) {
    console.warn("FIGMA_TOKEN or FIGMA_FILE_KEY is not set. Skipping Figma sync.");
    process.exit(0);
}

const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;

const response = await fetch(url, {
    headers: {
        "X-Figma-Token": token
    }
});

if (response.status === 404) {
    console.warn("Figma Variables API returned 404 — this endpoint requires a Figma Enterprise plan. Skipping sync.");
    process.exit(0);
}

if (response.status === 403) {
    console.warn("Figma Variables API returned 403 — check that FIGMA_TOKEN has the correct permissions. Skipping sync.");
    process.exit(0);
}

if (!response.ok) {
    throw new Error(`Unable to fetch Figma variables: HTTP ${response.status} ${response.statusText}`);
}

const variables = await response.json();

fs.mkdirSync("tokens", { recursive: true });

fs.writeFileSync(
    "tokens/variables.json",
    JSON.stringify(variables, null, 2)
);

console.log("Variables synced.");