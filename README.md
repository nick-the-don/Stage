# Stage

Stage is a Streamlit-hosted ReactFlow workspace for sketching image/video generation graphs, compiling them into Veo payloads, and submitting generation jobs through a local server-side proxy.

## Run

```powershell
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

Streamlit defaults to `http://localhost:8501`. If that port is busy, pass another port:

```powershell
python -m streamlit run app.py --server.port 8502
```

## Secrets

Copy `.streamlit/secrets.example.toml` to `.streamlit/secrets.toml` and fill in your real values. The real secrets file is ignored by Git.

The app starts a localhost-only proxy when it runs. Browser code receives only the proxy URL and a temporary token; Google API calls and video downloads are performed server-side so the API key is not exposed in the iframe.

## Current Architecture

- `app.py` is the Streamlit entrypoint.
- `assets/stage.html` contains the ReactFlow UI template.
- `stage_ui.py` loads the UI template and injects browser-safe runtime config.
- `veo_proxy.py` contains the localhost-only Veo API proxy and download service.
- The graph compiler produces one shared multi-clip payload for both the JSON feed and the Run button.
- The Run button submits clips sequentially, polls each operation with a 20-minute timeout, then downloads the generated video through the local proxy.
- `archive/` contains previous experiments and debug logs moved out of the active app root.

## Verification

Basic checks:

```powershell
python -m py_compile app.py veo_proxy.py stage_ui.py
python -m streamlit run app.py --server.port 8502
```

## Follow-Up Refactor

The next structural step, if needed, is to split `assets/stage.html` into separate CSS and JavaScript files or move it into a small Vite app. The security-sensitive API path already lives in Python.
