# Hourly EPD Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可双击启动的 Windows 桌面应用；应用启动后立即主动连接 `NRF-EPD-9691`、发送固定测试图，并在保持打开期间从每轮完成时刻起每隔 60 分钟再次发送。

**Architecture:** 使用 PySide6 构建单窗口界面，Qt 主线程只维护界面与一秒级调度 tick，独立 `QThread` 内通过 `asyncio.run()` 执行 Bleak 连接和图片传输。图片编码、EPD 协议、重试发送和周期调度保持为无 Qt 或仅依赖抽象接口的模块，以便用假 BLE 客户端和假时钟完成快速自动测试。每轮发送都新建并最终释放 GATT 会话；成功只表示全部图片分包及 `REFRESH` 写入被 GATT 接受，不声称已验证物理屏幕刷新。

**Tech Stack:** Python 3.13、PySide6、Bleak 3.x、Pillow、pytest、pytest-asyncio、pytest-qt、PyInstaller。

**Spec:** `docs/superpowers/specs/2026-09-20-hourly-epd-desktop-app-design.md`

## Global Constraints

- [ ] 第一阶段只发送随应用打包的 `epd_ble_test.png`，不加入图片选择、Codex 额度、日期、电子宠物、开机启动或系统托盘。
- [ ] 正式周期恒为 3,600 秒；测试通过注入假时钟推进，不真实等待 60 分钟。
- [ ] 蓝牙连接、超时、退避和图片发送绝不在 Qt 主线程执行。
- [ ] 一轮任务最多尝试三次；每次尝试都在 `finally` 中释放通知订阅和 GATT 连接。
- [ ] “停止自动发送”不强制中断正在传输的数据，只阻止后续周期；窗口关闭时先停止新任务，并在当前发送安全结束后退出。
- [ ] UI 成功文案统一为“传输完成，屏幕刷新中”，不显示未经固件回执支持的“屏幕刷新完成”。
- [ ] 所有界面状态同时使用文字和颜色表达，不能仅靠颜色区分。

## Review Focus

- [ ] 协议审查重点：黑白像素位序、命令顺序、首包/续包 flag、分包上限、每 50 包带响应检查点和最终 `REFRESH` 带响应写入。
- [ ] 并发审查重点：主线程无 BLE 阻塞、忙碌时不会重复启动 worker、停止/关闭与正在进行的发送不存在资源竞争。
- [ ] 调度审查重点：启动立即发送、成功后重新计时、计划任务最终失败后重新计时、手动成功后重置、手动失败不破坏既有倒计时。
- [ ] 视觉审查重点：窗口信息层级明确，主状态与倒计时最醒目，三项操作含义明确，日志默认折叠，固定图片预览不过度抢占空间。
- [ ] 打包审查重点：`--windowed` 构建无控制台窗口，图片资源在源码运行和 PyInstaller 构建中都能找到。

---

## Task 1: 建立可测试的项目骨架与固定配置

**Files:**

- Create: `.gitignore`
- Create: `pyproject.toml`
- Create: `src/epd_hourly_app/__init__.py`
- Create: `src/epd_hourly_app/config.py`
- Create: `src/epd_hourly_app/resources/__init__.py`
- Copy: `epd_ble_test.png` → `src/epd_hourly_app/resources/epd_ble_test.png`
- Create: `tests/test_config.py`

- [ ] **Step 1: 写失败测试，固定设备、协议、周期与资源要求**

```python
# tests/test_config.py
from epd_hourly_app.config import AppConfig, resource_path


def test_production_config_targets_confirmed_device() -> None:
    config = AppConfig.production()
    assert config.device_name == "NRF_EPD_9691"
    assert config.device_address == "CC:5C:27:AE:96:91"
    assert config.service_uuid == "62750001-d828-918d-fb46-b6c11c675aec"
    assert config.characteristic_uuid == "62750002-d828-918d-fb46-b6c11c675aec"
    assert config.interval_seconds == 3600
    assert config.max_attempts == 3


def test_packaged_image_exists() -> None:
    image_path = resource_path("epd_ble_test.png")
    assert image_path.is_file()
```

- [ ] **Step 2: 运行测试并确认因包或配置不存在而失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_config.py -q`

Expected: FAIL，错误为 `ModuleNotFoundError` 或缺少 `AppConfig`。

- [ ] **Step 3: 建立项目元数据和最小配置实现**

```toml
# pyproject.toml
[build-system]
requires = ["setuptools>=75", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "epd-hourly-app"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
  "bleak>=3.0,<4",
  "Pillow>=11,<12",
  "PySide6>=6.8,<7",
]

