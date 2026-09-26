# 墨水屏自定义项目

前提：本项目基于 [EPD-nRF5](https://github.com/tsl0922/EPD-nRF5) 开发，感谢大佬开源。><

## 已实现功能

自定义图片上传、连接后的电池电量读取、Codex 额度读取，以及按当前日期手动生成每日看板模板。

## 未实现功能

墨水屏的 30 分钟自动刷新和更高清的内容显示暂未实现。由于硬件连接会在一段时间后断开，使用时需要手动点击“重连”。

## 如何使用

在 Windows 上运行启动脚本：

```powershell
python web-epd\launch.py
```

脚本会打开 Edge 本地网页。在页面中选择蓝牙设备 `NRF-EPD-XXXX` 完成配对后即可使用 Original 或 Custom 视图。

## 注意事项

目前只支持 Windows；读取 Codex 额度需要安装并登录 Codex；上传图片时不要中止传输。网页提示传输完成后，仍需检查实体墨水屏是否正确显示。

## 许可与致谢

本项目按 GPL-3.0 发布，许可说明见 [`LICENSE`](LICENSE)。感谢 [EPD-nRF5](https://github.com/tsl0922/EPD-nRF5) 项目及其开源贡献。
