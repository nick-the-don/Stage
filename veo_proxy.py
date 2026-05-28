import json
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


def _extract_video_uri(operation_response):
    try:
        samples = (
            operation_response.get("response", {})
            .get("generateVideoResponse", {})
            .get("generatedSamples", [])
        )
        return samples[0].get("video", {}).get("uri") if samples else None
    except Exception:
        return None


def _google_json_request(method, url, api_key, payload=None, timeout=60):
    data = None
    headers = {"x-goog-api-key": api_key}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Google API request failed ({exc.code}): {body[:1200]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Google API request failed: {exc.reason}") from exc


def _build_veo_request(payload):
    model_id = payload.get("model_id")
    model_name = (
        "veo-3.1-fast-generate-preview"
        if model_id == "veo-3.1-fast"
        else "veo-3.1-generate-preview"
    )
    clips = payload.get("clips") or []
    if not clips:
        raise ValueError("No clips found in payload.")

    clip = clips[0]
    generation_config = clip.get("generation_config") or {}
    blocks = clip.get("compiled_blocks") or []
    first_block = blocks[0] if blocks else {}
    aspect_ratio = str(first_block.get("aspect_ratio") or "16:9")
    if aspect_ratio not in {"9:16", "16:9"}:
        aspect_ratio = "16:9"

    reference_images = []
    for ref in (clip.get("ingredients") or {}).get("reference_images") or []:
        gcs_uri = ref.get("gcs_uri")
        if not gcs_uri:
            continue
        reference_images.append(
            {
                "referenceType": ref.get("reference_type") or "asset",
                "image": {"gcsUri": gcs_uri, "mimeType": "image/jpeg"},
            }
        )

    body = {
        "instances": [{"prompt": clip.get("prompt") or "A cinematic shot."}],
        "parameters": {
            "durationSeconds": int(generation_config.get("seconds") or 8),
            "aspectRatio": aspect_ratio,
            "generateAudio": bool(generation_config.get("audio_enabled")),
        },
    }
    if reference_images:
        body["instances"][0]["referenceImages"] = reference_images[:3]

    return model_name, body


class _VeoProxyHandler(BaseHTTPRequestHandler):
    server_version = "StageProxy/1.0"

    def log_message(self, *_args):
        return

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Veo-Proxy-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def _authorized(self):
        parsed = urllib.parse.urlparse(self.path)
        query_token = urllib.parse.parse_qs(parsed.query).get("token", [""])[0]
        header_token = self.headers.get("X-Veo-Proxy-Token", "")
        return self.server.client_token in {query_token, header_token}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if not self._authorized():
            self._send_json(401, {"error": "Unauthorized local proxy request."})
            return
        if not self.server.api_key:
            self._send_json(500, {"error": "Missing [google].api_key in .streamlit/secrets.toml."})
            return

        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/veo/submit":
                data = self._read_json()
                model_name, body = _build_veo_request(data.get("payload") or {})
                operation = _google_json_request(
                    "POST",
                    f"{VEO_BASE_URL}/models/{model_name}:predictLongRunning",
                    self.server.api_key,
                    body,
                    timeout=90,
                )
                op_name = operation.get("name")
                if not op_name:
                    raise RuntimeError(f"No operation name returned: {operation}")
                self._send_json(200, {"operation_name": op_name, "model_name": model_name})
                return

            if parsed.path == "/api/veo/status":
                data = self._read_json()
                op_name = str(data.get("operation_name") or "").lstrip("/")
                if not op_name:
                    raise ValueError("operation_name is required.")
                operation = _google_json_request(
                    "GET",
                    f"{VEO_BASE_URL}/{op_name}",
                    self.server.api_key,
                    timeout=45,
                )
                self._send_json(
                    200,
                    {
                        "done": bool(operation.get("done")),
                        "video_uri": _extract_video_uri(operation),
                        "error": operation.get("error"),
                    },
                )
                return

            self._send_json(404, {"error": f"Unknown endpoint: {parsed.path}"})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/veo/download":
            self._send_json(404, {"error": f"Unknown endpoint: {parsed.path}"})
            return
        if not self._authorized():
            self._send_json(401, {"error": "Unauthorized local proxy request."})
            return
        if not self.server.api_key:
            self._send_json(500, {"error": "Missing [google].api_key in .streamlit/secrets.toml."})
            return

        uri = urllib.parse.parse_qs(parsed.query).get("uri", [""])[0]
        if not uri.startswith("http"):
            self._send_json(400, {"error": "A generated video URI is required."})
            return

        try:
            request = urllib.request.Request(uri, headers={"x-goog-api-key": self.server.api_key})
            with urllib.request.urlopen(request, timeout=180) as response:
                self.send_response(200)
                self._cors_headers()
                self.send_header("Content-Type", response.headers.get("Content-Type", "video/mp4"))
                self.send_header("Content-Disposition", 'attachment; filename="veo_generated.mp4"')
                length = response.headers.get("Content-Length")
                if length:
                    self.send_header("Content-Length", length)
                self.end_headers()
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})


def start_veo_proxy(api_key):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _VeoProxyHandler)
    server.api_key = str(api_key or "")
    server.client_token = secrets.token_urlsafe(32)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return {
        "url": f"http://127.0.0.1:{server.server_port}",
        "token": server.client_token,
        "has_api_key": bool(server.api_key),
        "server": server,
    }
