"""Loopback-only static server for the manual EPD uploader."""

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_ID = "epd-manual-web"
ROOT = Path(__file__).resolve().parent


class LocalHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/__health":
            payload = json.dumps({"app": APP_ID}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/__stop":
            self.send_error(404)
            return
        if self.headers.get("X-EPD-Stop") != APP_ID:
            self.send_error(403)
            return
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()
        threading.Thread(target=self.server.shutdown, daemon=True).start()


def make_server(port=8765):
    return LocalHTTPServer(("127.0.0.1", port), AppHandler)
