"""Read ChatGPT account limits through the installed Codex app-server.

The browser never receives authentication material. The official Codex process
loads and refreshes its own credentials, and this module forwards only the
normalized two-window quota snapshot to the local dashboard.
"""

from __future__ import annotations

import json
import math
import os
import queue
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path


APP_SERVER_TIMEOUT_SECONDS = 15
DEFAULT_CODEX_EXECUTABLE = Path(
    os.environ.get(
        "LOCALAPPDATA",
        str(Path.home() / "AppData" / "Local"),
    )
) / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.exe"


class QuotaDataError(ValueError):
    """Raised when an app-server quota response is incomplete or invalid."""


class AppServerError(RuntimeError):
    """Raised when the official app-server cannot complete an RPC request."""


def _error_payload(status="unavailable", message="额度服务暂不可用"):
    return {
        "status": status,
        "source": "codex-app-server",
        "updated_at": None,
        "plan_type": None,
        "five_hour": None,
        "seven_day": None,
        "error": message,
    }


def _number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise QuotaDataError(f"invalid {field}")
    number = float(value)
    if not math.isfinite(number):
        raise QuotaDataError(f"invalid {field}")
    return number


def _percent(value, field):
    number = _number(value, field)
    if number < 0 or number > 100:
        raise QuotaDataError(f"invalid {field}")
    return int(round(number))


def _window(raw, field, expected_minutes):
    if not isinstance(raw, dict):
        raise QuotaDataError(f"missing {field}")
    used = _percent(raw.get("usedPercent"), f"{field}.usedPercent")
    minutes = raw.get("windowDurationMins")
    if minutes is None:
        raise QuotaDataError(f"missing {field}.windowDurationMins")
    minutes = int(round(_number(minutes, f"{field}.windowDurationMins")))
    if minutes != expected_minutes:
        raise QuotaDataError(f"unexpected {field} window")
    reset_at = raw.get("resetsAt")
    if reset_at is not None:
        reset_at = int(round(_number(reset_at, f"{field}.resetsAt")))
    return {
        "used_percent": used,
        "remaining_percent": 100 - used,
        "window_minutes": minutes,
        "reset_at": reset_at,
    }


def _rate_limit_snapshot(payload):
    if not isinstance(payload, dict):
        raise QuotaDataError("app-server response is not an object")
    by_limit = payload.get("rateLimitsByLimitId")
    if isinstance(by_limit, dict) and isinstance(by_limit.get("codex"), dict):
        return by_limit["codex"]
    snapshot = payload.get("rateLimits")
    if not isinstance(snapshot, dict):
        raise QuotaDataError("missing rateLimits")
    return snapshot


def normalize_rate_limits_payload(payload, updated_at=None):
    """Map ``account/rateLimits/read`` to the dashboard response contract."""
    snapshot = _rate_limit_snapshot(payload)
    plan_type = snapshot.get("planType")
    return {
        "status": "ok",
        "source": "codex-app-server",
        "updated_at": updated_at or datetime.now(timezone.utc).isoformat(),
        "plan_type": plan_type if isinstance(plan_type, str) else None,
        "five_hour": _window(snapshot.get("primary"), "primary", 300),
        "seven_day": _window(snapshot.get("secondary"), "secondary", 10080),
        "error": None,
    }


def _default_executable():
    configured = os.environ.get("CODEX_EXECUTABLE")
    if configured:
        return configured
    if DEFAULT_CODEX_EXECUTABLE.is_file():
        return str(DEFAULT_CODEX_EXECUTABLE)
    return shutil.which("codex") or "codex"


def build_app_server_command(executable=None):
    """Return the official stdio app-server command without auth arguments."""
    return [str(executable or _default_executable()), "app-server", "--stdio"]


def _process_environment():
    env = os.environ.copy()
    home = str(Path.home())
    env.setdefault("HOME", home)
    env.setdefault("USERPROFILE", home)
    return env


class CodexAppServerClient:
    """Small JSON-lines JSON-RPC client for the official Codex app-server."""

    def __init__(self, executable=None, timeout=APP_SERVER_TIMEOUT_SECONDS, process_factory=None):
        self._command = build_app_server_command(executable)
        self._timeout = timeout
        self._process_factory = process_factory or subprocess.Popen
        self._process = None
        self._messages = queue.Queue()
        self._reader = None
        self._next_id = 1

    def _start(self):
        if self._process is not None:
            return
        try:
            self._process = self._process_factory(
                self._command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=_process_environment(),
                bufsize=0,
            )
        except (OSError, ValueError) as exc:
            raise AppServerError("unable to start Codex app-server") from exc

        def pump():
            try:
                while True:
                    line = self._process.stdout.readline()
                    if not line:
                        break
                    self._messages.put(line)
            finally:
                self._messages.put(None)

        self._reader = threading.Thread(target=pump, name="codex-app-server-reader", daemon=True)
        self._reader.start()
        self._request(
            "initialize",
            {
                "clientInfo": {"name": "epd-manual-web", "version": "1.0.0"},
                "capabilities": {"experimentalApi": False},
            },
        )
        self._send({"jsonrpc": "2.0", "method": "initialized"})

    def _send(self, message):
        if self._process is None or self._process.stdin is None:
            raise AppServerError("Codex app-server is not running")
        try:
            wire = (json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8")
            self._process.stdin.write(wire)
            self._process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise AppServerError("unable to send app-server request") from exc

    def _next_message(self):
        try:
            line = self._messages.get(timeout=self._timeout)
        except queue.Empty as exc:
            raise AppServerError("Codex app-server request timed out") from exc
        if line is None:
            raise AppServerError("Codex app-server closed unexpectedly")
        if isinstance(line, bytes):
            line = line.decode("utf-8", errors="strict")
        try:
            message = json.loads(line)
        except (UnicodeDecodeError, TypeError, ValueError) as exc:
            raise AppServerError("Codex app-server returned invalid JSON") from exc
        if not isinstance(message, dict):
            raise AppServerError("Codex app-server returned an invalid message")
        return message

    def _request(self, method, params=None):
        request_id = self._next_id
        self._next_id += 1
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        self._send(message)
        while True:
            response = self._next_message()
            if response.get("id") != request_id:
                continue
            if isinstance(response.get("error"), dict):
                raise AppServerError(f"app-server RPC failed for {method}")
            result = response.get("result")
            if not isinstance(result, dict):
                raise AppServerError(f"app-server RPC returned no result for {method}")
            return result

    def read_rate_limits(self):
        self._start()
        return self._request("account/rateLimits/read")

    def close(self):
        process, self._process = self._process, None
        if process is None:
            return
        try:
            process.terminate()
            process.wait(timeout=2)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            try:
                process.kill()
            except (OSError, ValueError):
                pass


def fetch_quota():
    """Read quota through Codex and return only the dashboard-safe payload."""
    client = CodexAppServerClient()
    try:
        return normalize_rate_limits_payload(client.read_rate_limits())
    except (AppServerError, QuotaDataError, OSError, ValueError):
        return _error_payload()
    finally:
        client.close()
