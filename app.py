from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from tlm_model import PRESETS, fit_model_to_data, normalize_preset, sensitivity_attribution, simulate_model

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8787"))
ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"


class AppHandler(BaseHTTPRequestHandler):
    server_version = "TLMPython/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path.startswith("/api/"):
            self._handle_api_get(path)
            return

        self._serve_static(path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if not path.startswith("/api/"):
            self._send_text(HTTPStatus.NOT_FOUND, "Not found")
            return

        if path != "/api/simulate":
            if path == "/api/fit":
                self._handle_fit()
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        if length > 2 * 1024 * 1024:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Payload too large"})
            return

        raw = self.rfile.read(length) if length > 0 else b""

        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
            model_input = payload.get("model", payload) if isinstance(payload, dict) else None
            model = normalize_preset(model_input)
            include_sensitivity = bool(payload.get("includeSensitivity")) if isinstance(payload, dict) else False
            if include_sensitivity:
                result = sensitivity_attribution(model, float(payload.get("perturbation", 0.05)))
            else:
                result = simulate_model(model)
            self._send_json(HTTPStatus.OK, result)
        except json.JSONDecodeError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "error": "Failed to parse simulation request",
                "details": str(exc),
            })
        except Exception as exc:  # noqa: BLE001
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                "error": "Simulation failed",
                "details": str(exc),
            })

    def _handle_fit(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        if length > 4 * 1024 * 1024:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Payload too large"})
            return

        raw = self.rfile.read(length) if length > 0 else b""
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
            model_input = payload.get("model", payload) if isinstance(payload, dict) else None
            points = payload.get("points", []) if isinstance(payload, dict) else []
            iterations = int(payload.get("iterations", 220)) if isinstance(payload, dict) else 220
            result = fit_model_to_data(model_input, points, iterations=iterations)
            self._send_json(HTTPStatus.OK, result)
        except json.JSONDecodeError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "error": "Failed to parse fit request",
                "details": str(exc),
            })
        except Exception as exc:  # noqa: BLE001
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "error": "Fitting failed",
                "details": str(exc),
            })

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path.startswith("/api/"):
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.end_headers()
            return

        self._serve_static(path, head_only=True)

    def _handle_api_get(self, path: str) -> None:
        if path == "/api/presets":
            self._send_json(HTTPStatus.OK, {"presets": PRESETS})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _serve_static(self, path: str, head_only: bool = False) -> None:
        requested = "/index.html" if path == "/" else path
        target = (PUBLIC_DIR / requested.lstrip("/")).resolve()

        if not str(target).startswith(str(PUBLIC_DIR.resolve())):
            self._send_text(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        if not target.is_file():
            self._send_text(HTTPStatus.NOT_FOUND, "Not found")
            return

        mime_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        size = target.stat().st_size

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        if not head_only:
            with target.open("rb") as fp:
                self.wfile.write(fp.read())

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_text(self, status: HTTPStatus, text: str) -> None:
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"TLM EIS simulator: http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
