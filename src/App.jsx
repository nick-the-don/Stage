import React from "react";
import htm from "htm";
import ReactFlow, {
  Background,
  Controls,
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
  "Veo 3.1 Quality": { id: "veo-3.1-quality", credits_per_sec_hd: 12, max_reference_images: 3, supports_audio: true },
  "Veo 3.1 Fast": { id: "veo-3.1-fast", credits_per_sec_hd: 5, max_reference_images: 2, supports_audio: false }
};

const RES_PRESETS = ["SD","HD","2K","4K"];
const RES_MULT = { SD:0.7, HD:1.0, "2K":1.25, "4K":1.6 };
const ASPECT_PRESETS = ["1:1","9:16","16:9","21:9"];

const NODE_COLORS = { model:"#E63946", ref:"#F4A261", face:"#E9C46A", body:"#2A9D8F", clothing:"#3A86FF", pose:"#8E44AD", param:"#6C757D", clip:"#6C757D", nano_banana:"#FFD700" };

const PALETTE = [
  { key:"model", title:"Model", subtitle:"Final render + chaining", tags:["Veo 3.1 Fast/Quality"] },
  { key:"nano_banana", title:"Nano Banana Pro", subtitle:"Gemini 3 Pro Image", tags:["14-img blend","high fidelity"], thumb:"14x" },
  { key:"ref", title:"Asset Reference", subtitle:"Upload / Analyze", tags:["reference image"], thumb:"IMG" },
  { key:"face", title:"CU / Face", subtitle:"Close-up identity passes", tags:["face cref"] },
  { key:"body", title:"Body CREF", subtitle:"Full-body consistency", tags:["turnaround"] },
  { key:"clothing", title:"Clothing / Accessories", subtitle:"Wardrobe exploration", tags:["materials"] },
  { key:"pose", title:"Pose action", subtitle:"Readable silhouette", tags:["action"] },
  { key:"param_batch_4", title:"Batch = 4", subtitle:"Param override", tags:["override"] },
  { key:"param_aspect_16_9", title:"Aspect = 16:9", subtitle:"Param override", tags:["override"] },
  { key:"param_res_hd", title:"Res = HD", subtitle:"Param override", tags:["override"] },
  { key:"param_focal_35", title:"Focal = 35mm", subtitle:"Param override", tags:["override"] },
  { key:"param_ap_f14", title:"Aperture = f/1.4", subtitle:"Param override", tags:["override"] },
  { key:"clip", title:"Background", subtitle:"Scene / environment", tags:["backdrop"] }
];

const IMAGE_GEN_KEYS = ["model","nano_banana","ref","face","body","clothing","pose"];
const PARAM_KEYS = PALETTE.map(p=>p.key).filter(k=>k.startsWith("param_"));
const MISC_KEYS = ["clip"];
const byKeys = (keys) => keys.map(k => PALETTE.find(p=>p.key===k)).filter(Boolean);
function isGeneratorType(t){ return ["face","body","clothing","pose"].includes(t); }
function makeId(prefix){ return (prefix||"n") + "_" + Math.random().toString(16).slice(2,10); }

function defaultPropsFor(type){
  if(type==="model"){
    return { title:"MODEL (Veo)", subtitle:"Top of pipe (governs capabilities)", tags:["gates features","credits + price"], model_ver:"Veo 3.1 Quality", seconds_per_clip:8, audio_enabled:true, usd_per_credit:0.01, currency:"USD", usd_to_local:1.0 };
  }
  if(type==="nano_banana"){ 
    return { title:"Nano Banana Pro", subtitle:"14-Input Blender", tags:["gemini 3 pro"], res:"HD", slots: Array(14).fill(null), prompt: "", result_uri: null }; 
  }
  if(type==="ref"){
    return { title:"Asset Reference", subtitle:"Upload + analyze", tags:["nano banana pro","identity lock"], gcs_uri:"gs://your-bucket/character_master.jpg", reference_mode:"double_stacked", ref_slots:2, image_store_key:null, image_preview_url:null, image_data_url:null, image_name:null, analysis:null };
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
      const k = src.data && src.data.param_key;
      const v = src.data && src.data.param_val;
      if(k) params[k] = v;
    }
  }
  return params;
}

async function nanoBananaAnalyze(_imageDataUrl){
  return { metadata_tags: ["studio_portrait","character_reference","identity_anchor","controlled_lighting"] };
}

function TagRow({ data }){
  return html`
    <div className="nodeTagRow">
      ${((data && data.tags) || []).map((t, i) => html`<span key=${t + "-" + i} className="nodeTag">${t}</span>`)}
    </div>
  `;
}

