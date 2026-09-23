import importlib.util
import json
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("epd_server", ROOT / "server.py")
server_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server_module)


class LocalServerTests(unittest.TestCase):
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
