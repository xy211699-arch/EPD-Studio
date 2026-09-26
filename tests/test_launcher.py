import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(ROOT))


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LauncherTests(unittest.TestCase):
    def test_launcher_starts_its_own_console_server(self):
        launcher = load_script("launch")
        started = []
        fake_server = SimpleNamespace(
            server_address=("127.0.0.1", 8767),
            serve_forever=lambda: started.append(True),
            server_close=lambda: None,
        )
        with patch.object(launcher, "EDGE_PATHS", (ROOT / "server.py",)), \
             patch.object(launcher, "make_available_server", return_value=fake_server) as create, \
             patch.object(launcher.subprocess, "Popen") as open_edge, \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(launcher.main(), 0)
        create.assert_called_once_with()
        self.assertEqual(started, [True])
        self.assertEqual(open_edge.call_args.args[0][1], "http://127.0.0.1:8767/")
        self.assertIn("http://127.0.0.1:8767/", output.getvalue())

    def test_new_instance_uses_actual_selected_port(self):
        launcher = load_script("launch")
        fake_server = SimpleNamespace(
            server_address=("127.0.0.1", 8767),
            serve_forever=lambda: None,
            server_close=lambda: None,
        )
        with patch.object(launcher, "EDGE_PATHS", (ROOT / "server.py",)), \
             patch.object(launcher, "make_available_server", return_value=fake_server), \
             patch.object(launcher.subprocess, "Popen") as open_edge, \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(launcher.main(), 0)
        self.assertEqual(open_edge.call_args.args[0][1], "http://127.0.0.1:8767/")
        self.assertIn("http://127.0.0.1:8767/", output.getvalue())

    def test_keyboard_interrupt_closes_only_its_server(self):
        launcher = load_script("launch")
        closed = []
        def interrupted():
            raise KeyboardInterrupt
        fake_server = SimpleNamespace(
            server_address=("127.0.0.1", 8767),
            serve_forever=interrupted,
            server_close=lambda: closed.append(True),
        )
        with patch.object(launcher, "EDGE_PATHS", (ROOT / "server.py",)), \
             patch.object(launcher, "make_available_server", return_value=fake_server), \
             patch.object(launcher.subprocess, "Popen"), \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(launcher.main(), 0)
        self.assertEqual(closed, [True])
        self.assertIn("已停止", output.getvalue())

    def test_stop_script_reports_only_verified_services(self):
        stopper = load_script("stop")
        with patch.object(stopper, "stop_running_servers", return_value=[8767]) as stop, \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(stopper.main(), 0)
        stop.assert_called_once_with()
        self.assertIn("8767", output.getvalue())

    def test_stop_script_does_not_claim_unverified_service_stopped(self):
        stopper = load_script("stop")
        with patch.object(stopper, "stop_running_servers", return_value=[]), \
             redirect_stderr(io.StringIO()) as error:
            self.assertEqual(stopper.main(), 1)
        self.assertIn("未找到", error.getvalue())


if __name__ == "__main__":
    unittest.main()
