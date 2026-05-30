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
const GEMINI_ANALYSIS_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_BASE_URL = "https://generativelanguage.googleapis.com/v1";
const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_ANALYSIS_MODEL = process.env.GEMINI_ANALYSIS_MODEL || "gemini-2.5-flash";
const NANO_BANANA_PRO_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
const PLACEHOLDER_SECRET_VALUES = new Set([
  "",
  "YOUR_GOOGLE_API_KEY",
  "PASTE_YOUR_GEMINI_API_KEY_HERE",
  "PASTE_YOUR_GOOGLE_API_KEY_HERE",
]);

loadDotEnv(path.join(rootDir, "access.env"));
loadDotEnv(path.join(rootDir, ".env"));

const clientToken = crypto.randomBytes(32).toString("base64url");
const app = express();

app.use(express.json({ limit: "80mb" }));

const config = {
  apiKey: secretValueAny("google", "api_key", ["GEMINI_API_KEY", "GOOGLE_API_KEY"], ""),
  defaultFps: Number(secretValue("veo", "default_fps", "VEO_DEFAULT_FPS", "24") || 24),
  defaultResolution: String(secretValue("veo", "default_resolution", "VEO_DEFAULT_RESOLUTION", "1080p") || "1080p"),
};

app.get("/api/config", (_req, res) => {
  res.json({
    proxy_url: "",
    client_token: clientToken,
    has_api_key: Boolean(config.apiKey),
    gemini_models: {
      analysis: GEMINI_ANALYSIS_MODEL,
      image: NANO_BANANA_PRO_MODEL,
    },
    defaults: {
      fps: config.defaultFps,
      resolution: config.defaultResolution,
    },
  });
});

