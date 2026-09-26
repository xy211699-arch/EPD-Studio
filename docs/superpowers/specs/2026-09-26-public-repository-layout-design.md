# EPD Studio 公开仓库结构整理

## 目标与边界

让 GitHub 仓库呈现清晰、常见的开源项目目录，而不改变蓝牙连接、图片编码、额度读取、看板生成或上传行为。用户提供的 970x461 PNG 仅作为 README 顶部横向标识；网页继续使用当前 `epd-icon.svg` favicon。公开的 `reference` 快照及其来源记录必须保留。

## 目录

仓库根目录保留 `README.md`、`LICENSE`、`THIRD_PARTY.md`、`.gitignore` 和 `.github/`。运行时网页与 Python 脚本从 `web-epd/` 迁入 `app/`，自动测试迁入根目录 `tests/`，公开素材放在根目录 `assets/`，第三方来源快照保留在 `reference/`。`docs/superpowers/` 是历史设计与实施过程文件，不属于用户运行或理解项目所需的发布文件，应退出最终公开树；Git 历史仍可追溯。

`reference/epdiy-2026-09-24/` 与 `reference/official-epd-nrf5-2026-09-25/` 分别改为 `reference/epdiy/` 与 `reference/epd-nrf5/`；获取日期和哈希仍留在各自的 manifest 与来源说明中。`web-epd/README.md` 与 `QUOTA.md` 的非重复、安全相关操作说明合并为根目录 `USAGE.md`，`SOURCE.md` 的来源记录合并为 `reference/README.md`。不删除运行所需的历史站点 JavaScript、CSS 或测试样例。

## 命名与图片

将已不符合动态行为的 `static-dashboard.js` 改为 `dashboard.js`，`quota-state.js` 改为 `quota.js`，`view-tabs.js` 改为 `tabs.js`，`upload-state.js` 改为 `upload.js`。其余协议相关脚本保持原名，避免为了命名而大范围改写。根目录 `assets/logo.png` 使用用户提供的 PNG 原图，不重绘、不裁掉字母；README 按横向比例展示。网页当前 favicon 移为 `app/favicon.svg`，继续由 `app/index.html` 引用。旧的历史站点 `favicon.png` 不再放在运行目录，转入 `reference/legacy/favicon.png` 并保留来源记录。

## 迁移验证

同步更新 `index.html` 的资源路径、README 的启动命令、CI 命令、Python 与 Node 测试的文件路径，以及来源文档中的相对链接。`python app/launch.py` 必须仍只启动本地网页，不改变端口范围和设备操作边界。验证包含全部 Python/Node 测试、脚本语法、README 图片与网页 favicon 路径、静态资源可访问性和 `git diff --check`；不自动连接或写入实体墨水屏。

## 发布

完成迁移并审查 Git 暂存清单后，只提交本次结构整理与用户图标，不纳入工作区外的聊天附件目录、缓存或调试文件。推送前核对远程 `main` 与本地基线，采用普通快进推送，不覆盖远程新提交。
