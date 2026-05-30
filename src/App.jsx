import React from "react";
import htm from "htm";
import ReactFlow, {
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import "./App.css";

const html = htm.bind(React.createElement);

function nowTime(){
  try { return new Date().toLocaleTimeString([], {hour12:false}); }
  catch(e){ return ""; }
}

const MODEL_CATALOG = {
  "Veo 3.1 Quality": { id: "veo-3.1-generate-001", credits_per_sec_hd: 12, max_reference_images: 3, supports_audio: true },
  "Veo 3.1 Fast": { id: "veo-3.1-fast-generate-001", credits_per_sec_hd: 5, max_reference_images: 2, supports_audio: false },
  "Gemini Omni Flash": { id: "gemini-omni-flash", credits_per_sec_hd: 8, max_reference_images: 5, supports_audio: true, is_omni: true, max_seconds: 10, explicit_start_end_frames: false }
};

const RES_PRESETS = ["SD","HD","2K","4K"];
const RES_MULT = { SD:0.7, HD:1.0, "720P":0.8, "720":0.8, "1080P":1.0, "1080":1.0, "2K":1.25, "4K":1.6 };
const ESTIMATE_RATES = {
  generator_image_hd: 3,
  nano_banana_hd: 8,
  asset_analysis: 1,
  audio_multiplier: 1.1
};
const ASPECT_PRESETS = ["1:1","9:16","16:9","21:9"];

const NODE_COLORS = { model:"#E63946", omni_model:"#7DD3FC", ref:"#F4A261", face:"#E9C46A", body:"#2A9D8F", clothing:"#3A86FF", pose:"#8E44AD", lens:"#C4B5FD", param:"#6C757D", clip:"#6C757D", nano_banana:"#FFD700" };
const REF_GATE_COLORS = { pending:"#E63946", active:"#4ec9b0" };
const ANALYSIS_SCHEMA_VERSION = "stage.asset_reference.analysis.v1";
const GRID_DOT_GAP = 18;
const FLOW_MIN_ZOOM = 0.08;
const WIRE_PATCH_COLOR = REF_GATE_COLORS.active;
const MINIMAP_STYLE = {
  backgroundColor: "rgba(20,20,20,.62)",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: "8px",
  boxShadow: "0 14px 32px rgba(0,0,0,.32)",
  backdropFilter: "blur(8px)",
};
function miniMapNodeColor(node){
  return NODE_COLORS[node.type] || "#777";
}
function miniMapNodeStrokeColor(node){
  return NODE_COLORS[node.type] || "#9a9a9a";
}

const PALETTE = [
  { key:"model", title:"VEO", subtitle:"Final render + chaining", tags:["Veo 3.1 Fast/Quality"] },
  { key:"omni_model", title:"Google Omni", subtitle:"Any-input video model", tags:["10s","5 photo refs","video/audio"] },
  { key:"nano_banana", title:"Nano Banana Pro", subtitle:"Gemini 3 Pro Image", tags:["14-img blend","high fidelity"], thumb:"14x" },
  { key:"ref", title:"Asset Reference", subtitle:"Upload / Analyze", tags:["reference image"], thumb:"IMG" },
  { key:"face", title:"CU / Face", subtitle:"Close-up identity passes", tags:["face cref"] },
  { key:"body", title:"Body CREF", subtitle:"Full-body consistency", tags:["turnaround"] },
  { key:"clothing", title:"Clothing / Accessories", subtitle:"Wardrobe exploration", tags:["materials"] },
  { key:"pose", title:"Pose action", subtitle:"Readable silhouette", tags:["action"] },
  { key:"param_batch_4", title:"Batch", subtitle:"Output samples", tags:["parameter"] },
  { key:"param_length_8", title:"Length", subtitle:"Clip duration", tags:["parameter"] },
  { key:"param_fps_24", title:"FPS", subtitle:"Frame rate", tags:["parameter"] },
  { key:"param_aspect_16_9", title:"Aspect", subtitle:"Frame shape", tags:["parameter"] },
  { key:"param_res_hd", title:"Resolution", subtitle:"Output size", tags:["parameter"] },
  { key:"param_lens", title:"Lens", subtitle:"Optics + shutter", tags:["parameter"] },
  { key:"clip", title:"Background", subtitle:"Scene / environment", tags:["backdrop"] }
];

const PARAM_KEYS = PALETTE.map(p=>p.key).filter(k=>k.startsWith("param_"));
const FOCAL_LENGTH_OPTIONS = ["14mm","18mm","21mm","24mm","28mm","35mm","40mm","50mm","65mm","75mm","85mm","100mm","135mm","200mm"];
const APERTURE_OPTIONS = ["f/1.2","f/1.4","f/2","f/2.8","f/4","f/5.6","f/8","f/11","f/16"];
const LENS_EFFECT_OPTIONS = ["None","Split-Diopter","Prism Glass","Edge Smearing","Chromatic Aberration","Prism Refraction","Swirly Bokeh","Cat-Eye Bokeh","Hexagonal Bokeh"];
const SHUTTER_EFFECT_OPTIONS = ["Natural Motion Blur","Long Exposure / Slow Shutter","1/12s Heavy Motion Blur","High Shutter Speed","1/1000s Freeze Motion","Narrow Shutter Angle","Wide Shutter Angle"];
const PARAMETER_DEFS = [
  { key:"batch", title:"Batch", param_key:"batch", default_val:1, options:[1,2,3,4], note:"Veo max output videos per prompt is 4." },
  { key:"length", title:"Length", param_key:"length_seconds", default_val:8, options:[4,6,8,10], suffix:"s", note:"Veo accepts 4, 6, or 8 seconds; 10s is kept for Omni intent." },
  { key:"fps", title:"FPS", param_key:"fps", default_val:24, options:[24,30,60], note:"Veo 3.1 submits at 24 FPS; higher values are Omni/style intent." },
  { key:"aspect", title:"Aspect", param_key:"aspect", default_val:"16:9", options:["16:9","9:16"], note:"Veo 3.1 accepts landscape or portrait." },
  { key:"resolution", title:"Resolution", param_key:"res", default_val:"1080p", options:["720p","1080p","4K"], note:"Veo 3.1 supports 720p, 1080p, and 4K preview output." },
  { key:"lens", title:"Lens", param_key:"lens", default_val:"lens", options:[], note:"Prompt-level optical guidance: focal length, aperture, lens effects, and shutter effects." }
];
const PARAMETER_DEF_BY_PARAM_KEY = Object.fromEntries(PARAMETER_DEFS.map(def => [def.param_key, def]));
const LIBRARY_DEPARTMENTS = [
  { title:"Casting", keys:["face","pose","body","ref","nano_banana"] },
  { title:"Hair and Makeup", keys:["face","ref","nano_banana"] },
  { title:"Wardrobe", keys:["clothing","ref","nano_banana"] },
  { title:"Production Design", keys:["ref","nano_banana"] },
  { title:"Cinematography", keys:PARAM_KEYS },
  { title:"Directing", keys:[] },
  { title:"Print", keys:["model","omni_model"] }
];
const LIBRARY_UTILS = ["clip"];
const byKeys = (keys) => keys.map(k => PALETTE.find(p=>p.key===k)).filter(Boolean);
function paletteTypeForKey(key){
  return String(key || "").startsWith("param_") ? "param" : key;
}
function paletteColorForKey(key){
  const type = paletteTypeForKey(key);
  if(type === "ref") return REF_GATE_COLORS.pending;
  if(key === "param_lens") return NODE_COLORS.lens;
  return NODE_COLORS[type] || "#777";
}
function paletteItemStyle(key){
  const color = paletteColorForKey(key);
  return {
    borderColor: color,
    background: `linear-gradient(90deg, ${color}2b, #2d2d2d 68%)`,
    boxShadow: `inset 3px 0 0 ${color}`,
  };
}
function isGeneratorType(t){ return ["face","body","clothing","pose"].includes(t); }
function isCascadeTargetType(t){ return isGeneratorType(t) || t === "nano_banana"; }
function makeId(prefix){ return (prefix||"n") + "_" + Math.random().toString(16).slice(2,10); }
function snapValue(value, grid){
  return Math.round(Number(value || 0) / grid) * grid;
}
function snapFlowPosition(position, enabled){
  if(!enabled || !position) return position;
  return { x: snapValue(position.x, GRID_DOT_GAP), y: snapValue(position.y, GRID_DOT_GAP) };
}
function isTextEditingTarget(event){
  const el = event && event.target;
  if(!el) return false;
  const tag = String(el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!el.isContentEditable;
}

function parameterDefForData(data){
  if(data && (data.param_key === "focal_length" || data.param_key === "aperture")) return PARAMETER_DEF_BY_PARAM_KEY.lens || PARAMETER_DEFS[0];
  return PARAMETER_DEF_BY_PARAM_KEY[(data && data.param_key) || "batch"] || PARAMETER_DEFS[0];
}

function lensParamValues(data){
  const values = (data && data.param_values) || {};
  return {
    focal_length: values.focal_length || data?.focal_length || (data?.param_key === "focal_length" ? data?.param_val : null) || "35mm",
    aperture: values.aperture || data?.aperture || (data?.param_key === "aperture" ? data?.param_val : null) || "f/2.8",
    lens_effect: values.lens_effect || data?.lens_effect || "None",
    shutter_effect: values.shutter_effect || data?.shutter_effect || "Natural Motion Blur"
  };
}

function parameterTitleForKey(paramKey){
  return (PARAMETER_DEF_BY_PARAM_KEY[paramKey] && PARAMETER_DEF_BY_PARAM_KEY[paramKey].title) || "Parameter";
}

function parameterValueLabel(def, value){
  return `${value}${def && def.suffix && !String(value).endsWith(def.suffix) ? def.suffix : ""}`;
}

function defaultPropsFor(type){
  if(type==="model"){
    return { title:"VEO", subtitle:"Vertex video model", tags:["gates features","credits + price"], model_ver:"Veo 3.1 Quality", seconds_per_clip:8, resolution:"1080p", fps:24, batch:1, aspect:"16:9", focal_length:"As it comes", aperture:"As it comes", lens_effect:"None", shutter_effect:"Natural Motion Blur", audio_enabled:true, usd_per_credit:0.01, currency:"USD", usd_to_local:1.0 };
  }
  if(type==="omni_model"){
    return { title:"GOOGLE OMNI", subtitle:"Any-input video + edit model", tags:["gemini omni flash","up to 5 photos","video/audio"], model_ver:"Gemini Omni Flash", length_seconds:10, resolution:"4K", fps:24, batch:1, aspect:"16:9", focal_length:"As it comes", aperture:"As it comes", lens_effect:"None", shutter_effect:"Natural Motion Blur", audio_enabled:true, editing_layer:"nano-banana-pro", usd_per_credit:0.01, currency:"USD", usd_to_local:1.0 };
  }
  if(type==="nano_banana"){ 
    return { title:"Nano Banana Pro", subtitle:"14-Input Blender", tags:["gemini 3 pro"], res:"HD", aspect:"16:9", slots: Array(14).fill(null), prompt: "", result_uri: null, result_data_url: null, result_text: "", result_model: "", generation_status:"idle" }; 
  }
  if(type==="ref"){
    return { title:"Asset Reference", subtitle:"", tags:["nano banana pro","identity lock"], gcs_uri:"gs://your-bucket/character_master.jpg", reference_mode:"double_stacked", ref_slots:2, image_store_key:null, image_preview_url:null, image_data_url:null, image_name:null, analysis:null, analysis_status:"pending" };
  }
  if(type==="face"){
    return { title:"CU / Face (Variations)", subtitle:"Angles + identity lock", tags:["batch 4 default","portrait"], batch:4, res:"HD", aspect:"1:1", ref_slots:1, prompt:"4 facial variations (slightly different angles) of the SAME character identity. Preserve facial proportions, eye spacing, silhouette. Neutral grey background. Cinematic portrait lighting." };
  }
  if(type==="body"){
    return { title:"Body (Turnaround)", subtitle:"Front/side/rear/3Q", tags:["neutral suit","consistency"], batch:4, res:"HD", aspect:"16:9", ref_slots:1, prompt:"4 angles (front, side, rear, three-quarter) of the standing body of the character in bodyforming neutral skin-coloured attire against a medium grey background." };
  }
  if(type==="clothing"){
    return { title:"Clothing", subtitle:"Wardrobe exploration", tags:["materials","clean read"], batch:2, res:"HD", aspect:"16:9", ref_slots:1, prompt:"Clothing concept exploration for the character. Keep identity consistent. Show 2 clean variations with clear fabric/material read." };
  }
  if(type==="pose"){
    return { title:"Pose / Action", subtitle:"Readable silhouette", tags:["action","silhouette"], batch:2, res:"HD", aspect:"16:9", ref_slots:1, prompt:"Pose/action exploration. Keep character identity locked. Generate 2 variants of a readable action pose with clean silhouette." };
  }
  if(type==="param"){
    return { title:"PARAM", subtitle:"Overrides inputs", tags:["wire me in"], param_key:"batch", param_val:2 };
  }
  if(type==="clip"){
    return { clip_name:"BACKGROUND", clip_index:1, seconds:8, autochain_to_next_clip:true, output_last_frame_uri:"gs://your-bucket/renders/CLIP_A_LAST_FRAME.png" };
  }
  return { title:type.toUpperCase(), subtitle:"", tags:[] };
}

function incomingParams(nodeId, nodes, edges){
  const incoming = edges.filter(e => e.target === nodeId).map(e => e.source);
  const params = {};
  for(const sid of incoming){
    const src = nodes.find(n => n.id === sid);
    if(src && src.type === "param"){
      if(src.data && src.data.param_key === "lens"){
        Object.assign(params, lensParamValues(src.data));
        continue;
      }
      if(src.data && src.data.param_values && typeof src.data.param_values === "object"){
        Object.assign(params, src.data.param_values);
      }
      const k = src.data && src.data.param_key;
      const v = src.data && src.data.param_val;
      if(k) params[k] = v;
    }
  }
  return params;
}

function estimateNumber(value, fallback){
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundCredits(value){
  const num = Number(value) || 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

function formatCredits(value){
  const num = roundCredits(value);
  if(Math.abs(num) >= 100) return num.toFixed(0);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function resMultiplier(res){
  const key = String(res || "HD").toUpperCase();
  return RES_MULT[key] !== undefined ? RES_MULT[key] : 1.0;
}

function effectiveNodeValue(node, nodes, edges, key, fallback){
  const ov = incomingParams(node.id, nodes, edges);
  const own = node.data || {};
  return ov[key] !== undefined ? ov[key] : (own[key] !== undefined ? own[key] : fallback);
}

function effectiveNodeBatch(node, nodes, edges){
  return Math.max(1, Math.ceil(estimateNumber(effectiveNodeValue(node, nodes, edges, "batch", 1), 1)));
}

function effectiveNodeRes(node, nodes, edges){
  return String(effectiveNodeValue(node, nodes, edges, "res", "HD") || "HD").toUpperCase();
}

function firstDefinedParam(params, keys){
  for(const key of keys){
    if(params && params[key] !== undefined) return params[key];
  }
  return undefined;
}

function clampNumber(value, min, max, fallback){
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, safe));
}

function clampInt(value, min, max, fallback){
  return Math.round(clampNumber(value, min, max, fallback));
}

function normalizeVeoResolution(value){
  const raw = String(value || "1080p").trim().toUpperCase();
  if(["SD", "720", "720P"].includes(raw)) return "720p";
  if(["4K", "UHD"].includes(raw)) return "4K";
  if(["HD", "FHD", "FULLHD", "FULL HD", "1080", "1080P", "2K"].includes(raw)) return "1080p";
  return "1080p";
}

function normalizeOmniResolution(value){
  const raw = String(value || "4K").trim().toUpperCase();
  if(raw === "720" || raw === "720P" || raw === "1080" || raw === "1080P") return "HD";
  if(raw === "SD") return "HD";
  if(RES_PRESETS.includes(raw)) return raw;
  return "4K";
}

function normalizeVeoSeconds(value){
  const allowed = [4, 6, 8];
  const n = Number(value || 8);
  return allowed.reduce((best, curr) => {
    const bestDiff = Math.abs(best - n);
    const currDiff = Math.abs(curr - n);
    return currDiff < bestDiff || (currDiff === bestDiff && curr > best) ? curr : best;
  }, 8);
}

function normalizeModelAspect(value){
  return String(value || "16:9") === "9:16" ? "9:16" : "16:9";
}

function normalizeVeoFps(){
  return 24;
}

function normalizeVeoSampleCount(value){
  return clampInt(value, 1, 4, 1);
}

function normalizeOmniSeconds(value){
  return clampInt(value, 1, 10, 10);
}

function normalizeModelBatch(value, modelType){
  return modelType === "model" ? clampInt(value, 1, 4, 1) : clampInt(value, 1, 8, 1);
}

function modelParamDefaultPatch(node, nodes, edges){
  if(!node || (node.type !== "model" && node.type !== "omni_model")) return null;
  const params = incomingParams(node.id, nodes, edges);
  const manual = (node.data && node.data._manual_model_controls) || {};
  const patch = {};
  const setFromParam = (targetKey, aliases, normalizer) => {
    if(manual[targetKey]) return;
    const raw = firstDefinedParam(params, aliases);
    if(raw === undefined) return;
    const next = normalizer(raw);
    if(next !== undefined && (!node.data || node.data[targetKey] !== next)) patch[targetKey] = next;
  };
  if(node.type === "model"){
    setFromParam("seconds_per_clip", ["length", "length_seconds", "seconds", "seconds_per_clip", "duration", "duration_seconds"], normalizeVeoSeconds);
    setFromParam("resolution", ["resolution", "res", "image_size"], normalizeVeoResolution);
    setFromParam("fps", ["fps", "frame_rate", "frameRate"], (value) => clampInt(value, 1, 120, 24));
    setFromParam("batch", ["batch", "sample_count", "sampleCount"], (value) => normalizeModelBatch(value, "model"));
    setFromParam("aspect", ["aspect", "aspect_ratio", "aspectRatio"], normalizeModelAspect);
    setFromParam("focal_length", ["focal_length", "focalLength"], (value) => String(value || "As it comes"));
    setFromParam("aperture", ["aperture"], (value) => String(value || "As it comes"));
    setFromParam("lens_effect", ["lens_effect", "lensEffect"], (value) => String(value || "None"));
    setFromParam("shutter_effect", ["shutter_effect", "shutterEffect"], (value) => String(value || "Natural Motion Blur"));
  }
  if(node.type === "omni_model"){
    setFromParam("length_seconds", ["length", "length_seconds", "seconds", "seconds_per_clip", "duration", "duration_seconds"], normalizeOmniSeconds);
    setFromParam("resolution", ["resolution", "res", "image_size"], normalizeOmniResolution);
    setFromParam("fps", ["fps", "frame_rate", "frameRate"], (value) => clampInt(value, 12, 60, 24));
    setFromParam("batch", ["batch", "sample_count", "sampleCount"], (value) => normalizeModelBatch(value, "omni_model"));
    setFromParam("aspect", ["aspect", "aspect_ratio", "aspectRatio"], normalizeModelAspect);
    setFromParam("focal_length", ["focal_length", "focalLength"], (value) => String(value || "As it comes"));
    setFromParam("aperture", ["aperture"], (value) => String(value || "As it comes"));
    setFromParam("lens_effect", ["lens_effect", "lensEffect"], (value) => String(value || "None"));
    setFromParam("shutter_effect", ["shutter_effect", "shutterEffect"], (value) => String(value || "Natural Motion Blur"));
  }
  return Object.keys(patch).length ? patch : null;
}

function isGatewayDisabled(node){
  const data = (node && node.data) || {};
  const warningText = Array.isArray(data.cascade_warnings) ? data.cascade_warnings.join(" ") : "";
  return !!(data.disabled && (data.cascade_source_ref_id || /Asset Reference analysis/i.test(warningText)));
}

function isManuallyDisabled(node){
  return !!(node && node.data && node.data.disabled && !isGatewayDisabled(node));
}

function isEstimateEligible(node){
  return !!node && !isManuallyDisabled(node);
}

function sortedGenerators(gens){
  const order = ["face","body","clothing","pose"];
  return gens.slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

function nanoInputCount(node, edges){
  const slots = (node.data && node.data.slots) || [];
  const used = new Set();
  edges.forEach(edge => {
    if(edge.target === node.id && /^in_\d+$/.test(String(edge.targetHandle || ""))) used.add(edge.targetHandle);
  });
  slots.forEach((slot, index) => {
    if(slot) used.add(`manual_${index}`);
  });
  return used.size;
}

function hasReferenceImage(node){
  const data = (node && node.data) || {};
  return !!(data.image_store_key || data.image_preview_url || data.image_data_url);
}

function estimateGraphCredits(nodes, edges, modelProps, caps, referenceGateReady){
  const secondsDefault = Math.max(1, Math.min(caps.max_seconds || 30, estimateNumber(modelProps.length_seconds !== undefined ? modelProps.length_seconds : modelProps.seconds_per_clip, 8)));
  const audioEnabled = !!(modelProps.audio_enabled && caps.supports_audio);
  const audioMult = audioEnabled ? ESTIMATE_RATES.audio_multiplier : 1.0;
  const modelBatch = normalizeModelBatch(modelProps.batch, caps.is_omni ? "omni_model" : "model");
  const modelResolution = String(modelProps.resolution || "").toUpperCase();
  const usdPerCredit = Math.max(0, estimateNumber(modelProps.usd_per_credit, 0.01));
  const usdToLocal = Math.max(0, estimateNumber(modelProps.usd_to_local, 1.0));
  const currency = modelProps.currency || "USD";
  const sectionsRaw = { video: 0, image_prep: 0, nano_banana: 0, analysis: 0 };
  const breakdown = [];
  const warnings = [];
  const includedGeneratorIds = new Set();
  const clipNodes = nodes.filter(n => n.type === "clip").slice().sort((a, b) => Number((a.data && a.data.clip_index) || 0) - Number((b.data && b.data.clip_index) || 0));
  const hasExplicitClips = clipNodes.length > 0;
  const clipList = hasExplicitClips ? clipNodes : [{
    id: "VIRTUAL_CLIP_1",
    type: "clip",
    data: { clip_name: "CLIP_1", clip_index: 1, seconds: secondsDefault }
  }];

  function generatorsForClip(clipId){
    const pool = hasExplicitClips
      ? nodes.filter(n => n.parentNode === clipId)
      : nodes.filter(n => !n.parentNode);
    return sortedGenerators(pool.filter(n => isGeneratorType(n.type) && isEstimateEligible(n)));
  }

  if(hasExplicitClips){
    const ungrouped = nodes.filter(n => isGeneratorType(n.type) && !n.parentNode && isEstimateEligible(n));
    if(ungrouped.length){
      warnings.push(`${ungrouped.length} ungrouped generator node(s) are outside clip groups, so they are excluded from the Veo clip estimate.`);
    }
  }

  clipList.forEach((clip) => {
    const gens = generatorsForClip(clip.id);
    gens.forEach(g => includedGeneratorIds.add(g.id));
    const seconds = Math.max(1, estimateNumber(clip.data && clip.data.seconds, secondsDefault));
    let resolutionBasis = modelResolution || "HD";
    let highestResMult = modelResolution ? resMultiplier(modelResolution) : 1.0;
    gens.forEach(g => {
      const res = effectiveNodeRes(g, nodes, edges);
      const mult = resMultiplier(res);
      if(mult >= highestResMult){
        highestResMult = mult;
        resolutionBasis = res;
      }
    });
    const credits = seconds * caps.credits_per_sec_hd * highestResMult * audioMult * modelBatch;
    sectionsRaw.video += credits;
    breakdown.push({
      category: "video",
      name: (clip.data && clip.data.clip_name) || clip.id,
      node_id: clip.id,
      model: modelProps.model_ver,
      seconds,
      batch: modelBatch,
      resolution_basis: resolutionBasis,
      audio_enabled: audioEnabled,
      credits: roundCredits(credits),
      formula: `${seconds}s x ${modelBatch} sample(s) x ${caps.credits_per_sec_hd} credits/sec x ${highestResMult} res x ${audioMult} audio`
    });
  });

  includedGeneratorIds.forEach((id) => {
    const node = nodes.find(n => n.id === id);
    if(!node) return;
    const batch = effectiveNodeBatch(node, nodes, edges);
    const res = effectiveNodeRes(node, nodes, edges);
    const credits = batch * ESTIMATE_RATES.generator_image_hd * resMultiplier(res);
    sectionsRaw.image_prep += credits;
    breakdown.push({
      category: "image_prep",
      name: (node.data && node.data.title) || node.type,
      node_id: node.id,
      type: node.type,
      batch,
      resolution: res,
      status: referenceGateReady ? "ready" : "planned_gateway_locked",
      credits: roundCredits(credits),
      formula: `${batch} image(s) x ${ESTIMATE_RATES.generator_image_hd} HD credits x ${resMultiplier(res)} res`
    });
  });

  nodes.filter(n => n.type === "nano_banana" && isEstimateEligible(n)).forEach((node) => {
    const res = String((node.data && node.data.res) || "HD").toUpperCase();
    const inputs = nanoInputCount(node, edges);
    const inputComplexity = 1 + Math.min(0.35, inputs * 0.025);
    const credits = ESTIMATE_RATES.nano_banana_hd * resMultiplier(res) * inputComplexity;
    sectionsRaw.nano_banana += credits;
    breakdown.push({
      category: "nano_banana",
      name: (node.data && node.data.title) || "Nano Banana Pro",
      node_id: node.id,
      resolution: res,
      image_inputs: inputs,
      status: node.data && node.data.disabled ? "planned_gateway_locked" : "ready",
      credits: roundCredits(credits),
      formula: `${ESTIMATE_RATES.nano_banana_hd} HD credits x ${resMultiplier(res)} res x ${roundCredits(inputComplexity)} input complexity`
    });
  });

  nodes.filter(n => n.type === "ref" && isEstimateEligible(n)).forEach((node) => {
    if(!hasReferenceImage(node)) return;
    const analyzed = isAnalysisActivated(node.data && node.data.analysis);
    const credits = analyzed ? 0 : ESTIMATE_RATES.asset_analysis;
    sectionsRaw.analysis += credits;
    breakdown.push({
      category: "analysis",
      name: (node.data && node.data.title) || "Asset Reference",
      node_id: node.id,
      status: analyzed ? "already_analyzed" : "pending",
      credits: roundCredits(credits),
      formula: analyzed ? "already analyzed in this graph" : `${ESTIMATE_RATES.asset_analysis} analysis call`
    });
  });

  if(!referenceGateReady){
    warnings.push("Asset Reference gateway is locked; image-prep and downstream generation costs are planned estimates until analysis is run.");
  }

  const sections = Object.fromEntries(Object.entries(sectionsRaw).map(([key, value]) => [key, roundCredits(value)]));
  const totalRaw = Object.values(sectionsRaw).reduce((sum, value) => sum + value, 0);
  const totalUsd = totalRaw * usdPerCredit;
  const totalLocal = totalUsd * usdToLocal;
  return {
    model: modelProps.model_ver,
    basis: "planning_estimate",
    ready: referenceGateReady,
    seconds_default: secondsDefault,
    batch_default: modelBatch,
    resolution_default: modelProps.resolution || null,
    audio_enabled: audioEnabled,
    rates: {
      veo_credits_per_sec_hd: caps.credits_per_sec_hd,
      generator_image_hd: ESTIMATE_RATES.generator_image_hd,
      nano_banana_hd: ESTIMATE_RATES.nano_banana_hd,
      asset_analysis: ESTIMATE_RATES.asset_analysis,
      audio_multiplier: ESTIMATE_RATES.audio_multiplier
    },
    sections,
    total_credits: roundCredits(totalRaw),
    usd_per_credit: usdPerCredit,
    total_usd: totalUsd,
    currency,
    total_local: totalLocal,
    breakdown,
    warnings,
    assumptions: [
      "Veo video cost is estimated per compiled clip, using clip seconds, the selected model rate, the highest connected generator resolution in that clip, and the audio multiplier.",
      "Image-prep generator nodes are estimated as still-image batches, not as full video renders.",
      "Nano Banana Pro and Asset Reference analysis are separate API calls from the Veo Run button, but are included so the graph shows planned end-to-end cost.",
      "Provider billing can differ from this local planning credit model; adjust ESTIMATE_RATES and MODEL_CATALOG when real pricing is known."
    ]
  };
}

function arrayValue(value){
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isAnalysisActivated(analysis){
  return !!(analysis && (analysis.activated || analysis.status === "analyzed" || (analysis.gateway && analysis.gateway.activated)));
}

function uniqueTags(tags, extra){
  const out = [];
  for(const tag of (tags || []).concat(extra || [])){
    if(tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function loadImageInfo(dataUrl){
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = 24;
      sampleCanvas.height = 24;
      const ctx = sampleCanvas.getContext("2d");
      ctx.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const data = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
      let r = 0, g = 0, b = 0, count = 0;
      for(let i = 0; i < data.length; i += 4){
        const alpha = data[i + 3] / 255;
        r += data[i] * alpha;
        g += data[i + 1] * alpha;
        b += data[i + 2] * alpha;
        count += alpha;
      }
      count = count || 1;
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
      const luminance = Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b));
      const orientation = image.width === image.height ? "square" : (image.width > image.height ? "landscape" : "portrait");
      resolve({ width:image.width, height:image.height, orientation, average_color:hex, luminance });
    };
    image.onerror = () => reject(new Error("Image analysis decode failed."));
    image.src = dataUrl;
  });
}

function nodeCascadePrompt(analysis, type){
  const prompts = (analysis && analysis.cascade && analysis.cascade.node_prompts) || {};
  return prompts[type] || ((analysis && analysis.cascade && analysis.cascade.prompt_prefix) || "");
}

function referenceDescriptionFor(analysis, kind){
  const descriptions = (analysis && analysis.cascade && analysis.cascade.reference_descriptions) || {};
  if(descriptions[kind]) return descriptions[kind];
  const profile = (analysis && analysis.identity_profile) || {};
  return profile.summary || (kind === "style" ? "Style and lighting anchor from analyzed reference." : "Primary identity anchor from analyzed reference.");
}

function validationWarningsForPrompt(analysis, prompt){
  if(!analysis || !prompt) return [];
  const rules = analysis.validation_rules || {};
  const terms = arrayValue(rules.forbidden_prompt_terms);
  const lower = String(prompt).toLowerCase();
  return terms
    .filter(term => lower.includes(String(term).toLowerCase()))
    .map(term => `Prompt contains identity-conflicting term: "${term}".`);
}

function requestReferenceAnalysis(nodeId){
  window.dispatchEvent(new CustomEvent("stage:analyze-reference", { detail: { nodeId } }));
}

function requestReferenceUpload(nodeId, file){
  window.dispatchEvent(new CustomEvent("stage:upload-reference", { detail: { nodeId, file } }));
}

function requestNanoBananaGeneration(nodeId){
  window.dispatchEvent(new CustomEvent("stage:nano-generate", { detail: { nodeId } }));
}

async function nanoBananaAnalyze(imageDataUrl, meta){
  const imageInfo = await loadImageInfo(imageDataUrl).catch(() => null);
  const imageName = (meta && meta.imageName) || "uploaded reference";
  const source = {
    image_name: imageName,
    width: imageInfo ? imageInfo.width : null,
    height: imageInfo ? imageInfo.height : null,
    orientation: imageInfo ? imageInfo.orientation : "unknown",
    average_color: imageInfo ? imageInfo.average_color : null,
    luminance: imageInfo ? imageInfo.luminance : null,
  };
  const palette = [source.average_color, source.orientation, source.luminance !== null ? (source.luminance > 150 ? "bright key" : "low key") : null].filter(Boolean);
  const summary = `Use ${imageName} as the primary identity and style anchor. Preserve the uploaded subject, proportions, silhouette, palette, material cues, and lighting continuity unless a downstream node explicitly overrides a local detail.`;
  const promptPrefix = `[ANALYZED ASSET REFERENCE] ${summary}`;
  return {
    schema: ANALYSIS_SCHEMA_VERSION,
    status: "analyzed",
    activated: true,
    analyzed_at: new Date().toISOString(),
    source,
    gateway: {
      activated: true,
      activates_node_types: ["face", "body", "clothing", "pose"],
      cascade_scope: "all downstream generator nodes"
    },
    identity_profile: {
      summary,
      subject: "Primary subject or asset in the uploaded reference image.",
      identity_markers: [
        "preserve the same face or object identity",
        "preserve silhouette, proportions, and scale relationships",
        "preserve distinctive visible marks, accessories, and material cues"
      ],
      wardrobe: ["derive wardrobe and accessory continuity from the reference unless a clothing node overrides it"],
      palette,
      lighting: "match the apparent lighting direction, contrast, and color temperature from the reference",
      camera: source.orientation === "portrait" ? "portrait-oriented identity reference" : "wide or neutral identity reference",
      background: "treat background as secondary unless a clip/background node overrides it",
      negative: ["different person", "new identity", "changed face shape", "unrelated character"]
    },
    cascade: {
      prompt_prefix: promptPrefix,
      node_prompts: {
        face: `${promptPrefix} Face pass: lock facial structure, eye spacing, profile, skin detail, and expression range to the reference.`,
        body: `${promptPrefix} Body pass: lock body proportions, silhouette, posture language, and scale to the reference.`,
        clothing: `${promptPrefix} Clothing pass: retain detected wardrobe/material logic while allowing controlled wardrobe exploration.`,
        pose: `${promptPrefix} Pose pass: keep identity and body mechanics consistent while changing only the action or stance.`
      },
      reference_descriptions: {
        asset: `Primary identity anchor from ${imageName}: preserve subject, proportions, silhouette, and visible details.`,
        style: `Style anchor from ${imageName}: preserve palette ${palette.join(", ") || "from reference"}, lighting, and material tone.`
      }
    },
    validation_rules: {
      forbidden_prompt_terms: ["different person", "new identity", "changed face", "change face", "unrelated character"],
      warnings: []
    },
    model_json_effects: [
      "Adds identity_profile to the compiled model JSON.",
      "Prefixes downstream generator prompts with cascade.node_prompts[type].",
      "Improves reference image descriptions in ingredients.reference_images.",
      "Blocks generation until this gateway is activated."
    ]
  };
}

function TagRow({ data }){
  return html`
    <div className="nodeTagRow">
      ${((data && data.tags) || []).map((t, i) => html`<span key=${t + "-" + i} className="nodeTag">${t}</span>`)}
    </div>
  `;
}

function ModelNode({ data, id }){
  const { setNodes } = useReactFlow();
  const color = NODE_COLORS["model"] || "#888";
  const selectedModel = (data && data.model_ver) || "Veo 3.1 Quality";
  const selectedCaps = MODEL_CATALOG[selectedModel] || MODEL_CATALOG["Veo 3.1 Quality"];
  const seconds = [4, 6, 8].includes(Number(data && data.seconds_per_clip)) ? Number(data.seconds_per_clip) : 8;
  const resolution = normalizeVeoResolution(data && data.resolution);
  const fps = clampInt(data && data.fps, 1, 120, 24);
  const batch = normalizeModelBatch(data && data.batch, "model");
  const audioEnabled = !!(data && data.audio_enabled && selectedCaps.supports_audio);
  const updateData = (patch, manualKeys) => {
    const keys = manualKeys || Object.keys(patch || {});
    setNodes(nds => nds.map(n => {
      if(n.id !== id) return n;
      const manual = Object.assign({}, (n.data && n.data._manual_model_controls) || {});
      keys.forEach(key => { manual[key] = true; });
      return Object.assign({}, n, { data: Object.assign({}, n.data, patch, { _manual_model_controls: manual }) });
    }));
  };
  const onModelChange = (modelVer) => {
    const nextCaps = MODEL_CATALOG[modelVer] || MODEL_CATALOG["Veo 3.1 Quality"];
    updateData({ model_ver:modelVer, audio_enabled: nextCaps.supports_audio ? audioEnabled : false });
  };
  return html`
    <div className="nodeBox nodeModelGrid" style=${{borderColor: color}}>
      <div className="modelInputsRowTop">
        <span key="start" className="nodeMuted">Start Frame</span>
        <span key="end" className="nodeMuted">End Frame</span>
        <span key="asset1" className="nodeMuted">Asset 1</span>
        <span key="asset2" className="nodeMuted">Asset 2</span>
        <span key="style" className="nodeMuted">Style</span>
      </div>
      <${Handle} key="start-handle" type="target" position=${Position.Top} id="start" style=${{left:"36px"}} />
      <${Handle} key="end-handle" type="target" position=${Position.Top} id="end" style=${{left:"108px"}} />
      <${Handle} key="asset1-handle" type="target" position=${Position.Top} id="asset1" style=${{left:"180px"}} />
      <${Handle} key="asset2-handle" type="target" position=${Position.Top} id="asset2" style=${{left:"252px"}} />
      <${Handle} key="style-handle" type="target" position=${Position.Top} id="style" style=${{left:"324px"}} />
      <${Handle} key="params-handle" type="target" position=${Position.Left} id="params" style=${{top:"108px", background:NODE_COLORS.param}} />
      <div className="modelParamPortLabel">Params</div>
      <div className="nodeHeaderRow modelNodeHeaderRow">
        <div className="nodeHeaderText">
          <div className="nodeTitle nodeTitleBubble" style=${{borderColor: color, color}}>VEO</div>
          <div className="nodeSub">${(data && data.subtitle) || "Vertex video model"}</div>
        </div>
      </div>
      <div className="modelControls nodrag">
        <select value=${selectedModel} onChange=${(e)=>onModelChange(e.target.value)}>
          <option value="Veo 3.1 Quality">Veo 3.1 Quality</option>
          <option value="Veo 3.1 Fast">Veo 3.1 Fast</option>
        </select>
        <div className="modelControlGrid">
          <label>
            <span>Sec</span>
            <select value=${seconds} onChange=${(e)=>updateData({ seconds_per_clip:Number(e.target.value) })}>
              <option value=${4}>4</option>
              <option value=${6}>6</option>
              <option value=${8}>8</option>
            </select>
          </label>
          <label>
            <span>Res</span>
            <select value=${resolution} onChange=${(e)=>updateData({ resolution:e.target.value })}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4K">4K</option>
            </select>
          </label>
          <label>
            <span>FPS</span>
            <input type="number" min="1" max="120" step="1" value=${fps} onInput=${(e)=>updateData({ fps: clampInt(e.target.value, 1, 120, 24) })} />
          </label>
          <label>
            <span>Batch</span>
            <input type="number" min="1" max="4" step="1" value=${batch} onInput=${(e)=>updateData({ batch: normalizeModelBatch(e.target.value, "model") })} />
          </label>
          <label className="modelAudioToggle">
            <span>Audio</span>
            <input type="checkbox" checked=${audioEnabled} disabled=${!selectedCaps.supports_audio} onChange=${(e)=>updateData({ audio_enabled:e.target.checked })} />
          </label>
        </div>
      </div>
      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" style=${{left:"180px"}} />
    </div>
  `;
}

function OmniModelNode({ data, id }){
  const { setNodes } = useReactFlow();
  const color = NODE_COLORS["omni_model"] || "#7DD3FC";
  const updateData = (patch, manualKeys) => {
    const keys = manualKeys || Object.keys(patch || {});
    setNodes(nds => nds.map(n => {
      if(n.id !== id) return n;
      const manual = Object.assign({}, (n.data && n.data._manual_model_controls) || {});
      keys.forEach(key => { manual[key] = true; });
      return Object.assign({}, n, { data: Object.assign({}, n.data, patch, { _manual_model_controls: manual }) });
    }));
  };
  const selectedModel = (data && data.model_ver) || "Gemini Omni Flash";
  const seconds = Number((data && data.length_seconds) || 10);
  const resolution = String((data && data.resolution) || "4K");
  const fps = Number((data && data.fps) || 24);
  const batch = normalizeModelBatch(data && data.batch, "omni_model");
  const audioEnabled = !!(data && data.audio_enabled);
  return html`
    <div className="nodeBox nodeOmniGrid" style=${{borderColor: color}}>
      <div className="omniInputsRowTop">
        <span className="nodeMuted">Photo 1</span>
        <span className="nodeMuted">Photo 2</span>
        <span className="nodeMuted">Photo 3</span>
        <span className="nodeMuted">Photo 4</span>
        <span className="nodeMuted">Photo 5</span>
        <span className="nodeMuted">Video</span>
        <span className="nodeMuted">Audio</span>
      </div>
      ${["photo1","photo2","photo3","photo4","photo5","video","audio"].map((handle, index) => html`
        <${Handle} key=${handle + "-handle"} type="target" position=${Position.Top} id=${handle} style=${{left:(36 + index * 72) + "px"}} />
      `)}
      <${Handle} key="params-handle" type="target" position=${Position.Left} id="params" style=${{top:"108px", background:NODE_COLORS.param}} />
      <div className="modelParamPortLabel">Params</div>
      <div className="nodeHeaderRow modelNodeHeaderRow">
        <div className="nodeHeaderText">
          <div className="nodeTitle nodeTitleBubble" style=${{borderColor: color, color}}>GOOGLE OMNI</div>
          <div className="nodeSub">Text, photos, video, audio → video</div>
        </div>
      </div>
      <div className="omniControls nodrag">
        <select value=${selectedModel} onChange=${(e)=>updateData({ model_ver:e.target.value })}>
          <option value="Gemini Omni Flash">Gemini Omni Flash</option>
        </select>
        <div className="omniControlGrid">
          <label>
            <span>Sec</span>
            <input type="number" min="1" max="10" value=${seconds} onInput=${(e)=>updateData({ length_seconds: Math.max(1, Math.min(10, Number(e.target.value || 10))) })} />
          </label>
          <label>
            <span>Res</span>
            <select value=${resolution} onChange=${(e)=>updateData({ resolution:e.target.value })}>
              <option value="HD">HD</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
          <label>
            <span>FPS</span>
            <input type="number" min="12" max="60" step="1" value=${fps} onInput=${(e)=>updateData({ fps: Math.max(12, Math.min(60, Number(e.target.value || 24))) })} />
          </label>
          <label>
            <span>Batch</span>
            <input type="number" min="1" max="8" step="1" value=${batch} onInput=${(e)=>updateData({ batch: normalizeModelBatch(e.target.value, "omni_model") })} />
          </label>
          <label className="omniAudioToggle">
            <span>Audio</span>
            <input type="checkbox" checked=${audioEnabled} onChange=${(e)=>updateData({ audio_enabled:e.target.checked })} />
          </label>
        </div>
      </div>
      <div className="nodeMuted omniNote">No official hard start/end-frame contract found; use Photo/Video refs for frame guidance.</div>
      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" style=${{background:color, left:"252px"}} />
    </div>
  `;
}

function BaseNode({ data, type, id }){
  const { setNodes } = useReactFlow();
  const disabled = !!(data && data.disabled);
  const refAnalyzed = type === "ref" && isAnalysisActivated(data && data.analysis);
  const isRef = (type === "ref" || type === "style_ref");
  const hasMultiInputs = ["face","body","clothing","pose"].includes(type);
  const refUploadInputId = `ref-upload-${id}`;
  const isParam = type === "param";
  const paramDef = isParam ? parameterDefForData(data) : null;
  const isLensParam = isParam && paramDef && paramDef.key === "lens";
  const lensValues = isLensParam ? lensParamValues(data) : null;
  const color = type === "ref" ? (refAnalyzed ? REF_GATE_COLORS.active : REF_GATE_COLORS.pending) : (isLensParam ? NODE_COLORS.lens : (NODE_COLORS[type] || "#888"));
  
  // Allow prompt editing directly on the node if it's a generator type
  const showPromptBox = ["face","body","clothing","pose"].includes(type);
  const onPromptChange = (e) => {
     setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, prompt: e.target.value } } : n));
  };
  const onParamKindChange = (e) => {
    const nextDef = PARAMETER_DEFS.find(def => def.param_key === e.target.value) || PARAMETER_DEFS[0];
    setNodes(nds => nds.map(n => n.id === id ? {
      ...n,
      data: {
        ...n.data,
        title: nextDef.title,
        subtitle: nextDef.note,
        param_key: nextDef.param_key,
        param_val: nextDef.default_val
      }
    } : n));
  };
  const onParamValueChange = (e) => {
    const raw = e.target.value;
    const nextValue = typeof paramDef.default_val === "number" ? Number(raw) : raw;
    setNodes(nds => nds.map(n => n.id === id ? {
      ...n,
      data: {
        ...n.data,
        title: paramDef.title,
        subtitle: paramDef.note,
        param_val: nextValue
      }
    } : n));
  };
  const onLensParamChange = (key, value) => {
    const current = lensParamValues(data);
    const nextValues = Object.assign({}, current, { [key]: value });
    setNodes(nds => nds.map(n => n.id === id ? {
      ...n,
      data: {
        ...n.data,
        title: "Lens",
        subtitle: "Optics, depth of field, and shutter intent.",
        param_key: "lens",
        param_values: nextValues,
        focal_length: nextValues.focal_length,
        aperture: nextValues.aperture,
        lens_effect: nextValues.lens_effect,
        shutter_effect: nextValues.shutter_effect
      }
    } : n));
  };

  return html`
    <div className=${"nodeBox nodeGridBase nodeType-" + String(type || "node") + " " + (isLensParam ? "nodeParamLens " : "") + (disabled ? "nodeDisabled " : "") + (type === "ref" ? (refAnalyzed ? "referenceGateOn" : "referenceGateOff") : "")} style=${{borderColor: color}}>
      ${isParam ? null : html`<div className="topInputsRow">${hasMultiInputs ? html`<span key="asset" className="nodeMuted">Asset</span><span key="style" className="nodeMuted">Style</span>` : html`<span key="input" className="nodeMuted">Input</span>`}</div>`}
      <div className="nodeHeaderRow">
        <div className="nodeHeaderText">
          <div className="nodeTitle nodeTitleBubble" style=${{borderColor: color, color}}>${isParam ? paramDef.title : ((data && data.title) || "Node")}</div>
          ${type === "ref" || isLensParam ? null : html`<div className="nodeSub">${isParam ? "Cinematography parameter" : ((data && data.subtitle) || "")}</div>`}
          ${(data && data.badge) ? html`<div className="nodeMuted" style=${{marginTop:"4px"}}>${data.badge}</div>` : null}
        </div>
      </div>
      ${type === "ref" ? html`
        <div className="referenceUploadNodeWrap nodrag">
          <label className="referenceUploadTile" htmlFor=${refUploadInputId} title="Upload image">
            ${data && (data.image_preview_url || data.image_data_url)
              ? html`<img src=${data.image_preview_url || data.image_data_url} alt="" />`
              : html`<span>+</span>`
            }
          </label>
          <div className="referenceUploadMeta">
            <div className="referenceUploadNodeLabel">Upload Image</div>
            <div className="referenceUploadFileName">${(data && data.image_name) || "No File Chosen"}</div>
          </div>
          <input
            className="referenceUploadNodeInput"
            id=${refUploadInputId}
            type="file"
            accept="image/*"
            onClick=${(e)=>e.stopPropagation()}
            onChange=${(e)=>{ const file = e.target.files && e.target.files[0]; if(file) requestReferenceUpload(id, file); e.target.value = ""; }}
          />
        </div>
      ` : null}
      ${isRef && type !== "ref" && data && (data.image_preview_url || data.image_data_url) ? html`<div style=${{marginTop:"8px", display:"flex", gap:"8px", alignItems:"center"}}><img src=${data.image_preview_url || data.image_data_url} style=${{width:"42px", height:"42px", objectFit:"cover", borderRadius:"10px", border:"1px solid rgba(255,255,255,.12)"}} /><div className="nodeMuted" style=${{lineHeight:"1.2"}}>${(data.image_name || "reference.png")}<br/><span style=${{opacity:.9}}>preview</span></div></div>` : null}
      ${isLensParam ? html`
        <div className="paramControlPanel lensControlPanel nodrag">
          <label>
            <span>Focal Length</span>
            <select value=${lensValues.focal_length} onChange=${(e)=>onLensParamChange("focal_length", e.target.value)}>
              ${FOCAL_LENGTH_OPTIONS.map(option => html`<option key=${option} value=${option}>${option}</option>`)}
            </select>
          </label>
          <label>
            <span>Aperture</span>
            <select value=${lensValues.aperture} onChange=${(e)=>onLensParamChange("aperture", e.target.value)}>
              ${APERTURE_OPTIONS.map(option => html`<option key=${option} value=${option}>${option}</option>`)}
            </select>
          </label>
          <label>
            <span>Lens Effects</span>
            <select value=${lensValues.lens_effect} onChange=${(e)=>onLensParamChange("lens_effect", e.target.value)}>
              ${LENS_EFFECT_OPTIONS.map(option => html`<option key=${option} value=${option}>${option}</option>`)}
            </select>
          </label>
          <label>
            <span>Shutter Effects</span>
            <select value=${lensValues.shutter_effect} onChange=${(e)=>onLensParamChange("shutter_effect", e.target.value)}>
              ${SHUTTER_EFFECT_OPTIONS.map(option => html`<option key=${option} value=${option}>${option}</option>`)}
            </select>
          </label>
        </div>
      ` : isParam ? html`
        <div className="paramControlPanel nodrag">
          <label>
            <span>Parameter</span>
            <select value=${paramDef.param_key} onChange=${onParamKindChange}>
              ${PARAMETER_DEFS.map(def => html`<option key=${def.param_key} value=${def.param_key}>${def.title}</option>`)}
            </select>
          </label>
          <label>
            <span>Value</span>
            <select value=${data && data.param_val !== undefined ? data.param_val : paramDef.default_val} onChange=${onParamValueChange}>
              ${paramDef.options.map(option => html`<option key=${String(option)} value=${option}>${parameterValueLabel(paramDef, option)}</option>`)}
            </select>
          </label>
          <div className="paramControlNote">${paramDef.note}</div>
        </div>
      ` : html`<${TagRow} data=${data} />`}

      ${showPromptBox ? html`
         <div style=${{marginTop:"8px"}}>
           <textarea className="nodrag" placeholder="Enter prompt..." value=${data.prompt || ""} onInput=${onPromptChange} style=${{width:"100%", height:"50px", fontSize:"10px", background:"#111", border:"1px solid #333", color:"#ccc", padding:"4px"}}></textarea>
         </div>
      ` : null}

      ${isLensParam ? html`<${Handle} key="lens-in-handle" type="target" position=${Position.Top} id="in" style=${{left:"144px", top:"3px"}} />` : isParam ? null : hasMultiInputs ? html`<${Handle} key="asset-handle" type="target" position=${Position.Top} id="asset" style=${{left:"72px"}} /><${Handle} key="style-handle" type="target" position=${Position.Top} id="style" style=${{left:"144px"}} />` : html`<${Handle} key="in-handle" type="target" position=${Position.Top} id="in" style=${{left:"108px"}} />`}
      ${type === "ref" ? html`
        <div className="referenceAnalyzeNodeWrap nodrag">
          <button
            className=${"referenceAnalyzeNodeBtn " + (refAnalyzed ? "active" : "")}
            onClick=${(e)=>{ e.preventDefault(); e.stopPropagation(); requestReferenceAnalysis(id); }}
            title=${refAnalyzed ? "Re-analyze and recascade" : "Analyze and activate downstream nodes"}
          >${refAnalyzed ? "RE-ANALYZE" : "ANALYZE"}</button>
        </div>
      ` : null}
      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" style=${isLensParam ? {left:"144px", bottom:"3px"} : {left:"108px"}} />
    </div>
  `;
}

