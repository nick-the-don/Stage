# Stage

Stage is a Vite React and Express app for sketching image/video generation graphs, compiling them into Veo payloads, and submitting generation jobs through a server-side proxy.

## Run

Install dependencies:

```powershell
npm.cmd install
```

Copy `.env.example` to `.env` and set `GOOGLE_API_KEY`.

Start the dev server:

```powershell
npm.cmd run dev
```

The app defaults to `http://127.0.0.1:5173`.

To let other machines on the same network connect, set `HOST=0.0.0.0` in `.env` and restart the server. Keep this on a trusted network unless you add real authentication.

## Production

Build the React app:

```powershell
npm.cmd run build
```

Serve the built app through Express:

```powershell
npm.cmd run start
```

## Configuration

Preferred configuration is `.env`:

```text
GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY
VEO_DEFAULT_FPS=24
VEO_DEFAULT_RESOLUTION=1080p
HOST=127.0.0.1
PORT=5173
```

For compatibility, the server also reads `.streamlit/secrets.toml` if it already exists, but Streamlit is no longer required.

## Architecture

- `src/App.jsx` contains the ReactFlow workspace UI.
- `src/App.css` contains the app styling migrated from the previous Streamlit-hosted HTML shell.
- `src/main.jsx` loads browser-safe runtime config from the Express server before rendering React.
- `server/index.js` serves the React app and owns the Veo API proxy routes.
- The browser receives only proxy metadata and a temporary token. Google API calls and video downloads happen server-side so the API key is not exposed.

API routes:

```text
GET  /api/config
POST /api/veo/submit
POST /api/veo/status
GET  /api/veo/download
```

The graph compiler still produces one shared multi-clip payload for both the JSON feed and the Run button. The Run button submits clips sequentially, polls each operation with a 20-minute timeout, then downloads generated video through the Express proxy.
