"""Loopback-only static server for the manual EPD uploader."""

import errno
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

from quota import fetch_quota


APP_ID = "epd-manual-web"
ROOT = Path(__file__).resolve().parent
PORTS = tuple(range(8765, 8776))
LOCAL_OPENER = build_opener(ProxyHandler({}))


class LocalHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, _format, *_args):
        # pythonw.exe has no stderr; BaseHTTPRequestHandler's logger would
        # raise while sending every response, leaving the port occupied.
        pass

    def do_GET(self):
        if self.path == "/__health":
            payload = json.dumps({"app": APP_ID}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/__quota":
            payload = json.dumps(fetch_quota(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
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


def make_available_server(ports=PORTS):
    last_collision = None
    for port in ports:
        try:
            return make_server(port)
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, 10048) and getattr(exc, "winerror", None) != 10048:
                raise
            last_collision = exc
    raise OSError("本地网页可用端口均已被占用") from last_collision


def running_app_ports(ports=PORTS):
    found = []
    for port in ports:
        try:
            with LOCAL_OPENER.open(f"http://127.0.0.1:{port}/__health", timeout=0.5) as response:
                payload = json.loads(response.read(256)) if response.status == 200 else None
                if isinstance(payload, dict) and payload.get("app") == APP_ID:
                    found.append(port)
        except (OSError, ValueError):
            continue
    return found


def stop_running_servers(ports=PORTS):
    stopped = []
    for port in running_app_ports(ports):
        request = Request(
            f"http://127.0.0.1:{port}/__stop",
            data=b"",
            headers={"X-EPD-Stop": APP_ID},
            method="POST",
        )
        try:
            with LOCAL_OPENER.open(request, timeout=2) as response:
                if response.status == 200:
                    stopped.append(port)
        except OSError:
            continue
    return stopped