function NanoBananaNode({ data, id }){
  const { setNodes } = useReactFlow();
  
  // Helper to update node data specific to this node
  const updateData = (patch) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id === id) {
        const newData = { ...n.data, ...patch };
        // If we are updating a specific slot index
        if(patch.slotUpdate){ 
          const newSlots = [...(n.data.slots || Array(14).fill(null))];
          newSlots[patch.slotUpdate.index] = patch.slotUpdate.data;
          newData.slots = newSlots;
          delete newData.slotUpdate;
        }
        return { ...n, data: newData };
      }
      return n;
    }));
  };

  const slots = data.slots || Array(14).fill(null);
  const res = data.res || "HD";
  const resultUri = data.result_data_url || data.result_uri;
  const generating = data.generation_status === "running";
  const locked = !!data.disabled;

  // Handler for file input clicking
  const onSlotClick = (index) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = () => updateData({ slotUpdate: { index, data: reader.result } });
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return html`
    <div className=${"nodeBox nodeNanoGrid " + (locked ? "nodeDisabled " : "")} style=${{borderColor: "#FFD700"}}>
      ${slots.map((_slotImg, i) => {
        const isHiFi = i < 6;
        const color = isHiFi ? "#4ec9b0" : "#f4a261";
        return html`
          <${Handle}
            key=${"slot-handle-" + i}
            type="target"
            position=${Position.Top}
            id=${"in_" + i}
            isConnectableStart=${true}
            style=${{background:color, left:(36 + (i % 7) * 54) + "px", top:(144 + Math.floor(i / 7) * 54) + "px", width:"8px", height:"8px", transform:"translate(-50%, -50%)"}}
          />
        `;
      })}
      
      <div className="nanoHeader" style=${{background:"rgba(255, 215, 0, 0.1)", borderBottom:"1px solid #444"}}>
        <div style=${{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div className="nodeTitle nodeTitleBubble" style=${{borderColor:"#FFD700", color:"#FFD700", margin:"0"}}>NANO BANANA PRO</div>
        </div>
        <div className="nodeSub" style=${{marginTop:"4px"}}>14-Image Context Window</div>
      </div>

      <div className="nanoSlotsPanel">
        <div style=${{display:"flex", justifyContent:"space-between", marginBottom:"18px", fontSize:"10px", fontWeight:"700", height:"18px", alignItems:"center"}}>
          <span style=${{color:"#4ec9b0"}}>HIGH FIDELITY (1-6)</span>
          <span style=${{color:"#f4a261"}}>SUPPLEMENTARY (7-14)</span>
        </div>
        
        <div style=${{display:"grid", gridTemplateColumns:"repeat(7, 36px)", gap:"18px"}}>
          ${slots.map((slotImg, i) => {
            const isHiFi = i < 6;
            const color = isHiFi ? "#4ec9b0" : "#f4a261";
            return html`
              <div key=${i} style=${{position:"relative", width:"100%", aspectRatio:"1/1"}}>
                <div 
                  onClick=${() => onSlotClick(i)}
                  title=${isHiFi ? `Slot ${i+1}: High Fidelity` : `Slot ${i+1}: Supplementary`}
                  style=${{
                    width:"100%", height:"100%", 
                    border:`1px solid ${color}`, borderRadius:"4px", 
                    background:"#111", cursor:"pointer", overflow:"hidden",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    opacity: slotImg ? 1 : 0.5
                  }}
                >
                  ${slotImg 
                    ? html`<img src=${slotImg} style=${{width:"100%", height:"100%", objectFit:"cover"}} />`
                    : html`<span style=${{fontSize:"9px", color:color}}>${i+1}</span>`
                  }
                </div>
              </div>
            `;
          })}
        </div>
      </div>

      <div style=${{padding:"0 18px"}}>
         <div style=${{fontSize:"10px", color:"#888", fontStyle:"italic", lineHeight:"1.4", marginBottom:"8px"}}>
          "Generate a cinematic wide shot. Use the character face from <span style=${{color:"#4ec9b0"}}>[img1]</span> and <span style=${{color:"#4ec9b0"}}>[img2]</span>. Apply lighting from <span style=${{color:"#4ec9b0"}}>[img3]</span>. Use composition of <span style=${{color:"#4ec9b0"}}>[img4]</span>. Loosely reference texture from <span style=${{color:"#f4a261"}}>[img5-14]</span>."
         </div>
         
         <textarea 
          placeholder="Enter prompt here..." 
          value=${data.prompt} 
          onInput=${(e) => updateData({ prompt: e.target.value })}
          style=${{
            width:"100%", height:"60px", background:"#000", border:"1px solid #333", 
            color:"#ddd", fontSize:"11px", borderRadius:"6px", padding:"6px"
          }}
         ></textarea>
      </div>

      <div style=${{padding:"18px", display:"flex", alignItems:"center", gap:"18px"}}>
        <div style=${{display:"flex", background:"#222", borderRadius:"6px", border:"1px solid #333", overflow:"hidden"}}>
          ${["HD","2K","4K"].map(r => html`
            <div
              key=${r}
              onClick=${() => updateData({ res: r })}
              style=${{
                padding:"4px 8px", fontSize:"10px", cursor:"pointer", fontWeight:"700",
                background: res === r ? "#FFD700" : "transparent",
                color: res === r ? "#000" : "#888"
              }}
            >${r}</div>
          `)}
        </div>
        <button 
          className="btnSmall" 
          style=${{marginBottom:"0", textAlign:"center", background:"#FFD700", color:"#000", borderColor:"#bfa100", fontWeight:"800"}}
          disabled=${generating || locked}
          onClick=${(e) => { e.preventDefault(); e.stopPropagation(); requestNanoBananaGeneration(id); }}
          title=${locked ? "Run Asset Reference analysis to activate this node" : "Generate with connected inputs"}
        >
          ${locked ? "LOCKED" : (generating ? "GENERATING" : "GENERATE")}
        </button>
      </div>

      ${resultUri ? html`
        <div style=${{width:"100%", aspectRatio:"16/9", borderTop:"1px solid #333", position:"relative"}}>
          <img src=${resultUri} style=${{width:"100%", height:"100%", objectFit:"contain", background:"#000"}} />
          <div style=${{position:"absolute", bottom:"6px", right:"6px", background:"rgba(0,0,0,0.6)", padding:"2px 6px", borderRadius:"4px", fontSize:"10px", color:"#fff"}}>
            ${data.result_model || "Generated Result"}
          </div>
        </div>
      ` : null}

      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" style=${{background:"#FFD700", left:"198px"}} />
    </div>
  `;
}



