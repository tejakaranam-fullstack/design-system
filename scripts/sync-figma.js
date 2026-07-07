import fs from "fs";

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.FIGMA_FILE_KEY;

const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;

const response = await fetch(url, {
    headers: {
        "X-Figma-Token": token
    }
});

if (!response.ok) {
    throw new Error("Unable to fetch Figma variables");
}

const variables = await response.json();

fs.mkdirSync("tokens", { recursive: true });

fs.writeFileSync(
    "tokens/variables.json",
    JSON.stringify(variables, null, 2)
);

console.log("Variables synced.");