app.post("/api/gemini/analyze", requireProxyToken, async (req, res) => {
  try {
    ensureApiKey();
    const imageDataUrl = String(req.body?.image_data_url || "");
    const imageName = String(req.body?.image_name || "uploaded reference");
    if (!imageDataUrl) {
      res.status(400).json({ error: "image_data_url is required." });
      return;
    }

    const inlineImage = dataUrlToInlineData(imageDataUrl);
    const body = {
      contents: [{
        role: "user",
        parts: [
          { text: buildAssetReferenceAnalysisPrompt({ imageName, nodeId: req.body?.node_id }) },
          { inline_data: inlineImage },
        ],
      }],
      generationConfig: {
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: assetReferenceAnalysisSchema(),
          },
        },
      },
    };

    const response = await googleJsonRequest(
      "POST",
      `${GEMINI_ANALYSIS_BASE_URL}/models/${GEMINI_ANALYSIS_MODEL}:generateContent`,
      body,
      90_000,
    );
    const rawText = extractCandidateText(response);
    const parsed = parseJsonFromModelText(rawText);
    const analysis = normalizeAssetReferenceAnalysis(parsed, {
      imageName,
      nodeId: req.body?.node_id,
      model: GEMINI_ANALYSIS_MODEL,
    });
    res.json({ analysis, model: GEMINI_ANALYSIS_MODEL, raw_text: rawText });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/gemini/image", requireProxyToken, async (req, res) => {
  try {
    ensureApiKey();
    const prompt = String(req.body?.prompt || "").trim();
    const model = String(req.body?.model || NANO_BANANA_PRO_MODEL);
    const aspectRatio = normalizeAspectRatio(req.body?.aspect_ratio);
    const imageSize = normalizeImageSize(req.body?.resolution || req.body?.image_size);
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!prompt && !images.length) {
      res.status(400).json({ error: "A prompt or at least one image input is required." });
      return;
    }

    const imageParts = images
      .map((image, index) => {
        const dataUrl = image && (image.data_url || image.dataUri || image.url);
        if (!dataUrl || !String(dataUrl).startsWith("data:")) {
          return null;
        }
        const label = String(image.label || `input_${index + 1}`);
        const role = String(image.role || (index < 6 ? "high_fidelity" : "supplementary"));
        return [
          { text: `[${label} | ${role}]` },
          { inline_data: dataUrlToInlineData(String(dataUrl)) },
        ];
      })
      .filter(Boolean)
      .flat();

    const body = {
      contents: [{
        role: "user",
        parts: [
          { text: buildNanoBananaPrompt(prompt, images) },
          ...imageParts,
        ],
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: {
            aspectRatio,
            imageSize,
          },
        },
      },
    };

    const response = await googleJsonRequest(
      "POST",
      `${GEMINI_IMAGE_BASE_URL}/models/${model}:generateContent`,
      body,
      180_000,
    );
    const generated = extractGeneratedImage(response);
    if (!generated) {
      throw new Error(`No generated image returned. Model text: ${extractCandidateText(response).slice(0, 800)}`);
    }
    res.json({
      image_data_url: inlineDataToDataUrl(generated),
      mime_type: generated.mime_type || generated.mimeType || "image/png",
      text: extractCandidateText(response),
      model,
      inputs_used: images.length,
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    });
  } catch (error) {
    sendError(res, error);
  }
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
    const usageMetadata = operation?.response?.usageMetadata || operation?.metadata?.usageMetadata || null;
    res.json({
      done: Boolean(operation.done),
      video_uri: extractVideoUri(operation),
      video_uris: extractVideoUris(operation),
      usage_metadata: usageMetadata,
      operation_metadata: operation.metadata || null,
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
    console.log("No Gemini API key configured. Set GEMINI_API_KEY in access.env before running Veo jobs.");
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
    throw new Error("Missing GEMINI_API_KEY in access.env, or GOOGLE_API_KEY in .env.");
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

function dataUrlToInlineData(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Expected an image data URL.");
  }
  return {
    mime_type: match[1],
    data: match[2],
  };
}

function inlineDataToDataUrl(inlineData) {
  const mimeType = inlineData?.mime_type || inlineData?.mimeType || "image/png";
  const data = inlineData?.data || "";
  return `data:${mimeType};base64,${data}`;
}

function extractCandidateText(response) {
  const parts = [];
  for (const candidate of response?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.text) {
        parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractGeneratedImage(response) {
  for (const candidate of response?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      const inlineData = part?.inline_data || part?.inlineData;
      if (inlineData?.data) {
        return inlineData;
      }
    }
  }
  return null;
}

function parseJsonFromModelText(text) {
  const source = String(text || "").trim();
  if (!source) {
    throw new Error("Gemini returned an empty analysis response.");
  }
  try {
    return JSON.parse(source);
  } catch (_error) {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }
    const objectMatch = source.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error("Gemini analysis was not valid JSON.");
  }
}

function buildAssetReferenceAnalysisPrompt({ imageName, nodeId }) {
  return [
    "Analyze this uploaded Asset Reference for a node-based image/video generation pipeline.",
    "Return only JSON matching the provided schema.",
    "The JSON will be editable and will cascade into downstream node prompts.",
    "Be specific about visible identity, silhouette, wardrobe/materials, palette, lighting, camera/composition cues, and useful negative prompts.",
    "Keep the language concise, production-ready, and directly reusable in prompts.",
    `Image name: ${imageName || "uploaded reference"}.`,
    `Node id: ${nodeId || "asset_reference"}.`,
  ].join("\n");
}

function buildNanoBananaPrompt(prompt, images) {
  const imageCount = Array.isArray(images) ? images.length : 0;
  const context = imageCount
    ? `Use all ${imageCount} supplied image input(s). Inputs 1-6 are high fidelity anchors; later inputs are supplementary references unless their labels say otherwise.`
    : "No image references were supplied.";
  return [
    "Generate a polished still image for the Stage node graph using Nano Banana Pro / Gemini image generation.",
    context,
    "Preserve identity, pose, wardrobe, palette, lighting, and material constraints from connected upstream nodes unless the prompt explicitly overrides them.",
    "Return an image result.",
    "",
    "Prompt:",
    prompt || "Create the best coherent image implied by the connected inputs.",
  ].join("\n");
}

function assetReferenceAnalysisSchema() {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      source: {
        type: "object",
        properties: {
          image_name: { type: "string" },
          subject_type: { type: "string" },
          visible_subjects: stringArray,
          notable_features: stringArray,
          palette: stringArray,
          lighting: { type: "string" },
          camera: { type: "string" },
          background: { type: "string" },
        },
      },
      identity_profile: {
        type: "object",
        properties: {
          summary: { type: "string" },
          subject: { type: "string" },
          identity_markers: stringArray,
          wardrobe: stringArray,
          palette: stringArray,
          lighting: { type: "string" },
          camera: { type: "string" },
          background: { type: "string" },
          negative: stringArray,
        },
      },
      cascade: {
        type: "object",
        properties: {
          prompt_prefix: { type: "string" },
          node_prompts: {
            type: "object",
            properties: {
              face: { type: "string" },
              body: { type: "string" },
              clothing: { type: "string" },
              pose: { type: "string" },
            },
          },
          reference_descriptions: {
            type: "object",
            properties: {
              asset: { type: "string" },
              style: { type: "string" },
            },
          },
        },
      },
      validation_rules: {
        type: "object",
        properties: {
          forbidden_prompt_terms: stringArray,
          warnings: stringArray,
        },
      },
      model_json_effects: stringArray,
    },
    required: ["source", "identity_profile", "cascade", "validation_rules", "model_json_effects"],
  };
}