function ClipNode({ id, data }){
  const { setNodes } = useReactFlow();

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const nodeEl = document.querySelector(`[data-id="${id}"]`);
    const rect = nodeEl ? nodeEl.getBoundingClientRect() : { width: 560, height: 430 };
    const startW = rect.width;
    const startH = rect.height;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nextW = Math.max(260, Math.round(startW + dx));
      const nextH = Math.max(180, Math.round(startH + dy));

      setNodes((nds) => nds.map((n) => {
        if(n.id !== id) return n;
        const style = { ...(n.style || {}) };
        style.width = nextW;
        style.height = nextH;
        return { ...n, style };
      }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return html`
    <div className="groupNode" style=${{position:"relative", width:"100%", height:"100%"}}>
      <div className="groupHeader drag-handle">
        <div className="groupLabel">${(data && data.clip_name) || "BACKGROUND"}</div>
        <div className="groupMeta">idx ${(data && data.clip_index) || "?"}</div>
      </div>
      <div style=${{flex:1}}></div>
      <div className="groupResizer" onMouseDown=${onResizeMouseDown} title="Resize"></div>
    </div>
  `;
}
const nodeTypes = {
  model: ModelNode,
  omni_model: OmniModelNode,
  nano_banana: NanoBananaNode,
  ref: (p)=>BaseNode({ ...p, type:"ref" }),
  style_ref: (p)=>BaseNode({ ...p, type:"style_ref" }),
  face: (p)=>BaseNode({ ...p, type:"face" }),
  body: (p)=>BaseNode({ ...p, type:"body" }),
  clothing: (p)=>BaseNode({ ...p, type:"clothing" }),
  pose: (p)=>BaseNode({ ...p, type:"pose" }),
  param: (p)=>BaseNode({ ...p, type:"param" }),
  clip: ClipNode
};

// Edge type that can show a label biased toward the TARGET node.
// Used for nodes with many in-node inputs (e.g. Nano Banana slots).
function LabeledEdge(props){
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, style } = props;
  const label = (data && data.label) ? String(data.label) : "";
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition
  });
  // Pull the label closer to the target (works well enough across edge types).
  const bx = labelX * 0.25 + targetX * 0.75;
  const by = labelY * 0.25 + targetY * 0.75;
  return html`
    <>
      <${BaseEdge} key="edge" id=${id} path=${edgePath} markerEnd=${markerEnd} style=${style} />
      ${label ? html`
        <${EdgeLabelRenderer} key="label">
          <div
            style=${{
              position:"absolute",
              transform:`translate(-50%, -50%) translate(${bx}px, ${by}px)`,
              pointerEvents:"none",
              fontSize:"10px",
              padding:"2px 6px",
              borderRadius:"999px",
              border:"1px solid rgba(255,255,255,.14)",
              background:"rgba(0,0,0,.55)",
              color:"#eee",
              lineHeight:1
            }}
          >${label}</div>
        </${EdgeLabelRenderer}>
      ` : null}
    </>
  `;
}

const edgeTypes = { labeled: LabeledEdge };
const panOnDrag = [0, 1, 2];
const defaultEdgeOptions = { type: "smoothstep" };
const proOptions = { hideAttribution: true };
const referenceNodeTypes = new Set(["ref", "face", "body", "clothing", "pose"]);
const modelReferenceHandles = new Set(["asset1", "asset2", "style"]);
const omniPhotoHandles = new Set(["photo1", "photo2", "photo3", "photo4", "photo5"]);
const omniInputHandles = ["photo1", "photo2", "photo3", "photo4", "photo5", "video", "audio"];

function inputCapacityForNode(node, caps){
  if(!node) return null;
  if(node.type === "model"){
    return {
      handles: {
        start: { max: 1 },
        end: { max: 1 },
        asset1: { max: 1, group: "references" },
        asset2: { max: 1, group: "references" },
        style: { max: 1, group: "references" }
      },
      groups: {
        references: {
          handles: modelReferenceHandles,
          max: caps.max_reference_images,
          message: "This will create too many inputs for the current model."
        }
      }
    };
  }
  if(node.type === "omni_model"){
    return {
      handles: {
        photo1: { max: 1, group: "photos" },
        photo2: { max: 1, group: "photos" },
        photo3: { max: 1, group: "photos" },
        photo4: { max: 1, group: "photos" },
        photo5: { max: 1, group: "photos" },
        video: { max: 1 },
        audio: { max: 1 }
      },
      groups: {
        photos: {
          handles: omniPhotoHandles,
          max: caps.max_reference_images || 5,
          message: "Gemini Omni Flash currently supports up to 5 photo reference input(s)."
        }
      }
    };
  }
  if(node.type === "nano_banana"){
    const handles = {};
    for(let i = 0; i < 14; i += 1) handles[`in_${i}`] = { max: 1 };
    return { handles, groups: {} };
  }
  return null;
}

function connectionCapacityIssue(conn, nodes, edges, caps){
  const target = nodes.find(n => n.id === conn.target);
  const targetHandle = String(conn.targetHandle || "");
  const capacity = inputCapacityForNode(target, caps);
  if(!capacity || !targetHandle) return null;

  const handleRule = capacity.handles[targetHandle];
  if(handleRule){
    const handleCount = edges.filter(e => e.target === conn.target && String(e.targetHandle || "") === targetHandle).length;
    if(handleCount >= handleRule.max){
      return { message: "That input is already connected." };
    }
  }

  if(handleRule && handleRule.group){
    const groupRule = capacity.groups[handleRule.group];
    const groupCount = edges.filter(e => (
      e.target === conn.target && groupRule.handles.has(String(e.targetHandle || ""))
    )).length;
    if(groupCount >= groupRule.max){
      return {
        message: groupRule.message,
        count: groupCount + 1,
        max: groupRule.max
      };
    }
  }

  return null;
}

function currentModelCapacityIssue(nodes, edges, caps){
  const model = nodes.find(n => n.type === "omni_model") || nodes.find(n => n.type === "model");
  if(!model) return null;
  const capacity = inputCapacityForNode(model, caps);
  if(!capacity) return null;

  const referenceRule = capacity.groups.references || capacity.groups.photos;
  if(!referenceRule) return null;
  const referenceCount = edges.filter(e => (
    e.target === model.id && referenceRule.handles.has(String(e.targetHandle || ""))
  )).length;
  if(referenceCount > referenceRule.max){
    return {
      message: `Current model supports ${referenceRule.max} reference input(s); ${referenceCount} are connected.`,
      count: referenceCount,
      max: referenceRule.max
    };
  }
  return null;
}

function labelForIndexedInput(handleId){
  const match = String(handleId || "").match(/^in_(\d+)$/);
  return match ? `Input ${Number(match[1]) + 1}` : null;
}

function smartConnectionOptionsForInput(target, targetHandle){
  if(!target || target.type !== "nano_banana" || !/^in_\d+$/.test(String(targetHandle || ""))) return [];
  return [
    {
      key: "asset_reference",
      type: "ref",
      title: "Asset Reference",
      subtitle: "Most common image source",
      color: NODE_COLORS.ref
    },
    {
      key: "nano_banana",
      type: "nano_banana",
      title: "Nano Banana Pro",
      subtitle: "Generated image output",
      color: NODE_COLORS.nano_banana
    }
  ];
}

function smartGhostPosition(start, current){
  const dx = Math.max(120, Math.abs(current.x - start.x));
  const xBias = current.x >= start.x ? 22 : -192;
  const yBias = current.y >= start.y ? 16 : -88;
  return {
    x: current.x + xBias + Math.min(30, dx * 0.04),
    y: current.y + yBias
  };
}

function clientPointFromEvent(event){
  const touch = event && ((event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0]));
  return {
    x: Number((event && event.clientX) || (touch && touch.clientX) || 0),
    y: Number((event && event.clientY) || (touch && touch.clientY) || 0)
  };
}

function clearReferenceAutoDisabledFlags(list){
  return list || [];
}

