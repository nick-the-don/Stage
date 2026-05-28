import json
from pathlib import Path

UI_TEMPLATE_PATH = Path(__file__).with_name("assets") / "stage.html"

STREAMLIT_SHELL_CSS = """
<style>
  [data-testid="stHeader"],
  [data-testid="stToolbar"],
  [data-testid="stDecoration"] { display:none !important; }
  .block-container {
    padding:0 !important;
    max-width:100% !important;
  }
  [data-testid="stVerticalBlock"],
  [data-testid="stElementContainer"] {
    gap:0 !important;
  }
  iframe {
    display:block !important;
    height:100vh !important;
    min-height:720px !important;
  }
</style>
"""


def load_ui_html(client_config):
    template = UI_TEMPLATE_PATH.read_text(encoding="utf-8")
    return template.replace("__VEO_CONFIG_PLACEHOLDER__", json.dumps(client_config))
