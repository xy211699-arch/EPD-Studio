# 墨水屏本地网页手动上传实施计划

**目标：** 在 Windows 的 Microsoft Edge 中交付一份本地网页，用户手动连接或同页重连、选图预览、裁剪与抖动、点击一次上传，并能看到真实的连接和写入结果。

**架构：** 从用户验证过的网页取得静态前端快照，保留图片编码与 Web Bluetooth 协议，针对失败传播和状态控制做小范围修改。用仅绑定 `127.0.0.1` 的本地静态服务提供固定来源，EVA-CLIENT 风格仅影响界面层，不接管传输层。

**技术栈：** HTML、CSS、浏览器 JavaScript、Web Bluetooth、Node.js 内置 `node:test`、Python 3.13 标准库、Microsoft Edge。当前环境已检查到 Node.js v24.18.0、Python 3.13.5 和 Edge 安装路径；交付说明要写明所需环境，不能假定其他电脑与当前电脑相同。

**设计依据：** `docs/superpowers/specs/2026-09-24-manual-epd-web-design.md`。旧的 `docs/superpowers/plans/2026-09-24-hourly-web-epd.md` 已失效，执行时不得引用其定时或自动连接要求。

## 全局约束与复核重点

本阶段不实现定时发送、自动连接、断线自动重连、自动重试、自动构图、GPT/Codex 额度读取、固件升级或硬件配置。所有实体 BLE 测试都由用户在 Edge 中主动选择设备后进行，旧 EXE 需先退出。单次 GATT 写入成功只代表传输命令被接受，不证明屏幕画面正确；最终画面由用户确认。源站目前的 `write()` 在写入失败时返回 `false`，而 `writeImage()` 忽略该结果，必须在保持协议字节不变的前提下修复。

复核时特别覆盖五类输入和状态：没有选择图片时不得上传；页面尚无 `BluetoothDevice` 对象时“重连”不可用；连接在图片传输中断开时不得继续发 `REFRESH`；画布尺寸或颜色模式与设备驱动不匹配时不得默认继续上传；页面重载后不得显示旧连接或自动发送。这五类情形各由下文对应任务的自动测试或 Edge 验收固定下来。

## 文件结构与接口约定

创建 `web-epd/index.html`、`web-epd/css/app.css`、`web-epd/js/main.js`、`web-epd/js/dithering.js`、`web-epd/js/rle.js`、`web-epd/js/paint.js`、`web-epd/js/crop.js`、`web-epd/favicon.png` 和 `web-epd/assets/epd_ble_test.png`。原站文件先原样快照，再记录每个文件的来源 URL、获取日期和 SHA-256 于 `web-epd/SOURCE.md`；必要修改集中在 `index.html`、`css/app.css` 和 `js/main.js`，不改动其余协议或图像算法文件。另建 `web-epd/js/upload-state.js` 管理界面状态，`web-epd/server.py`、`launch.pyw`、`stop.pyw` 管理本地页面服务，`web-epd/tests/` 保存 Node 与 Python 自动测试，`web-epd/README.md` 写用户操作和限制。

`upload-state.js` 用经典脚本可访问的 `globalThis.EpdUploadState.createUploadState()` 暴露纯状态对象，脚本加载顺序在 `main.js` 之前。对象含 `status`、`hasDevice`、`hasImage`、`busy` 属性和 `canReconnect()`、`canUpload()`、`setStatus(next)`、`setDevice(deviceOrNull)`、`setImage(isReady)` 方法；`status` 只取 `idle`、`connecting`、`connected`、`sending`、`error`，其中 `canReconnect()` 要求存在设备且当前未连接、未连接中、未传输，`canUpload()` 要求已连接、图片可用且未传输。`main.js` 继续保留源站 `preConnect()`、`reConnect()`、`connect()`、`write()`、`writeImage()`、`sendimg()` 作为页面调用入口；`writeImage()` 遇到任何分包写入失败时抛出带阶段和包序号的错误，`sendimg()` 返回成功或失败结果，且只在所有图片包写入成功后发送 `REFRESH`。`server.py` 提供 `make_server()` 和只对本项目响应的健康、停止入口；启动、停止脚本不含 BLE 代码。

## 任务：固定源站基线并建立本地服务

