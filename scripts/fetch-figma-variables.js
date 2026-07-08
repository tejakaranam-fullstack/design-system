import axios from "axios";

const token = process.env.FIGMA_API_TOKEN;
const fileKey = process.env.FIGMA_FILE_ID;

if (!token) throw new Error("Missing FIGMA_API_TOKEN");
if (!fileKey) throw new Error("Missing FIGMA_FILE_ID");

// Basic sanity check: file keys are usually URL-safe strings, not full URLs.
if (/^https?:\/\//i.test(fileKey)) {
  throw new Error(
    `FIGMA_FILE_ID should be a file key, not a URL. Received: ${fileKey}`
  );
}

const client = axios.create({
  baseURL: "https://api.figma.com/v1",
  headers: { "X-Figma-Token": token },
  timeout: 20000,
});

async function fetchVariables() {
  try {
    // Use file variables endpoint (file key required)
    const res = await client.get(`/files/${fileKey}/variables/local`);
    return res.data;
  } catch (err) {
    const status = err?.response?.status;
    const body = err?.response?.data;
    throw new Error(
      `Failed to fetch Figma variables for file '${fileKey}'. ` +
      `HTTP ${status ?? "unknown"}: ${JSON.stringify(body)}`
    );
  }
}
