import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1] / "app"
SPEC = importlib.util.spec_from_file_location("epd_quota", ROOT / "quota.py")
quota = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(quota)


RATE_LIMITS_PAYLOAD = {
    "accountId": "account-1",
    "rateLimits": {
        "planType": "plus",
        "primary": {
            "usedPercent": 28,
            "windowDurationMins": 300,
            "resetsAt": 1790262000,
        },
        "secondary": {
            "usedPercent": 23,
            "windowDurationMins": 10080,
            "resetsAt": 1790866800,
        },
    },
}


class QuotaTests(unittest.TestCase):
    def test_app_server_client_performs_initialize_and_rate_limits_rpc(self):
        class FakeStdin:
            def __init__(self):
                self.writes = []

            def write(self, value):
                self.writes.append(value)

            def flush(self):
                pass

        class FakeStdout:
            def __init__(self):
                self.lines = [
                    b'{"id":1,"result":{"userAgent":"test","codexHome":"C:\\\\Users\\\\test","platformFamily":"windows","platformOs":"windows"}}\n',
                    b'{"method":"remoteControl/status/changed","params":{"status":"disabled"}}\n',
                    (json.dumps({"id": 2, "result": RATE_LIMITS_PAYLOAD}) + "\n").encode("utf-8"),
                ]

            def readline(self):
                return self.lines.pop(0) if self.lines else b""

        class FakeProcess:
            def __init__(self):
                self.stdin = FakeStdin()
                self.stdout = FakeStdout()
                self.terminated = False

            def terminate(self):
                self.terminated = True

            def wait(self, timeout):
                return 0

            def kill(self):
                self.terminated = True

        process = FakeProcess()

        def factory(command, **kwargs):
            self.assertEqual(command[-2:], ["app-server", "--stdio"])
            self.assertNotIn("Bearer", " ".join(command))
            self.assertNotIn("access_token", kwargs.get("env", {}))
            return process

        client = quota.CodexAppServerClient(executable="codex-test", timeout=1, process_factory=factory)
        try:
            self.assertEqual(client.read_rate_limits(), RATE_LIMITS_PAYLOAD)
            messages = [json.loads(item.decode("utf-8")) for item in process.stdin.writes]
            self.assertEqual([message["method"] for message in messages], ["initialize", "initialized", "account/rateLimits/read"])
        finally:
            client.close()
        self.assertTrue(process.terminated)

    def test_normalizes_app_server_rate_limits_into_remaining_quota(self):
        result = quota.normalize_rate_limits_payload(RATE_LIMITS_PAYLOAD, updated_at="2026-09-25T13:00:00Z")

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["plan_type"], "plus")
        self.assertEqual(result["five_hour"]["used_percent"], 28)
        self.assertEqual(result["five_hour"]["remaining_percent"], 72)
        self.assertEqual(result["five_hour"]["window_minutes"], 300)
        self.assertEqual(result["five_hour"]["reset_at"], 1790262000)
        self.assertEqual(result["seven_day"]["used_percent"], 23)
        self.assertEqual(result["seven_day"]["remaining_percent"], 77)
        self.assertEqual(result["seven_day"]["window_minutes"], 10080)

    def test_rejects_app_server_payload_without_both_quota_windows(self):
        with self.assertRaises(quota.QuotaDataError):
            quota.normalize_rate_limits_payload({"rateLimits": {"planType": "plus"}}, updated_at="now")

    def test_fetch_quota_uses_official_app_server_without_credentials_in_python_response(self):
        class FakeAppServer:
            def read_rate_limits(self):
                return RATE_LIMITS_PAYLOAD

            def close(self):
                pass

        with patch.object(quota, "CodexAppServerClient", return_value=FakeAppServer()):
            result = quota.fetch_quota()

        self.assertEqual(result["source"], "codex-app-server")
        self.assertEqual(result["five_hour"]["remaining_percent"], 72)
        self.assertNotIn("access_token", result)
        self.assertNotIn("account-1", str(result))

    def test_app_server_start_failure_is_unavailable_without_raw_error(self):
        class FailingAppServer:
            def read_rate_limits(self):
                raise OSError("failed to start app-server with token secret")

            def close(self):
                pass

        with patch.object(quota, "CodexAppServerClient", return_value=FailingAppServer()):
            result = quota.fetch_quota()

        self.assertEqual(result["status"], "unavailable")
        self.assertNotIn("token secret", str(result))

    def test_app_server_rpc_failure_is_unavailable(self):
        class FailingAppServer:
            def read_rate_limits(self):
                raise quota.AppServerError("rate limits RPC failed")

            def close(self):
                pass

        with patch.object(quota, "CodexAppServerClient", return_value=FailingAppServer()):
            result = quota.fetch_quota()

        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["five_hour"])

    def test_app_server_command_does_not_include_auth_material(self):
        command = quota.build_app_server_command()
        self.assertIn("app-server", command)
        self.assertNotIn("auth.json", " ".join(command))
        self.assertNotIn("Bearer", " ".join(command))


if __name__ == "__main__":
    unittest.main()