function normalizeAssetReferenceAnalysis(value, meta) {
  const input = value && typeof value === "object" ? value : {};
  const sourceInput = input.source && typeof input.source === "object" ? input.source : {};
  const profileInput = input.identity_profile && typeof input.identity_profile === "object" ? input.identity_profile : {};
  const cascadeInput = input.cascade && typeof input.cascade === "object" ? input.cascade : {};
  const nodePrompts = cascadeInput.node_prompts && typeof cascadeInput.node_prompts === "object" ? cascadeInput.node_prompts : {};
  const descriptions = cascadeInput.reference_descriptions && typeof cascadeInput.reference_descriptions === "object" ? cascadeInput.reference_descriptions : {};
  const validationInput = input.validation_rules && typeof input.validation_rules === "object" ? input.validation_rules : {};
  const imageName = meta.imageName || sourceInput.image_name || "uploaded reference";
  const summary = profileInput.summary || `Use ${imageName} as the primary identity and style anchor.`;
  const promptPrefix = cascadeInput.prompt_prefix || `[ANALYZED ASSET REFERENCE] ${summary}`;

  return {
    schema: "stage.asset_reference.analysis.v1",
    status: "analyzed",
    activated: true,
    analyzed_at: new Date().toISOString(),
    source: {
      image_name: imageName,
      node_id: meta.nodeId || null,
      model: meta.model || GEMINI_ANALYSIS_MODEL,
      subject_type: sourceInput.subject_type || "asset reference",
      visible_subjects: arrayOfStrings(sourceInput.visible_subjects),
      notable_features: arrayOfStrings(sourceInput.notable_features),
      palette: arrayOfStrings(sourceInput.palette),
      lighting: sourceInput.lighting || profileInput.lighting || "",
      camera: sourceInput.camera || profileInput.camera || "",
      background: sourceInput.background || profileInput.background || "",
    },
    gateway: {
      activated: true,
      activates_node_types: ["face", "body", "clothing", "pose", "nano_banana"],
      cascade_scope: "all downstream generator nodes",
    },
    identity_profile: {
      summary,
      subject: profileInput.subject || sourceInput.subject_type || "Primary subject or asset in the uploaded reference image.",
      identity_markers: arrayOfStrings(profileInput.identity_markers, sourceInput.notable_features, ["preserve the same subject identity", "preserve silhouette and proportions"]),
      wardrobe: arrayOfStrings(profileInput.wardrobe),
      palette: arrayOfStrings(profileInput.palette, sourceInput.palette),
      lighting: profileInput.lighting || sourceInput.lighting || "Match the apparent lighting direction, contrast, and color temperature from the reference.",
      camera: profileInput.camera || sourceInput.camera || "Use the visible composition and lens cues as a reference.",
      background: profileInput.background || sourceInput.background || "Treat the background as secondary unless overridden downstream.",
      negative: arrayOfStrings(profileInput.negative, validationInput.forbidden_prompt_terms, ["different person", "new identity", "unrelated character"]),
    },
    cascade: {
      prompt_prefix: promptPrefix,
      node_prompts: {
        face: nodePrompts.face || `${promptPrefix} Face pass: preserve facial or primary identity markers, proportions, silhouette, expression range, and distinctive visible details.`,
        body: nodePrompts.body || `${promptPrefix} Body pass: preserve full-body proportions, silhouette, stance language, scale, and material continuity.`,
        clothing: nodePrompts.clothing || `${promptPrefix} Clothing pass: preserve detected wardrobe, accessories, fabric/material logic, and palette unless a local clothing prompt overrides it.`,
        pose: nodePrompts.pose || `${promptPrefix} Pose pass: preserve identity and body mechanics while changing only the requested action or stance.`,
      },
      reference_descriptions: {
        asset: descriptions.asset || `Primary identity anchor from ${imageName}: preserve subject, proportions, silhouette, and visible details.`,
        style: descriptions.style || `Style anchor from ${imageName}: preserve palette, lighting, camera feel, and material tone.`,
      },
    },
    validation_rules: {
      forbidden_prompt_terms: arrayOfStrings(validationInput.forbidden_prompt_terms, profileInput.negative, ["different person", "new identity", "changed face", "change face", "unrelated character"]),
      warnings: arrayOfStrings(validationInput.warnings),
    },
    model_json_effects: arrayOfStrings(input.model_json_effects, [
      "Adds identity_profile to the compiled model JSON.",
      "Prefixes downstream generator prompts with cascade.node_prompts[type].",
      "Improves reference image descriptions in ingredients.reference_images.",
      "Activates downstream generator nodes through the Asset Reference gateway.",
    ]),
  };
}

