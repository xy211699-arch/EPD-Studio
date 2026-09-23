"""Stop only the verified loopback server for this app."""

import json
import sys
from tkinter import Tk, messagebox
from urllib.error import URLError
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8765"
APP_ID = "epd-manual-web"


def show_error(message):
    root = Tk()
    root.withdraw()
    messagebox.showerror("停止墨水屏本地网页", message, parent=root)
    root.destroy()


def main():
    try:
        with urlopen(BASE + "/__health", timeout=2) as response:
            if json.load(response).get("app") != APP_ID:
                show_error("该端口不是本项目的服务，未执行停止操作。")
                return 1
        request = Request(BASE + "/__stop", data=b"", headers={"X-EPD-Stop": APP_ID}, method="POST")
        with urlopen(request, timeout=2) as response:
            return 0 if response.status == 200 else 1
    except (URLError, OSError, ValueError) as exc:
        show_error(f"未能停止本地网页：\n{exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
