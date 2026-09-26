"""Stop only healthy, verified instances of the local EPD page."""

import sys

from server import stop_running_servers


def main():
    try:
        stopped = stop_running_servers()
    except (OSError, ValueError) as exc:
        print(f"停止本地页面失败：{exc}", file=sys.stderr)
        return 1
    if not stopped:
        print("未找到可确认的本项目服务；没有终止任何进程。", file=sys.stderr)
        return 1
    print(f"已停止本项目服务，端口：{', '.join(map(str, stopped))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