[project.optional-dependencies]
dev = [
  "pyinstaller>=6.10,<7",
  "pytest>=8.3,<9",
  "pytest-asyncio>=0.25,<1",
  "pytest-qt>=4.4,<5",
]

[project.gui-scripts]
epd-hourly-app = "epd_hourly_app.main:main"

[tool.setuptools]
package-dir = {"" = "src"}
include-package-data = true

[tool.setuptools.package-data]
epd_hourly_app = ["resources/*.png"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

```python
# src/epd_hourly_app/config.py
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path


@dataclass(frozen=True, slots=True)
class AppConfig:
    device_name: str
    device_address: str
    service_uuid: str
    characteristic_uuid: str
    interval_seconds: int = 3600
    max_attempts: int = 3
    connect_timeout_seconds: float = 20.0
    capability_timeout_seconds: float = 3.0
    retry_delays_seconds: tuple[float, float] = (1.0, 3.0)

    @classmethod
    def production(cls) -> "AppConfig":
        return cls(
            device_name="NRF_EPD_9691",
            device_address="CC:5C:27:AE:96:91",
            service_uuid="62750001-d828-918d-fb46-b6c11c675aec",
            characteristic_uuid="62750002-d828-918d-fb46-b6c11c675aec",
        )


def resource_path(name: str) -> Path:
    return Path(str(files("epd_hourly_app.resources").joinpath(name)))
```

- [ ] **Step 4: 安装开发依赖、复制已验证测试图并运行测试**

Run: `.\.venv\Scripts\python.exe -m pip install -e ".[dev]"`

Run: `Copy-Item -LiteralPath .\epd_ble_test.png -Destination .\src\epd_hourly_app\resources\epd_ble_test.png`

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_config.py -q`

Expected: `2 passed`。

- [ ] **Step 5: 提交骨架**

```powershell
git add .gitignore pyproject.toml src tests/test_config.py
git commit -m "build: scaffold hourly EPD desktop app"
```

## Task 2: 实现与官方上位机一致的黑白图片编码

**Files:**

- Create: `src/epd_hourly_app/image_codec.py`
- Create: `tests/test_image_codec.py`

- [ ] **Step 1: 写位序、阈值、尺寸与资源图片测试**

```python
# tests/test_image_codec.py
import pytest
from PIL import Image

from epd_hourly_app.config import resource_path
from epd_hourly_app.image_codec import InvalidImageError, encode_black_white


def test_white_pixels_are_one_bits() -> None:
    image = Image.new("RGB", (8, 1), "white")
    assert encode_black_white(image, expected_size=(8, 1)) == b"\xff"


def test_pixels_are_packed_most_significant_bit_first() -> None:
    image = Image.new("RGB", (8, 1), "black")
    for x in (1, 3, 5, 7):
        image.putpixel((x, 0), (255, 255, 255))
    assert encode_black_white(image, expected_size=(8, 1)) == b"\x55"


def test_threshold_matches_official_encoder() -> None:
    image = Image.new("RGB", (8, 1), (139, 139, 139))
    image.putpixel((7, 0), (140, 140, 140))
    assert encode_black_white(image, expected_size=(8, 1)) == b"\x01"


def test_rejects_wrong_size() -> None:
    with pytest.raises(InvalidImageError, match="400×300"):
        encode_black_white(Image.new("RGB", (8, 1)), expected_size=(400, 300))


def test_fixed_image_encodes_to_15000_bytes() -> None:
    with Image.open(resource_path("epd_ble_test.png")) as image:
        encoded = encode_black_white(image, expected_size=(400, 300))
    assert len(encoded) == 15_000
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_image_codec.py -q`

Expected: FAIL，缺少 `image_codec`。

- [ ] **Step 3: 实现确定性的 1-bit 编码**

```python
# src/epd_hourly_app/image_codec.py
from PIL import Image, UnidentifiedImageError


class InvalidImageError(ValueError):
    pass


def encode_black_white(
    image: Image.Image,
    *,
    expected_size: tuple[int, int] = (400, 300),
    threshold: int = 140,
) -> bytes:
    if image.size != expected_size:
        width, height = expected_size
        raise InvalidImageError(f"图片尺寸必须为 {width}×{height}")
    rgb = image.convert("RGB")
    width, height = rgb.size
    byte_width = (width + 7) // 8
    output = bytearray(byte_width * height)
    for y in range(height):
        for x in range(width):
            red, green, blue = rgb.getpixel((x, y))
            gray = round(0.299 * red + 0.587 * green + 0.114 * blue)
            if gray >= threshold:
                output[y * byte_width + x // 8] |= 1 << (7 - x % 8)
    return bytes(output)
```

- [ ] **Step 4: 运行编码测试和完整测试**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_image_codec.py -q`

Expected: `5 passed`。

Run: `.\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过。

- [ ] **Step 5: 提交图片编码器**

```powershell
git add src/epd_hourly_app/image_codec.py tests/test_image_codec.py
git commit -m "feat: encode fixed image for EPD protocol"
```

## Task 3: 实现 EPD 命令、能力解析与图片分包

**Files:**

- Create: `src/epd_hourly_app/protocol.py`
- Create: `tests/test_protocol.py`

- [ ] **Step 1: 写协议常量、能力通知与现代/兼容分包测试**

```python
# tests/test_protocol.py
from epd_hourly_app.protocol import (
    Command,
    DeviceCapabilities,
    build_image_packets,
    parse_capabilities,
)


def test_parse_firmware_capability_notification() -> None:
    result = parse_capabilities(b"mtu=247 rle=1")
    assert result == DeviceCapabilities(packet_size=247, modern_flags=True)


def test_modern_raw_packets_use_first_and_followup_flags() -> None:
    packets = build_image_packets(b"abcdef", packet_size=5, modern_flags=True)
    assert packets == [
        bytes([Command.WRITE_IMAGE, 0x02]) + b"abc",
        bytes([Command.WRITE_IMAGE, 0x00]) + b"def",
    ]


def test_legacy_raw_packets_use_legacy_flags() -> None:
    packets = build_image_packets(b"abcd", packet_size=4, modern_flags=False)
    assert packets == [
        bytes([Command.WRITE_IMAGE, 0x0F]) + b"ab",
        bytes([Command.WRITE_IMAGE, 0xFF]) + b"cd",
    ]


def test_packet_never_exceeds_negotiated_size() -> None:
    packets = build_image_packets(bytes(range(40)), packet_size=17, modern_flags=True)
    assert max(map(len, packets)) <= 17
    assert b"".join(packet[2:] for packet in packets) == bytes(range(40))
```

- [ ] **Step 2: 运行并确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_protocol.py -q`

Expected: FAIL，缺少协议模块。

- [ ] **Step 3: 实现显式协议模型**

```python
# src/epd_hourly_app/protocol.py
import re
from dataclasses import dataclass
from enum import IntEnum


class Command(IntEnum):
    SET_PINS = 0x00
    INIT = 0x01
    CLEAR = 0x02
    SEND_COMMAND = 0x03
    SEND_DATA = 0x04
    REFRESH = 0x05
    SLEEP = 0x06
    SET_TIME = 0x20
    WRITE_IMAGE = 0x30


@dataclass(frozen=True, slots=True)
class DeviceCapabilities:
    packet_size: int
    modern_flags: bool


def parse_capabilities(payload: bytes) -> DeviceCapabilities | None:
    text = payload.decode("ascii", errors="ignore")
    match = re.search(r"mtu=(\d+)\s+rle=(\d+)", text)
    if not match:
        return None
    return DeviceCapabilities(
        packet_size=int(match.group(1)),
        modern_flags=match.group(2) == "1",
    )


def build_image_packets(
    data: bytes, *, packet_size: int, modern_flags: bool
) -> list[bytes]:
    if packet_size <= 2:
        raise ValueError("packet_size 必须大于 2")
    chunk_size = packet_size - 2
    first_flag, next_flag = ((0x02, 0x00) if modern_flags else (0x0F, 0xFF))
    packets: list[bytes] = []
    for offset in range(0, len(data), chunk_size):
        flag = first_flag if offset == 0 else next_flag
        packets.append(bytes((Command.WRITE_IMAGE, flag)) + data[offset : offset + chunk_size])
    return packets
```

- [ ] **Step 4: 运行测试并检查所有协议边界**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_protocol.py -q`

Expected: `4 passed`。

Run: `.\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过。

- [ ] **Step 5: 提交协议层**

```powershell
git add src/epd_hourly_app/protocol.py tests/test_protocol.py
git commit -m "feat: implement EPD packet protocol"
```

## Task 4: 实现可替换后端的原生 BLE 会话

**Files:**

- Create: `src/epd_hourly_app/ble_transport.py`
- Create: `tests/test_ble_transport.py`

- [ ] **Step 1: 用假 Bleak 客户端定义会话行为测试**

```python
# tests/test_ble_transport.py
import asyncio

from epd_hourly_app.ble_transport import BleSession
from epd_hourly_app.config import AppConfig
from epd_hourly_app.protocol import Command


class FakeCharacteristic:
    max_write_without_response_size = 247


class FakeServices:
    def get_service(self, _uuid: str):
        return object()

    def get_characteristic(self, _uuid: str):
        return FakeCharacteristic()


class FakeClient:
    def __init__(self) -> None:
        self.is_connected = False
        self.services = FakeServices()
        self.writes: list[tuple[bytes, bool]] = []
        self.disconnected = False
        self.notification = None

    async def connect(self, **_kwargs) -> None:
        self.is_connected = True

    async def start_notify(self, _uuid, callback) -> None:
        self.notification = callback

    async def write_gatt_char(self, _uuid, data, *, response) -> None:
        self.writes.append((bytes(data), response))
        if data == bytes((Command.INIT,)) and self.notification:
            self.notification(None, bytearray(b"mtu=247 rle=1"))

    async def stop_notify(self, _uuid) -> None:
        pass

    async def disconnect(self) -> None:
        self.disconnected = True
        self.is_connected = False


async def test_session_sends_expected_sequence_and_disconnects() -> None:
    client = FakeClient()
    session = BleSession(AppConfig.production(), client_factory=lambda _device: client)
    try:
        capabilities = await session.open()
        await session.send_image(b"x" * 15_000, capabilities)
    finally:
        await session.close()
    assert client.writes[0] == (bytes((Command.INIT,)), True)
    assert client.writes[1] == (bytes((Command.INIT,)), True)
    assert client.writes[-1] == (bytes((Command.REFRESH,)), True)
    image_writes = client.writes[2:-1]
    assert image_writes[49][1] is True
    assert all(not response for _, response in image_writes[:49])
    assert client.disconnected is True
```

- [ ] **Step 2: 运行并确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_ble_transport.py -q`

Expected: FAIL，缺少 `BleSession`。

- [ ] **Step 3: 实现直接地址连接、服务校验、通知握手与发送**

实现必须提供 `BleTransportError` 和 `BleSession`。`BleSession.__init__(config, client_factory=None)` 保存配置和可注入客户端工厂；`open() -> DeviceCapabilities` 连接固定缓存设备、验证服务与特征、订阅通知并发送首次 `INIT`；`send_image(encoded, capabilities) -> None` 再次发送 `INIT`、发送图片分包、每 50 包进行带响应写入并最终带响应写入 `REFRESH`；`close() -> None` 尽力停止通知并断开，而且可重复调用，不得掩盖原始发送异常。

生产实现使用已经通过探测验证的固定对象，避免启动浏览器或弹出设备选择器：

```python
device = BLEDevice(
    address=self._config.device_address,
    name=self._config.device_name,
    details=None,
)
self._client = self._client_factory(device)
await asyncio.wait_for(
    self._client.connect(), timeout=self._config.connect_timeout_seconds
)
```

能力通知在 `capability_timeout_seconds` 内到达时采用固件给出的 `mtu` 与现代 flag；超时则使用特征的 `max_write_without_response_size` 并进入旧 flag 兼容模式。服务或特征不存在、连接超时、写入失败都转换成包含阶段信息的 `BleTransportError`。

- [ ] **Step 4: 增加异常路径测试**

补充测试覆盖连接超时、服务缺失、特征缺失、能力通知超时回退、分包写入异常和 `close()` 幂等；测试超时使用立即抛出或可控 event，不真实等待 20 秒。

- [ ] **Step 5: 运行传输层及完整测试**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_ble_transport.py -q`

Expected: 全部通过，且测试耗时不包含真实蓝牙扫描或等待。

Run: `.\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过。

- [ ] **Step 6: 提交 BLE 会话层**

```powershell
git add src/epd_hourly_app/ble_transport.py tests/test_ble_transport.py
git commit -m "feat: add native BLE image transport"
```

## Task 5: 实现三次尝试、阶段日志与可靠释放

**Files:**

- Create: `src/epd_hourly_app/sender.py`
- Create: `tests/test_sender.py`

- [ ] **Step 1: 写成功、三次失败和重试前释放测试**

```python
# tests/test_sender.py
from dataclasses import dataclass

from epd_hourly_app.sender import ImageSender, SendOutcome


class FakeSession:
    def __init__(self, events: list[str], should_fail: bool) -> None:
        self.events = events
        self.should_fail = should_fail

    async def open(self):
        self.events.append("open")
        return object()

    async def send_image(self, _data, _capabilities) -> None:
        self.events.append("send")
        if self.should_fail:
            raise RuntimeError("write failed")

    async def close(self) -> None:
        self.events.append("close")


async def test_success_closes_session() -> None:
    events: list[str] = []
    sender = ImageSender(
        encoded_image=b"image",
        max_attempts=3,
        retry_delays=(0, 0),
        session_factory=lambda: FakeSession(events, should_fail=False),
    )
    result = await sender.send()
    assert result.outcome is SendOutcome.SUCCESS
    assert result.attempts == 1
    assert events == ["open", "send", "close"]


async def test_failure_releases_each_session_before_retry() -> None:
    events: list[str] = []
    sender = ImageSender(
        encoded_image=b"image",
        max_attempts=3,
        retry_delays=(0, 0),
        session_factory=lambda: FakeSession(events, should_fail=True),
    )
    result = await sender.send()
    assert result.outcome is SendOutcome.FAILURE
    assert result.attempts == 3
    assert events == ["open", "send", "close"] * 3
```

- [ ] **Step 2: 运行并确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_sender.py -q`

Expected: FAIL，缺少发送服务。

- [ ] **Step 3: 实现发送结果与重试循环**

```python
# src/epd_hourly_app/sender.py
from dataclasses import dataclass
from enum import Enum
from time import monotonic


class SendOutcome(Enum):
    SUCCESS = "success"
    FAILURE = "failure"


@dataclass(frozen=True, slots=True)
class SendResult:
    outcome: SendOutcome
    attempts: int
    elapsed_seconds: float
    message: str


class ImageSender:
    async def send(self) -> SendResult:
        """每次尝试创建新会话，finally 释放，失败后按配置退避。"""
```

成功 message 固定为“传输完成，屏幕刷新中”；最终失败 message 使用简洁中文概括最后一个阶段错误。日志回调接收结构化的 `attempt`、`stage`、`message`，供 GUI 转成带时间文本。重试 sleep 必须可注入，测试传入立即返回的 fake sleep。

- [ ] **Step 4: 补充日志、部分失败后成功和 close 自身异常测试**

确认第二次成功时 `attempts == 2`，且第一次 close 已发生；确认失败尝试中的 close 异常会记录但不会覆盖原始写入异常；确认图片和 `REFRESH` 已成功写入后的 close 异常只记录清理警告，不重新发送整张图片，避免重复刷新屏幕。

- [ ] **Step 5: 运行发送服务及完整测试**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_sender.py -q`

Expected: 全部通过。

Run: `.\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过。

- [ ] **Step 6: 提交发送服务**

```powershell
git add src/epd_hourly_app/sender.py tests/test_sender.py
git commit -m "feat: retry and release EPD transfers"
```

## Task 6: 用假时钟实现不等待 60 分钟的调度状态机

**Files:**

- Create: `src/epd_hourly_app/scheduler.py`
- Create: `tests/test_scheduler.py`

- [ ] **Step 1: 写全部周期语义测试**

```python
# tests/test_scheduler.py
from epd_hourly_app.scheduler import HourlyController, Trigger


class FakeClock:
    def __init__(self) -> None:
        self.value = 1_000.0

    def now(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def test_start_requests_immediate_send() -> None:
    clock = FakeClock()
    controller = HourlyController(interval_seconds=3600, now=clock.now)
    assert controller.start() is Trigger.AUTOMATIC


def test_completion_schedules_exactly_one_hour_later() -> None:
    clock = FakeClock()
    controller = HourlyController(interval_seconds=3600, now=clock.now)
    controller.start()
    controller.complete(success=True)
    clock.advance(3599)
    assert controller.tick() is None
    clock.advance(1)
    assert controller.tick() is Trigger.AUTOMATIC


def test_manual_success_resets_existing_deadline() -> None:
    clock = FakeClock()
    controller = HourlyController(interval_seconds=3600, now=clock.now)
    controller.start()
    controller.complete(success=True)
    clock.advance(1800)
    assert controller.send_now() is Trigger.MANUAL
    controller.complete(success=True)
    clock.advance(3599)
    assert controller.tick() is None
    clock.advance(1)
    assert controller.tick() is Trigger.AUTOMATIC


```

在同一测试文件继续实现五个完整测试：手动失败保留原 deadline；自动失败从结束时建立新 deadline；停止后推进任意时间都不触发；重新启动立即产生自动 trigger；busy 时拒绝重复 trigger。每个测试都使用 `FakeClock.advance()`，不得调用真实 sleep。

- [ ] **Step 2: 运行并确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_scheduler.py -q`

Expected: FAIL，缺少调度模块。

- [ ] **Step 3: 实现纯状态机**

```python
# src/epd_hourly_app/scheduler.py
from collections.abc import Callable
from enum import Enum


class Trigger(Enum):
    AUTOMATIC = "automatic"
    MANUAL = "manual"


```

`HourlyController` 构造参数为 `interval_seconds: int` 和 `now: Callable[[], float]`，公开方法为 `start() -> Trigger | None`、`stop() -> None`、`send_now() -> Trigger | None`、`tick() -> Trigger | None`、`complete(success: bool) -> None` 和 `seconds_remaining() -> int | None`。控制器必须记录当前 trigger，从而区分“自动任务失败后从失败结束时开始新周期”和“手动任务失败后保留原倒计时”。忙碌期间 `start()`、`send_now()` 和 `tick()` 不得发出第二个 trigger。`seconds_remaining()` 使用向上取整，避免刚设置周期就显示 `59:59`。

- [ ] **Step 4: 运行调度测试，确认无需真实等待**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_scheduler.py -q --durations=5`

Expected: 全部通过，整个文件在数秒内完成，不存在 `sleep(3600)`。

Run: `.\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过。

- [ ] **Step 5: 提交调度状态机**

```powershell
git add src/epd_hourly_app/scheduler.py tests/test_scheduler.py
git commit -m "feat: schedule hourly EPD transfers"
```

## Task 7: 构建简约、清晰且线程安全的桌面界面

**Files:**

- Create: `src/epd_hourly_app/worker.py`
- Create: `src/epd_hourly_app/ui.py`
- Create: `src/epd_hourly_app/styles.py`
- Create: `tests/test_ui.py`

- [ ] **Step 1: 写初始视觉层级和控件语义测试**

```python
# tests/test_ui.py
from epd_hourly_app.ui import MainWindow


def test_window_exposes_clear_primary_information(qtbot, app_harness) -> None:
    window = MainWindow(app_harness)
    qtbot.addWidget(window)
    assert window.windowTitle() == "墨水屏定时助手"
    assert window.status_title.text() == "准备发送"
    assert window.device_value.text() == "NRF-EPD-9691"
    assert window.countdown_value.text() == "立即发送"
    assert window.send_now_button.text() == "立即发送"
    assert window.start_button.text() == "启动自动发送"
    assert window.stop_button.text() == "停止自动发送"
    assert window.log_panel.isHidden()


```

在同一测试文件继续实现四个完整测试：busy 状态禁用重复发送；停止时保留正在运行的 worker 但清除倒计时；成功结果只显示“传输完成，屏幕刷新中”；日志按钮可展开和折叠。`app_harness` 提供可手动完成的 fake worker，测试不启动真实线程和蓝牙。

- [ ] **Step 2: 运行并确认失败**

Run: `$env:QT_QPA_PLATFORM='offscreen'; .\.venv\Scripts\python.exe -m pytest tests/test_ui.py -q`

Expected: FAIL，缺少窗口实现。

- [ ] **Step 3: 实现后台 worker 和窗口组合逻辑**

```python
# src/epd_hourly_app/worker.py
class SendWorker(QThread):
    progress = Signal(object)
    completed = Signal(object)

    def __init__(self, sender_factory, parent=None):
        super().__init__(parent)
        self._sender_factory = sender_factory

    def run(self) -> None:
        result = asyncio.run(self._sender_factory(self.progress.emit).send())
        self.completed.emit(result)
```

`MainWindow` 使用 1 秒 `QTimer` 调用控制器 `tick()` 并刷新倒计时。只有控制器返回 trigger 且没有活动 worker 时才启动 `SendWorker`。worker 结束后先更新最近结果、日志和按钮，再调用控制器 `complete()`。停止自动发送时立即隐藏下一次时间，但不终止活动 worker。关闭窗口时若正在发送，记录 pending close，禁用操作并显示“正在安全结束当前传输”，worker 完成后真正退出。

- [ ] **Step 4: 实现明确的单列界面结构**

窗口建议固定最小宽度 720 px，默认约 760×720 px。自上而下实现状态卡、测试图与最近结果双列卡、操作区和可折叠日志；窄窗口时保持最小宽度，不做会破坏信息层级的动态挤压。

```text
┌─────────────────────────────────────────────┐
│ 墨水屏定时助手                    自动发送中 │
│                                             │
│ 下一次发送                                  │
│ 59:42                         NRF-EPD-9691  │
├─────────────────────┬───────────────────────┤
│ 固定测试图预览      │ 最近一次              │
│ [400×300 等比缩放]  │ 传输完成，屏幕刷新中  │
│                     │ 2026-09-20 14:36      │
├─────────────────────┴───────────────────────┤
│ [立即发送] [启动自动发送] [停止自动发送]   │
│ ▸ 运行日志                                  │
└─────────────────────────────────────────────┘
```

- [ ] **Step 5: 建立克制且一致的 QSS 设计系统**

```python
# src/epd_hourly_app/styles.py
COLORS = {
    "window": "#F5F7FA",
    "surface": "#FFFFFF",
    "text": "#18212F",
    "muted": "#64748B",
    "accent": "#2563EB",
    "accent_hover": "#1D4ED8",
    "success": "#15803D",
    "warning": "#B45309",
    "danger": "#B91C1C",
    "border": "#E2E8F0",
}
```

字体优先使用 `Segoe UI` 与 `Microsoft YaHei UI`。卡片统一 12 px 圆角、16–20 px 内边距和 12–16 px 间距。主按钮仅“立即发送”使用强调色，启动与停止使用次级样式；禁用态保持文字可读。不要加入渐变、阴影动画、装饰图标或无限旋转动画。连接中使用简短状态文字和静态进度条即可。

- [ ] **Step 6: 完成 UI 行为测试和无障碍状态检查**

补充测试验证失败状态包含“失败”文字、按钮可重新尝试、日志每行含时间与阶段、预览保持纵横比、窗口关闭时不遗留运行线程。测试通过 objectName 或公开 view-model 状态定位控件，不依赖像素坐标。

- [ ] **Step 7: 运行 UI 与完整测试**

Run: `$env:QT_QPA_PLATFORM='offscreen'; .\.venv\Scripts\python.exe -m pytest tests/test_ui.py -q`

Expected: 全部通过。

Run: `$env:QT_QPA_PLATFORM='offscreen'; .\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过且无 `QThread: Destroyed while thread is still running` 警告。

- [ ] **Step 8: 提交 GUI**

```powershell
git add src/epd_hourly_app/worker.py src/epd_hourly_app/ui.py src/epd_hourly_app/styles.py tests/test_ui.py
git commit -m "feat: add clear minimal desktop interface"
```

## Task 8: 组装正式入口并验证真实设备单次发送

**Files:**

- Create: `src/epd_hourly_app/main.py`
- Create: `tests/test_main.py`

- [ ] **Step 1: 写依赖组装测试**

测试 `build_application()` 使用生产配置、固定资源图、`BleSession`、`ImageSender` 和 `HourlyController`，但允许测试注入 fake sender factory，避免导入模块时自动连接真实设备。

```python
# tests/test_main.py
def test_import_has_no_ble_or_window_side_effects() -> None:
    import epd_hourly_app.main

    assert callable(epd_hourly_app.main.main)
```

- [ ] **Step 2: 运行并确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_main.py -q`

Expected: FAIL，缺少入口模块。

- [ ] **Step 3: 实现无控制台依赖的 GUI 入口**

```python
# src/epd_hourly_app/main.py
import sys
from PySide6.QtWidgets import QApplication


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("墨水屏定时助手")
    window = build_main_window()
    window.show()
    window.start_automatic()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
```

`build_main_window()` 在显示窗口前打开并编码资源图片；图片无效时仍显示窗口，但状态卡给出明确错误且不启动 worker。不得在模块 import 时创建 `QApplication`、连接蓝牙或启动线程。

- [ ] **Step 4: 运行完整自动测试**

Run: `$env:QT_QPA_PLATFORM='offscreen'; .\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部通过，不访问真实蓝牙，不等待 60 分钟。

- [ ] **Step 5: 在已断开网页连接的前提下执行真实单次验证**

Run: `.\.venv\Scripts\python.exe -m epd_hourly_app.main`

人工验收：应用自行连接 `NRF-EPD-9691`；界面依次显示连接、传输进度和“传输完成，屏幕刷新中”；实体墨水屏显示固定 `BLE TEST` 图片；日志记录耗时；传输后 GATT 被释放；倒计时从 `60:00` 开始。无需等待完整 60 分钟。

若真实设备失败，只按系统化调试流程收集阶段日志并修正根因；不得通过扩大无限重试、要求打开网页或要求手动选择蓝牙来绕过。

- [ ] **Step 6: 提交入口和真实设备兼容修正**

```powershell
git add src/epd_hourly_app/main.py tests/test_main.py
git commit -m "feat: launch automatic EPD desktop workflow"
```

## Task 9: 打包 Windows 桌面应用并完成交付验证

**Files:**

- Create: `epd_hourly_app.spec`
- Create: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: 编写 PyInstaller spec，显式包含图片资源**

```python
# epd_hourly_app.spec
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("bleak.backends.winrt")

a = Analysis(
    ["src/epd_hourly_app/main.py"],
    pathex=["src"],
    binaries=[],
    datas=[
        (
            "src/epd_hourly_app/resources/epd_ble_test.png",
            "epd_hourly_app/resources",
        )
    ],
    hiddenimports=hiddenimports,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="EPD Hourly",
    console=False,
)
```

- [ ] **Step 2: 写清安装、开发运行、测试、打包和验收边界**

`README.md` 使用中文说明应用启动即发送、每轮结束后 60 分钟再发送、停止按钮语义、关闭即退出、蓝牙必须开启、设备地址固定、成功文案只代表 GATT 传输被接受，以及如何查看折叠日志。不要把诊断脚本描述为最终用户入口。

- [ ] **Step 3: 执行静态占位符与差异检查**

Run: `rg -n "TODO|FIXME|pass$|NotImplemented|\.\.\." src tests README.md epd_hourly_app.spec`

Expected: 无实现占位符；测试函数名或合法省略符也应在提交前消除。

Run: `git diff --check`

Expected: 无错误。

- [ ] **Step 4: 执行最终自动验证**

Run: `$env:QT_QPA_PLATFORM='offscreen'; .\.venv\Scripts\python.exe -m pytest -q`

Expected: 全部测试通过且总时长不包含 60 分钟等待。

- [ ] **Step 5: 构建 windowed 可执行程序**

Run: `.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean .\epd_hourly_app.spec`

Expected: 生成 `dist\EPD Hourly.exe`，双击后只有桌面窗口，不出现控制台窗口。

- [ ] **Step 6: 对打包产物做真实设备冒烟验证**

Run: `Start-Process -FilePath '.\dist\EPD Hourly.exe'`

人工验收：窗口视觉与源码运行一致；测试图预览正常；首次主动连接并发送成功；停止、启动和立即发送按钮状态清楚；关闭窗口后任务管理器中不再存在该进程。为避免等待一小时，本阶段只验证首次发送与按钮调度；60 分钟逻辑由假时钟自动测试覆盖。

- [ ] **Step 7: 提交打包配置与文档**

```powershell
git add .gitignore epd_hourly_app.spec README.md
git commit -m "build: package EPD hourly Windows app"
```

## Final Verification Gate

- [ ] 对照设计文档逐段检查范围、界面、调度、协议、错误、测试、交付物和非目标，记录任何偏差并修正。
- [ ] 确认 `git status --short` 只保留明确决定不纳入正式应用的诊断脚本或其他已知文件。
- [ ] 确认所有自动测试刚刚实际运行通过，不引用较早结果。
- [ ] 确认 `dist\EPD Hourly.exe` 是本轮代码重新构建的产物。
- [ ] 确认真实设备验收只报告亲眼观察到的画面；程序状态只报告 GATT 传输结果。
- [ ] 确认最终交付说明明确指出：本阶段未等待真实 60 分钟，周期正确性由假时钟测试验证，长时间稳定性仍需用户后续运行观察。
