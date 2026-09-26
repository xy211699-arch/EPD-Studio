import importlib.util
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1] / "app"
SPEC = importlib.util.spec_from_file_location("epd_server", ROOT / "server.py")
server_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server_module)


class LocalServerTests(unittest.TestCase):
    def test_health_works_without_console_error_stream(self):
        server = server_module.make_server(port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(sys, "stderr", None):
                with urlopen(f"http://127.0.0.1:{server.server_address[1]}/__health", timeout=2) as response:
                    self.assertEqual(json.load(response)["app"], "epd-manual-web")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_quota_endpoint_returns_normalized_payload_without_credentials(self):
        server = server_module.make_server(port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(server_module, "fetch_quota", return_value={
                "status": "ok",
                "source": "codex-app-server",
                "updated_at": "2026-09-25T13:00:00Z",
                "plan_type": "plus",
                "five_hour": {"remaining_percent": 72},
                "seven_day": {"remaining_percent": 77},
            }):
                with urlopen(f"http://127.0.0.1:{server.server_address[1]}/__quota", timeout=2) as response:
                    payload = json.load(response)
            self.assertEqual(payload["status"], "ok")
            self.assertEqual(payload["five_hour"]["remaining_percent"], 72)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_occupied_port_is_not_reused_or_stopped(self):
        occupied = server_module.make_server(port=0)
        occupied_port = occupied.server_address[1]
        try:
            selected = server_module.make_available_server(ports=(occupied_port, 0))
            try:
                self.assertNotEqual(selected.server_address[1], occupied_port)
                self.assertEqual(occupied.server_address[1], occupied_port)
            finally:
                selected.server_close()
        finally:
            occupied.server_close()

    def test_stop_only_verified_project_server(self):
        posts = []

        class OtherHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                payload = b'{"app":"another-program"}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_POST(self):
                posts.append(self.path)
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args):
                pass

        other = ThreadingHTTPServer(("127.0.0.1", 0), OtherHandler)
        app = server_module.make_server(port=0)
        threads = [threading.Thread(target=instance.serve_forever, daemon=True) for instance in (other, app)]
        for thread in threads:
            thread.start()
        try:
            stopped = server_module.stop_running_servers(ports=(other.server_address[1], app.server_address[1]))
            self.assertEqual(stopped, [app.server_address[1]])
            self.assertEqual(posts, [])
            self.assertTrue(threads[0].is_alive())
        finally:
            other.shutdown()
            other.server_close()
            app.shutdown()
            app.server_close()
            for thread in threads:
                thread.join(timeout=2)

    def test_malformed_health_response_is_not_treated_as_this_app(self):
        class MalformedHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                payload = b'[]'
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *_args):
                pass

        other = ThreadingHTTPServer(("127.0.0.1", 0), MalformedHandler)
        thread = threading.Thread(target=other.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertEqual(server_module.running_app_ports(ports=(other.server_address[1],)), [])
        finally:
            other.shutdown()
            other.server_close()
            thread.join(timeout=2)

    def test_serves_only_local_app_and_stops(self):
        server = server_module.make_server(port=0)
        self.assertEqual(server.server_address[0], "127.0.0.1")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        try:
            with urlopen(f"http://127.0.0.1:{port}/__health") as response:
                self.assertEqual(json.load(response)["app"], "epd-manual-web")
            with urlopen(f"http://127.0.0.1:{port}/") as response:
                self.assertIn(b"<html", response.read().lower())
            request = Request(
                f"http://127.0.0.1:{port}/__stop",
                data=b"",
                headers={"X-EPD-Stop": "epd-manual-web"},
                method="POST",
            )
            with urlopen(request) as response:
                self.assertEqual(response.status, 200)
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
        finally:
            server.server_close()

    def test_port_collision_is_an_error(self):
        first = server_module.make_server(port=0)
        try:
            with self.assertRaises(OSError):
                server_module.make_server(port=first.server_address[1])
        finally:
            first.server_close()


if __name__ == "__main__":
    unittest.main()