先对 `web-epd/SOURCE.md` 和本地服务写失败测试：逐个检查 HTML、CSS、五个 JavaScript 文件和图标的本地存在性、非零长度及来源记录；检查服务只绑定 `127.0.0.1:8765`，健康入口有本项目专用标识，端口占用时清楚报错。随后获取源站文件、核对脚本加载顺序、记录 SHA-256，移除百度统计等与本地上传无关的外部脚本，并实现 `server.py`、`launch.pyw` 和 `stop.pyw`。启动脚本必须双击后打开 Edge；停止脚本先验证本项目健康标识再请求停止，不能按端口号盲目终止其他进程；如果 Edge 或 Python 不可用，显示可见错误。

本任务的测试文件为 `web-epd/tests/test_server.py` 和 `web-epd/tests/source.test.mjs`。前者用临时端口实例验证静态服务、停止入口和端口冲突，后者用文件系统断言静态基线；测试不启动真实 Edge 或蓝牙。失败测试写好后先运行并记录预期失败，再实现最小功能，运行以下命令并提交这一任务的文件。

```powershell
python -m unittest discover -s web-epd/tests -p 'test_*.py' -v
node --test web-epd/tests/source.test.mjs
git add -- web-epd
git commit -m "feat: snapshot EPD web source and add local launcher"
```

## 任务：修复上传失败传播与单次传输互斥

先在 `web-epd/tests/transfer.test.mjs` 用 Node 的 `vm` 加载经典脚本 `js/main.js`，提供假 `document`、假画布、假 `write()` 和假连接。测试的核心断言是：第一个图片包写入返回 `false` 时 `writeImage()` 抛错并停止后续包；中间包失败时同样停止；初始化失败时不发图片包；任一图片包失败时不发 `REFRESH`；刷新写入失败时结果是失败而不是“发送完成”；传输中第二次点击不创建并发传输。假特征记录命令序列，测试不得访问实体设备。

先让这些断言在源站快照上失败，再最小修改 `js/main.js`：将 `writeImage()` 内每次 `await write(EpdCmd.WRITE_IMG, ...)` 的返回值检查为严格成功，否则抛出包含阶段、包序号和总包数的错误；`sendimg()` 以 `try/catch/finally` 确保忙碌标记恢复、日志可见，并在失败路径不调用刷新命令。`sendimg()` 在读取画布前检查有效图片、GATT 连接和裁剪已完成；驱动尺寸或颜色模式不匹配时阻止发送并提示人工核对，而不是沿用源站的“仍可继续”确认框。保持源站现有压缩、分包标志、命令顺序和默认参数不变。运行下面的测试与语法检查，再提交。

```powershell
node --test web-epd/tests/transfer.test.mjs
node --check web-epd/js/main.js
git add -- web-epd/js/main.js web-epd/tests/transfer.test.mjs
git commit -m "fix: stop EPD upload on failed GATT writes"
```

## 任务：连接状态与用户触发的重连

先在 `web-epd/tests/state.test.mjs` 测试 `createUploadState()` 的可用条件：初次打开、连接中、已选设备但断线、已连接但未选图、已连接且已有图、传输中和失败后。再在 `web-epd/tests/connection.test.mjs` 用假 `BluetoothDevice` 与假 GATT 对象执行 `preConnect()` 和 `reConnect()`：首次连接只由用户点击 `preConnect()` 触发设备选择；同页断线后 `reConnect()` 复用保存的设备对象且不调用 `requestDevice()`；没有对象时 `reConnect()` 不做连接；重复点击不会并发连接；页面重新初始化为未连接、无设备。测试中由假的断开事件驱动状态变化，不等待真实五分钟。

在 `js/main.js` 增加连接互斥与空设备保护，保留源站手动重连路径，不添加自动重连监听器。断开后保留图片、画布与处理选择，只更新连接状态；连接失败和用户取消设备选择应显示不同提示。`upload-state.js` 作为纯状态模块供界面使用，按钮是否可点只从真实连接、设备对象、图片可用性和忙碌状态计算，不从按钮文案推断。运行下面的测试并提交。

```powershell
node --test web-epd/tests/state.test.mjs web-epd/tests/connection.test.mjs
node --check web-epd/js/upload-state.js
git add -- web-epd/js/main.js web-epd/js/upload-state.js web-epd/tests/state.test.mjs web-epd/tests/connection.test.mjs
git commit -m "feat: preserve manual EPD reconnect with truthful state"
```