function ModelNode({ data }){
  const color = NODE_COLORS["model"] || "#888";
  return html`
    <div className="nodeBox" style=${{borderColor: color}}>
      <div className="modelInputsRowTop">
        <span key="start" className="nodeMuted">Start Frame</span>
        <span key="end" className="nodeMuted">End Frame</span>
        <span key="asset1" className="nodeMuted">Asset 1</span>
        <span key="asset2" className="nodeMuted">Asset 2</span>
        <span key="style" className="nodeMuted">Style</span>
      </div>
      <${Handle} key="start-handle" type="target" position=${Position.Top} id="start" style=${{left:"10%"}} />
      <${Handle} key="end-handle" type="target" position=${Position.Top} id="end" style=${{left:"30%"}} />
      <${Handle} key="asset1-handle" type="target" position=${Position.Top} id="asset1" style=${{left:"50%"}} />
      <${Handle} key="asset2-handle" type="target" position=${Position.Top} id="asset2" style=${{left:"70%"}} />
      <${Handle} key="style-handle" type="target" position=${Position.Top} id="style" style=${{left:"90%"}} />
      <div style=${{display:"flex", justifyContent:"space-between", gap:"10px", marginTop:"10px"}}>
        <div>
          <div className="nodeTitle">${(data && data.title) || "Model (Veo)"}</div>
          <div className="nodeSub">${(data && data.subtitle) || "Final render + chaining"}</div>
        </div>
        <div className="pill" style=${{borderColor: color, color: color}}>VEO</div>
      </div>
      <${TagRow} data=${data} />
      <div className="nodeMuted" style=${{marginTop:"8px"}}>
        ${(data && data.model_ver) ? ("Selected: " + data.model_ver) : ""}
      </div>
      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" />
    </div>
  `;
}