function arrayOfStrings(...values) {
  const out = [];
  for (const value of values) {
    const list = Array.isArray(value) ? value : (typeof value === "string" && value ? [value] : []);
    for (const item of list) {
      const text = String(item || "").trim();
      if (text && !out.includes(text)) {
        out.push(text);
      }
    }
  }
  return out;
}

function normalizeAspectRatio(value) {
  const ratio = String(value || "16:9");
  return ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"].includes(ratio) ? ratio : "16:9";
}

function normalizeImageSize(value) {
  const normalized = String(value || "2K").toUpperCase();
  if (["1K", "2K", "4K"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "SD" || normalized === "HD") {
    return "1K";
  }
  return "2K";
}

function veoVertexModelName(modelId) {
  const value = String(modelId || "");
  if (value === "veo-3.1-fast" || value === "veo-3.1-fast-generate-preview" || value === "veo-3.1-fast-generate-001") {
    return "veo-3.1-fast-generate-001";
  }
  if (value === "veo-3.1-quality" || value === "veo-3.1-generate-preview" || value === "veo-3.1-generate-001") {
    return "veo-3.1-generate-001";
  }
  return value || "veo-3.1-generate-001";
}

function isVeo31ModelName(modelName) {
  return String(modelName || "").startsWith("veo-3.1");
}

function normalizeVeoDurationSeconds(value, hasReferenceImages) {
  if (hasReferenceImages) {
    return 8;
  }
  const allowed = [4, 6, 8];
  const n = Number(value || 8);
  return allowed.reduce((best, curr) => {
    const bestDiff = Math.abs(best - n);
    const currDiff = Math.abs(curr - n);
    return currDiff < bestDiff || (currDiff === bestDiff && curr > best) ? curr : best;
  }, 8);
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  const safe = Number.isFinite(num) ? num : fallback;
  return Math.round(Math.max(min, Math.min(max, safe)));
}

function normalizeVeoResolution(value) {
  const raw = String(value || "1080p").trim().toUpperCase();
  if (["SD", "720", "720P"].includes(raw)) {
    return "720p";
  }
  if (["4K", "UHD"].includes(raw)) {
    return "4K";
  }
  if (["HD", "FHD", "FULLHD", "FULL HD", "1080", "1080P", "2K"].includes(raw)) {
    return "1080p";
  }
  return "1080p";
}

function normalizeVeoFps() {
  return 24;
}

function normalizeVeoSampleCount(value) {
  return clampInt(value, 1, 4, 1);
}

function imageInputFromModelInputs(modelInputs, handle) {
  const input = (modelInputs || []).find((item) => item.handle === handle && item.gcs_uri);
  if (!input) {
    return null;
  }
  return {
    gcsUri: input.gcs_uri,
    mimeType: input.mime_type || "image/jpeg",
  };
}

function referenceImagesForVeo(referenceImages, modelName) {
  const out = [];
  for (const ref of referenceImages || []) {
    if (!ref?.gcs_uri) {
      continue;
    }
    const referenceType = String(ref.reference_type || "asset") === "style" ? "style" : "asset";
    if (isVeo31ModelName(modelName) && referenceType === "style") {
      continue;
    }
    out.push({
      referenceType,
      image: { gcsUri: ref.gcs_uri, mimeType: ref.mime_type || "image/jpeg" },
    });
    if (out.length >= 3) {
      break;
    }
  }
  return out;
}

function buildVeoRequest(payload) {
  if (payload?.model_family === "gemini_omni" || String(payload?.model_id || "").startsWith("gemini-omni")) {
    throw new Error("Gemini Omni payloads can be compiled/exported, but this local /api/veo/submit route only submits Veo models for now.");
  }
  const modelName = veoVertexModelName(payload.model_id);

  const clips = payload.clips || [];
  if (!clips.length) {
    throw new Error("No clips found in payload.");
  }

  const clip = clips[0];
  const generationConfig = clip.generation_config || {};
  const blocks = clip.compiled_blocks || [];
  const firstBlock = blocks[0] || {};
  let aspectRatio = String(generationConfig.aspect_ratio || firstBlock.aspect_ratio || "16:9");
  if (!["9:16", "16:9"].includes(aspectRatio)) {
    aspectRatio = "16:9";
  }

  const modelInputs = clip.ingredients?.model_inputs || [];
  const startImage = imageInputFromModelInputs(modelInputs, "start");
  const endImage = startImage ? imageInputFromModelInputs(modelInputs, "end") : null;
  const referenceImages = startImage ? [] : referenceImagesForVeo(clip.ingredients?.reference_images, modelName);
  const task = startImage ? "imageToVideo" : (referenceImages.length ? "referenceToVideo" : "textToVideo");

  const body = {
    instances: [{
      prompt: clip.prompt || "A cinematic shot.",
    }],
    parameters: {
      task,
      sampleCount: normalizeVeoSampleCount(generationConfig.sample_count || generationConfig.batch || 1),
      durationSeconds: normalizeVeoDurationSeconds(generationConfig.seconds || 8, referenceImages.length > 0),
      aspectRatio,
      fps: normalizeVeoFps(generationConfig.fps),
      resolution: normalizeVeoResolution(generationConfig.resolution),
      generateAudio: Boolean(generationConfig.audio_enabled),
      enhancePrompt: true,
      compressionQuality: "optimized",
      personGeneration: "allow_adult",
      resizeMode: "pad",
    },
  };

  if (startImage) {
    body.instances[0].image = startImage;
    if (endImage) {
      body.instances[0].lastFrame = endImage;
    }
  } else if (referenceImages.length) {
    body.instances[0].referenceImages = referenceImages;
  }

  return { modelName, body };
}

function extractVideoUri(operationResponse) {
  return extractVideoUris(operationResponse)[0] || null;
}

function extractVideoUris(operationResponse) {
  const samples = operationResponse?.response?.generateVideoResponse?.generatedSamples || [];
  return samples.map((sample) => sample?.video?.uri).filter(Boolean);
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
  if (hasUsableSecret(process.env[envName])) {
    return process.env[envName];
  }
  const streamlitSecrets = parseSimpleToml(path.join(rootDir, ".streamlit", "secrets.toml"));
  const secret = streamlitSecrets?.[section]?.[key];
  return hasUsableSecret(secret) ? secret : fallback;
}

function secretValueAny(section, key, envNames, fallback) {
  for (const envName of envNames) {
    if (hasUsableSecret(process.env[envName])) {
      return process.env[envName];
    }
  }
  const streamlitSecrets = parseSimpleToml(path.join(rootDir, ".streamlit", "secrets.toml"));
  const secret = streamlitSecrets?.[section]?.[key];
  return hasUsableSecret(secret) ? secret : fallback;
}

function hasUsableSecret(value) {
  if (value === undefined || value === null) {
    return false;
  }
  const text = String(value).trim();
  return !PLACEHOLDER_SECRET_VALUES.has(text);
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