function App(){
  const historyRef = window.__veoHistoryRef || (window.__veoHistoryRef = {stack:[], index:-1});
  const pushHistory = (snapshot)=>{
    const h = historyRef; 
    h.stack = h.stack.slice(0, h.index+1);
    h.stack.push(JSON.stringify(snapshot));
    h.index = h.stack.length-1;
  };
  const canUndo = ()=> historyRef.index>0;
  const canRedo = ()=> historyRef.index < historyRef.stack.length-1;
  const undo = ()=>{ if(!canUndo()) return null; historyRef.index--; return JSON.parse(historyRef.stack[historyRef.index]); };
  const redo = ()=>{ if(!canRedo()) return null; historyRef.index++; return JSON.parse(historyRef.stack[historyRef.index]); };

  const rfApi = useReactFlow();

  const LS_KEY = "stage_umdv1";
  const IMAGE_DB_NAME = "stage_assets";
  const IMAGE_STORE_NAME = "images";

  function openImageDb(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IMAGE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IMAGE_STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed."));
    });
  }

  async function saveImageAsset(key, dataUrl){
    const db = await openImageDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE_NAME, "readwrite");
      tx.objectStore(IMAGE_STORE_NAME).put(dataUrl, key);
      tx.oncomplete = () => resolve(key);
      tx.onerror = () => reject(tx.error || new Error("Image save failed."));
    });
  }

  async function loadImageAsset(key){
    if(!key) return null;
    const db = await openImageDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE_NAME, "readonly");
      const req = tx.objectStore(IMAGE_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Image load failed."));
    });
  }

  async function makeImagePreview(dataUrl, maxSize){
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image preview decode failed."));
      image.src = dataUrl;
    });
    const scale = Math.min(1, Number(maxSize || 180) / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  function scrubNodeForStorage(node){
    if(!node || !node.data) return node;
    const data = Object.assign({}, node.data);
    delete data.image_data_url;
    return Object.assign({}, node, { data });
  }

  function scrubNodesForStorage(list){
    return (list || []).map(scrubNodeForStorage);
  }

  function scrubClipboardForStorage(value){
    if(!value) return null;
    return {
      nodes: scrubNodesForStorage(value.nodes || []),
      edges: value.edges || []
    };
  }

  async function imageDataForNode(node){
    const data = (node && node.data) || {};
    if(data.image_data_url) return data.image_data_url;
    if(data.result_data_url) return data.result_data_url;
    if(data.result_uri && String(data.result_uri).startsWith("data:")) return data.result_uri;
    return await loadImageAsset(data.image_store_key);
  }

  const [consoleLines, setConsoleLines] = React.useState([]);
  function logLine(level, msg){
    setConsoleLines(prev => {
      const next = prev.concat([{ level, msg: msg }]);
      return next.slice(-160);
    });
  }
  const [toast, setToast] = React.useState(null);
  const toastTimerRef = React.useRef(null);
  const showToast = React.useCallback((message) => {
    if(toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1200);
  }, []);
  React.useEffect(() => {
    return () => {
      if(toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const initial = React.useMemo(() => {
    const saved = localStorage.getItem(LS_KEY);
    if(saved){
      try {
        const parsed = JSON.parse(saved);
        return Object.assign({}, parsed, { nodes: clearReferenceAutoDisabledFlags(parsed.nodes || []) });
      } catch(e){}
    }
    return {
      nodes: [
        { id:"gen_face_1", type:"face", position:{x:220,y:120}, data: Object.assign({}, defaultPropsFor("face"), { title:"Face Variations" }) },
        { id:"model_final", type:"model", position:{x:720,y:320}, data: defaultPropsFor("model") }
      ],
      edges: [],
      selectedIds: [],
      clipboard: null
    };
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const clearedAutoDisabledRef = React.useRef(false);

  React.useEffect(() => {
    if(clearedAutoDisabledRef.current) return;
    clearedAutoDisabledRef.current = true;
    setNodes(nds => {
      const cleaned = clearReferenceAutoDisabledFlags(nds);
      return cleaned.some((node, index) => node !== nds[index]) ? cleaned : nds;
    });
  }, [setNodes]);

  React.useEffect(() => {
    setNodes(nds => {
      let changed = false;
      const next = nds.map(node => {
        const patch = modelParamDefaultPatch(node, nds, edges);
        if(!patch) return node;
        changed = true;
        return Object.assign({}, node, { data: Object.assign({}, node.data, patch) });
      });
      return changed ? next : nds;
    });
  }, [nodes, edges, setNodes]);

  const historyLockRef = React.useRef(false);
  const lastSnapStrRef = React.useRef("");

  const applySnapshot = React.useCallback((snap) => {
    if(!snap) return;
    historyLockRef.current = true;
    try{
      if(Array.isArray(snap.nodes)) setNodes(snap.nodes);
      if(Array.isArray(snap.edges)) setEdges(snap.edges);
      if(snap.viewport && rfApi.setViewport){
        rfApi.setViewport(snap.viewport, { duration: 0 });
      }
    } finally {
      setTimeout(()=>{ historyLockRef.current = false; }, 0);
    }
  }, [setNodes, setEdges, rfApi]);

  const pushSnapshot = React.useCallback((snap) => {
    if(!snap) return;
    const s = JSON.stringify(snap);
    if(s === lastSnapStrRef.current) return;
    lastSnapStrRef.current = s;
    pushHistory(snap);
  }, []);

  React.useEffect(() => {
    try{
      const initVp = rfApi.getViewport ? rfApi.getViewport() : null;
      pushSnapshot({ nodes: initial.nodes, edges: initial.edges, viewport: initVp });
    }catch(e){}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if(historyLockRef.current) return;
    const t = setTimeout(() => {
      try{
        const vp = rfApi.getViewport ? rfApi.getViewport() : null;
        pushSnapshot({ nodes, edges, viewport: vp });
      }catch(e){}
    }, 80);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const [selectedIds, setSelectedIds] = React.useState(initial.selectedIds || []);
  const [clipboard, setClipboard] = React.useState(initial.clipboard);
  const [compiledJson, setCompiledJson] = React.useState(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = React.useState([]);
  const [jsonOpen, setJsonOpen] = React.useState(true);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [snapEnabled, setSnapEnabled] = React.useState(true);
  const [debugConsoleOpen, setDebugConsoleOpen] = React.useState(false);
  const [smartConnect, setSmartConnect] = React.useState(null);
  const [openMenu, setOpenMenu] = React.useState(null);
  const [edgeMenu, setEdgeMenu] = React.useState(null);
  const [wirePatchEdgeId, setWirePatchEdgeId] = React.useState(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [projectName, setProjectName] = React.useState("Untitled.veo.json");
  const fileInputRef = React.useRef(null);
  const menuBarRef = React.useRef(null);
  const smartConnectRef = React.useRef(null);
  const smartConnectUsedRef = React.useRef(false);
  const shiftKeyRef = React.useRef(false);
  const connectionActiveRef = React.useRef(false);
  const connectionBezierRef = React.useRef(false);
  const wirePatchEdgeRef = React.useRef(null);
  const libraryDragRef = React.useRef(null);

  React.useEffect(() => {
    smartConnectRef.current = smartConnect;
  }, [smartConnect]);

  React.useEffect(() => {
    function onKeyDown(event){
      if(event.key === "Shift"){
        shiftKeyRef.current = true;
        if(connectionActiveRef.current) connectionBezierRef.current = true;
      }
    }
    function onKeyUp(event){
      if(event.key === "Shift") shiftKeyRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

function connectionEdgeType(){
  return (connectionBezierRef.current || shiftKeyRef.current) ? "default" : "smoothstep";
}

function edgeModeForType(type){
  return !type || type === "default" ? "bezier" : "linear";
}

function edgeTypeForMode(mode){
  return mode === "bezier" ? "default" : "straight";
}

function nodeApproxSize(node){
  const data = (node && node.data) || {};
  const style = (node && node.style) || {};
  const measured = (node && node.measured) || {};
  let width = Number(style.width || node?.width || measured.width || 216);
  let height = Number(style.height || node?.height || measured.height || 144);
  if(node && node.type === "model"){
    width = Number(style.width || node.width || measured.width || 360);
    height = Number(style.height || node.height || measured.height || 180);
  }
  if(node && node.type === "omni_model"){
    width = Number(style.width || node.width || measured.width || 504);
    height = Number(style.height || node.height || measured.height || 180);
  }
  if(node && isGeneratorType(node.type)){
    width = Number(style.width || node.width || measured.width || 216);
    height = Number(style.height || node.height || measured.height || 216);
  }
  if(node && node.type === "ref"){
    width = Number(style.width || node.width || measured.width || 216);
    height = Number(style.height || node.height || measured.height || 216);
  }
  if(node && node.type === "param"){
    width = Number(style.width || node.width || measured.width || ((node.data && node.data.param_key) === "lens" ? 288 : 216));
    height = Number(style.height || node.height || measured.height || ((node.data && node.data.param_key) === "lens" ? 288 : 180));
  }
  if(node && node.type === "nano_banana"){
    width = Number(style.width || node.width || measured.width || 396);
    height = Number(style.height || node.height || measured.height || 432);
  }
  if(node && node.type === "clip"){
    width = Number(style.width || node.width || measured.width || 560);
    height = Number(style.height || node.height || measured.height || 430);
  }
  if(data.w) width = Number(data.w) || width;
  if(data.h) height = Number(data.h) || height;
  return { width, height };
}

function flowToScreenPoint(rfApi, point){
  if(rfApi && typeof rfApi.flowToScreenPosition === "function"){
    return rfApi.flowToScreenPosition(point);
  }
  const vp = rfApi && typeof rfApi.getViewport === "function" ? rfApi.getViewport() : { x:0, y:0, zoom:1 };
  return {
    x: point.x * (vp.zoom || 1) + (vp.x || 0),
    y: point.y * (vp.zoom || 1) + (vp.y || 0)
  };
}

function nodeMiddleScreenRect(node, rfApi){
  if(!node || !node.position) return null;
  const { width, height } = nodeApproxSize(node);
  const left = node.position.x + width * 0.1;
  const top = node.position.y + height * 0.1;
  const right = node.position.x + width * 0.9;
  const bottom = node.position.y + height * 0.9;
  const p1 = flowToScreenPoint(rfApi, { x:left, y:top });
  const p2 = flowToScreenPoint(rfApi, { x:right, y:bottom });
  return {
    l: Math.min(p1.x, p2.x),
    t: Math.min(p1.y, p2.y),
    r: Math.max(p1.x, p2.x),
    b: Math.max(p1.y, p2.y),
  };
}

function nodeMiddleFlowRect(node){
  if(!node || !node.position) return null;
  const { width, height } = nodeApproxSize(node);
  return {
    l: node.position.x + width * 0.1,
    t: node.position.y + height * 0.1,
    r: node.position.x + width * 0.9,
    b: node.position.y + height * 0.9,
  };
}

function pointInRect(point, rect){
  return point.x >= rect.l && point.x <= rect.r && point.y >= rect.t && point.y <= rect.b;
}

function rectCenter(rect){
  return { x:(rect.l + rect.r) / 2, y:(rect.t + rect.b) / 2 };
}

function distance(a, b){
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function edgePathElement(edgeId){
  const edgeEls = document.querySelectorAll(".react-flow__edge");
  for(const el of edgeEls){
    const id = el && (el.getAttribute("data-id") || el.getAttribute("data-testid"));
    if(el && (id === edgeId || id === `rf__edge-${edgeId}` || id === `react-flow__edge-${edgeId}`)){
      return el.querySelector(".react-flow__edge-path");
    }
  }
  const escapeCss = globalThis.CSS && globalThis.CSS.escape ? globalThis.CSS.escape : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const byClass = document.querySelector(`.react-flow__edge-${escapeCss(edgeId)} .react-flow__edge-path`);
  if(byClass) return byClass;
  return null;
}

function handleRatioForNode(node, handleId, kind){
  const id = String(handleId || "");
  if(kind === "source") return { x:.5, y:1 };
  if(node && node.type === "model"){
    if(id === "params") return { x:0, y:.6 };
    const ratios = { start:.1, end:.3, asset1:.5, asset2:.7, style:.9 };
    return { x: ratios[id] || .5, y:0 };
  }
  if(node && node.type === "omni_model"){
    if(id === "params") return { x:0, y:.6 };
    const index = omniInputHandles.indexOf(id);
    if(index >= 0) return { x:(36 + index * 72) / 504, y:0 };
  }
  if(node && node.type === "nano_banana"){
    const match = id.match(/^in_(\d+)$/);
    if(match){
      const index = Math.max(0, Math.min(13, Number(match[1])));
      return { x: (36 + (index % 7) * 54) / 396, y:(144 + Math.floor(index / 7) * 54) / 432 };
    }
  }
  if(id === "asset") return { x:1/3, y:0 };
  if(id === "style") return { x:2/3, y:0 };
  if(node && node.type === "param" && node.data && node.data.param_key === "lens"){
    return { x:.5, y: kind === "target" ? 0.01 : 0.99 };
  }
  return { x:.5, y: kind === "target" ? 0 : 1 };
}

function nodeHandleFlowPoint(node, handleId, kind){
  if(!node || !node.position) return null;
  const size = nodeApproxSize(node);
  const ratio = handleRatioForNode(node, handleId, kind);
  return {
    x: node.position.x + size.width * ratio.x,
    y: node.position.y + size.height * ratio.y,
  };
}

function sampledPolylineHit(rect, points){
  const center = rectCenter(rect);
  let best = Infinity;
  let hit = false;
  for(let p = 1; p < points.length; p += 1){
    const a = points[p - 1];
    const b = points[p];
    for(let i = 0; i <= 24; i += 1){
      const t = i / 24;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if(pointInRect(point, rect)){
        hit = true;
        best = Math.min(best, distance(point, center));
      }
    }
  }
  return hit ? best : null;
}

function edgeFlowHitScore(edge, rect, nodes){
  const source = nodes.find(n => n.id === edge.source);
  const target = nodes.find(n => n.id === edge.target);
  const start = nodeHandleFlowPoint(source, edge.sourceHandle || "out", "source");
  const end = nodeHandleFlowPoint(target, edge.targetHandle || "in", "target");
  if(!start || !end) return null;
  if(edge.type === "smoothstep"){
    const midY = start.y + (end.y - start.y) / 2;
    return sampledPolylineHit(rect, [start, { x:start.x, y:midY }, { x:end.x, y:midY }, end]);
  }
  return sampledPolylineHit(rect, [start, end]);
}

function edgePatchInputHandle(node, edges){
  if(!node || node.type === "clip") return null;
  const occupied = (handle) => edges.some(e => e.target === node.id && String(e.targetHandle || "") === handle);
  if(node.type === "nano_banana"){
    for(let i = 0; i < 14; i += 1){
      const handle = `in_${i}`;
      if(!occupied(handle)) return handle;
    }
    return null;
  }
  if(node.type === "model"){
    return ["start", "asset1", "asset2", "style", "end"].find(h => !occupied(h)) || null;
  }
  if(node.type === "omni_model"){
    return omniInputHandles.find(h => !occupied(h)) || null;
  }
  if(isGeneratorType(node.type)){
    return ["asset", "style"].find(h => !occupied(h)) || null;
  }
  return occupied("in") ? null : "in";
}

function edgeLabelPatch(handle){
  const label = labelForIndexedInput(handle);
  return label ? {
    label,
    labelStyle: { fill: "#FFD700", fontWeight: 700, fontSize: 10 },
    labelBgStyle: { fill: "rgba(0,0,0,0.6)", stroke: "#444", strokeWidth: 1 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 999
  } : {};
}

function setWirePatchPreview(candidate){
  const nextKey = candidate ? `${candidate.nodeId}:${candidate.edgeId}` : "";
  const prev = wirePatchEdgeRef.current;
  const prevKey = prev ? `${prev.nodeId}:${prev.edgeId}` : "";
  if(nextKey === prevKey) return;
  wirePatchEdgeRef.current = candidate;
  setWirePatchEdgeId(candidate ? candidate.edgeId : null);
}

function findWirePatchCandidate(node){
  if(!node || !node.id || !edgePatchInputHandle(node, edges)) return null;
  const rect = nodeMiddleScreenRect(node, rfApi);
  const flowRect = nodeMiddleFlowRect(node);
  if(!rect && !flowRect) return null;
  const center = rect ? rectCenter(rect) : null;
  let best = null;
  for(const edge of edges){
    if(edge.source === node.id || edge.target === node.id) continue;
    if(!nodes.some(n => n.id === edge.source) || !nodes.some(n => n.id === edge.target)) continue;
    const path = edgePathElement(edge.id);
    let score = null;
    if(path && typeof path.getTotalLength === "function" && rect){
      try{
        const length = path.getTotalLength();
        const matrix = path.getScreenCTM && path.getScreenCTM();
        if(length && matrix){
          let domScore = Infinity;
          let hit = false;
          for(let i = 0; i <= 40; i += 1){
            const local = path.getPointAtLength((length * i) / 40);
            const point = {
              x: local.x * matrix.a + local.y * matrix.c + matrix.e,
              y: local.x * matrix.b + local.y * matrix.d + matrix.f
            };
            if(pointInRect(point, rect)){
              hit = true;
              domScore = Math.min(domScore, distance(point, center));
            }
          }
          if(hit) score = domScore;
        }
      }catch(err){}
    }
    if(score === null && flowRect){
      score = edgeFlowHitScore(edge, flowRect, nodes);
    }
    if(score !== null && (!best || score < best.score)){
        best = { edgeId: edge.id, nodeId: node.id, score };
    }
  }
  return best;
}

  // ALT/Option = pan with left mouse (keeps normal middle/right panning too)
  ;

  function snapshotProject(){ return { version: 2, name: projectName, nodes: scrubNodesForStorage(nodes), edges }; }
  function downloadJson(filename, obj){
    try{
      const blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "project.veo.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    }catch(e){
      logLine("ERROR", `${nowTime()} Save failed: ${String(e && (e.message||e))}`);
    }
  }
  function loadProject(obj){
    try{
      if(!obj || !obj.nodes || !obj.edges) throw new Error("Invalid project file (expected {nodes, edges}).");
      setNodes(clearReferenceAutoDisabledFlags(obj.nodes));
      setEdges(obj.edges);
      setSelectedIds([]);
      setSelectedEdgeIds([]);
      setCompiledJson(null);
      setProjectName(obj.name || "Opened.veo.json");
      logLine("INFO", `${nowTime()} Opened project (${(obj.nodes||[]).length} nodes).`);
    }catch(e){
      logLine("ERROR", `${nowTime()} Open failed: ${String(e && (e.message||e))}`);
    }
  }
  function actionNew(){
    if(!window.confirm("New project? (Y/N)")) return;
    const fresh = { nodes: [{ id:"clip_1", type:"clip", position:{x:220,y:160}, data: defaultPropsFor("clip") }, { id:"model_1", type:"model", position:{x:780,y:520}, data: defaultPropsFor("model") }], edges: [] };
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    setSelectedIds([]);
    setSelectedEdgeIds([]);
    setCompiledJson(null);
    setProjectName("Untitled.veo.json");
    logLine("INFO", `${nowTime()} New project.`);
  }
  function actionSave(){ downloadJson(projectName || "Untitled.veo.json", snapshotProject()); logLine("INFO", `${nowTime()} Saved: ${projectName}`); }
  function actionSaveAs(){
    const name = prompt("Save As...", projectName || "Untitled.veo.json");
    if(!name) return;
    setProjectName(name);
    downloadJson(name, snapshotProject());
    logLine("INFO", `${nowTime()} Saved As: ${name}`);
  }
  function actionOpen(){
    if(!window.confirm("Open project file? (Y/N)")) return;
    if(fileInputRef.current) fileInputRef.current.click();
  }
  function actionUndo(){
    const snap = undo();
    if(snap){
      applySnapshot(snap);
      logLine("INFO", `${nowTime()} Undo`);
    }
  }
  function actionRedo(){
    const snap = redo();
    if(snap){
      applySnapshot(snap);
      logLine("INFO", `${nowTime()} Redo`);
    }
  }
  async function toggleFullscreen(){
    try{
      if(document.fullscreenElement){
        await document.exitFullscreen();
      } else {
        const target = document.getElementById("root") || document.documentElement;
        await target.requestFullscreen();
      }
    }catch(err){
      logLine("WARN", `${nowTime()} Full screen unavailable in this browser frame.`);
    }
  }

  React.useEffect(() => {
    function onFullscreenChange(){ setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  React.useEffect(() => {
    function onPointerDown(e){
      if(menuBarRef.current && !menuBarRef.current.contains(e.target)){
        setOpenMenu(null);
      }
      if(!(e.target && e.target.closest && e.target.closest(".edgeContextMenu"))){
        setEdgeMenu(null);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  React.useEffect(() => {
    function isMac(){ return /Mac|iPhone|iPad|iPod/.test(navigator.platform); }
    function onKeyDown(e){
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      const key = (e.key || "").toLowerCase();

      if(mod && key === "n"){ e.preventDefault(); actionNew(); return; }
      if(mod && key === "o"){ e.preventDefault(); actionOpen(); return; }
      if(mod && key === "s" && e.shiftKey){ e.preventDefault(); actionSaveAs(); return; }
      if(mod && key === "s"){ e.preventDefault(); actionSave(); return; }

      if(mod && key === "z" && !e.shiftKey){ e.preventDefault(); const snap = undo(); if(snap){ applySnapshot(snap); } return; }
      if(mod && (key === "y" || (key === "z" && e.shiftKey))){ e.preventDefault(); const snap = redo(); if(snap){ applySnapshot(snap); } return; }

      if(key === "f11"){
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if(isTextEditingTarget(e) && !mod) return;

      if(key === "s" && !mod){
        e.preventDefault();
        setSnapEnabled(prev => {
          const next = !prev;
          logLine("INFO", `${nowTime()} Grid snapping ${next ? "enabled" : "disabled"}.`);
          return next;
        });
        return;
      }

      // 'F' Key to Focus View
      if(key === "f" && !mod){
        rfApi.fitView({ padding: 0.2, duration: 200 });
        logLine("INFO", `${nowTime()} Focus / Fit View`);
        return;
      }

      if(mod && key === "c"){
        if(selectedIds.length){
          const nodeSet = new Set(selectedIds);
          const copiedNodes = scrubNodesForStorage(nodes.filter(n => nodeSet.has(n.id)));
          const copiedEdges = edges.filter(ed => nodeSet.has(ed.source) && nodeSet.has(ed.target));
          setClipboard({ nodes: copiedNodes, edges: copiedEdges });
          logLine("INFO", `${nowTime()} Copied ${copiedNodes.length} node(s)`);
        }
        return;
      }
      if(mod && key === "v"){
        if(clipboard && clipboard.nodes && clipboard.nodes.length){
          const idMap = {};
          const offset = 28;
          const newNodes = clipboard.nodes.map(n => {
            const newId = makeId(n.type);
            idMap[n.id] = newId;
            return Object.assign({}, n, { id: newId, position: { x: (n.position?.x || 0) + offset, y: (n.position?.y || 0) + offset }, selected: false });
          });
          const newEdges = (clipboard.edges || []).map(ed => Object.assign({}, ed, { id: makeId("e"), source: idMap[ed.source], target: idMap[ed.target] })).filter(ed => ed.source && ed.target);
          setNodes(nds => nds.concat(newNodes));
          setEdges(eds => eds.concat(newEdges));
          setSelectedIds(newNodes.map(n => n.id));
          logLine("INFO", `${nowTime()} Pasted ${newNodes.length} node(s)`);
        }
        return;
      }
      if(key === "backspace" || key === "delete"){
        if(selectedEdgeIds.length){
          const s = new Set(selectedEdgeIds);
          setEdges(eds => eds.filter(ed => !s.has(ed.id)));
          logLine("INFO", `${nowTime()} Deleted ${selectedEdgeIds.length} edge(s)`);
          setSelectedEdgeIds([]);
          return;
        }
        if(selectedIds.length){
          const s = new Set(selectedIds);
          setNodes(nds => nds.filter(n => !s.has(n.id)));
          setEdges(eds => eds.filter(ed => !s.has(ed.source) && !s.has(ed.target)));
          logLine("INFO", `${nowTime()} Deleted ${selectedIds.length} node(s)`);
          setSelectedIds([]);
          return;
        }
      }
      if(key === "escape"){
        e.preventDefault();
        if(openMenu){
          setOpenMenu(null);
          return;
        }
        if(window.confirm("Exit Stage? (Y/N)")){ window.location.href = "about:blank"; return; }
        setSelectedIds([]);
        setSelectedEdgeIds([]);
        logLine("INFO", `${nowTime()} ESC (cancelled)`);
        return;
      }
      if(key === "d" && selectedIds.length){
        e.preventDefault();
        const s = new Set(selectedIds);
        setNodes(nds => nds.map(n => s.has(n.id) ? Object.assign({}, n, { data: Object.assign({}, (n.data||{}), { disabled: !(n.data && n.data.disabled) }) }) : n));
        logLine("INFO", `${nowTime()} Toggled disabled for ${selectedIds.length} node(s)`);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nodes, edges, selectedIds, clipboard, selectedEdgeIds, openMenu, undo, redo, rfApi, toggleFullscreen]);

  const dragHistoryRef = React.useRef({});
  const onNodeDrag = React.useCallback((_e, node) => {
    try{
      if(!node || !node.id) return;
      if(node.type === "background"){
        const prev = dragHistoryRef.current.__bgPrev || { x: node.position?.x || 0, y: node.position?.y || 0 };
        const curr = { x: node.position?.x || 0, y: node.position?.y || 0 };
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        dragHistoryRef.current.__bgPrev = curr;
        const w = (node.data && node.data.w) ? node.data.w : 520;
        const h = (node.data && node.data.h) ? node.data.h : 320;
        const left = curr.x, top = curr.y, right = curr.x + w, bottom = curr.y + h;
        if(dx !== 0 || dy !== 0){
          setNodes(nds => nds.map(n => {
            if(n.id === node.id) return n;
            const px = n.position?.x || 0;
            const py = n.position?.y || 0;
            if(px >= left && px <= right && py >= top && py <= bottom){
              return Object.assign({}, n, { position: { x: px + dx, y: py + dy } });
            }
            return n;
          }));
        }
      }

      if(node.type === "clip"){
        const prev = (dragHistoryRef.current.__clipPrev && dragHistoryRef.current.__clipPrev[node.id]) || { x: node.position?.x || 0, y: node.position?.y || 0 };
        const curr = { x: node.position?.x || 0, y: node.position?.y || 0 };
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        dragHistoryRef.current.__clipPrev = dragHistoryRef.current.__clipPrev || {};
        dragHistoryRef.current.__clipPrev[node.id] = curr;

        const w = Number((node.style && node.style.width) || node.width || (node.measured && node.measured.width) || 560);
        const h = Number((node.style && node.style.height) || node.height || (node.measured && node.measured.height) || 430);
        const left = curr.x, top = curr.y, right = curr.x + w, bottom = curr.y + h;

        const intersects = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
        const groupBox = { l:left, t:top, r:right, b:bottom };

        if(dx !== 0 || dy !== 0){
          setNodes(nds => nds.map(n => {
            if(n.id === node.id) return n;
            // Don't move other clip boundaries
            if(n.type === "clip") return n;
            const nx = n.position?.x || 0;
            const ny = n.position?.y || 0;
            const nw = Number((n.style && n.style.width) || n.width || (n.measured && n.measured.width) || 180);
            const nh = Number((n.style && n.style.height) || n.height || (n.measured && n.measured.height) || 90);
            const box = { l:nx, t:ny, r:nx+nw, b:ny+nh };
            // Move nodes that are contained OR touching/intersecting the boundary.
            if(intersects(box, groupBox)){
              return Object.assign({}, n, { position: { x: nx + dx, y: ny + dy } });
            }
            return n;
          }));
        }
      }
      setWirePatchPreview(findWirePatchCandidate(node));
      const now = Date.now();
      const hist = dragHistoryRef.current[node.id] || [];
      hist.push({ t: now, x: node.position?.x || 0 });
      const trimmed = hist.filter(p => now - p.t <= 700);
      dragHistoryRef.current[node.id] = trimmed;
      if(node.type !== 'background') dragHistoryRef.current.__bgPrev = null;
      if(trimmed.length < 8) return;
      let flips = 0;
      let lastDir = 0;
      for(let i=1;i<trimmed.length;i++){
        const dx = trimmed[i].x - trimmed[i-1].x;
        const dir = dx > 6 ? 1 : (dx < -6 ? -1 : 0);
        if(dir !== 0 && lastDir !== 0 && dir !== lastDir) flips++;
        if(dir !== 0) lastDir = dir;
      }
      if(flips >= 4){
        setEdges(eds => eds.filter(ed => ed.source !== node.id && ed.target !== node.id));
        logLine("WARN", `${nowTime()} Shake disconnect: cleared wires from ${node.id}`);
        dragHistoryRef.current[node.id] = [];
      }
    }catch(err){}
  }, [setEdges, nodes, edges, rfApi]);

  const onNodeDragStop = React.useCallback((_e, node) => {
    if(!node || !node.id){
      setWirePatchPreview(null);
      return;
    }
    const patchCandidate = wirePatchEdgeRef.current && wirePatchEdgeRef.current.nodeId === node.id
      ? wirePatchEdgeRef.current
      : null;
    if(snapEnabled){
      const snapped = snapFlowPosition(node.position, true);
      if(snapped && (snapped.x !== node.position?.x || snapped.y !== node.position?.y)){
        setNodes(nds => nds.map(n => n.id === node.id ? Object.assign({}, n, { position: snapped }) : n));
      }
    }
    if(patchCandidate){
      const edgeToPatch = edges.find(edge => edge.id === patchCandidate.edgeId);
      const inputHandle = edgePatchInputHandle(node, edges);
      if(edgeToPatch && inputHandle){
        const firstEdge = Object.assign({
          id: makeId("e"),
          source: edgeToPatch.source,
          sourceHandle: edgeToPatch.sourceHandle,
          target: node.id,
          targetHandle: inputHandle,
          type: edgeToPatch.type || defaultEdgeOptions.type,
        }, edgeLabelPatch(inputHandle));
        const secondEdge = Object.assign({}, edgeToPatch, {
          id: makeId("e"),
          source: node.id,
          sourceHandle: "out",
        });
        setEdges(eds => eds.flatMap(edge => edge.id === edgeToPatch.id ? [firstEdge, secondEdge] : [edge]));
        setSelectedEdgeIds([]);
        setSelectedIds([node.id]);
        logLine("INFO", `${nowTime()} Auto-patched ${node.id} into wire ${edgeToPatch.id}.`);
      }
    }
    setWirePatchPreview(null);
  }, [setNodes, setEdges, edges, snapEnabled]);

  React.useEffect(() => {
    try{
      localStorage.setItem(LS_KEY, JSON.stringify({ nodes: scrubNodesForStorage(nodes), edges, selectedIds, clipboard: scrubClipboardForStorage(clipboard) }));
    }catch(err){
      logLine("WARN", `${nowTime()} Autosave skipped: browser storage is full or unavailable.`);
    }
  }, [nodes, edges, selectedIds, clipboard]);

  const selectedNodes = React.useMemo(() => selectedIds.map(id => nodes.find(n => n.id === id)).filter(Boolean), [nodes, selectedIds]);
  const selectedPrimary = React.useMemo(() => selectedNodes[0] || null, [selectedNodes]);

  const modelNode = React.useMemo(() => nodes.find(n => n.type==="omni_model") || nodes.find(n => n.type==="model") || null, [nodes]);
  const modelProps = (modelNode && modelNode.data) || defaultPropsFor("model");
  const caps = MODEL_CATALOG[modelProps.model_ver] || MODEL_CATALOG["Veo 3.1 Quality"];
  const primaryRefNode = React.useMemo(() => nodes.find(n => n.type === "ref") || null, [nodes]);
  const primaryRefAnalysis = primaryRefNode && isAnalysisActivated(primaryRefNode.data && primaryRefNode.data.analysis) ? primaryRefNode.data.analysis : null;
  const referenceGateReady = !primaryRefNode || !!primaryRefAnalysis;
  const renderedEdges = React.useMemo(() => edges.map(edge => {
    if(edge.id !== wirePatchEdgeId) return edge;
    return Object.assign({}, edge, {
      animated: true,
      style: Object.assign({}, edge.style || {}, {
        stroke: WIRE_PATCH_COLOR,
        strokeWidth: 3,
        filter: `drop-shadow(0 0 7px ${WIRE_PATCH_COLOR})`
      })
    });
  }), [edges, wirePatchEdgeId]);

  const finalizeSmartConnection = React.useCallback((pointOverride) => {
    const smart = smartConnectRef.current;
    if(!smart) return;

    const option = smart.options[smart.selectedIndex] || smart.options[0];
    const point = pointOverride || smart.current || smart.start;
    const flowPoint = rfApi.screenToFlowPosition(point);
    const id = makeId(option.type);
    const label = labelForIndexedInput(smart.targetHandle);
    const nodePosition = snapFlowPosition({ x: flowPoint.x - 85, y: flowPoint.y - 44 }, snapEnabled);
    const node = {
      id,
      type: option.type,
      position: nodePosition,
      data: Object.assign({}, defaultPropsFor(option.type), { title: option.title })
    };
    const edge = {
      id: makeId("e"),
      source: id,
      sourceHandle: "out",
      target: smart.targetNodeId,
      targetHandle: smart.targetHandle,
      type: connectionEdgeType(),
      label: label || undefined,
      labelStyle: label ? { fill: "#FFD700", fontWeight: 700, fontSize: 10 } : undefined,
      labelBgStyle: label ? { fill: "rgba(0,0,0,0.6)", stroke: "#444", strokeWidth: 1 } : undefined,
      labelBgPadding: label ? [6, 3] : undefined,
      labelBgBorderRadius: label ? 999 : undefined
    };

    setNodes(nds => nds.concat([node]));
    setEdges(eds => addEdge(edge, eds));
    setSelectedIds([id]);
    setSmartConnect(null);
    logLine("INFO", `${nowTime()} Smart connect: added ${option.title} to ${label || smart.targetHandle}.`);
  }, [rfApi, setEdges, setNodes, snapEnabled]);

  React.useEffect(() => {
    if(!smartConnect) return;
    const onPointerMove = (event) => {
      const point = clientPointFromEvent(event);
      setSmartConnect(prev => prev ? Object.assign({}, prev, { current: point }) : prev);
    };
    window.addEventListener("pointermove", onPointerMove, true);
    return () => window.removeEventListener("pointermove", onPointerMove, true);
  }, [smartConnect && smartConnect.id]);

  React.useEffect(() => {
    if(!smartConnect) return;
    const onKeyDown = (event) => {
      if(event.key === "ArrowDown" || event.key === "ArrowUp"){
        event.preventDefault();
        const dir = event.key === "ArrowDown" ? 1 : -1;
        setSmartConnect(prev => {
          if(!prev) return prev;
          const nextIndex = (prev.selectedIndex + dir + prev.options.length) % prev.options.length;
          return Object.assign({}, prev, { selectedIndex: nextIndex });
        });
        return;
      }
      if(event.key === "Enter"){
        event.preventDefault();
        finalizeSmartConnection();
        return;
      }
      if(event.key === "Escape"){
        event.preventDefault();
        setSmartConnect(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [smartConnect, finalizeSmartConnection]);

  const onConnectStart = React.useCallback((event, params) => {
    smartConnectUsedRef.current = false;
    connectionActiveRef.current = true;
    connectionBezierRef.current = !!(event && event.shiftKey) || shiftKeyRef.current;
    const handleType = String((params && params.handleType) || "");
    const targetNodeId = params && params.nodeId;
    const targetHandle = params && params.handleId;
    const target = nodes.find(n => n.id === targetNodeId);
    const options = smartConnectionOptionsForInput(target, targetHandle);
    if(handleType !== "target" || !options.length){
      setSmartConnect(null);
      return;
    }

    const issue = connectionCapacityIssue({ target: targetNodeId, targetHandle }, nodes, edges, caps);
    if(issue){
      showToast(issue.message);
      logLine("WARN", `${nowTime()} Smart connect blocked: ${issue.message}`);
      setSmartConnect(null);
      return;
    }

    const point = clientPointFromEvent(event);
    setSmartConnect({
      id: makeId("smart"),
      start: point,
      current: point,
      targetNodeId,
      targetHandle,
      options,
      selectedIndex: 0
    });
  }, [nodes, edges, caps, showToast]);

  const onConnectEnd = React.useCallback((event) => {
    const smart = smartConnectRef.current;
    window.setTimeout(() => {
      connectionActiveRef.current = false;
      connectionBezierRef.current = false;
    }, 0);
    if(!smart || smartConnectUsedRef.current) return;
    const point = clientPointFromEvent(event);
    const moved = Math.hypot(point.x - smart.start.x, point.y - smart.start.y);
    if(moved < 12){
      setSmartConnect(null);
      return;
    }
    finalizeSmartConnection(point);
  }, [finalizeSmartConnection]);

  const onConnect = React.useCallback((conn) => {
    if(smartConnectRef.current) smartConnectUsedRef.current = true;
    const issue = connectionCapacityIssue(conn, nodes, edges, caps);
    if(issue){
      showToast(issue.message);
      logLine("WARN", `${nowTime()} Connection blocked: ${issue.message}`);
      setSmartConnect(null);
      return;
    }
    // If the target handle looks like an indexed input (e.g. in_0, in_1...), attach a centered label like "Input 1".
    const th = String(conn && conn.targetHandle ? conn.targetHandle : "");
    const label = labelForIndexedInput(th);
    setEdges((eds) => addEdge({ 
      ...conn, 
      type: connectionEdgeType(),
      label: label || undefined,
      labelStyle: label ? { fill: "#FFD700", fontWeight: 700, fontSize: 10 } : undefined,
      labelBgStyle: label ? { fill: "rgba(0,0,0,0.6)", stroke: "#444", strokeWidth: 1 } : undefined,
      labelBgPadding: label ? [6, 3] : undefined,
      labelBgBorderRadius: label ? 999 : undefined
    }, eds));
    setSmartConnect(null);
  }, [nodes, edges, caps, setEdges, showToast]);

  const onEdgeContextMenu = React.useCallback((event, edge) => {
    event.preventDefault();
    event.stopPropagation();
    if(!edge || !edge.id) return;
    setSelectedEdgeIds([edge.id]);
    setSelectedIds([]);
    setEdgeMenu({
      edgeId: edge.id,
      x: event.clientX,
      y: event.clientY
    });
  }, []);

  function setEdgeMode(edgeId, mode){
    const label = mode === "bezier" ? "Bezier" : "Linear";
    setEdges(eds => eds.map(edge => edge.id === edgeId ? Object.assign({}, edge, { type: edgeTypeForMode(mode) }) : edge));
    setEdgeMenu(null);
    logLine("INFO", `${nowTime()} Edge ${edgeId} set to ${label}.`);
  }

  const onSelectionChange = React.useCallback((sel) => {
    const ids = ((sel && sel.nodes) ? sel.nodes : []).map(n => n.id);
    setSelectedIds(ids);
  }, []);

  const onNodeClick = React.useCallback((_event, node) => {
    if(!node || !node.id) return;
    setSelectedIds([node.id]);
    setSelectedEdgeIds([]);
    setEdgeMenu(null);
  }, []);

  function libraryNodeSpec(key){
    let type = key;
    let dataPatch = {};
    if(key && key.indexOf("param_") === 0) type = "param";
    if(key==="param_batch_4") dataPatch = { title:"Batch", subtitle:"Veo max output videos per prompt is 4.", param_key:"batch", param_val:1 };
    if(key==="param_length_8") dataPatch = { title:"Length", subtitle:"Veo accepts 4, 6, or 8 seconds; 10s is kept for Omni intent.", param_key:"length_seconds", param_val:8 };
    if(key==="param_fps_24") dataPatch = { title:"FPS", subtitle:"Veo 3.1 submits at 24 FPS; higher values are Omni/style intent.", param_key:"fps", param_val:24 };
    if(key==="param_aspect_16_9") dataPatch = { title:"Aspect", subtitle:"Veo 3.1 accepts landscape or portrait.", param_key:"aspect", param_val:"16:9" };
    if(key==="param_res_hd") dataPatch = { title:"Resolution", subtitle:"Veo 3.1 supports 720p, 1080p, and 4K preview output.", param_key:"res", param_val:"1080p" };
    if(key==="param_lens") dataPatch = { title:"Lens", subtitle:"Optics, depth of field, and shutter intent.", param_key:"lens", param_values:lensParamValues({}), focal_length:"35mm", aperture:"f/2.8", lens_effect:"None", shutter_effect:"Natural Motion Blur" };
    return { type, dataPatch };
  }

  function canvasFlowPointFromDragEvent(event){
    const bounds = event.currentTarget.getBoundingClientRect();
    return rfApi.screenToFlowPosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  function virtualLibraryNodeForEvent(event, key){
    if(!key) return null;
    const spec = libraryNodeSpec(key);
    if(!spec.type || spec.type === "clip") return null;
    const point = canvasFlowPointFromDragEvent(event);
    const size = nodeApproxSize({ type: spec.type });
    return {
      id: "__library_drag_preview__",
      type: spec.type,
      position: {
        x: point.x - size.width / 2,
        y: point.y - size.height / 2
      }
    };
  }

  function patchEdgeWithNode(edgeToPatch, node, inputHandle){
    if(!edgeToPatch || !node || !inputHandle) return false;
    const firstEdge = Object.assign({
      id: makeId("e"),
      source: edgeToPatch.source,
      sourceHandle: edgeToPatch.sourceHandle,
      target: node.id,
      targetHandle: inputHandle,
      type: edgeToPatch.type || defaultEdgeOptions.type,
    }, edgeLabelPatch(inputHandle));
    const secondEdge = Object.assign({}, edgeToPatch, {
      id: makeId("e"),
      source: node.id,
      sourceHandle: "out",
    });
    setEdges(eds => eds.flatMap(edge => edge.id === edgeToPatch.id ? [firstEdge, secondEdge] : [edge]));
    setSelectedEdgeIds([]);
    setSelectedIds([node.id]);
    logLine("INFO", `${nowTime()} Auto-patched ${node.id} into wire ${edgeToPatch.id}.`);
    return true;
  }

  const onDragStart = (event, itemKey) => {
    libraryDragRef.current = { key: itemKey };
    event.dataTransfer.setData("application/veo-node", itemKey);
    event.dataTransfer.effectAllowed = "move";
  };
  const onDragEnd = () => {
    libraryDragRef.current = null;
    setWirePatchPreview(null);
  };
  const onDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const key = libraryDragRef.current && libraryDragRef.current.key;
    const virtualNode = virtualLibraryNodeForEvent(event, key);
    setWirePatchPreview(virtualNode ? findWirePatchCandidate(virtualNode) : null);
  };
  const onDrop = (event) => {
    event.preventDefault();
    const key = event.dataTransfer.getData("application/veo-node") || (libraryDragRef.current && libraryDragRef.current.key);
    libraryDragRef.current = null;
    if(!key) return;
    const spec = libraryNodeSpec(key);
    const type = spec.type;
    const dataPatch = spec.dataPatch;
    const dropPoint = canvasFlowPointFromDragEvent(event);
    const virtualNode = virtualLibraryNodeForEvent(event, key);
    const patchCandidate = virtualNode ? findWirePatchCandidate(virtualNode) : null;
    const patchEdge = patchCandidate ? edges.find(edge => edge.id === patchCandidate.edgeId) : null;
    const size = nodeApproxSize({ type });
    const position = patchEdge
      ? snapFlowPosition({ x: dropPoint.x - size.width / 2, y: dropPoint.y - size.height / 2 }, snapEnabled)
      : snapFlowPosition(dropPoint, snapEnabled);
if(type==="clip"){
      const gid = makeId("clip");
      const d = defaultPropsFor("clip");
      const existing = nodes.filter(n => n.type === "clip");
      const nextIdx = existing.length ? (Math.max.apply(null, existing.map(n => Number((n.data && n.data.clip_index) || 0))) + 1) : 1;
      d.clip_index = nextIdx;
      d.clip_name = "CLIP_" + String.fromCharCode(64 + Math.min(nextIdx, 26));
      d.output_last_frame_uri = `gs://your-bucket/renders/${d.clip_name}_LAST_FRAME.png`;
      const groupNode = { id: gid, type:"clip", position, data:d, style:{ width:560, height:430 }, dragHandle: ".drag-handle" };
      setNodes(nds => nds.concat([groupNode]));
      setSelectedIds([gid]);
      logLine("INFO", `${nowTime()} Added clip boundary ${d.clip_name} (${gid})`);
      setWirePatchPreview(null);
      return;
    }
    const id = makeId(type);
    const base = defaultPropsFor(type);
    const palette = PALETTE.find(p => p.key === key);
    const n = { id, type, position, data: Object.assign({}, base, dataPatch, { tags: (palette && palette.tags) ? palette.tags : (base.tags || []) }) };
    if(type === "ref"){
      setNodes(nds => nds.map(existing => (
        isCascadeTargetType(existing.type)
          ? Object.assign({}, existing, { data: Object.assign({}, existing.data, { disabled:true, cascade_source_ref_id:id, cascade_prompt:"", cascade_identity_profile:null, cascade_warnings:["Waiting for Asset Reference analysis."] }) })
          : existing
      )).concat([n]));
    } else {
      setNodes(nds => {
        const shouldGate = type && isCascadeTargetType(type) && nds.some(existing => existing.type === "ref" && !isAnalysisActivated(existing.data && existing.data.analysis));
        const node = shouldGate
          ? Object.assign({}, n, { data: Object.assign({}, n.data, { disabled:true, cascade_warnings:["Waiting for Asset Reference analysis."] }) })
          : n;
        return nds.concat([node]);
      });
    }
    if(patchEdge){
      const inputHandle = edgePatchInputHandle(n, edges);
      if(inputHandle) patchEdgeWithNode(patchEdge, n, inputHandle);
    }
    setWirePatchPreview(null);
    setSelectedIds([id]);
    if(!patchEdge) logLine("INFO", `${nowTime()} Dropped ${type} node ${id}`);
  };

  function updateNode(id, patch){ setNodes(nds => nds.map(n => (n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, patch) }) : n))); }

  function setReferenceGatePending(refId, patch){
    setNodes(nds => nds.map(n => {
      if(n.id === refId){
        return Object.assign({}, n, { data: Object.assign({}, n.data, patch || {}, { analysis_status:"pending", activated_at:null }) });
      }
      if(isCascadeTargetType(n.type)){
        return Object.assign({}, n, {
          data: Object.assign({}, n.data, {
            disabled: true,
            cascade_source_ref_id: refId,
            cascade_prompt: "",
            cascade_identity_profile: null,
            cascade_warnings: ["Waiting for Asset Reference analysis."]
          })
        });
      }
      return n;
    }));
  }

  function applyReferenceAnalysis(refId, analysis, options){
    const quiet = !!(options && options.quiet);
    const active = isAnalysisActivated(analysis);
    setNodes(nds => nds.map(n => {
      if(n.id === refId){
        return Object.assign({}, n, {
          data: Object.assign({}, n.data, {
            analysis,
            analysis_status: active ? "analyzed" : "pending",
            activated_at: active ? (analysis.analyzed_at || new Date().toISOString()) : null
          })
        });
      }
      if(isCascadeTargetType(n.type)){
        const cascadePrompt = active ? nodeCascadePrompt(analysis, n.type) : "";
        return Object.assign({}, n, {
          data: Object.assign({}, n.data, {
            disabled: !active,
            cascade_source_ref_id: refId,
            cascade_prompt: cascadePrompt,
            cascade_identity_profile: active ? (analysis.identity_profile || null) : null,
            cascade_warnings: active ? [] : ["Waiting for Asset Reference analysis."],
            tags: active ? uniqueTags(n.data && n.data.tags, ["analysis-linked"]) : (n.data && n.data.tags) || []
          })
        });
      }
      return n;
    }));
    if(!quiet){
      logLine(active ? "INFO" : "WARN", `${nowTime()} Asset Reference gateway ${active ? "activated" : "locked"}.`);
    }
  }

  function clearReferenceAnalysis(refId){
    setReferenceGatePending(refId, { analysis:null, analysis_status:"pending", activated_at:null });
    logLine("WARN", `${nowTime()} Asset Reference analysis cleared; downstream generator nodes locked.`);
  }

  const capacityWarningRef = React.useRef("");
  React.useEffect(() => {
    const issue = currentModelCapacityIssue(nodes, edges, caps);
    const key = issue ? `${modelProps.model_ver}:${issue.count}:${issue.max}` : "";
    if(issue && key !== capacityWarningRef.current){
      showToast(issue.message);
      logLine("WARN", `${nowTime()} ${issue.message}`);
    }
    capacityWarningRef.current = key;
  }, [nodes, edges, caps, modelProps.model_ver, showToast]);

  const creditsAndCost = React.useMemo(() => {
    return estimateGraphCredits(nodes, edges, modelProps, caps, referenceGateReady);
  }, [nodes, edges, modelProps, caps, referenceGateReady]);

  async function onRefImageChange(file, refId){
    const refNode = refId ? nodes.find(n => n.id === refId) : selectedPrimary;
    if(!file || !refNode || refNode.type !== "ref") return;
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const imageKey = `ref:${refNode.id}`;
    let previewUrl = dataUrl;
    try{
      await saveImageAsset(imageKey, dataUrl);
      previewUrl = await makeImagePreview(dataUrl, 180);
      setReferenceGatePending(refNode.id, { image_store_key: imageKey, image_preview_url: previewUrl, image_data_url: null, image_name: file.name, analysis:null, activated_at:null });
      setSelectedIds([refNode.id]);
      logLine("INFO", `${nowTime()} Stored reference image: ${file.name}`);
    }catch(err){
      setReferenceGatePending(refNode.id, { image_store_key: null, image_preview_url: previewUrl, image_data_url: dataUrl, image_name: file.name, analysis:null, activated_at:null });
      setSelectedIds([refNode.id]);
      logLine("WARN", `${nowTime()} IndexedDB unavailable; image will stay in memory for this session only.`);
    }
  }

  async function runRefAnalysis(refId){
    const refNode = refId ? nodes.find(n => n.id === refId) : selectedPrimary;
    if(!refNode || refNode.type !== "ref") return;
    const imageData = await imageDataForNode(refNode);
    if(!imageData){ logLine("WARN", `${nowTime()} Run Analysis: no image uploaded.`); return; }
    const config = window.__VEO_CONFIG__ || {};
    if(!config.has_api_key){
      logLine("ERROR", `${nowTime()} Missing API key. Set GEMINI_API_KEY in access.env.`);
      return;
    }
    logLine("INFO", `${nowTime()} Running Gemini asset analysis...`);
    updateNode(refNode.id, { analysis_status:"running" });
    try{
      const response = await proxyJson("/api/gemini/analyze", {
        image_data_url: imageData,
        image_name: refNode.data && refNode.data.image_name,
        node_id: refNode.id
      });
      if(!response.analysis) throw new Error("No analysis JSON returned.");
      applyReferenceAnalysis(refNode.id, response.analysis);
      setSelectedIds([refNode.id]);
      setJsonOpen(true);
      logLine("INFO", `${nowTime()} Analysis complete via ${response.model || "Gemini"}.`);
    }catch(err){
      updateNode(refNode.id, { analysis_status:"pending" });
      logLine("ERROR", `${nowTime()} Analysis failed: ${String(err && (err.message||err))}`);
    }
  }

  async function collectNanoBananaInputs(nanoNode){
    const slots = (nanoNode.data && nanoNode.data.slots) || Array(14).fill(null);
    const images = [];
    for(let i = 0; i < 14; i += 1){
      const handleId = `in_${i}`;
      const edge = edges.find(e => e.target === nanoNode.id && String(e.targetHandle || "") === handleId);
      const role = i < 6 ? "high_fidelity" : "supplementary";
      if(edge){
        const source = nodes.find(n => n.id === edge.source);
        const dataUrl = source ? await imageDataForNode(source).catch(() => null) : null;
        if(dataUrl){
          images.push({
            slot: i + 1,
            label: `${source.data && source.data.title ? source.data.title : source.type} -> slot ${i + 1}`,
            role,
            source_node_id: source.id,
            source_type: source.type,
            data_url: dataUrl
          });
        }
      } else if(slots[i]){
        images.push({
          slot: i + 1,
          label: `Manual slot ${i + 1}`,
          role,
          source_node_id: null,
          source_type: "manual_upload",
          data_url: slots[i]
        });
      }
    }
    return images;
  }

  function buildNanoBananaPrompt(nanoNode, images){
    const activeRefNode = nodes.find(n => n.type === "ref" && isAnalysisActivated(n.data && n.data.analysis));
    const refAnalysis = activeRefNode && activeRefNode.data ? activeRefNode.data.analysis : null;
    const incomingEdges = edges.filter(e => e.target === nanoNode.id);
    const upstreamLines = incomingEdges.map((edge) => {
      const source = nodes.find(n => n.id === edge.source);
      if(!source) return null;
      const sourceData = source.data || {};
      if(source.type === "ref" && isAnalysisActivated(sourceData.analysis)){
        return `Connected ${edge.targetHandle}: ${sourceData.analysis.identity_profile && sourceData.analysis.identity_profile.summary ? sourceData.analysis.identity_profile.summary : referenceDescriptionFor(sourceData.analysis, "asset")}`;
      }
      if(source.type === "nano_banana"){
        return `Connected ${edge.targetHandle}: use generated image output from ${sourceData.title || source.id}${sourceData.result_text ? `. Prior generation note: ${sourceData.result_text}` : ""}.`;
      }
      const prompt = [sourceData.cascade_prompt, sourceData.prompt].filter(Boolean).join(" ");
      return prompt ? `Connected ${edge.targetHandle}: ${sourceData.title || source.type}: ${prompt}` : `Connected ${edge.targetHandle}: ${sourceData.title || source.type}.`;
    }).filter(Boolean);
    const cascadePrompt = (nanoNode.data && nanoNode.data.cascade_prompt) || nodeCascadePrompt(refAnalysis, "nano_banana");
    const userPrompt = (nanoNode.data && nanoNode.data.prompt) || "";
    const imageLines = images.map(img => `Input ${img.slot} (${img.role}): ${img.label}`).join("\n");
    return [
      cascadePrompt,
      refAnalysis && refAnalysis.identity_profile ? `Identity profile: ${refAnalysis.identity_profile.summary}` : "",
      upstreamLines.length ? "Connected upstream context:\n" + upstreamLines.join("\n") : "",
      imageLines ? "Image inputs:\n" + imageLines : "",
      userPrompt ? `User prompt: ${userPrompt}` : "User prompt: Generate the most coherent image implied by the connected references.",
      `Requested output: ${String((nanoNode.data && nanoNode.data.res) || "HD")} still image, ${String((nanoNode.data && nanoNode.data.aspect) || "16:9")} composition.`
    ].filter(Boolean).join("\n\n");
  }

  async function runNanoBananaGeneration(nodeId){
    const nanoNode = nodes.find(n => n.id === nodeId);
    if(!nanoNode || nanoNode.type !== "nano_banana") return;
    if(nanoNode.data && nanoNode.data.disabled){
      logLine("WARN", `${nowTime()} Nano Banana Pro is locked. Run Asset Reference analysis first.`);
      return;
    }
    const config = window.__VEO_CONFIG__ || {};
    if(!config.has_api_key){
      logLine("ERROR", `${nowTime()} Missing API key. Set GEMINI_API_KEY in access.env.`);
      return;
    }
    setNodes(nds => nds.map(n => n.id === nodeId ? Object.assign({}, n, { data: Object.assign({}, n.data, { generation_status:"running", generation_error:null }) }) : n));
    try{
      const images = await collectNanoBananaInputs(nanoNode);
      const prompt = buildNanoBananaPrompt(nanoNode, images);
      logLine("INFO", `${nowTime()} Submitting Nano Banana Pro generation with ${images.length} image input(s)...`);
      const response = await proxyJson("/api/gemini/image", {
        model: (config.gemini_models && config.gemini_models.image) || "gemini-3-pro-image",
        prompt,
        images,
        resolution: nanoNode.data && nanoNode.data.res,
        aspect_ratio: nanoNode.data && nanoNode.data.aspect
      });
      if(!response.image_data_url) throw new Error("No image returned.");
      setNodes(nds => nds.map(n => n.id === nodeId ? Object.assign({}, n, {
        data: Object.assign({}, n.data, {
          result_data_url: response.image_data_url,
          result_uri: response.image_data_url,
          result_text: response.text || "",
          result_model: response.model || "Nano Banana Pro",
          generation_status:"idle",
          generation_error:null,
          last_generated_at: new Date().toISOString(),
          last_inputs_used: response.inputs_used
        })
      }) : n));
      setSelectedIds([nodeId]);
      logLine("INFO", `${nowTime()} Nano Banana Pro image generated via ${response.model || "Gemini"}.`);
    }catch(err){
      setNodes(nds => nds.map(n => n.id === nodeId ? Object.assign({}, n, { data: Object.assign({}, n.data, { generation_status:"error", generation_error:String(err && (err.message||err)) }) }) : n));
      logLine("ERROR", `${nowTime()} Nano Banana Pro failed: ${String(err && (err.message||err))}`);
    }
  }

  React.useEffect(() => {
    function onReferenceUpload(event){
      const detail = event && event.detail;
      if(detail && detail.nodeId && detail.file) onRefImageChange(detail.file, detail.nodeId);
    }
    function onReferenceAnalyze(event){
      const nodeId = event && event.detail && event.detail.nodeId;
      if(nodeId) runRefAnalysis(nodeId);
    }
    function onNanoGenerate(event){
      const nodeId = event && event.detail && event.detail.nodeId;
      if(nodeId) runNanoBananaGeneration(nodeId);
    }
    window.addEventListener("stage:upload-reference", onReferenceUpload);
    window.addEventListener("stage:analyze-reference", onReferenceAnalyze);
    window.addEventListener("stage:nano-generate", onNanoGenerate);
    return () => {
      window.removeEventListener("stage:upload-reference", onReferenceUpload);
      window.removeEventListener("stage:analyze-reference", onReferenceAnalyze);
      window.removeEventListener("stage:nano-generate", onNanoGenerate);
    };
  }, [nodes, edges, selectedPrimary]);

  const liveFeed = React.useMemo(() => {
    const payload = compilePayloadMultiClip({ quiet: true });
    return payload ? { subtitle: payload.ready ? `${payload.clips.length} compiled clip(s)` : "Gateway locked", payload } : null;
  }, [nodes, edges, modelProps, caps, creditsAndCost]);

  const selectedAnalysis = selectedPrimary && selectedPrimary.type === "ref" ? (selectedPrimary.data && selectedPrimary.data.analysis) : null;
  const showingAnalysisJson = !!(selectedPrimary && selectedPrimary.type === "ref" && selectedAnalysis);
  const selectedNodeJson = React.useMemo(() => {
    if(!selectedPrimary || showingAnalysisJson) return null;
    if(selectedPrimary.type === "model" || selectedPrimary.type === "omni_model"){
      const payload = compilePayloadMultiClip({ quiet: true, targetModel: selectedPrimary });
      if(!payload){
        return {
          feed_type: "generator_api_payload",
          status: "compile_failed",
          ready: false,
          generator: {
            node_id: selectedPrimary.id,
            node_type: selectedPrimary.type,
            title: (selectedPrimary.data && selectedPrimary.data.title) || selectedPrimary.type,
            model: selectedPrimary.data && selectedPrimary.data.model_ver
          },
          reason: "The graph could not be normalized into a generator payload."
        };
      }
      return selectedGeneratorApiJson(selectedPrimary, payload);
    }
    if(selectedPrimary.type === "nano_banana"){
      return selectedNanoBananaApiJson(selectedPrimary);
    }
    const incoming = edges.filter(edge => edge.target === selectedPrimary.id);
    const outgoing = edges.filter(edge => edge.source === selectedPrimary.id);
    return {
      node_id: selectedPrimary.id,
      type: selectedPrimary.type,
      position: selectedPrimary.position || null,
      data: selectedPrimary.data || {},
      connections: {
        inputs: incoming.map(edge => ({
          edge_id: edge.id,
          source: edge.source,
          source_handle: edge.sourceHandle || null,
          target_handle: edge.targetHandle || null
        })),
        outputs: outgoing.map(edge => ({
          edge_id: edge.id,
          target: edge.target,
          source_handle: edge.sourceHandle || null,
          target_handle: edge.targetHandle || null
        }))
      }
    };
  }, [selectedPrimary, nodes, edges, showingAnalysisJson, modelProps, caps, creditsAndCost, referenceGateReady]);
  const analysisDraftKey = showingAnalysisJson ? `${selectedPrimary.id}:${selectedAnalysis.analyzed_at || selectedPrimary.data.analysis_status || "analysis"}` : "";
  const [analysisJsonDraft, setAnalysisJsonDraft] = React.useState("");
  const [analysisJsonError, setAnalysisJsonError] = React.useState("");

  React.useEffect(() => {
    if(showingAnalysisJson){
      setAnalysisJsonDraft(JSON.stringify(selectedAnalysis, null, 2));
      setAnalysisJsonError("");
    } else {
      setAnalysisJsonDraft("");
      setAnalysisJsonError("");
    }
  }, [analysisDraftKey, showingAnalysisJson]);

  function onAnalysisJsonEdit(value){
    if(!selectedPrimary || selectedPrimary.type !== "ref") return;
    setAnalysisJsonDraft(value);
    try{
      const parsed = JSON.parse(value);
      setAnalysisJsonError("");
      if(isAnalysisActivated(parsed)){
        applyReferenceAnalysis(selectedPrimary.id, parsed, { quiet:true });
      } else {
        setReferenceGatePending(selectedPrimary.id, { analysis:parsed, analysis_status:"pending" });
      }
    }catch(err){
      setAnalysisJsonError(String(err && err.message || err));
    }
  }

  function connectedInputsForModelNode(targetModel){
    if(!targetModel) return [];
    const order = targetModel.type === "omni_model"
      ? ["params"].concat(omniInputHandles)
      : ["params", "start", "end", "asset1", "asset2", "style"];
    return edges
      .filter(edge => edge.target === targetModel.id)
      .slice()
      .sort((a, b) => order.indexOf(String(a.targetHandle || "")) - order.indexOf(String(b.targetHandle || "")))
      .map(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const sourceData = (source && source.data) || {};
        const handle = String(edge.targetHandle || "");
        const role = targetModel.type === "omni_model"
          ? (handle === "params" ? "parameter" : (omniPhotoHandles.has(handle) ? "photo_reference" : handle))
          : (handle === "params" ? "parameter" : handle);
        const descriptionRole = targetModel.type === "omni_model"
          ? (role === "photo_reference" ? "asset" : "style")
          : (role === "style" ? "style" : "asset");
        return {
          handle,
          role,
          source_node_id: edge.source,
          source_type: source ? source.type : "unknown",
          gcs_uri: sourceData.gcs_uri || sourceData.output_last_frame_uri || sourceData.result_uri || null,
          mime_type: sourceData.mime_type || (role === "video" ? "video/mp4" : (role === "audio" ? "audio/mpeg" : "image/jpeg")),
          param_key: source && source.type === "param" ? sourceData.param_key || null : null,
          param_value: source && source.type === "param" ? sourceData.param_val : undefined,
          param_values: source && source.type === "param" ? (sourceData.param_key === "lens" ? lensParamValues(sourceData) : sourceData.param_values || null) : null,
          title: sourceData.title || sourceData.clip_name || (source ? source.type : edge.source),
          description: source && source.type === "param"
            ? (sourceData.param_key === "lens"
              ? `lens=${lensParamValues(sourceData).focal_length}, ${lensParamValues(sourceData).aperture}, ${lensParamValues(sourceData).lens_effect}, ${lensParamValues(sourceData).shutter_effect}`
              : `${sourceData.param_key || "param"}=${sourceData.param_val}`)
            : source && source.type === "ref" && isAnalysisActivated(sourceData.analysis)
            ? referenceDescriptionFor(sourceData.analysis, descriptionRole)
            : (sourceData.cascade_prompt || sourceData.prompt || sourceData.subtitle || "")
        };
      });
  }

  function mediaReferenceForInput(input){
    if(!input || !input.gcs_uri) return null;
    return {
      source_node_id: input.source_node_id,
      source_type: input.source_type,
      handle: input.handle,
      role: input.role,
      gcs_uri: input.gcs_uri,
      mime_type: input.mime_type || "image/jpeg",
      description: input.description || input.title || ""
    };
  }

  function uniqueMediaReferences(refs){
    const seen = new Set();
    const out = [];
    for(const ref of refs || []){
      if(!ref) continue;
      const key = `${ref.gcs_uri || ref.source_node_id}:${ref.role || ref.reference_type || ""}:${ref.handle || ""}`;
      if(seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
    return out;
  }

  function usablePayloadForModelInput(input){
    const source = nodes.find(n => n.id === input.source_node_id);
    const data = (source && source.data) || {};
    if(input.role === "parameter" || (source && source.type === "param")){
      return {
        kind: "parameter",
        title: input.title || parameterTitleForKey(input.param_key),
        values: input.param_values || (input.param_key ? { [input.param_key]: input.param_value } : {}),
        prompt_fragment: input.description || null
      };
    }
    if(source && source.type === "ref"){
      const analysis = isAnalysisActivated(data.analysis) ? data.analysis : null;
      return {
        kind: "asset_reference",
        status: analysis ? "analyzed" : "pending_analysis",
        media: mediaReferenceForInput(input),
        description: input.description || null,
        identity_profile: analysis ? (analysis.identity_profile || null) : null,
        cascade_prompt_prefix: analysis && analysis.cascade ? analysis.cascade.prompt_prefix || null : null,
        validation_rules: analysis ? analysis.validation_rules || null : null
      };
    }
    if(source && source.type === "nano_banana"){
      return {
        kind: "generated_image_reference",
        media: mediaReferenceForInput(input),
        prompt: data.prompt || null,
        result_text: data.result_text || null,
        generated_at: data.last_generated_at || null
      };
    }
    return {
      kind: source ? source.type : "unknown",
      media: mediaReferenceForInput(input),
      title: input.title || (source ? source.type : input.source_node_id),
      prompt: data.prompt || data.cascade_prompt || input.description || null,
      output_uri: data.output_last_frame_uri || data.result_uri || null
    };
  }

  function cascadeInputsForGeneratorPayload(payload){
    const inputs = payload.output_model_inputs || [];
    const clips = payload.clips || [];
    const clipReferenceImages = uniqueMediaReferences(clips.flatMap(clip => ((clip.ingredients && clip.ingredients.reference_images) || []).map(ref => ({
      source_node_id: payload.gateway && payload.gateway.asset_reference_node_id,
      source_type: "asset_reference",
      role: ref.reference_type || "asset",
      reference_type: ref.reference_type || "asset",
      gcs_uri: ref.gcs_uri,
      mime_type: ref.mime_type || "image/jpeg",
      description: ref.description || ""
    }))));
    const directMedia = uniqueMediaReferences(inputs.map(mediaReferenceForInput).filter(Boolean));
    return {
      effective_settings: payload.effective_model_settings || {},
      gateway: payload.gateway || null,
      direct_model_inputs: inputs.map(input => ({
        handle: input.handle,
        role: input.role,
        source_node_id: input.source_node_id,
        source_type: input.source_type,
        usable_payload: usablePayloadForModelInput(input)
      })),
      media: {
        direct_inputs: directMedia,
        reference_images: clipReferenceImages,
        first_frame: clips[0] && clips[0].ingredients ? clips[0].ingredients.first_frame || null : null
      },
      prompt_blocks: clips.map(clip => ({
        clip_name: clip.clip_name,
        prompt: clip.prompt || "",
        blocks: (clip.compiled_blocks || []).map(block => ({
          source_node_id: block.node_id,
          type: block.type,
          prompt: block.prompt,
          settings: {
            batch: block.batch,
            resolution: block.resolution,
            aspect_ratio: block.aspect_ratio,
            focal_length: block.focal_length,
            aperture: block.aperture,
            lens_effect: block.lens_effect,
            shutter_effect: block.shutter_effect
          },
          validation_warnings: block.validation_warnings || []
        }))
      }))
    };
  }

  function compactCreditsEstimate(credits){
    if(!credits) return null;
    return {
      basis: credits.basis,
      model: credits.model,
      ready: credits.ready,
      sections: credits.sections || {},
      total_credits: credits.total_credits,
      currency: credits.currency,
      total_local: credits.total_local,
      warnings: credits.warnings || []
    };
  }

  function selectedGeneratorApiJson(modelNode, payload){
    const isOmni = payload.model_family === "gemini_omni";
    const generator = {
      node_id: modelNode.id,
      node_type: modelNode.type,
      title: (modelNode.data && modelNode.data.title) || (isOmni ? "GOOGLE OMNI" : "VEO"),
      provider: isOmni ? "google_gemini" : "vertex_ai",
      model_family: payload.model_family,
      model_label: modelNode.data && modelNode.data.model_ver,
      model_id: payload.model_id,
      ready: payload.ready
    };
    const common = {
      feed_type: "generator_api_payload",
      ready: payload.ready,
      generator,
      cascade_inputs: cascadeInputsForGeneratorPayload(payload),
      warnings: payload.warnings || [],
      credits_estimate: compactCreditsEstimate(payload.credits_estimate)
    };
    if(isOmni){
      return Object.assign(common, {
        model_contract: {
          accepts_text: true,
          accepts_photo_references: true,
          accepts_video: true,
          accepts_audio: true,
          multi_turn_editing: true,
          explicit_start_end_frames: false,
          max_photo_references: payload.model_capabilities && payload.model_capabilities.max_photo_references,
          max_seconds: payload.model_capabilities && payload.model_capabilities.max_seconds,
          note: "Omni is treated as an any-input prompt contract; hard Veo start/end-frame fields are not promoted into its API request."
        },
        api_payload: {
          api_family: "gemini_omni",
          submit_status: "awaiting_public_submit_route",
          request_shape: "any_input_video_prompt_json",
          requests: (payload.clips || []).map(clip => ({
            clip_name: clip.clip_name,
            request_body: clip.omni_prompt_json || null
          }))
        }
      });
    }
    return Object.assign(common, {
      model_contract: {
        accepts_text: true,
        accepts_start_frame: true,
        accepts_end_frame_with_start_frame: true,
        accepts_reference_images: true,
        reference_style_supported: false,
        supported_durations_seconds: [4, 6, 8],
        reference_image_duration_seconds: 8,
        supported_fps: [24],
        max_reference_images: payload.model_capabilities && payload.model_capabilities.max_reference_images,
        submit_route: payload.api_compatibility && payload.api_compatibility.submit_route
      },
      api_payload: {
        api_family: "vertex_ai_veo",
        submit_route: payload.api_compatibility && payload.api_compatibility.submit_route,
        request_shape: "instances[] + parameters",
        requests: (payload.clips || []).map(clip => {
          const vertex = clip.vertex_request_preview || {};
          return {
            clip_name: clip.clip_name,
            model: vertex.model || payload.model_id,
            request_body: {
              instances: vertex.instances || [],
              parameters: vertex.parameters || {}
            },
            structured_prompt_json: clip.veo_prompt_json || null
          };
        })
      }
    });
  }

  function nanoBananaInputPreview(nanoNode){
    const slots = (nanoNode.data && nanoNode.data.slots) || Array(14).fill(null);
    const images = [];
    for(let i = 0; i < 14; i += 1){
      const handleId = `in_${i}`;
      const edge = edges.find(e => e.target === nanoNode.id && String(e.targetHandle || "") === handleId);
      const role = i < 6 ? "high_fidelity" : "supplementary";
      if(edge){
        const source = nodes.find(n => n.id === edge.source);
        const data = (source && source.data) || {};
        const label = `${data.title || (source && source.type) || edge.source} -> slot ${i + 1}`;
        images.push({
          slot: i + 1,
          handle: handleId,
          role,
          label,
          source_node_id: edge.source,
          source_type: source ? source.type : "unknown",
          media: {
            gcs_uri: data.gcs_uri || data.result_uri || data.output_last_frame_uri || null,
            mime_type: data.mime_type || "image/jpeg",
            has_inline_image: !!(data.image_data_url || data.result_data_url || data.image_store_key)
          },
          usable_payload: source && source.type === "ref" && isAnalysisActivated(data.analysis) ? {
            kind: "asset_reference",
            description: referenceDescriptionFor(data.analysis, "asset"),
            identity_profile: data.analysis.identity_profile || null,
            cascade_prompt_prefix: data.analysis.cascade ? data.analysis.cascade.prompt_prefix || null : null
          } : {
            kind: source ? source.type : "unknown",
            prompt: data.prompt || data.cascade_prompt || null,
            result_text: data.result_text || null
          }
        });
      } else if(slots[i]){
        images.push({
          slot: i + 1,
          handle: handleId,
          role,
          label: `Manual slot ${i + 1}`,
          source_node_id: null,
          source_type: "manual_upload",
          media: {
            gcs_uri: null,
            mime_type: "image/jpeg",
            has_inline_image: true
          },
          usable_payload: {
            kind: "manual_image_reference"
          }
        });
      }
    }
    return images;
  }

  function selectedNanoBananaApiJson(nanoNode){
    const images = nanoBananaInputPreview(nanoNode);
    const prompt = buildNanoBananaPrompt(nanoNode, images);
    const config = typeof window !== "undefined" ? window.__VEO_CONFIG__ || {} : {};
    const model = (config.gemini_models && config.gemini_models.image) || "gemini-3-pro-image";
    const ready = !(nanoNode.data && nanoNode.data.disabled);
    return {
      feed_type: "generator_api_payload",
      ready,
      generator: {
        node_id: nanoNode.id,
        node_type: nanoNode.type,
        title: (nanoNode.data && nanoNode.data.title) || "Nano Banana Pro",
        provider: "google_gemini",
        model_family: "nano_banana",
        model_label: "Nano Banana Pro",
        model_id: model,
        ready
      },
      model_contract: {
        accepts_text: true,
        accepts_image_inputs: true,
        max_image_inputs: 14,
        high_fidelity_slots: "1-6",
        supplementary_slots: "7-14",
        output: "still_image"
      },
      cascade_inputs: {
        effective_settings: {
          resolution: (nanoNode.data && nanoNode.data.res) || "HD",
          aspect_ratio: (nanoNode.data && nanoNode.data.aspect) || "16:9"
        },
        direct_model_inputs: images.map(image => ({
          handle: image.handle,
          role: image.role,
          source_node_id: image.source_node_id,
          source_type: image.source_type,
          usable_payload: image.usable_payload
        })),
        media: {
          image_inputs: images.map(image => ({
            slot: image.slot,
            role: image.role,
            label: image.label,
            media: image.media
          }))
        }
      },
      api_payload: {
        api_family: "gemini_image",
        submit_route: "/api/gemini/image",
        request_shape: "generateContent text + up to 14 image parts",
        request_body: {
          model,
          prompt,
          images: images.map(image => ({
            slot: image.slot,
            label: image.label,
            role: image.role,
            source_node_id: image.source_node_id,
            source_type: image.source_type,
            media: image.media
          })),
          resolution: nanoNode.data && nanoNode.data.res,
          aspect_ratio: nanoNode.data && nanoNode.data.aspect
        }
      },
      warnings: ready ? [] : ["Asset Reference gateway is locked. Run Analysis before using this generator."]
    };
  }

  function timecodeRange(index, total, seconds){
    const count = Math.max(1, total || 1);
    const start = Math.floor((seconds * index) / count);
    const end = Math.min(seconds, Math.ceil((seconds * (index + 1)) / count));
    const fmt = (value) => "00:" + String(Math.max(0, value)).padStart(2, "0");
    return `${fmt(start)} - ${fmt(end)}`;
  }

  function modelOpticsPromptFromConfig(config){
    if(!config) return "";
    return [
      config.aspect_ratio ? `Aspect ratio ${config.aspect_ratio}.` : "",
      config.focal_length && config.focal_length !== "As it comes" ? `Focal length ${config.focal_length}.` : "",
      config.aperture && config.aperture !== "As it comes" ? `Aperture ${config.aperture}.` : "",
      config.lens_effect && config.lens_effect !== "None" ? `Lens effect: ${config.lens_effect}.` : "",
      config.shutter_effect && config.shutter_effect !== "Natural Motion Blur" ? `Shutter effect: ${config.shutter_effect}.` : ""
    ].filter(Boolean).join(" ");
  }

  function omniPromptJsonForClip(clip, blocks, modelInputs, modelContext){
    const ctxProps = (modelContext && modelContext.modelProps) || modelProps;
    const ctxCaps = (modelContext && modelContext.caps) || caps;
    const seconds = Number((clip && clip.generation_config && clip.generation_config.seconds) || ctxProps.length_seconds || 10);
    const resolution = String((clip && clip.generation_config && clip.generation_config.resolution) || ctxProps.resolution || "4K").toLowerCase();
    const fps = Number((clip && clip.generation_config && clip.generation_config.fps) || ctxProps.fps || 24);
    const batch = normalizeModelBatch((clip && clip.generation_config && clip.generation_config.batch) || ctxProps.batch, "omni_model");
    const actions = blocks.length ? blocks : [{ type:"prompt", prompt: clip.prompt || "Generate a cohesive Gemini Omni video from the connected multimodal inputs." }];
    return {
      generation_config: {
        engine: "gemini-omni",
        model: ctxProps.model_ver || "Gemini Omni Flash",
        editing_layer: ctxProps.editing_layer || "nano-banana-pro",
        length_seconds: seconds,
        resolution,
        fps,
        batch,
        native_audio: !!(ctxProps.audio_enabled && ctxCaps.supports_audio)
      },
      cinematography: {
        camera_directions: "Derived from connected Cinematography parameter nodes, prompts, and reference media.",
        aspect_ratio: (clip && clip.generation_config && clip.generation_config.aspect_ratio) || ctxProps.aspect || "16:9",
        focal_length: (clip && clip.generation_config && clip.generation_config.focal_length) || ctxProps.focal_length || "As it comes",
        aperture: (clip && clip.generation_config && clip.generation_config.aperture) || ctxProps.aperture || "As it comes",
        lens_effect: (clip && clip.generation_config && clip.generation_config.lens_effect) || ctxProps.lens_effect || "None",
        shutter_effect: (clip && clip.generation_config && clip.generation_config.shutter_effect) || ctxProps.shutter_effect || "Natural Motion Blur",
        note: "Use video/photo references for motion, framing, and style continuity."
      },
      art_direction: {
        style: "Derived from connected Asset Reference, Nano Banana, and department nodes."
      },
      characters: modelInputs.filter(input => ["photo_reference", "video"].includes(input.role)).map(input => ({
        id: input.source_node_id,
        description: input.description || input.title,
        starting_position: input.handle
      })),
      action_blocking: actions.map((block, index) => ({
        timecode: timecodeRange(index, actions.length, seconds),
        action: block.prompt || block.user_prompt || block.type || "Continue the prior action coherently."
      })),
      input_contract: {
        text: true,
        photo_references_max: ctxCaps.max_reference_images || 5,
        video_input: true,
        audio_input: true,
        explicit_start_end_frames: false,
        note: "Official Gemini Omni materials describe photo/video/audio references and video editing, not a Veo-style hard start/end-frame contract."
      }
    };
  }

  function veoVertexModelName(modelId){
    const value = String(modelId || "");
    if(value === "veo-3.1-fast" || value === "veo-3.1-fast-generate-preview" || value === "veo-3.1-fast-generate-001"){
      return "veo-3.1-fast-generate-001";
    }
    if(value === "veo-3.1-quality" || value === "veo-3.1-generate-preview" || value === "veo-3.1-generate-001"){
      return "veo-3.1-generate-001";
    }
    return value || "veo-3.1-generate-001";
  }

  function isVeo31ModelName(modelId){
    return String(modelId || "").startsWith("veo-3.1");
  }

  function normalizeVeoDurationSeconds(value, hasReferenceImages){
    if(hasReferenceImages) return 8;
    const allowed = [4, 6, 8];
    const n = Number(value || 8);
    return allowed.reduce((best, curr) => {
      const bestDiff = Math.abs(best - n);
      const currDiff = Math.abs(curr - n);
      return currDiff < bestDiff || (currDiff === bestDiff && curr > best) ? curr : best;
    }, 8);
  }

  function normalizeVeoAspectRatio(value){
    return String(value || "16:9") === "9:16" ? "9:16" : "16:9";
  }

  function imageInputFromModelInputs(modelInputs, handle){
    const input = (modelInputs || []).find(item => item.handle === handle && item.gcs_uri);
    if(!input) return null;
    return { gcsUri: input.gcs_uri, mimeType: input.mime_type || "image/jpeg" };
  }

  function veoReferenceImagesForVertex(referenceImages, modelId){
    const out = [];
    for(const ref of referenceImages || []){
      if(!ref || !ref.gcs_uri) continue;
      const referenceType = String(ref.reference_type || "asset") === "style" ? "style" : "asset";
      if(isVeo31ModelName(modelId) && referenceType === "style") continue;
      out.push({
        referenceType,
        image: { gcsUri: ref.gcs_uri, mimeType: ref.mime_type || "image/jpeg" },
        description: ref.description || ""
      });
      if(out.length >= 3) break;
    }
    return out;
  }

  function veoVertexRequestPreview(clip, modelId){
    const vertexModel = veoVertexModelName(modelId);
    const blocks = (clip && clip.compiled_blocks) || [];
    const firstBlock = blocks[0] || {};
    const modelInputs = (clip && clip.ingredients && clip.ingredients.model_inputs) || [];
    const startImage = imageInputFromModelInputs(modelInputs, "start");
    const endImage = startImage ? imageInputFromModelInputs(modelInputs, "end") : null;
    const referenceImages = startImage ? [] : veoReferenceImagesForVertex(clip && clip.ingredients && clip.ingredients.reference_images, vertexModel);
    const hasReferenceImages = referenceImages.length > 0;
    const seconds = normalizeVeoDurationSeconds(clip && clip.generation_config && clip.generation_config.seconds, hasReferenceImages);
    const requestedFps = clip && clip.generation_config && clip.generation_config.fps;
    const fps = normalizeVeoFps(requestedFps);
    const sampleCount = normalizeVeoSampleCount(clip && clip.generation_config && clip.generation_config.batch);
    const resolution = normalizeVeoResolution(clip && clip.generation_config && clip.generation_config.resolution);
    const task = startImage ? "imageToVideo" : (hasReferenceImages ? "referenceToVideo" : "textToVideo");
    const instance = { prompt: (clip && clip.prompt) || "A cinematic shot." };
    if(startImage){
      instance.image = startImage;
      if(endImage) instance.lastFrame = endImage;
    } else if(hasReferenceImages){
      instance.referenceImages = referenceImages.map(ref => ({
        referenceType: ref.referenceType,
        image: ref.image
      }));
    }
    return {
      model: vertexModel,
      instances: [instance],
      parameters: {
        task,
        sampleCount,
        durationSeconds: seconds,
        aspectRatio: normalizeVeoAspectRatio((clip && clip.generation_config && clip.generation_config.aspect_ratio) || firstBlock.aspect_ratio),
        fps,
        resolution,
        generateAudio: !!(clip && clip.generation_config && clip.generation_config.audio_enabled),
        enhancePrompt: true,
        compressionQuality: "optimized",
        personGeneration: "allow_adult",
        resizeMode: "pad"
      }
    };
  }

  function veoPromptJsonForClip(clip, blocks, modelInputs, vertexRequest, modelContext){
    const ctxCaps = (modelContext && modelContext.caps) || caps;
    const params = (vertexRequest && vertexRequest.parameters) || {};
    const instance = (vertexRequest && vertexRequest.instances && vertexRequest.instances[0]) || {};
    const seconds = Number(params.durationSeconds || 8);
    const actions = blocks.length ? blocks : [{ type:"prompt", prompt: (clip && clip.prompt) || "Generate a cohesive Veo clip from the connected text and image inputs." }];
    const references = (clip && clip.ingredients && clip.ingredients.reference_images) || [];
    return {
      generation_config: {
        engine: "veo",
        provider: "vertex_ai",
        model: vertexRequest ? vertexRequest.model : veoVertexModelName(ctxCaps.id),
        task: params.task || "textToVideo",
        sample_count: params.sampleCount || 1,
        duration_seconds: seconds,
        resolution: params.resolution || "1080p",
        aspect_ratio: params.aspectRatio || "16:9",
        fps: params.fps || 24,
        requested_fps: clip && clip.generation_config ? clip.generation_config.fps || null : null,
        audio_enabled: !!params.generateAudio,
        enhance_prompt: params.enhancePrompt !== false,
        compression_quality: params.compressionQuality || "optimized",
        person_generation: params.personGeneration || "allow_adult",
        resize_mode: params.resizeMode || "pad"
      },
      cinematography: {
        camera_directions: "Derived from connected Cinematography parameter nodes, prompt blocks, and frame/reference inputs.",
        focal_length: clip && clip.generation_config ? clip.generation_config.focal_length || "As it comes" : "As it comes",
        aperture: clip && clip.generation_config ? clip.generation_config.aperture || "As it comes" : "As it comes",
        lens_effect: clip && clip.generation_config ? clip.generation_config.lens_effect || "None" : "None",
        shutter_effect: clip && clip.generation_config ? clip.generation_config.shutter_effect || "Natural Motion Blur" : "Natural Motion Blur",
        first_frame: instance.image ? instance.image.gcsUri : ((clip && clip.ingredients && clip.ingredients.first_frame) || null),
        last_frame: instance.lastFrame ? instance.lastFrame.gcsUri : null
      },
      art_direction: {
        style: "Derived from Asset Reference analysis, style prompts, and downstream generator prompts.",
        omitted_style_references: references.filter(ref => String(ref.reference_type || "") === "style").map(ref => ({
          gcs_uri: ref.gcs_uri,
          reason: "Veo 3.1 does not accept referenceImages.style; keep style as prompt text instead."
        }))
      },
      characters: (modelInputs || []).filter(input => ["asset1", "asset2", "start", "end"].includes(input.role) || input.source_type === "ref").map(input => ({
        id: input.source_node_id,
        role: input.role,
        description: input.description || input.title,
        gcs_uri: input.gcs_uri || null
      })),
      action_blocking: actions.map((block, index) => ({
        timecode: timecodeRange(index, actions.length, seconds),
        action: block.prompt || block.user_prompt || block.type || "Continue the prior action coherently."
      })),
      input_contract: {
        text: true,
        image_input: !!instance.image,
        last_frame: !!instance.lastFrame,
        reference_images: instance.referenceImages || [],
        reference_images_max: 3,
        reference_style_supported: false,
        duration_allowed_seconds: instance.referenceImages ? [8] : [4, 6, 8],
        note: "This object mirrors the richer Omni prompt JSON, while vertex_request_preview mirrors the strict Vertex request body."
      },
      vertex_request_preview: vertexRequest || null
    };
  }

  function compilePayloadMultiClip(options){
    const quiet = !!(options && options.quiet);
    const targetModelNode = (options && options.targetModel) || modelNode;
    const targetModelProps = (targetModelNode && targetModelNode.data) || defaultPropsFor("model");
    const targetCaps = MODEL_CATALOG[targetModelProps.model_ver] || MODEL_CATALOG["Veo 3.1 Quality"];
    const refNode = nodes.find(n => n.type === "ref") || null;
    const refAnalysis = refNode && isAnalysisActivated(refNode.data && refNode.data.analysis) ? refNode.data.analysis : null;
    const gateBlocked = !!(refNode && !refAnalysis);
    const modelId = targetCaps.id;
    const isOmniModel = !!(targetModelNode && targetModelNode.type === "omni_model");
    const modelInputs = connectedInputsForModelNode(targetModelNode);
    const secondsDefault = Math.max(1, Math.min(targetCaps.max_seconds || 30, Number(isOmniModel ? (targetModelProps.length_seconds || 10) : (targetModelProps.seconds_per_clip || 8))));
    const modelBatchDefault = normalizeModelBatch(targetModelProps.batch, isOmniModel ? "omni_model" : "model");
    const modelResolutionDefault = isOmniModel ? normalizeOmniResolution(targetModelProps.resolution || "4K") : normalizeVeoResolution(targetModelProps.resolution || "1080p");
    const modelFpsDefault = isOmniModel ? clampInt(targetModelProps.fps, 12, 60, 24) : clampInt(targetModelProps.fps, 1, 120, 24);
    const modelAspectDefault = normalizeModelAspect(targetModelProps.aspect || "16:9");
    const modelFocalDefault = String(targetModelProps.focal_length || "As it comes");
    const modelApertureDefault = String(targetModelProps.aperture || "As it comes");
    const modelLensEffectDefault = String(targetModelProps.lens_effect || "None");
    const modelShutterEffectDefault = String(targetModelProps.shutter_effect || "Natural Motion Blur");
    const audio_enabled = !!(targetModelProps.audio_enabled && targetCaps.supports_audio);
    const targetCreditsAndCost = estimateGraphCredits(nodes, edges, targetModelProps, targetCaps, referenceGateReady);
    let reference_images = [];
    let identity_first_frame = null;
    const payloadWarnings = [];
    if(gateBlocked){
      payloadWarnings.push("Asset Reference gateway is locked. Run Analysis to activate downstream generator nodes.");
      if(!quiet) logLine("WARN", `${nowTime()} Compile blocked: run Asset Reference analysis first.`);
    }
    if(refNode && refAnalysis){
      const uri = (refNode.data && refNode.data.gcs_uri) || "gs://your-bucket/character_master.jpg";
      const mode = (refNode.data && refNode.data.reference_mode) || "double_stacked";
      if(mode === "double_stacked"){
        reference_images.push({ gcs_uri: uri, reference_type:"asset", description:referenceDescriptionFor(refAnalysis, "asset") });
        reference_images.push({ gcs_uri: uri, reference_type:"style", description:referenceDescriptionFor(refAnalysis, "style") });
      } else {
        reference_images.push({ gcs_uri: uri, reference_type:"asset", description:referenceDescriptionFor(refAnalysis, "asset") });
      }
      identity_first_frame = uri;
    } else if(!refNode) {
      if(!quiet) logLine("WARN", `${nowTime()} No Asset Reference node. Identity lock may drift.`);
    }
    if(reference_images.length > targetCaps.max_reference_images){
      if(!quiet) logLine("ERROR", `${nowTime()} Compile failed: refs=${reference_images.length} exceeds model max=${targetCaps.max_reference_images}.`);
      return null;
    }
    const clips = nodes.filter(n => n.type === "clip").slice().sort((a,b) => Number((a.data && a.data.clip_index) || 0) - Number((b.data && b.data.clip_index) || 0));
    const hasClips = clips.length > 0;
    function generatorsForClip(clipId){
      const children = nodes.filter(n => n.parentNode === clipId);
      const gens = gateBlocked ? [] : children.filter(n => isGeneratorType(n.type) && !(n.data && n.data.disabled));
      const order = ["face","body","clothing","pose"];
      gens.sort((a,b)=> order.indexOf(a.type) - order.indexOf(b.type));
      return gens;
    }
    function generatorsUngrouped(){
      const gens = gateBlocked ? [] : nodes.filter(n => isGeneratorType(n.type) && !n.parentNode && !(n.data && n.data.disabled));
      const order = ["face","body","clothing","pose"];
      gens.sort((a,b)=> order.indexOf(a.type) - order.indexOf(b.type));
      return gens;
    }
    const compiledClips = [];
    let prevClip = null;
    const clipList = hasClips ? clips : [{ id: "VIRTUAL_CLIP_1", type: "clip", data: { clip_name: "CLIP_1", clip_index: 1, seconds: secondsDefault, autochain_to_next_clip: true, output_last_frame_uri: "gs://your-bucket/renders/CLIP_1_LAST_FRAME.png" } }];
    for(const c of clipList){
      const clipName = (c.data && c.data.clip_name) || "CLIP";
      const clipSeconds = Number((c.data && c.data.seconds) || secondsDefault);
      const autochain = !!(c.data && c.data.autochain_to_next_clip);
      const first_frame = (!prevClip) ? identity_first_frame : (prevClip.autochain_to_next_clip ? prevClip.output_last_frame_uri : identity_first_frame);
      const gens = hasClips ? generatorsForClip(c.id) : generatorsUngrouped();
      const blocks = [];
      const promptParts = [];
      for(const g of gens){
        const ov = incomingParams(g.id, nodes, edges);
        const batch = Number((ov.batch !== undefined ? ov.batch : (g.data && g.data.batch)) || 1);
        const res = String((ov.res !== undefined ? ov.res : (g.data && g.data.res)) || "HD");
        const aspect = String((ov.aspect !== undefined ? ov.aspect : (g.data && g.data.aspect)) || "16:9");
        const focal = String((ov.focal_length !== undefined ? ov.focal_length : "As it comes"));
        const aperture = String((ov.aperture !== undefined ? ov.aperture : "As it comes"));
        const lensEffect = String((ov.lens_effect !== undefined ? ov.lens_effect : "None"));
        const shutterEffect = String((ov.shutter_effect !== undefined ? ov.shutter_effect : "Natural Motion Blur"));
        const cascadePrompt = (g.data && g.data.cascade_prompt) || nodeCascadePrompt(refAnalysis, g.type);
        const userPrompt = (g.data && g.data.prompt) || "";
        const opticsPrompt = [
          focal !== "As it comes" ? `Use ${focal} lens perspective.` : "",
          aperture !== "As it comes" ? `Aperture ${aperture}.` : "",
          lensEffect !== "None" ? `Lens effect: ${lensEffect}.` : "",
          shutterEffect !== "Natural Motion Blur" ? `Shutter effect: ${shutterEffect}.` : ""
        ].filter(Boolean).join(" ");
        const finalPrompt = [cascadePrompt, opticsPrompt, userPrompt].filter(Boolean).join(" ");
        const validation_warnings = validationWarningsForPrompt(refAnalysis, finalPrompt);
        payloadWarnings.push(...validation_warnings.map(w => `${g.id}: ${w}`));
        blocks.push({ node_id: g.id, type: g.type, batch, resolution: res, aspect_ratio: aspect, focal_length: focal, aperture, lens_effect:lensEffect, shutter_effect:shutterEffect, prompt: finalPrompt, user_prompt:userPrompt, cascade_prompt:cascadePrompt, analysis_ref_id: refAnalysis ? refNode.id : null, validation_warnings });
        promptParts.push("[" + String(g.type).toUpperCase() + " | batch=" + batch + " | " + res + " | " + aspect + " | focal=" + focal + " | aperture=" + aperture + " | lens_effect=" + lensEffect + " | shutter_effect=" + shutterEffect + "] " + finalPrompt);
      }
      const output_last_frame_uri = (c.data && c.data.output_last_frame_uri) || ("gs://your-bucket/renders/" + clipName + "_LAST_FRAME.png");
      const generation_config = isOmniModel
        ? { method: "omni_any_to_video", engine:"gemini-omni", editing_layer:targetModelProps.editing_layer || "nano-banana-pro", audio_enabled:audio_enabled, seconds:clipSeconds, length_seconds:clipSeconds, resolution:modelResolutionDefault, fps:modelFpsDefault, batch:modelBatchDefault, aspect_ratio:modelAspectDefault, focal_length:modelFocalDefault, aperture:modelApertureDefault, lens_effect:modelLensEffectDefault, shutter_effect:modelShutterEffectDefault, multi_turn_editing:true, explicit_start_end_frames:false }
        : { method: "ingredients_to_video", provider:"vertex_ai", model:veoVertexModelName(modelId), seed: 3003, motion_pacing: "slow", audio_enabled: audio_enabled, seconds: clipSeconds, resolution:modelResolutionDefault, fps:modelFpsDefault, batch:modelBatchDefault, aspect_ratio:modelAspectDefault, focal_length:modelFocalDefault, aperture:modelApertureDefault, lens_effect:modelLensEffectDefault, shutter_effect:modelShutterEffectDefault };
      const clipPrompt = [modelOpticsPromptFromConfig(generation_config), promptParts.join(" ").trim()].filter(Boolean).join(" ");
      const clipPayload = { clip_name: clipName, clip_index: Number((c.data && c.data.clip_index) || 0), generation_config, ingredients: { reference_images: reference_images, first_frame: first_frame, model_inputs: modelInputs }, prompt: clipPrompt, compiled_blocks: blocks, output_last_frame_uri: output_last_frame_uri, autochain_to_next_clip: autochain };
      if(isOmniModel){
        clipPayload.omni_prompt_json = omniPromptJsonForClip(clipPayload, blocks, modelInputs, { modelProps: targetModelProps, caps: targetCaps });
      } else {
        const vertexRequest = veoVertexRequestPreview(clipPayload, modelId);
        const vertexInstance = vertexRequest.instances && vertexRequest.instances[0] ? vertexRequest.instances[0] : {};
        const hasStyleRefs = reference_images.some(ref => String(ref.reference_type || "") === "style");
        const hasExplicitStart = modelInputs.some(input => input.handle === "start" && input.gcs_uri);
        const hasExplicitEnd = modelInputs.some(input => input.handle === "end" && input.gcs_uri);
        if(hasStyleRefs && isVeo31ModelName(vertexRequest.model)){
          payloadWarnings.push(`${clipName}: Veo 3.1 does not accept referenceImages.style, so style refs are kept in prompt JSON but omitted from the Vertex request.`);
        }
        if(Number(vertexRequest.parameters.durationSeconds) !== Number(clipSeconds)){
          payloadWarnings.push(`${clipName}: Veo duration normalized from ${clipSeconds}s to ${vertexRequest.parameters.durationSeconds}s for Vertex compatibility.`);
        }
        if(Number(vertexRequest.parameters.fps) !== Number(generation_config.fps)){
          payloadWarnings.push(`${clipName}: Veo 3.1 currently renders at 24 FPS, so requested ${generation_config.fps} FPS is stored as intent and submitted as ${vertexRequest.parameters.fps} FPS.`);
        }
        if(Number(vertexRequest.parameters.sampleCount) !== Number(generation_config.batch)){
          payloadWarnings.push(`${clipName}: Veo batch normalized from ${generation_config.batch} to ${vertexRequest.parameters.sampleCount} sample(s).`);
        }
        if(hasExplicitEnd && !hasExplicitStart){
          payloadWarnings.push(`${clipName}: End Frame is ignored by Vertex unless Start Frame is also connected.`);
        }
        if(hasExplicitStart && reference_images.length){
          payloadWarnings.push(`${clipName}: Explicit Start/End Frame input takes priority; Vertex request omits referenceImages because image and referenceImages cannot be combined.`);
        }
        clipPayload.vertex_request_preview = vertexRequest;
        clipPayload.veo_prompt_json = veoPromptJsonForClip(clipPayload, blocks, modelInputs, vertexRequest, { modelProps: targetModelProps, caps: targetCaps });
        clipPayload.generation_config.seconds = vertexRequest.parameters.durationSeconds;
        clipPayload.generation_config.sample_count = vertexRequest.parameters.sampleCount;
        clipPayload.generation_config.resolution = vertexRequest.parameters.resolution;
        clipPayload.generation_config.requested_fps = generation_config.fps;
        clipPayload.generation_config.fps = vertexRequest.parameters.fps;
        clipPayload.generation_config.vertex_task = vertexRequest.parameters.task;
        clipPayload.generation_config.reference_images_submitted = Array.isArray(vertexInstance.referenceImages) ? vertexInstance.referenceImages.length : 0;
      }
      compiledClips.push(clipPayload);
      prevClip = { clip_name: clipName, autochain_to_next_clip: autochain, output_last_frame_uri: output_last_frame_uri };
    }
    const payload = {
      model_id: modelId,
      model_family: isOmniModel ? "gemini_omni" : "veo",
      output_model_node_id: targetModelNode ? targetModelNode.id : null,
      output_model_inputs: modelInputs,
      effective_model_settings: {
        seconds: secondsDefault,
        resolution: modelResolutionDefault,
        fps: isOmniModel ? modelFpsDefault : normalizeVeoFps(modelFpsDefault),
        requested_fps: modelFpsDefault,
        batch: modelBatchDefault,
        aspect_ratio: modelAspectDefault,
        focal_length: modelFocalDefault,
        aperture: modelApertureDefault,
        lens_effect: modelLensEffectDefault,
        shutter_effect: modelShutterEffectDefault,
        audio_enabled,
        upstream_parameters: modelInputs.filter(input => input.role === "parameter").map(input => ({
          node_id: input.source_node_id,
          key: input.param_key,
          value: input.param_values || input.param_value
        }))
      },
      api_compatibility: isOmniModel ? {
        provider: "google",
        submit_route: null,
        submit_ready: false,
        request_shape: "omni_prompt_json export only",
        notes: [
          "Gemini Omni is represented as a separate any-input prompt JSON until an official public submit API is wired in.",
          "The local /api/veo/submit route intentionally rejects Omni payloads."
        ]
      } : {
        provider: "vertex_ai",
        submit_route: "/api/veo/submit",
        submit_ready: !gateBlocked,
        request_shape: "instances[] + parameters",
        supported_model_ids: ["veo-3.1-generate-001", "veo-3.1-fast-generate-001"],
        notes: [
          "Veo 3.1 durations are normalized to 4, 6, or 8 seconds.",
          "Reference-image Veo requests are normalized to 8 seconds.",
          "Veo 3.1 style reference images are omitted from vertex_request_preview and preserved as prompt text guidance."
        ]
      },
      model_capabilities: isOmniModel ? {
        max_photo_references: targetCaps.max_reference_images || 5,
        accepts_text: true,
        accepts_images: true,
        accepts_video: true,
        accepts_audio: true,
        native_audio: true,
        multi_turn_editing: true,
        explicit_start_end_frames: false,
        max_seconds: targetCaps.max_seconds || 10,
        max_batch: 8
      } : {
        max_reference_images: targetCaps.max_reference_images,
        supports_audio: targetCaps.supports_audio,
        supported_resolutions: ["720p", "1080p", "4K"],
        supported_fps: [24],
        max_batch: 4
      },
      ready: !gateBlocked,
      gateway: {
        status: refNode ? (refAnalysis ? "active" : "pending_analysis") : "no_asset_reference",
        asset_reference_node_id: refNode ? refNode.id : null,
        activated_at: refAnalysis ? (refAnalysis.analyzed_at || (refNode.data && refNode.data.activated_at) || null) : null
      },
      identity_profile: refAnalysis ? (refAnalysis.identity_profile || null) : null,
      cascade: refAnalysis ? {
        source_ref_id: refNode.id,
        prompt_prefix: refAnalysis.cascade && refAnalysis.cascade.prompt_prefix,
        node_prompts: refAnalysis.cascade && refAnalysis.cascade.node_prompts,
        validation_rules: refAnalysis.validation_rules || null
      } : null,
      warnings: payloadWarnings,
      clips: compiledClips,
      credits_estimate: targetCreditsAndCost
    };
    if(!quiet && !gateBlocked) logLine("INFO", `${nowTime()} Compile OK: built ${compiledClips.length} clip(s).`);
    return payload;
  }

  async function proxyJson(path, body){
    const config = window.__VEO_CONFIG__ || {};
    if(typeof config.proxy_url !== "string" || !config.client_token){
      throw new Error("Local Veo proxy is not configured.");
    }
    const res = await fetch(`${config.proxy_url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Veo-Proxy-Token": config.client_token
      },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let js = {};
    try{ js = text ? JSON.parse(text) : {}; }
    catch(e){ throw new Error(`Proxy returned non-JSON response (${res.status}).`); }
    if(!res.ok || js.error){
      const err = js.error ? (typeof js.error === "string" ? js.error : JSON.stringify(js.error)) : `Proxy request failed (${res.status})`;
      throw new Error(err);
    }
    return js;
  }

  function downloadUrlFor(uri){
    const config = window.__VEO_CONFIG__ || {};
    return `${config.proxy_url}/api/veo/download?token=${encodeURIComponent(config.client_token)}&uri=${encodeURIComponent(uri)}`;
  }

  async function runVeoGeneration(payload){
    const config = window.__VEO_CONFIG__ || {};
    if(!config.has_api_key){
      logLine("ERROR", `${nowTime()} Missing API key. Set GOOGLE_API_KEY in .env`);
      return;
    }
    const clips = (payload && payload.clips) || [];
    if(!clips.length){ logLine("ERROR", `${nowTime()} No clips found in payload.`); return; }

    const maxPollMs = 20 * 60 * 1000;
    for(let i=0; i<clips.length; i++){
      const clip = clips[i];
      const clipName = (clip && clip.clip_name) || `clip_${i+1}`;
      const clipPayload = Object.assign({}, payload, { clips: [clip] });
      logLine("INFO", `${nowTime()} Submitting ${clipName} (${i+1}/${clips.length}) via local proxy...`);

      const submit = await proxyJson("/api/veo/submit", { payload: clipPayload });
      const opName = submit.operation_name;
      if(!opName) throw new Error("No operation name returned.");
      logLine("INFO", `${nowTime()} Operation: ${opName}`);

      const started = Date.now();
      for(;;){
        if(Date.now() - started > maxPollMs){
          throw new Error(`Timed out waiting for ${clipName} after 20 minutes.`);
        }
        await new Promise(r => setTimeout(r, 3000));
        const status = await proxyJson("/api/veo/status", { operation_name: opName });
        if(!status.done) continue;

        const uri = status.video_uri;
        if(!uri){ throw new Error(`${clipName} finished, but no video URI was returned.`); }
        logLine("INFO", `${nowTime()} Video ready for ${clipName}. Starting download.`);

        const a = document.createElement("a");
        a.href = downloadUrlFor(uri);
        a.download = `${clipName}.mp4`.replace(/[^a-z0-9_.-]+/gi, "_");
        document.body.appendChild(a);
        a.click();
        a.remove();
        break;
      }
    }
  }

  function runMenuAction(fn){
    setOpenMenu(null);
    try{
      const result = fn && fn();
      if(result && typeof result.catch === "function"){
        result.catch(err => logLine("ERROR", `${nowTime()} Menu action failed: ${String(err && (err.message||err))}`));
      }
    }catch(err){
      logLine("ERROR", `${nowTime()} Menu action failed: ${String(err && (err.message||err))}`);
    }
  }

  function menuButton(id, label){
    return html`
      <button
        className=${"menuBtn " + (openMenu === id ? "active" : "")}
        onClick=${(e)=>{ e.stopPropagation(); setOpenMenu(openMenu === id ? null : id); }}
      >${label}</button>
    `;
  }

  const menuBarUI = html`
    <div className="menuBar" ref=${menuBarRef}>
      <div className="menuGroup">
        ${menuButton("file", "File")}
        ${openMenu === "file" ? html`
          <div className="menuDropdown">
            <button className="menuItem" onClick=${()=>runMenuAction(actionNew)}><span>New Project</span><span className="menuShortcut">Ctrl+N</span></button>
            <button className="menuItem" onClick=${()=>runMenuAction(actionOpen)}><span>Open...</span><span className="menuShortcut">Ctrl+O</span></button>
            <div className="menuDivider"></div>
            <button className="menuItem" onClick=${()=>runMenuAction(actionSave)}><span>Save</span><span className="menuShortcut">Ctrl+S</span></button>
            <button className="menuItem" onClick=${()=>runMenuAction(actionSaveAs)}><span>Save As...</span><span className="menuShortcut">Ctrl+Shift+S</span></button>
          </div>
        ` : null}
      </div>
      <div className="menuGroup">
        ${menuButton("edit", "Edit")}
        ${openMenu === "edit" ? html`
          <div className="menuDropdown">
            <button className="menuItem" disabled=${!canUndo()} onClick=${()=>runMenuAction(actionUndo)}><span>Undo</span><span className="menuShortcut">Ctrl+Z</span></button>
            <button className="menuItem" disabled=${!canRedo()} onClick=${()=>runMenuAction(actionRedo)}><span>Redo</span><span className="menuShortcut">Ctrl+Y</span></button>
          </div>
        ` : null}
      </div>
      <div className="menuGroup">
        ${menuButton("workspace", "Workspace")}
        ${openMenu === "workspace" ? html`
          <div className="menuDropdown">
            <button className="menuItem" onClick=${()=>runMenuAction(toggleFullscreen)}><span>${isFullscreen ? "Exit Full Screen" : "Full Screen"}</span><span className="menuShortcut">F11</span></button>
            <button className="menuItem" onClick=${()=>runMenuAction(()=>rfApi.fitView({ padding: 0.2, duration: 200 }))}><span>Fit View</span><span className="menuShortcut">F</span></button>
            <button className="menuItem" onClick=${()=>runMenuAction(()=>setJsonOpen(v=>!v))}><span>${jsonOpen ? "Hide JSON Feed" : "Show JSON Feed"}</span><span className="menuShortcut"></span></button>
            <button className="menuItem" onClick=${()=>runMenuAction(()=>setInspectorOpen(v=>!v))}><span>${inspectorOpen ? "Hide Node Context" : "Show Node Context"}</span><span className="menuShortcut"></span></button>
          </div>
        ` : null}
      </div>
      <div className="menuGroup">
        ${menuButton("debug", "Debug")}
        ${openMenu === "debug" ? html`
          <div className="menuDropdown">
            <button className="menuItem" onClick=${()=>runMenuAction(()=>setDebugConsoleOpen(v=>!v))}><span>${debugConsoleOpen ? "Hide Console" : "Show Console"}</span><span className="menuShortcut"></span></button>
            <button className="menuItem" disabled=${consoleLines.length === 0} onClick=${()=>runMenuAction(()=>setConsoleLines([]))}><span>Clear Console</span><span className="menuShortcut"></span></button>
          </div>
        ` : null}
      </div>
      <div className="menuSpacer"></div>
      <div className="menuFileName">${projectName}</div>
      <input style=${{display:"none"}} ref=${fileInputRef} type="file" accept="application/json,.json" onChange=${(e)=>{ const f = e.target.files && e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ()=>{ try{ const obj = JSON.parse(String(r.result||"{}")); loadProject(obj); }catch(err){ logLine("ERROR", `${nowTime()} Open failed: ${String(err && (err.message||err))}`); } }; r.readAsText(f); e.target.value = ""; }} />
    </div>
  `;

  const paletteUI = html`
    <div className="panel libraryPanel">
      <div className="panelHeader"><h3>DEPARTMENT</h3><span className="pill ok">DRAG</span></div>
      <div className="panelBody libraryBody">
        <div className="libraryDepartments">
          ${LIBRARY_DEPARTMENTS.map(section => html`
            <div key=${section.title} className=${"libraryDepartment " + (section.keys.length ? "" : "empty")}>
              <div className="libraryHeading">
                <span className="libraryHeadingTitle">${section.title}</span>
              </div>
              <div className=${"libraryTray " + (section.keys.length ? "" : "empty")}>
                ${byKeys(section.keys).map(item => html`
                  <div
                    key=${section.title + "-" + item.key}
                    className="libraryTrayNode libraryNodeBtn"
                    style=${paletteItemStyle(item.key)}
                    draggable="true"
                    onDragStart=${(e)=>onDragStart(e, item.key)}
                    onDragEnd=${onDragEnd}
                  >
                    <div className="libraryTrayNodeText">
                      <div className="toolTitle">${item.title}</div>
                      <div className="muted">${item.subtitle}</div>
                    </div>
                    ${item.thumb ? html`<div className="thumbBox" style=${{borderColor:paletteColorForKey(item.key), color:paletteColorForKey(item.key)}}>${item.thumb}</div>` : null}
                  </div>
                `)}
              </div>
            </div>
          `)}
        </div>
        <div className="libraryUtilityBlock">
          <div className="libraryUtilityTitle">Utils / Background</div>
          <div className="libraryUtilityColumn">
            ${byKeys(LIBRARY_UTILS).map(item => html`
              <div
                key=${"utils-" + item.key}
                className="libraryTrayNode libraryUtilityNode libraryNodeBtn"
                style=${paletteItemStyle(item.key)}
                draggable="true"
                onDragStart=${(e)=>onDragStart(e, item.key)}
                onDragEnd=${onDragEnd}
              >
                <div className="libraryTrayNodeText">
                  <div className="toolTitle">${item.title}</div>
                  <div className="muted">${item.subtitle}</div>
                </div>
                ${item.thumb ? html`<div className="thumbBox" style=${{borderColor:paletteColorForKey(item.key), color:paletteColorForKey(item.key)}}>${item.thumb}</div>` : null}
              </div>
            `)}
          </div>
        </div>
      </div>
    </div>
  `;

  const totalClips = nodes.filter(n => n.type === "clip").length || 1;
  const creditSections = creditsAndCost.sections || {};
  const imageCredits = (creditSections.image_prep || 0) + (creditSections.nano_banana || 0);
  const creditBadgeTitle = (creditsAndCost.breakdown || []).map(item => `${item.category}: ${item.name} = ${formatCredits(item.credits)} credits`).join("\n");
  const canvasUI = html`
    <div className="rfWrap panel canvasPanel">
      <button className="jsonToggle" title="Toggle JSON Feed" onClick=${()=>setJsonOpen(v=>!v)}>${jsonOpen ? ">" : "<"}</button>
      <div className="topBar">
        <div className="badge" title=${creditBadgeTitle}>Model: <span style=${{color:"var(--ok)"}}>${creditsAndCost.model}</span> - Clips: <span style=${{color:"var(--ok)"}}>${totalClips}</span> - Credits: <span style=${{color:"var(--ok)"}}>${formatCredits(creditsAndCost.total_credits)}</span> <span style=${{color:"var(--muted)"}}>(V ${formatCredits(creditSections.video || 0)} / Img ${formatCredits(imageCredits)} / A ${formatCredits(creditSections.analysis || 0)})</span></div>
        <div className="badge">Snap: <span style=${{color: snapEnabled ? "var(--ok)" : "var(--muted)"}}>${snapEnabled ? "On" : "Off"}</span> - S</div>
      </div>
      <div style=${{height:"100%", width:"100%"}} onDrop=${onDrop} onDragOver=${onDragOver}>
        <${ReactFlow} nodes=${nodes} edges=${renderedEdges} onNodesChange=${onNodesChange} onEdgesChange=${onEdgesChange} onConnect=${onConnect} onConnectStart=${onConnectStart} onConnectEnd=${onConnectEnd} onNodeClick=${onNodeClick} onNodeDrag=${onNodeDrag} onNodeDragStop=${onNodeDragStop} onEdgeClick=${(e, edge)=>{ setSelectedEdgeIds([edge.id]); setSelectedIds([]); setEdgeMenu(null); }} onEdgeContextMenu=${onEdgeContextMenu} nodeTypes=${nodeTypes} edgeTypes=${edgeTypes} fitView=${true} minZoom=${FLOW_MIN_ZOOM} onSelectionChange=${onSelectionChange} selectionOnDrag=${true} selectNodesOnDrag=${true} panOnDrag=${panOnDrag} panActivationKeyCode="Alt" defaultEdgeOptions=${defaultEdgeOptions} proOptions=${proOptions}>
          <${Background} key="background" gap=${GRID_DOT_GAP} />
          <${MiniMap}
            key="minimap"
            className="stageMiniMap"
            position="bottom-left"
            pannable
            zoomable
            nodeColor=${miniMapNodeColor}
            nodeStrokeColor=${miniMapNodeStrokeColor}
            nodeStrokeWidth=${2}
            nodeBorderRadius=${3}
            maskColor="rgba(18,18,18,.42)"
            style=${MINIMAP_STYLE}
          />
        </${ReactFlow}>
      </div>
    </div>
  `;

  // Lightweight context drawer. Primary node controls live inside the nodes.
  const inspectorUI = html`
    <div className="panel inspectorPanel">
      <div className="panelHeader">
        <h3>NODE CONTEXT</h3>
        <button className="panelMiniBtn" onClick=${()=>setInspectorOpen(false)}>Hide</button>
      </div>
      <div className="panelBody">
        ${selectedPrimary ? html`
          ${(() => {
            const data = selectedPrimary.data || {};
            const inputCount = edges.filter(e => e.target === selectedPrimary.id).length;
            const outputCount = edges.filter(e => e.source === selectedPrimary.id).length;
            const activeRef = selectedPrimary.type === "ref" && isAnalysisActivated(data.analysis);
            const statusClass = selectedPrimary.type === "ref" ? (activeRef ? "ok" : "err") : (data.disabled ? "err" : "ok");
            const statusText = selectedPrimary.type === "ref" ? (activeRef ? "Gateway Active" : "Gateway Locked") : (data.disabled ? "Locked" : "Ready");
            const detailRows = [
              ["Type", selectedPrimary.type],
              ["Inputs", inputCount],
              ["Outputs", outputCount],
              selectedPrimary.type === "nano_banana" ? ["Generation", data.generation_status || "idle"] : null,
              selectedPrimary.type === "nano_banana" && data.result_model ? ["Model", data.result_model] : null,
              selectedPrimary.type === "ref" ? ["Analysis", data.analysis_status || (activeRef ? "analyzed" : "pending")] : null,
              data.image_name ? ["Image", data.image_name] : null,
              data.cascade_source_ref_id ? ["Cascade", data.cascade_source_ref_id] : null,
            ].filter(Boolean);
            return html`
              <div className="contextSummary">
                <div className="contextTitle">${data.title || selectedPrimary.type}</div>
                <div className="muted">${selectedPrimary.id}</div>
                <div className="contextPills">
                  <span className=${"pill " + statusClass}>${statusText}</span>
                  ${data.tags && data.tags.length ? data.tags.slice(0, 3).map((tag, i) => html`<span key=${tag + i} className="pill">${tag}</span>`) : null}
                </div>
              </div>
              <div className="contextGrid">
                ${detailRows.map(row => html`
                  <div key=${row[0]} className="contextMetric">
                    <span>${row[0]}</span>
                    <strong>${row[1]}</strong>
                  </div>
                `)}
              </div>
              ${data.cascade_prompt ? html`
                <div className="contextBlock">
                  <div className="contextLabel">Cascade Prompt</div>
                  <div className="contextText">${data.cascade_prompt}</div>
                </div>
              ` : null}
              ${data.generation_error ? html`
                <div className="contextBlock contextError">
                  <div className="contextLabel">Generation Error</div>
                  <div className="contextText">${data.generation_error}</div>
                </div>
              ` : null}
              <div className="contextBlock">
                <div className="contextLabel">Selected Node Data</div>
                <textarea className="jsonEditor contextJson" readOnly value=${JSON.stringify(data, null, 2)}></textarea>
              </div>
            `;
          })()}
        ` : html`<div className="muted">Select a node for context.</div>`}

      </div>
    </div>
  `;

  const readOnlyJsonText = selectedNodeJson
    ? JSON.stringify(selectedNodeJson, null, 2)
    : (compiledJson ? JSON.stringify(compiledJson, null, 2) : (liveFeed ? JSON.stringify(liveFeed.payload, null, 2) : ""));
  const readOnlyJsonKey = selectedNodeJson
    ? `selected:${selectedPrimary ? selectedPrimary.id : "none"}:${selectedNodeJson.feed_type || "node"}:${selectedNodeJson.generator ? selectedNodeJson.generator.model_family || "" : ""}`
    : (compiledJson ? "compiled" : "live");

  const jsonUI = html`
    <div className="panel">
      <div className="panelHeader">
        <h3>${showingAnalysisJson ? "Analysis JSON" : (selectedNodeJson ? (selectedNodeJson.feed_type === "generator_api_payload" ? "Generator API JSON" : "Node JSON") : "JSON Feed")}</h3>
        <div className="panelHeaderActions">
          <button className=${"panelMiniBtn " + (inspectorOpen ? "active" : "")} onClick=${()=>setInspectorOpen(v=>!v)}>Context</button>
          ${!showingAnalysisJson ? html`
            <button className="panelMiniBtn" onClick=${()=>{
              const payload = compilePayloadMultiClip();
              setCompiledJson(payload);
            }}>Compile</button>
            <button className="panelMiniBtn primary" onClick=${async ()=>{
              try{
                const payload = compilePayloadMultiClip();
                setCompiledJson(payload);
                if(!payload || payload.ready === false){ return; }
                await runVeoGeneration(payload);
              }catch(err){
                logLine("ERROR", `${nowTime()} RUN failed: ${String(err && (err.message||err))}`);
              }
            }}>Run</button>
            ${compiledJson ? html`<button className="panelMiniBtn" onClick=${()=>{ setCompiledJson(null); logLine("INFO", `${nowTime()} Cleared compiled payload.`); }}>Live</button>` : null}
          ` : null}
          <span className=${"pill " + (showingAnalysisJson ? (analysisJsonError ? "err" : "ok") : "")}>${showingAnalysisJson ? (analysisJsonError ? "Invalid JSON" : "Editable") : (selectedNodeJson ? (selectedNodeJson.feed_type === "generator_api_payload" ? (selectedNodeJson.ready ? "API-ready" : "Gateway locked") : ((selectedPrimary.data && selectedPrimary.data.title) || selectedPrimary.type || "Selected node")) : (compiledJson ? "Compiled snapshot" : (liveFeed ? liveFeed.subtitle : 'No model selected')))}</span>
        </div>
      </div>
      <div className="panelBody">
        ${showingAnalysisJson ? html`
          <textarea className=${"jsonEditor " + (analysisJsonError ? "jsonError" : "")} value=${analysisJsonDraft} onInput=${(e)=>onAnalysisJsonEdit(e.target.value)} style=${{width:'100%', minHeight:'70vh'}}></textarea>
          ${analysisJsonError ? html`<div className="jsonErrorText">${analysisJsonError}</div>` : null}
        ` : html`
          <textarea key=${readOnlyJsonKey} className="jsonEditor" readOnly value=${readOnlyJsonText} style=${{width:'100%', minHeight:'70vh'}}></textarea>
        `}
      </div>
    </div>
  `;

  const debugConsoleUI = debugConsoleOpen ? html`
    <div className="debugWindow">
      <div className="debugHeader">
        <div>
          <div className="debugTitle">Debug Console</div>
          <div className="debugMeta">${consoleLines.length} event${consoleLines.length === 1 ? "" : "s"}</div>
        </div>
        <div className="debugActions">
          <button className="debugBtn" disabled=${consoleLines.length === 0} onClick=${()=>setConsoleLines([])}>Clear</button>
          <button className="debugBtn" onClick=${()=>setDebugConsoleOpen(false)}>Close</button>
        </div>
      </div>
      <div className="console debugConsole">
        ${consoleLines.length ? consoleLines.slice(-80).map((line, i) => html`
          <div key=${line.level + "-" + i + "-" + line.msg} className="consoleLine">
            <span className=${"lvl" + line.level}>${line.level}</span>: ${line.msg}
          </div>
        `) : html`<div className="muted">No console output.</div>`}
      </div>
    </div>
  ` : null;

  const edgeMenuUI = edgeMenu ? (() => {
    const edge = edges.find(e => e.id === edgeMenu.edgeId);
    if(!edge) return null;
    const selectedMode = edgeModeForType(edge.type);
    const menuX = Math.min(edgeMenu.x, window.innerWidth - 150);
    const menuY = Math.min(edgeMenu.y, window.innerHeight - 94);
    const item = (mode, label) => html`
      <button
        key=${mode}
        className="edgeContextItem"
        onClick=${()=>setEdgeMode(edge.id, mode)}
      >
        <span className="edgeContextTick">${selectedMode === mode ? "✓" : ""}</span>
        <span>${label}</span>
      </button>
    `;
    return html`
      <div
        className="edgeContextMenu"
        style=${{left: menuX + "px", top: menuY + "px"}}
        onPointerDown=${(e)=>e.stopPropagation()}
        onContextMenu=${(e)=>e.preventDefault()}
      >
        ${item("linear", "Linear")}
        ${item("bezier", "Bezier")}
      </div>
    `;
  })() : null;

  const smartConnectUI = smartConnect ? (() => {
    const selected = smartConnect.options[smartConnect.selectedIndex] || smartConnect.options[0];
    const ghost = smartGhostPosition(smartConnect.start, smartConnect.current);
    return html`
      <div className="smartConnectLayer">
        <svg aria-hidden="true">
          <line
            x1=${smartConnect.start.x}
            y1=${smartConnect.start.y}
            x2=${ghost.x + 85}
            y2=${ghost.y + 28}
            stroke=${selected.color}
            strokeWidth="2"
            strokeDasharray="6 6"
            opacity="0.65"
          />
        </svg>
        <div
          className="smartGhostNode"
          style=${{left:`${ghost.x}px`, top:`${ghost.y}px`, borderColor:selected.color}}
        >
          <div className="nodeTitle" style=${{color:selected.color}}>${selected.title}</div>
          <div className="nodeSub">${selected.subtitle}</div>
        </div>
        <div className="smartConnectMenu" style=${{left:`${ghost.x}px`, top:`${ghost.y + 76}px`}}>
          ${smartConnect.options.map((option, index) => html`
            <button
              key=${option.key}
              className=${"smartConnectOption " + (index === smartConnect.selectedIndex ? "active" : "")}
              onMouseEnter=${()=>setSmartConnect(prev => prev ? Object.assign({}, prev, { selectedIndex:index }) : prev)}
              onClick=${()=>finalizeSmartConnection()}
            >
              <span>
                <div className="smartConnectTitle" style=${{color: index === smartConnect.selectedIndex ? option.color : "inherit"}}>${option.title}</div>
                <div className="smartConnectHint">${option.subtitle}</div>
              </span>
              <span className="smartConnectHint">${index === smartConnect.selectedIndex ? "Enter" : ""}</span>
            </button>
          `)}
          <div className="smartConnectHelp">Up/down to choose, Enter or mouse release to connect.</div>
        </div>
      </div>
    `;
  })() : null;

  // Fix: Wrap everything in a flex shell to fit the viewport exactly
  return html`
    <div className="shell">
      ${menuBarUI}
      ${debugConsoleUI}
      ${edgeMenuUI}
      ${smartConnectUI}
      <div className=${"app " + (jsonOpen ? "jsonOpen " : "") + (inspectorOpen ? "inspectorOpen" : "")}>${paletteUI}${canvasUI}${jsonOpen ? jsonUI : null}${inspectorOpen ? inspectorUI : null}</div>
      ${toast ? html`<div className="toastHost"><div key=${toast.id} className="stageToast">${toast.message}</div></div>` : null}
    </div>
  `;
}



export default function StageApp(){
  return html`<${ReactFlowProvider}><${App}/></${ReactFlowProvider}>`;
}
