import fs from "node:fs";

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.FIGMA_FILE_KEY;

if (!token) throw new Error("Missing FIGMA_TOKEN");
if (!fileKey) throw new Error("Missing FIGMA_FILE_KEY");

const url = `https://api.figma.com/v1/files/${fileKey}`;

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
  const text = await response.text();
  throw new Error(
    `Unable to fetch Figma file: HTTP ${response.status}\n${text}`
  );
}

const data = await response.json();

fs.mkdirSync("tokens", { recursive: true });
fs.writeFileSync(
  "tokens/file.json",
  JSON.stringify(data, null, 2)
);

console.log("File downloaded successfully.");
