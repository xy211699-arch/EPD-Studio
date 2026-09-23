"""Double-click this file to open the local uploader in Microsoft Edge."""

import subprocess
import sys
from pathlib import Path
from tkinter import Tk, messagebox

from server import make_server


EDGE_PATHS = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


def show_error(message):
    root = Tk()
    root.withdraw()
    messagebox.showerror("墨水屏图片上传", message, parent=root)
    root.destroy()


def main():
    edge = next((path for path in EDGE_PATHS if path.is_file()), None)
    if edge is None:
        show_error("未找到 Microsoft Edge。请先安装 Edge，或检查安装路径。")
        return 1
    try:
        server = make_server()
    except OSError as exc:
        show_error(f"无法启动本地网页；127.0.0.1:8765 可能已被占用。\n{exc}")
        return 1
    try:
        subprocess.Popen([str(edge), "http://localhost:8765/"], close_fds=True)
        server.serve_forever()
    except Exception as exc:
        show_error(f"本地网页运行失败：\n{exc}")
        return 1
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