function BaseNode({ data, type, id }){
  const { setNodes } = useReactFlow();
  const disabled = !!(data && data.disabled);
  const color = NODE_COLORS[type] || "#888";
  const isRef = (type === "ref" || type === "style_ref");
  const hasMultiInputs = ["face","body","clothing","pose"].includes(type);
  
  // Allow prompt editing directly on the node if it's a generator type
  const showPromptBox = ["face","body","clothing","pose"].includes(type);
  const onPromptChange = (e) => {
     setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, prompt: e.target.value } } : n));
  };

  return html`
    <div className=${"nodeBox " + (disabled ? "nodeDisabled" : "")} style=${{borderColor: color}}>
      <div className="topInputsRow">${hasMultiInputs ? html`<span key="asset" className="nodeMuted">Asset</span><span key="style" className="nodeMuted">Style</span>` : html`<span key="input" className="nodeMuted">Input</span>`}</div>
      <div style=${{display:"flex", justifyContent:"space-between", gap:"10px"}}>
        <div>
          <div className="nodeTitle">${(data && data.title) || "Node"}</div>
          <div className="nodeSub">${(data && data.subtitle) || ""}</div>
          ${(data && data.badge) ? html`<div className="nodeMuted" style=${{marginTop:"4px"}}>${data.badge}</div>` : null}
        </div>
        <div className="pill" style=${{borderColor: color, color: color}}>${String(type || "").toUpperCase()}</div>
      </div>
      ${isRef && data && (data.image_preview_url || data.image_data_url) ? html`<div style=${{marginTop:"8px", display:"flex", gap:"8px", alignItems:"center"}}><img src=${data.image_preview_url || data.image_data_url} style=${{width:"42px", height:"42px", objectFit:"cover", borderRadius:"10px", border:"1px solid rgba(255,255,255,.12)"}} /><div className="nodeMuted" style=${{lineHeight:"1.2"}}>${(data.image_name || "reference.png")}<br/><span style=${{opacity:.9}}>preview</span></div></div>` : null}
      <${TagRow} data=${data} />

      ${showPromptBox ? html`
         <div style=${{marginTop:"8px"}}>
           <textarea className="nodrag" placeholder="Enter prompt..." value=${data.prompt || ""} onInput=${onPromptChange} style=${{width:"100%", height:"50px", fontSize:"10px", background:"#111", border:"1px solid #333", color:"#ccc", padding:"4px"}}></textarea>
         </div>
      ` : null}

      ${hasMultiInputs ? html`<${Handle} key="asset-handle" type="target" position=${Position.Top} id="asset" style=${{left:"30%"}} /><${Handle} key="style-handle" type="target" position=${Position.Top} id="style" style=${{left:"70%"}} />` : html`<${Handle} key="in-handle" type="target" position=${Position.Top} id="in" />`}
      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" />
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
    <div className="nodeBox" style=${{borderColor: "#FFD700", width:"340px", padding:"0", overflow:"hidden", background:"#1a1a1a"}}>
      
      <div style=${{padding:"10px", background:"rgba(255, 215, 0, 0.1)", borderBottom:"1px solid #444"}}>
        <div style=${{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div className="nodeTitle" style=${{color:"#FFD700", margin:"0"}}>NANO BANANA PRO</div>
          <div className="pill" style=${{color:"#000", background:"#FFD700", fontWeight:"800"}}>GEMINI 3</div>
        </div>
        <div className="nodeSub" style=${{marginTop:"4px"}}>14-Image Context Window</div>
      </div>

      <div style=${{padding:"10px"}}>
        <div style=${{display:"flex", justifyContent:"space-between", marginBottom:"6px", fontSize:"10px", fontWeight:"700"}}>
          <span style=${{color:"#4ec9b0"}}>HIGH FIDELITY (1-6)</span>
          <span style=${{color:"#f4a261"}}>SUPPLEMENTARY (7-14)</span>
        </div>
        
        <div style=${{display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:"4px"}}>
          ${slots.map((slotImg, i) => {
            const isHiFi = i < 6;
            const color = isHiFi ? "#4ec9b0" : "#f4a261";
            return html`
              <div key=${i} style=${{position:"relative", width:"100%", aspectRatio:"1/1"}}>
                <${Handle}
                  key=${"slot-handle-" + i}
                  type="target" 
                  position=${Position.Top} 
                  id=${"in_" + i} 
                  isConnectableStart=${true}
                  style=${{background:color, top:"-6px", width:"8px", height:"8px", left:"50%", transform:"translateX(-50%)"}} 
                />
                
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

      <div style=${{padding:"0 10px"}}>
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

      <div style=${{padding:"10px", display:"flex", alignItems:"center", gap:"8px"}}>
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
          onClick=${() => {
              // Mock Generation Logic: Set the result URI to the first image slot or a placeholder
              updateData({ result_uri: slots.find(s=>s) || slots[0] || "https://placehold.co/600x400/1a1a1a/FFF?text=Generated+Image" });
          }}
        >
          GENERATE
        </button>
      </div>

      ${data.result_uri ? html`
        <div style=${{width:"100%", aspectRatio:"16/9", borderTop:"1px solid #333", position:"relative"}}>
          <img src=${data.result_uri} style=${{width:"100%", height:"100%", objectFit:"contain", background:"#000"}} />
          <div style=${{position:"absolute", bottom:"6px", right:"6px", background:"rgba(0,0,0,0.6)", padding:"2px 6px", borderRadius:"4px", fontSize:"10px", color:"#fff"}}>
            Generated Result
          </div>
        </div>
      ` : null}

      <${Handle} key="out-handle" type="source" position=${Position.Bottom} id="out" style=${{background:"#FFD700"}} />
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
  const model = nodes.find(n => n.type === "model");
  if(!model) return null;
  const capacity = inputCapacityForNode(model, caps);
  if(!capacity) return null;

  const referenceRule = capacity.groups.references;
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
  return (list || []).map(node => {
    if(!referenceNodeTypes.has(node.type) || !(node.data && node.data.disabled)) return node;
    const data = Object.assign({}, node.data);
    delete data.disabled;
    return Object.assign({}, node, { data });
  });
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
  const [jsonOpen, setJsonOpen] = React.useState(false);
  const [debugConsoleOpen, setDebugConsoleOpen] = React.useState(false);
  const [smartConnect, setSmartConnect] = React.useState(null);
  const [openMenu, setOpenMenu] = React.useState(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [projectName, setProjectName] = React.useState("Untitled.veo.json");
  const fileInputRef = React.useRef(null);
  const menuBarRef = React.useRef(null);
  const smartConnectRef = React.useRef(null);
  const smartConnectUsedRef = React.useRef(false);

  React.useEffect(() => {
    smartConnectRef.current = smartConnect;
  }, [smartConnect]);

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
  }, [setEdges]);

  React.useEffect(() => {
    try{
      localStorage.setItem(LS_KEY, JSON.stringify({ nodes: scrubNodesForStorage(nodes), edges, selectedIds, clipboard: scrubClipboardForStorage(clipboard) }));
    }catch(err){
      logLine("WARN", `${nowTime()} Autosave skipped: browser storage is full or unavailable.`);
    }
  }, [nodes, edges, selectedIds, clipboard]);

  const selectedNodes = React.useMemo(() => nodes.filter(n => selectedIds.includes(n.id)), [nodes, selectedIds]);
  const selectedPrimary = React.useMemo(() => selectedNodes[0] || null, [selectedNodes]);

  const modelNode = React.useMemo(() => nodes.find(n => n.type==="model") || null, [nodes]);
  const modelProps = (modelNode && modelNode.data) || defaultPropsFor("model");
  const caps = MODEL_CATALOG[modelProps.model_ver] || MODEL_CATALOG["Veo 3.1 Quality"];

  const finalizeSmartConnection = React.useCallback((pointOverride) => {
    const smart = smartConnectRef.current;
    if(!smart) return;

    const option = smart.options[smart.selectedIndex] || smart.options[0];
    const point = pointOverride || smart.current || smart.start;
    const flowPoint = rfApi.screenToFlowPosition(point);
    const id = makeId(option.type);
    const label = labelForIndexedInput(smart.targetHandle);
    const node = {
      id,
      type: option.type,
      position: { x: flowPoint.x - 85, y: flowPoint.y - 44 },
      data: Object.assign({}, defaultPropsFor(option.type), { title: option.title })
    };
    const edge = {
      id: makeId("e"),
      source: id,
      sourceHandle: "out",
      target: smart.targetNodeId,
      targetHandle: smart.targetHandle,
      type: "smoothstep",
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
  }, [rfApi, setEdges, setNodes]);

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
      type: "smoothstep",
      label: label || undefined,
      labelStyle: label ? { fill: "#FFD700", fontWeight: 700, fontSize: 10 } : undefined,
      labelBgStyle: label ? { fill: "rgba(0,0,0,0.6)", stroke: "#444", strokeWidth: 1 } : undefined,
      labelBgPadding: label ? [6, 3] : undefined,
      labelBgBorderRadius: label ? 999 : undefined
    }, eds));
    setSmartConnect(null);
  }, [nodes, edges, caps, setEdges, showToast]);

  const onSelectionChange = React.useCallback((sel) => {
    const ids = ((sel && sel.nodes) ? sel.nodes : []).map(n => n.id);
    setSelectedIds(ids);
  }, []);

  const onDragStart = (event, itemKey) => { event.dataTransfer.setData("application/veo-node", itemKey); event.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; };
  const onDrop = (event) => {
    event.preventDefault();
    const key = event.dataTransfer.getData("application/veo-node");
    if(!key) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = rfApi.screenToFlowPosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    let type = key;
    let dataPatch = {};
    if(key && key.indexOf("param_") === 0) type = "param";
    if(key==="param_batch_4") dataPatch = { title:"Batch=4", subtitle:"Param override", param_key:"batch", param_val:4 };
    if(key==="param_aspect_16_9") dataPatch = { title:"Aspect=16:9", subtitle:"Param override", param_key:"aspect", param_val:"16:9" };
    if(key==="param_res_hd") dataPatch = { title:"Res=HD", subtitle:"Param override", param_key:"res", param_val:"HD" };
    if(key==="param_focal_35") dataPatch = { title:"Focal=35mm", subtitle:"Param override", param_key:"focal_length", param_val:"35mm" };
    if(key==="param_ap_f14") dataPatch = { title:"Aperture=f/1.4", subtitle:"Param override", param_key:"aperture", param_val:"f/1.4" };
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
      return;
    }
    const id = makeId(type);
    const base = defaultPropsFor(type);
    const palette = PALETTE.find(p => p.key === key);
    const n = { id, type, position, data: Object.assign({}, base, dataPatch, { tags: (palette && palette.tags) ? palette.tags : (base.tags || []) }) };
    setNodes(nds => nds.concat([n]));
    setSelectedIds([id]);
    logLine("INFO", `${nowTime()} Dropped ${type} node ${id}`);
  };

  function updateNode(id, patch){ setNodes(nds => nds.map(n => (n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, patch) }) : n))); }

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
    const seconds = Number(modelProps.seconds_per_clip || 8);
    const audioEnabled = !!(modelProps.audio_enabled && caps.supports_audio);
    const audioMult = audioEnabled ? 1.1 : 1.0;
    const usdPerCredit = Number(modelProps.usd_per_credit || 0.01);
    const usdToLocal = Number(modelProps.usd_to_local || 1.0);
    const currency = modelProps.currency || "USD";
    let totalCredits = 0;
    const breakdown = [];
    nodes.forEach(n => {
      if(isGeneratorType(n.type)){
        const ov = incomingParams(n.id, nodes, edges);
        const batch = Number((ov.batch !== undefined ? ov.batch : (n.data && n.data.batch)) || 1);
        const res = String((ov.res !== undefined ? ov.res : (n.data && n.data.res)) || "HD");
        const rm = (RES_MULT[res] !== undefined) ? RES_MULT[res] : 1.0;
        const nodeCredits = batch * seconds * caps.credits_per_sec_hd * rm * audioMult;
        totalCredits += nodeCredits;
        breakdown.push({ name: (n.data && n.data.title) || n.type, credits: nodeCredits });
      }
    });
    const totalUsd = totalCredits * usdPerCredit;
    const totalLocal = totalUsd * usdToLocal;
    return { model: modelProps.model_ver, audio_enabled: audioEnabled, seconds, total_credits: totalCredits, usd_per_credit: usdPerCredit, total_usd: totalUsd, currency, total_local: totalLocal, breakdown };
  }, [nodes, edges, modelProps, caps]);

  async function onRefImageChange(file){
    if(!file || !selectedPrimary || selectedPrimary.type !== "ref") return;
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const imageKey = `ref:${selectedPrimary.id}`;
    let previewUrl = dataUrl;
    try{
      await saveImageAsset(imageKey, dataUrl);
      previewUrl = await makeImagePreview(dataUrl, 180);
      updateNode(selectedPrimary.id, { image_store_key: imageKey, image_preview_url: previewUrl, image_data_url: null, image_name: file.name });
      logLine("INFO", `${nowTime()} Stored reference image: ${file.name}`);
    }catch(err){
      updateNode(selectedPrimary.id, { image_store_key: null, image_preview_url: previewUrl, image_data_url: dataUrl, image_name: file.name });
      logLine("WARN", `${nowTime()} IndexedDB unavailable; image will stay in memory for this session only.`);
    }
  }

  async function runRefAnalysis(){
    if(!selectedPrimary || selectedPrimary.type !== "ref") return;
    const imageData = await imageDataForNode(selectedPrimary);
    if(!imageData){ logLine("WARN", `${nowTime()} Run Analysis: no image uploaded.`); return; }
    logLine("INFO", `${nowTime()} Running Nano Banana Pro analysis...`);
    const analysis = await nanoBananaAnalyze(imageData);
    updateNode(selectedPrimary.id, { analysis: analysis });
    logLine("INFO", `${nowTime()} Analysis complete.`);
  }

  const liveFeed = React.useMemo(() => {
    const payload = compilePayloadMultiClip({ quiet: true });
    return payload ? { subtitle: `${payload.clips.length} compiled clip(s)`, payload } : null;
  }, [nodes, edges, modelProps, caps, creditsAndCost]);

  function compilePayloadMultiClip(options){
    const quiet = !!(options && options.quiet);
    const refNode = nodes.find(n => n.type === "ref") || null;
    const modelId = caps.id;
    const secondsDefault = Number(modelProps.seconds_per_clip || 8);
    const audio_enabled = !!(modelProps.audio_enabled && caps.supports_audio);
    let reference_images = [];
    let identity_first_frame = null;
    if(refNode){
      const uri = (refNode.data && refNode.data.gcs_uri) || "gs://your-bucket/character_master.jpg";
      const mode = (refNode.data && refNode.data.reference_mode) || "double_stacked";
      if(mode === "double_stacked"){
        reference_images.push({ gcs_uri: uri, reference_type:"asset", description:"Primary Identity Anchor" });
        reference_images.push({ gcs_uri: uri, reference_type:"style", description:"Style/Lighting Anchor" });
      } else {
        reference_images.push({ gcs_uri: uri, reference_type:"asset", description:"Primary Identity Anchor" });
      }
      identity_first_frame = uri;
    } else {
      if(!quiet) logLine("WARN", `${nowTime()} No Asset Reference node. Identity lock may drift.`);
    }
    if(reference_images.length > caps.max_reference_images){
      if(!quiet) logLine("ERROR", `${nowTime()} Compile failed: refs=${reference_images.length} exceeds model max=${caps.max_reference_images}.`);
      return null;
    }
    const clips = nodes.filter(n => n.type === "clip").slice().sort((a,b) => Number((a.data && a.data.clip_index) || 0) - Number((b.data && b.data.clip_index) || 0));
    const hasClips = clips.length > 0;
    function generatorsForClip(clipId){
      const children = nodes.filter(n => n.parentNode === clipId);
      const gens = children.filter(n => isGeneratorType(n.type));
      const order = ["face","body","clothing","pose"];
      gens.sort((a,b)=> order.indexOf(a.type) - order.indexOf(b.type));
      return gens;
    }
    function generatorsUngrouped(){
      const gens = nodes.filter(n => isGeneratorType(n.type) && !n.parentNode);
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
        blocks.push({ node_id: g.id, type: g.type, batch, resolution: res, aspect_ratio: aspect, focal_length: focal, aperture, prompt: (g.data && g.data.prompt) || "" });
        promptParts.push("[" + String(g.type).toUpperCase() + " | batch=" + batch + " | " + res + " | " + aspect + " | focal=" + focal + " | aperture=" + aperture + "] " + ((g.data && g.data.prompt) || ""));
      }
      const output_last_frame_uri = (c.data && c.data.output_last_frame_uri) || ("gs://your-bucket/renders/" + clipName + "_LAST_FRAME.png");
      compiledClips.push({ clip_name: clipName, clip_index: Number((c.data && c.data.clip_index) || 0), generation_config: { method: "ingredients_to_video", seed: 3003, motion_pacing: "slow", audio_enabled: audio_enabled, seconds: clipSeconds }, ingredients: { reference_images: reference_images, first_frame: first_frame }, prompt: promptParts.join(" ").trim(), compiled_blocks: blocks, output_last_frame_uri: output_last_frame_uri, autochain_to_next_clip: autochain });
      prevClip = { clip_name: clipName, autochain_to_next_clip: autochain, output_last_frame_uri: output_last_frame_uri };
    }
    const payload = { model_id: modelId, clips: compiledClips, credits_estimate: { total_credits: creditsAndCost.total_credits, usd_per_credit: creditsAndCost.usd_per_credit, total_usd: creditsAndCost.total_usd, currency: creditsAndCost.currency, total_local: creditsAndCost.total_local } };
    if(!quiet) logLine("INFO", `${nowTime()} Compile OK: built ${compiledClips.length} clip(s).`);
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
    <div className="panel">
      <div className="panelHeader"><h3>LIBRARY</h3><span className="pill ok">DRAG</span></div>
      <div className="panelBody">
        <div className="card">
          <div className="toolSectionTitle">Image Gen</div>
          <div className="muted">Drag into canvas</div>
          ${byKeys(IMAGE_GEN_KEYS).map(item => html`<div key=${item.key} className="btn" draggable="true" onDragStart=${(e)=>onDragStart(e, item.key)}><div style=${{display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px"}}><div style=${{minWidth:0}}><div className="toolTitle">${item.title}</div><div className="muted">${item.subtitle}</div></div>${item.thumb ? html`<div className="thumbBox">${item.thumb}</div>` : null}</div></div>`)}
        </div>
        <div className="card">
          <div className="toolSectionTitle">Parameter Nodes</div>
          <div className="muted">Drag & wire into a generator node</div>
          <div className="row2" style=${{marginTop:"10px"}}>${byKeys(PARAM_KEYS).map(item => html`<div key=${item.key} className="btnSmall" draggable="true" onDragStart=${(e)=>onDragStart(e, item.key)}><div className="toolTitle">${item.title}</div><div className="muted">${item.subtitle}</div></div>`)}</div>
        </div>
        <div className="card">
          <div className="toolSectionTitle">Misc</div>
          <div className="muted">Background / scene nodes</div>
          ${byKeys(MISC_KEYS).map(item => html`<div key=${item.key} className="btn" draggable="true" onDragStart=${(e)=>onDragStart(e, item.key)}><div style=${{display:"flex", justifyContent:"space-between", alignItems:"center", gap:"10px"}}><div style=${{minWidth:0}}><div className="toolTitle">${item.title}</div><div className="muted">${item.subtitle}</div></div></div></div>`)}
        </div>
      </div>
    </div>
  `;

  const totalClips = nodes.filter(n => n.type === "clip").length || 1;
  const canvasUI = html`
    <div className="rfWrap panel canvasPanel">
      <button className="jsonToggle" title="Toggle JSON Feed" onClick=${()=>setJsonOpen(v=>!v)}>${jsonOpen ? ">" : "<"}</button>
      <div className="topBar">
        <div className="badge">Model: <span style=${{color:"var(--ok)"}}>${creditsAndCost.model}</span> - Clips: <span style=${{color:"var(--ok)"}}>${totalClips}</span> - Credits: <span style=${{color:"var(--ok)"}}>${creditsAndCost.total_credits.toFixed(0)}</span></div>
        <div className="badge">Shift+click / box select</div>
      </div>
      <div style=${{height:"100%", width:"100%"}} onDrop=${onDrop} onDragOver=${onDragOver}>
        <${ReactFlow} nodes=${nodes} edges=${edges} onNodesChange=${onNodesChange} onEdgesChange=${onEdgesChange} onConnect=${onConnect} onConnectStart=${onConnectStart} onConnectEnd=${onConnectEnd} onNodeDrag=${onNodeDrag} onEdgeClick=${(e, edge)=>{ setSelectedEdgeIds([edge.id]); setSelectedIds([]); }} nodeTypes=${nodeTypes} edgeTypes=${edgeTypes} fitView=${true} onSelectionChange=${onSelectionChange} selectionOnDrag=${true} selectNodesOnDrag=${true} panOnDrag=${panOnDrag} panActivationKeyCode="Alt" defaultEdgeOptions=${defaultEdgeOptions} proOptions=${proOptions}>
          <${Background} key="background" gap=${18} />
          <${MiniMap} key="minimap" pannable zoomable />
          <${Controls} key="controls" />
        </${ReactFlow}>
      </div>
    </div>
  `;

  // RESTORED: Detailed inspector UI with all inputs for different node types
  const inspectorUI = html`
    <div className="panel">
      <div className="panelHeader"><h3>INSPECTOR</h3></div>
      <div className="panelBody">
        ${selectedPrimary ? html`
          <div className="card">
            <div style=${{fontWeight:900, color:"#fff"}}>${(selectedPrimary.data && selectedPrimary.data.title) || selectedPrimary.type}</div>
          <div className="muted">ID: ${selectedPrimary.id} - type: ${selectedPrimary.type}</div>
          </div>
          
          <div className="card">
            <div style=${{fontWeight:900, color:"#fff"}}>Properties</div>
            <label>Title</label>
            <input value=${(selectedPrimary.data && selectedPrimary.data.title) || ""} onInput=${(e)=>updateNode(selectedPrimary.id, { title: e.target.value })} />

            <label>Type</label>
            ${(() => {
              const t = selectedPrimary.type;
              if(t === "ref"){
                const v = (selectedPrimary.data && selectedPrimary.data.ref_role) || "Primary";
                return html`
                  <select value=${v} onChange=${(e)=>updateNode(selectedPrimary.id, { ref_role: e.target.value })}>
                    <option value="Primary">Primary (Main Character)</option>
                    <option value="Secondary">Secondary</option>
                  </select>
                `;
              }
              const OPTS = {
                face:["Face Variations"],
                body:["Body Variations"],
                clothing:["Clothing Variations"],
                pose:["Pose Variations"],
                param:["Param"],
                clip:["Clip Group"],
                model:["Model (Veo)"]
              };
              const opts = OPTS[t] || [t];
              const v = (selectedPrimary.data && selectedPrimary.data.node_type) || (opts[0] || t);
              return html`
                <select value=${v} onChange=${(e)=>updateNode(selectedPrimary.id, { node_type: e.target.value })}>
                  ${opts.map(o => html`<option key=${o} value=${o}>${o}</option>`)}
                </select>
              `;
            })()}

            <label>Subtitle</label>
            <input value=${(selectedPrimary.data && selectedPrimary.data.subtitle) || ""} onInput=${(e)=>updateNode(selectedPrimary.id, { subtitle: e.target.value })} />

            <label>Tags (comma-separated)</label>
            <input value=${((selectedPrimary.data && selectedPrimary.data.tags) || []).join(", ")} onInput=${(e)=>updateNode(selectedPrimary.id, { tags: String(e.target.value||"").split(",").map(s=>s.trim()).filter(Boolean) })} />

            ${selectedPrimary.type === "model" ? html`
              <label>Model</label>
              <select value=${(selectedPrimary.data && selectedPrimary.data.model_ver) || "Veo 3.1 Quality"} onChange=${(e)=>updateNode(selectedPrimary.id, { model_ver: e.target.value })}>
                ${Object.keys(MODEL_CATALOG).map(k => html`<option key=${k} value=${k}>${k}</option>`)}
              </select>

              <div className="row2" style=${{marginTop:"10px"}}>
                <div>
                  <label>Seconds per clip</label>
                  <input type="number" min="4" max="30" value=${Number((selectedPrimary.data && selectedPrimary.data.seconds_per_clip) || 8)} onInput=${(e)=>updateNode(selectedPrimary.id, { seconds_per_clip: Number(e.target.value||8) })} />
                </div>
                <div>
                  <label>Audio enabled</label>
                  <select value=${(selectedPrimary.data && selectedPrimary.data.audio_enabled) ? "yes" : "no"} onChange=${(e)=>updateNode(selectedPrimary.id, { audio_enabled: e.target.value === "yes" })}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
            ` : null}

            ${["face","body","clothing","pose"].includes(selectedPrimary.type) ? html`
              <div className="row3" style=${{marginTop:"10px"}}>
                <div>
                  <label>Batch</label>
                  <input type="number" min="1" max="8" value=${Number((selectedPrimary.data && selectedPrimary.data.batch) || 1)} onInput=${(e)=>updateNode(selectedPrimary.id, { batch: Number(e.target.value||1) })} />
                </div>
                <div>
                  <label>Resolution</label>
                  <select value=${String((selectedPrimary.data && selectedPrimary.data.res) || "HD")} onChange=${(e)=>updateNode(selectedPrimary.id, { res: e.target.value })}>
                    ${RES_PRESETS.map(r => html`<option key=${r} value=${r}>${r}</option>`)}
                  </select>
                </div>
                <div>
                  <label>Aspect</label>
                  <select value=${String((selectedPrimary.data && selectedPrimary.data.aspect) || "16:9")} onChange=${(e)=>updateNode(selectedPrimary.id, { aspect: e.target.value })}>
                    ${ASPECT_PRESETS.map(a => html`<option key=${a} value=${a}>${a}</option>`)}
                  </select>
                </div>
              </div>

              <label>Ref slots (asset/style inputs)</label>
              <input type="number" min="0" max="3" value=${Number((selectedPrimary.data && selectedPrimary.data.ref_slots) || 1)} onInput=${(e)=>updateNode(selectedPrimary.id, { ref_slots: Number(e.target.value||1) })} />

              <label>Prompt</label>
              <textarea value=${(selectedPrimary.data && selectedPrimary.data.prompt) || ""} onInput=${(e)=>updateNode(selectedPrimary.id, { prompt: e.target.value })}></textarea>
            ` : null}

            ${selectedPrimary.type === "param" ? html`
              <label>Param key</label>
              <input value=${String((selectedPrimary.data && selectedPrimary.data.param_key) || "")} onInput=${(e)=>updateNode(selectedPrimary.id, { param_key: e.target.value })} />
              <label>Param value</label>
              <input value=${String((selectedPrimary.data && selectedPrimary.data.param_val) || "")} onInput=${(e)=>updateNode(selectedPrimary.id, { param_val: e.target.value })} />
            ` : null}
          </div>

          ${selectedPrimary.type === "ref" ? html`
            <div className="card">
              <div style=${{fontWeight:900, color:"#fff"}}>Asset Reference</div>
              <label>Upload image</label>
              <input type="file" accept="image/*" onChange=${(e)=>onRefImageChange(e.target.files && e.target.files[0])} />
              <div className="row2" style=${{marginTop:"10px"}}>
                <button className="btnSmall" onClick=${runRefAnalysis}>Run Analysis</button>
                <button className="btnSmall" onClick=${()=>updateNode(selectedPrimary.id, {analysis:null})}>Clear</button>
              </div>
              ${selectedPrimary.data && selectedPrimary.data.analysis ? html`
                <label>Analysis JSON</label>
                <textarea readOnly style=${{minHeight:"200px"}}>${JSON.stringify(selectedPrimary.data.analysis, null, 2)}</textarea>
              ` : null}
            </div>
          ` : null}
        ` : html`<div className="muted">Select a node to edit properties.</div>`}

        <div className="card">
          <div style=${{fontWeight:900, color:"#fff"}}>Compile</div>
          <button className="btnSmall" onClick=${()=>{
            const payload = compilePayloadMultiClip();
            setCompiledJson(payload);
          }}>COMPILE</button>

          <div className="row2" style=${{marginTop:"10px"}}>
            <button className="btnSmall" onClick=${async ()=>{
              try{
                const payload = compilePayloadMultiClip();
                setCompiledJson(payload);
                if(!payload){ return; }
                await runVeoGeneration(payload);
              }catch(err){
                logLine("ERROR", `${nowTime()} RUN failed: ${String(err && (err.message||err))}`);
              }
            }}>RUN (Generate)</button>
            <button className="btnSmall" onClick=${()=>{ setCompiledJson(null); logLine("INFO", `${nowTime()} Cleared compiled payload.`); }}>Clear</button>
          </div>
          ${compiledJson ? html`
            <label>Compiled payload</label>
            <textarea readOnly style=${{minHeight:"260px"}}>${JSON.stringify(compiledJson, null, 2)}</textarea>
          ` : null}
        </div>

      </div>
    </div>
  `;

  const jsonUI = html`
    <div className="panel">
      <div className="panelHeader">
        <h3>JSON Feed</h3>
        <span className="pill">${liveFeed ? liveFeed.subtitle : 'No model selected'}</span>
      </div>
      <div className="panelBody">
        <div className="muted" style=${{marginBottom:'8px'}}>Realtime compiled multi-clip payload.</div>
        <textarea readOnly style=${{width:'100%', minHeight:'70vh'}}>${liveFeed ? JSON.stringify(liveFeed.payload, null, 2) : ''}</textarea>
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
      ${smartConnectUI}
      <div className="app ${jsonOpen ? 'jsonOpen' : ''}">${paletteUI}${canvasUI}${inspectorUI}${jsonOpen ? jsonUI : null}</div>
      ${toast ? html`<div className="toastHost"><div key=${toast.id} className="stageToast">${toast.message}</div></div>` : null}
    </div>
  `;
}



export default function StageApp(){
  return html`<${ReactFlowProvider}><${App}/></${ReactFlowProvider}>`;
}
