"""Start the loopback-only EPD page in a visible Python console."""

import subprocess
import sys
from pathlib import Path

from server import make_available_server


EDGE_PATHS = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


def main():
    edge = next((path for path in EDGE_PATHS if path.is_file()), None)
    if edge is None:
        print("未找到 Microsoft Edge，请检查安装位置。", file=sys.stderr)
        return 1

    try:
        server = make_available_server()
    except OSError as exc:
        print(f"无法启动本地网页：{exc}", file=sys.stderr)
        return 1

    url = f"http://127.0.0.1:{server.server_address[1]}/"
    try:
        subprocess.Popen([str(edge), url], close_fds=True)
        print(f"本地页面已启动：{url}", flush=True)
        print("保持此窗口打开；按 Ctrl+C 可停止本次服务。", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        print("本地页面服务已停止。", flush=True)
    except Exception as exc:
        print(f"本地页面运行失败：{exc}", file=sys.stderr)
        return 1
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