## 任务：EVA-CLIENT 风格的单页上传界面

先在 `web-epd/tests/ui.test.mjs` 对 `index.html` 进行结构测试：必须保留连接、重连、文件选择、裁剪、抖动、画布、上传、状态与日志的入口以及源脚本正确顺序；不得出现面向用户的固件、引脚、任意命令和自动发送按钮；状态和错误不能只靠颜色。另用独立测试检查无图片、断线、传输中与页面重载时上传按钮的禁用条件，并检查原站脚本初始化在删去画笔与文字控件后不会访问空元素。

修改 `index.html` 为单页双栏：深色窄状态栏、引导条、左侧连接及图片操作卡片、右侧大画布预览，底部可展开日志与高级传输参数。`css/app.css` 使用已批准的暖灰画布 `#F4F3F1`、白色卡片、深墨色 `#1F1E1C` 和橙色主操作 `#E8590C`，保证窄窗口纵向排列与明确焦点样式。保留裁剪和抖动所需 DOM 节点，移除涂鸦、文字和危险命令的可见入口；同步调整 `main.js` 的 `updateButtonStatus()` 与初始化代码，不能只用 CSS 隐藏被删功能后保留会报错的节点引用。上传时显示阶段与包计数，写入完成显示“传输命令已完成，请检查屏幕”，错误在主界面可见，详细日志可展开。

在浏览器接触设备前，先运行结构测试和 Node 测试，再用 Edge 打开本地页面人工检查 1280 像素桌面窗口与窄窗口的布局、键盘焦点、无图状态和日志展开。这个人工检查只加载页面，不点击“连接”或“上传”。

```powershell
node --test web-epd/tests/ui.test.mjs web-epd/tests/state.test.mjs web-epd/tests/transfer.test.mjs web-epd/tests/connection.test.mjs
node --check web-epd/js/main.js
git add -- web-epd/index.html web-epd/css/app.css web-epd/js/main.js web-epd/tests/ui.test.mjs
git commit -m "feat: add EVA-inspired manual image upload workspace"
```

## 任务：集成验证、文档与实体设备停点

先运行全部 Python 和 Node 测试，再核对 `SOURCE.md` 中的来源与校验值，检查本地页面没有外部统计脚本，也没有未经用户点击而发起的 BLE 调用。用 Edge 在 `http://localhost:8765/` 验证页面、图片加载、裁剪与抖动预览以及可展开日志；使用项目根目录固定图 `epd_ble_test.png` 的副本，复制前核对 SHA-256 为 `F79E4BFAFA616C44F306BAA25476D3775775BE315886CFB0596B046C6500DF96`。`README.md` 写明双击启动与停止、手动连接、同页重连、页面刷新需重新连接、传输状态含义、故障处理、旧 EXE 不得同时运行以及未来自动构图并未实现。

实体设备验收必须作为明确的停点：先向用户展示本地页面，只有用户主动在 Edge 设备选择器中选定墨水屏后才发送一张固定测试图；用户确认屏幕完整显示后，再由用户决定是否测试断线后的“重连”和另一张图片。若设备不可见、连接失败、刷新异常或屏幕画面不完整，应停在诊断，不循环发送、不改固件或硬件参数。任何自动测试通过都不得写成实体设备已经成功显示。

```powershell
python -m unittest discover -s web-epd/tests -p 'test_*.py' -v
node --test web-epd/tests/source.test.mjs web-epd/tests/transfer.test.mjs web-epd/tests/state.test.mjs web-epd/tests/connection.test.mjs web-epd/tests/ui.test.mjs
git diff --check
git add -- web-epd/README.md web-epd/SOURCE.md web-epd/assets/epd_ble_test.png web-epd/tests
git commit -m "docs: document safe manual EPD upload and validation"
```

## 完成判定与交接

自动测试全通过、本地页面在 Edge 中无初始化错误、连接与重连按钮条件真实、每轮只在人工点击后上传、写入失败不继续发送刷新命令，才可进入实体设备测试。实体屏幕画面是否正确必须记录为用户观察结果，而不是测试框架推定。未来自动构图只作为新的图片来源接入现有预览和手动上传流程；读取何种额度及授权数据源须在未来阶段另行确认。
