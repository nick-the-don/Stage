import streamlit as st
import streamlit.components.v1 as components

from veo_proxy import start_veo_proxy
from stage_ui import STREAMLIT_SHELL_CSS, load_ui_html


def secret_value(section, key, default=""):
    try:
        return st.secrets.get(section, {}).get(key, default)
    except Exception:
        return default


@st.cache_resource
def start_cached_veo_proxy(api_key):
    return start_veo_proxy(api_key)


def build_client_config(proxy):
    return {
        "proxy_url": proxy["url"],
        "client_token": proxy["token"],
        "has_api_key": proxy["has_api_key"],
        "defaults": {
            "fps": int(secret_value("veo", "default_fps", 24) or 24),
            "resolution": str(secret_value("veo", "default_resolution", "1080p") or "1080p"),
        },
    }


def main():
    st.set_page_config(layout="wide", page_title="Stage | ReactFlow (UMD)")

    proxy = start_cached_veo_proxy(str(secret_value("google", "api_key", "") or ""))
    html = load_ui_html(build_client_config(proxy))

    st.markdown(STREAMLIT_SHELL_CSS, unsafe_allow_html=True)
    components.html(html, height=720, scrolling=False)


if __name__ == "__main__":
    main()
