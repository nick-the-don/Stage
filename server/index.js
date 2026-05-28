import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

loadDotEnv(path.join(rootDir, ".env"));

const clientToken = crypto.randomBytes(32).toString("base64url");
const app = express();

app.use(express.json({ limit: "25mb" }));

const config = {
  apiKey: secretValue("google", "api_key", "GOOGLE_API_KEY", ""),
  defaultFps: Number(secretValue("veo", "default_fps", "VEO_DEFAULT_FPS", "24") || 24),
  defaultResolution: String(secretValue("veo", "default_resolution", "VEO_DEFAULT_RESOLUTION", "1080p") || "1080p"),
};

app.get("/api/config", (_req, res) => {
  res.json({
    proxy_url: "",
    client_token: clientToken,
    has_api_key: Boolean(config.apiKey),
    defaults: {
      fps: config.defaultFps,
      resolution: config.defaultResolution,
    },
  });
});

app.post("/api/veo/submit", requireProxyToken, async (req, res) => {
  try {
    ensureApiKey();
    const { modelName, body } = buildVeoRequest(req.body?.payload || {});
    const operation = await googleJsonRequest(
      "POST",
      `${VEO_BASE_URL}/models/${modelName}:predictLongRunning`,
      body,
      90_000,
    );
    if (!operation.name) {
      throw new Error(`No operation name returned: ${JSON.stringify(operation)}`);
    }
    res.json({ operation_name: operation.name, model_name: modelName });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/veo/status", requireProxyToken, async (req, res) => {
  try {
    ensureApiKey();
    const operationName = String(req.body?.operation_name || "").replace(/^\/+/, "");
    if (!operationName) {
      res.status(400).json({ error: "operation_name is required." });
      return;
    }

    const operation = await googleJsonRequest("GET", `${VEO_BASE_URL}/${operationName}`, null, 45_000);
    res.json({
      done: Boolean(operation.done),
      video_uri: extractVideoUri(operation),
      error: operation.error,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/veo/download", requireProxyToken, async (req, res) => {
  try {
    ensureApiKey();
    const uri = String(req.query.uri || "");
    if (!uri.startsWith("http")) {
      res.status(400).json({ error: "A generated video URI is required." });
      return;
    }

    const response = await fetch(uri, {
      headers: { "x-goog-api-key": config.apiKey },
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Video download failed (${response.status}): ${text.slice(0, 1200)}`);
    }

    res.status(200);
    res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="veo_generated.mp4"');
    const length = response.headers.get("content-length");
    if (length) {
      res.setHeader("Content-Length", length);
    }
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    sendError(res, error);
  }
});

if (production) {
  const distDir = path.join(rootDir, "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Stage listening on http://${host}:${port}`);
  if (!config.apiKey) {
    console.log("No Google API key configured. Set GOOGLE_API_KEY in .env before running Veo jobs.");
  }
});

function requireProxyToken(req, res, next) {
  const queryToken = String(req.query.token || "");
  const headerToken = String(req.get("X-Veo-Proxy-Token") || "");
  if (clientToken && (queryToken === clientToken || headerToken === clientToken)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized proxy request." });
}

function ensureApiKey() {
  if (!config.apiKey) {
    throw new Error("Missing GOOGLE_API_KEY in .env.");
  }
}

async function googleJsonRequest(method, url, payload, timeoutMs) {
  const response = await fetch(url, {
    method,
    headers: {
      "x-goog-api-key": config.apiKey,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Google API request failed (${response.status}): ${text.slice(0, 1200)}`);
  }
  return data;
}

function buildVeoRequest(payload) {
  const modelName = payload.model_id === "veo-3.1-fast"
    ? "veo-3.1-fast-generate-preview"
    : "veo-3.1-generate-preview";

  const clips = payload.clips || [];
  if (!clips.length) {
    throw new Error("No clips found in payload.");
  }

  const clip = clips[0];
  const generationConfig = clip.generation_config || {};
  const blocks = clip.compiled_blocks || [];
  const firstBlock = blocks[0] || {};
  let aspectRatio = String(firstBlock.aspect_ratio || "16:9");
  if (!["9:16", "16:9"].includes(aspectRatio)) {
    aspectRatio = "16:9";
  }

  const referenceImages = [];
  for (const ref of clip.ingredients?.reference_images || []) {
    if (!ref.gcs_uri) {
      continue;
    }
    referenceImages.push({
      referenceType: ref.reference_type || "asset",
      image: { gcsUri: ref.gcs_uri, mimeType: "image/jpeg" },
    });
  }

  const body = {
    instances: [{ prompt: clip.prompt || "A cinematic shot." }],
    parameters: {
      durationSeconds: Number(generationConfig.seconds || 8),
      aspectRatio,
      generateAudio: Boolean(generationConfig.audio_enabled),
    },
  };

  if (referenceImages.length) {
    body.instances[0].referenceImages = referenceImages.slice(0, 3);
  }

  return { modelName, body };
}

function extractVideoUri(operationResponse) {
  return operationResponse?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || null;
}

function sendError(res, error) {
  const message = String(error && (error.message || error) || "Unknown error");
  res.status(500).json({ error: message });
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function secretValue(section, key, envName, fallback) {
  if (process.env[envName] !== undefined) {
    return process.env[envName];
  }
  const streamlitSecrets = parseSimpleToml(path.join(rootDir, ".streamlit", "secrets.toml"));
  return streamlitSecrets?.[section]?.[key] ?? fallback;
}

function parseSimpleToml(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const result = {};
  let section = null;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] ||= {};
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (section && valueMatch) {
      result[section][valueMatch[1]] = parseTomlScalar(valueMatch[2]);
    }
  }
  return result;
}

function parseTomlScalar(rawValue) {
  const trimmed = rawValue.trim();
  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  const numeric = Number(trimmed);
  return Number.isNaN(numeric) ? trimmed : numeric;
}
