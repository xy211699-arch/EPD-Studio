# 静态三色看板与双视图上传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 保留已验收的普通图片上传页，在同一网页加入 EVA 风格双视图切换，并让用户生成、预览、手动上传 400×300 静态黑白红看板。

**Architecture:** 两个视图同属当前 HTML 文档，复用同一 Web Bluetooth 会话，分别持有文件预览和生成点阵状态。独立的点阵模块只输出三色像素；main.js 根据明确的图片来源选择数据，但所有设备检查与写入仍走原 sendimg 链路。

**Tech Stack:** Windows 上的 Microsoft Edge、原生 HTML/CSS/JavaScript Canvas、现有 Python 本地静态服务、Node.js 内置 node:test 与 Python unittest；不增加运行时依赖。

**Spec:** docs/superpowers/specs/2026-09-24-static-dashboard-upload-design.md

## Global Constraints

工作目录为 C:/Users/35542/Desktop/Bluetooth connect/.worktrees/epd-manual-web；保护当前未提交的 launcher、server、来源快照和其他用户改动，不做重置或批量覆盖。

第一版只复现参考图片的静态版式与示例值，不读取 Codex 账户，不自动更新时间、连接、重连、重试或上传。

自定义来源只允许设备报告驱动 0x16、尺寸 400×300、颜色 black/white/red，并要求有效槽位；不允许通过高级参数绕过设备配置。

不增加 SET_TIME、CLEAR、SET_PINS、SET_CONFIG、固件升级或原始命令；仍使用当前手动上传的 SET_SLOT、INIT、WRITE_IMG 两平面、REFRESH 顺序和写入失败即中止规则。

生成图像含 120000 个纯白、纯黑、纯红像素，经现有编码后黑白与红色平面各为 15000 字节；不对生成图像应用照片缩放或误差扩散抖动。

任何自动测试不得连接真实设备；实体屏显示仅由用户在最终阶段手动验收。

## Review Focus

无效视图键或重复点击当前标签不得重新加载页面或触发蓝牙；由 Task 1 的 tab controller 测试固定。

新视图连接按钮必须与旧按钮同步显示连接、断开、重连状态；由 Task 3 的连接状态测试固定。

两次生成相同静态内容必须得到相同像素，且不修改旧视图所选文件；由 Task 2 与 Task 3 的状态测试固定。

像素数组长度错误或出现第四种颜色时，必须在 SET_SLOT/INIT 前拒绝；由 Task 2 与 Task 3 的数据校验测试固定。

设备配置不匹配、槽位无效或任一图片包失败时，不得发送 REFRESH；由 Task 3 的模拟 BLE 测试固定。

---

## File Map

web-epd/index.html 增加两个标签与两个视图容器，原上传视图内的现有 ID 和控件保持不变；新视图增加独立的连接按钮、静态生成按钮、预览画布、状态和手动上传按钮。

web-epd/css/app.css 增加 EVA 风格标签栏、新视图布局、三色画布像素预览和窄屏规则；不重做原页面基础视觉。

web-epd/js/view-tabs.js 只负责同页视图切换、可访问性属性与忙碌状态锁定，不持有蓝牙对象。

web-epd/js/static-dashboard.js 只负责固定布局的三色像素生成、浏览器字形取样、像素校验和转 ImageData，不调用 Web Bluetooth。

web-epd/js/main.js 保存两个图片来源的状态，复用 sendimg 的设备检查与写入；同步两组连接按钮与状态。

web-epd/tests/tabs.test.mjs 和 web-epd/tests/dashboard.test.mjs 测试新模块；现有 ui.test.mjs、connection.test.mjs、transfer.test.mjs 增加集成回归。web-epd/README.md 记录静态内容与手动验收边界。

## Preflight

实施者先读取规格、git status、上述文件及测试，并用 git diff 记录将要触及文件的原有改动，不清理当前脏工作区。随后在 web-epd 上级目录运行 node --test web-epd/tests/*.test.mjs 与 python -m unittest discover -s web-epd/tests -p 'test_*.py' -v，并记录基线失败；若失败与本计划无关，先报告而不是修改无关文件。当前 index.html、main.js、README.md 和部分测试本就有未提交改动，实施中只增量编辑、审查本次差异；不按文件整体暂存或提交，除非能逐块确认完全不包含用户原有改动。

### Task 1: 同页双视图切换

**Files:**
- Create: web-epd/js/view-tabs.js
- Create: web-epd/tests/tabs.test.mjs
- Modify: web-epd/index.html
- Modify: web-epd/css/app.css
- Modify: web-epd/js/main.js
- Modify: web-epd/tests/ui.test.mjs

**Interfaces:**
- Consumes: 当前网页的两个视图 DOM 节点；由 main.js 注入 isBusy()。
- Produces: EpdViewTabs.create({tabs, panels, isBusy, onSelect})，返回 {select(id), active}；视图键固定为 file、custom。

- [ ] **Step 1: 先写失败的切换测试。**

~~~js
test('file is default; custom switch preserves nodes and invokes no Bluetooth', () => {
  const app = makeTabsHarness();
  assert.equal(app.controller.active, 'file');
  assert.equal(app.panels.file.hidden, false);
  assert.equal(app.panels.custom.hidden, true);
  assert.equal(app.controller.select('custom'), true);
  assert.equal(app.panels.file.hidden, true);
  assert.equal(app.panels.custom.hidden, false);
  assert.equal(app.bluetoothCalls(), 0);
});

test('unknown tab, same tab, or busy transfer causes no transition', () => {
  const app = makeTabsHarness();
  assert.equal(app.controller.select('missing'), false);
  assert.equal(app.controller.select('file'), false);
  app.setBusy(true);
  assert.equal(app.controller.select('custom'), false);
  assert.equal(app.controller.active, 'file');
});
~~~

测试中的 makeTabsHarness 以 vm 加载 view-tabs.js，提供两个可记录 hidden、aria-selected、tabIndex、focus 调用的假 DOM 按钮与面板；再加一个键盘事件测试验证 ArrowRight、ArrowLeft、Home、End。增强 ui.test.mjs，断言现有控件 ID 原样存在、默认 file 视图可见、自定义视图初始隐藏，且新脚本在 main.js 前加载。

- [ ] **Step 2: 运行 node --test web-epd/tests/tabs.test.mjs web-epd/tests/ui.test.mjs；确认失败来自缺失的新视图或模块，而非测试夹具错误。**

- [ ] **Step 3: 增加标签栏与新视图静态骨架，不接入生成或蓝牙。**

~~~html
<div id="viewTabs" class="view-tabs" role="tablist" aria-label="上传方式">
  <button id="tab-file" role="tab" aria-controls="view-file" aria-selected="true" data-view="file">01 图片上传</button>
  <button id="tab-custom" role="tab" aria-controls="view-custom" aria-selected="false" data-view="custom">02 自定义图片上传</button>
</div>
<main id="view-custom" class="workspace" role="tabpanel" aria-labelledby="tab-custom" hidden>
<section class="panel control-panel"><h1>自定义图片上传</h1></section>
<section class="panel preview-panel"><h2>三色预览</h2></section>
</main>
~~~

实际修改应在现有 main 上添加 id="view-file"、role="tabpanel" 与 aria-labelledby="tab-file"，不替换其内部任何节点、ID 或事件绑定；不移动共享日志和页脚。新增样式使用既有 --paper、--ink、--accent，提供选中态、:focus-visible、[hidden] 强制隐藏及宽度小于 560px 的换行布局。

- [ ] **Step 4: 实现独立标签控制器及键盘导航。**

~~~js
function select(id, focus = false) {
  if (!(id in panels) || id === active || isBusy()) return false;
  active = id;
  for (const key of ['file', 'custom']) {
    panels[key].hidden = key !== id;
    tabs[key].setAttribute('aria-selected', String(key === id));
    tabs[key].tabIndex = key === id ? 0 : -1;
  }
  if (focus) tabs[id].focus();
  onSelect(id);
  return true;
}
~~~

给 click 与键盘事件绑定上述 select；构造时只同步默认状态，不调用 onSelect、蓝牙或 location API。Task 1 就在 main.js 的现有 body.onload 中创建 controller，注入 isBusy: () => connectionInProgress || uploadInProgress，使标签在本任务结束时已可实际切换；Task 3 只扩展其 onSelect 状态刷新逻辑。ui.test.mjs 另测 body.onload 创建控制器后，点击标签不调用 requestDevice/connect。

- [ ] **Step 5: 重跑本任务测试与完整 Node 套件，确认全部通过；审查本任务差异并保留原有未提交改动，不整体暂存或提交脏文件。**

### Task 2: 确定性静态三色点阵

**Files:**
- Create: web-epd/js/static-dashboard.js
- Create: web-epd/tests/dashboard.test.mjs
- Modify: web-epd/index.html
- Modify: web-epd/css/app.css

**Interfaces:**
- Consumes: 可选 stampText({text,x,y,size,color,point}) 字形回调；浏览器实现通过离屏 Canvas 获取 alpha 蒙版。
- Produces: EpdStaticDashboard.createPixels(stampText) -> Uint8Array(120000)，validatePixels(pixels) -> boolean，toImageData(pixels, ImageDataCtor) -> ImageData。
- Palette: 0=白、1=黑、2=红，坐标范围 x=0..399、y=0..299。

- [ ] **Step 1: 先写失败的点阵契约测试。**

~~~js
test('static dashboard is 400x300, tri-color, and deterministic', () => {
  const text = ({x, y, color, point}) => point(x, y, color);
  const first = EpdStaticDashboard.createPixels(text);
  const second = EpdStaticDashboard.createPixels(text);
  assert.equal(first.length, 400 * 300);
  assert.deepEqual(first, second);
  assert.equal(EpdStaticDashboard.validatePixels(first), true);
  assert.equal(first[0], 0);
  assert.ok(first.includes(1));
  assert.ok(first.includes(2));
});

test('invalid size and fourth color are rejected before upload', () => {
  assert.equal(EpdStaticDashboard.validatePixels(new Uint8Array(119999)), false);
  const pixels = new Uint8Array(120000);
  pixels[401] = 3;
  assert.equal(EpdStaticDashboard.validatePixels(pixels), false);
});
~~~

另测整幅缓冲中的白、黑、红采样经 toImageData 得到精确 RGBA 值，测浏览器字形适配器在 alpha 小于 128 时不落点、alpha 大于等于 128 时按颜色落点，以及连续两次生成不会叠加旧图层；红色与黑色重叠的像素须保持红色。独立断言 2026 年 7 月的首日列位、月底 31 日、5h/7d 静态标签及恐龙区域均非空，防止只画两根色块也使三色测试通过。

- [ ] **Step 2: 运行 node --test web-epd/tests/dashboard.test.mjs，确认因模块尚未提供而失败。**

- [ ] **Step 3: 实现像素缓冲与固定布局。**

~~~js
const WIDTH = 400, HEIGHT = 300;
const WHITE = 0, BLACK = 1, RED = 2;
function createPixels(stampText = browserStampText) {
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  const point = (x, y, color) => {
    if (Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
      const index = y * WIDTH + x;
      if (color === RED || pixels[index] !== RED) pixels[index] = color;
    }
  };
  const rect = (x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) point(xx, yy, color);
  };
  rect(213, 35, 1, 258, BLACK);
  rect(10, 36, 198, 22, BLACK);
  rect(150, 36, 58, 22, RED);
  stampText({text: '2026', x: 12, y: 9, size: 25, color: RED, point});
  stampText({text: 'Codex', x: 222, y: 48, size: 19, color: RED, point});
  return pixels;
}
~~~

在同一函数以固定坐标表绘制照片中的 2026 年 7 月七列月历：日号 1 至 31 按实际星期三至星期五排列，列宽约 27px，行高约 31px；静态农历短字、右侧 5h/7d 的 72%/77% 进度条、20:32 示例刷新字样和“努力搬砖 ing”分别用 stampText 放在月历或额度区。恐龙/仙人掌使用固定的 0/1/2 像素行字符串映射至右下角，不从照片裁剪后缩放。实现时先以屏幕尺寸和参考图可见边界核对所有坐标，必要时在不改变分辨率的前提下微调。浏览器字形适配器在透明离屏画布用本机中文字体生成 alpha 蒙版，阈值 128；红色写入优先于黑色，输出数组中不允许中间灰度。

- [ ] **Step 4: 实现像素校验及 ImageData 转换。**

~~~js
function validatePixels(pixels) {
  return Object.prototype.toString.call(pixels) === '[object Uint8Array]' &&
    pixels.length === WIDTH * HEIGHT &&
    pixels.every(value => value === WHITE || value === BLACK || value === RED);
}
function toImageData(pixels, ImageDataCtor = ImageData) {
  if (!validatePixels(pixels)) throw new TypeError('无效的三色点阵');
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < pixels.length; i++) {
    const offset = i * 4;
    const color = pixels[i];
    rgba[offset] = color === BLACK ? 0 : 255;
    rgba[offset + 1] = color === WHITE ? 255 : 0;
    rgba[offset + 2] = color === WHITE ? 255 : 0;
    rgba[offset + 3] = 255;
  }
  return new ImageDataCtor(rgba, WIDTH, HEIGHT);
}
~~~

新视图补 400×300 canvas 与“生成参考点阵”按钮，CSS 对预览使用 image-rendering: pixelated，宽度不足时按比例缩小而不裁切；此任务仅验证离线生成，不连接上传按钮。

- [ ] **Step 5: 重跑 dashboard.test.mjs 与完整 Node 套件；肉眼查看 400×300 原尺寸与放大预览，修正文字溢出和像素宠物轮廓；审查差异，不整体暂存或提交脏文件。**

### Task 3: 两种来源共用已验收的手动上传

**Files:**
- Modify: web-epd/js/main.js
- Modify: web-epd/index.html
- Modify: web-epd/tests/connection.test.mjs
- Modify: web-epd/tests/transfer.test.mjs
- Modify: web-epd/tests/ui.test.mjs
- Modify: web-epd/README.md

**Interfaces:**
- Consumes: EpdViewTabs.create、EpdStaticDashboard.createPixels/validatePixels/toImageData，现有 processImageData、writeImage、write。
- Produces: renderCustomImage() 设置独立 customPixels；sendimg(source = 'file') 支持 file 与 custom；原 sendimg() 调用保持原样有效。

- [ ] **Step 1: 先写失败的状态与模拟蓝牙测试。**

~~~js
test('custom source uploads without a selected file using existing commands', async () => {
  const app = makeThreeColorHarness({fileSelected: false, slot: 'slots=15 0 0'});
  app.context.renderCustomImage();
  const result = await app.context.sendimg('custom');
  assert.equal(result.ok, true);
  assert.deepEqual(app.commands.map(([cmd]) => cmd).slice(0, 2), [SET_SLOT, INIT]);
  assert.equal(app.commands.at(-1)[0], REFRESH);
  assert.equal(app.commands.filter(([cmd]) => cmd === WRITE_IMG).length > 0, true);
  assert.equal(app.fileInput.files.length, 0);
});

test('invalid custom pixels and mismatched driver send no command', async () => {
  const app = makeThreeColorHarness({fileSelected: false, slot: 'slots=15 0 0'});
  vm.runInContext('customPixels = new Uint8Array(119999)', app.context);
  assert.equal((await app.context.sendimg('custom')).ok, false);
  assert.deepEqual(app.commands, []);
  vm.runInContext('customPixels = new Uint8Array(120000)', app.context);
  app.setDriver('01');
  assert.equal((await app.context.sendimg('custom')).ok, false);
  assert.deepEqual(app.commands, []);
});
~~~

makeThreeColorHarness 扩展现有 transfer.test.mjs 的 vm 假 BLE：保留当前主脚本依赖的所有 DOM 节点，加入 customCanvas、customStatus 和 customUploadButton；在 vm 上先加载 static-dashboard.js、view-tabs.js，再加载 main.js；从 HTML 驱动选项建立值为字符串 '16'、尺寸 4.2_400_300、颜色 threeColor 的配置，注入有效 slots 通知，将 write 记录到 commands，使 setTimeout 立即回调。给假 Canvas 提供 getContext、getImageData、putImageData，并给假 ImageData 构造器提供 data/width/height；如需注入 customPixels，须通过 vm.runInContext 修改 main.js 的顶层 let 绑定，不能通过 context 对象赋值。再测未知 source 被拒绝、普通 sendimg() 在无文件时仍拒绝、自定义图确认覆盖失败时零写入、WRITE_IMG 失败后无 REFRESH、切换视图不引发 requestDevice/connect、断线后新视图“重连”仍复用同一设备。编码后在测试中按 processImageData 现有位序解回像素，核对与预览白/黑/红逐点一致，并检查两个平面各 15000 字节。

- [ ] **Step 2: 运行 node --test web-epd/tests/connection.test.mjs web-epd/tests/transfer.test.mjs web-epd/tests/ui.test.mjs，确认新用例因缺少自定义来源而失败。**

- [ ] **Step 3: 加入独立来源状态与预检，不重写 BLE 发送循环。**

~~~js
let customPixels = null;
let viewController = null;
function renderCustomImage() {
  const pixels = EpdStaticDashboard.createPixels();
  if (!EpdStaticDashboard.validatePixels(pixels)) throw new Error('三色点阵校验失败');
  document.getElementById('customCanvas').getContext('2d')
    .putImageData(EpdStaticDashboard.toImageData(pixels), 0, 0);
  customPixels = pixels;
  updateButtonStatus();
}
function imageForUpload(source) {
  if (source === 'file') return ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (source === 'custom' && EpdStaticDashboard.validatePixels(customPixels))
    return EpdStaticDashboard.toImageData(customPixels);
  throw new Error('图片来源无效或点阵尚未生成');
}
~~~

sendimg(source = 'file') 在任何设备写入前验证 source；file 继续检查裁剪状态、文件选择与 uploadState.hasImage，并继续使用旧页 canvasSize、ditherMode、epddriver 的一致性校验。custom 不受旧页裁剪、文件选择或旧页下拉框值影响，只检查 customPixels 与设备通知；编码模式明确固定为 threeColor，不读取旧页 ditherMode。custom 额外核对 deviceConfig 的 driver、size、color 与字符串 '16'、'4.2_400_300'、'threeColor' 完全一致，要求有效槽位；在 SET_SLOT/INIT 前取得处理后的数据并核对两个平面长度各为 15000 字节，否则拒绝。然后保持现有槽位确认、SET_SLOT、INIT、200ms、两平面 writeImage、REFRESH、catch/finally，不复制写包逻辑。源站纯三色编码由现有 processImageData 完成，不为本功能引入另一套命令或位序。

- [ ] **Step 4: 让连接控制与状态覆盖两个视图。**

~~~js
function updateConnectionButtons(connected) {
  for (const id of ['connectbutton', 'customConnectButton']) {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = connectionInProgress || uploadInProgress;
      button.textContent = connected ? '断开' : '连接';
    }
  }
  for (const id of ['reconnectbutton', 'customReconnectButton']) {
    const button = document.getElementById(id);
    if (button) button.disabled = !bleDevice || connected || connectionInProgress || uploadInProgress;
  }
}
~~~

两个连接按钮分别调用现有 preConnect/reConnect；updateButtonStatus 调用上述同步函数并更新 customUploadButton。setStatus 在可见旧页状态与新页 customStatus 同步关键传输消息；页面初始化创建 tab controller，isBusy 读取 connectionInProgress || uploadInProgress。新视图没有自动调用 renderCustomImage、preConnect 或 sendimg。

- [ ] **Step 5: 完整测试与说明。**

~~~powershell
node --test web-epd/tests/*.test.mjs
python -m unittest discover -s web-epd/tests -p 'test_*.py' -v
node --check web-epd/js/main.js
node --check web-epd/js/view-tabs.js
node --check web-epd/js/static-dashboard.js
git diff --check
~~~

在 README 增加两个视图的启动、静态示例、生成、预览、手动上传和不自动连接说明。使用浏览器本地页面只检查界面、键盘焦点、320px/桌面布局及点阵预览；不连接设备。检查模拟 BLE 命令序列、15KB 双平面与失败中止后，审查全部本次差异，保留用户原有未提交改动，不整体暂存或提交脏文件。向用户明确说明软件测试通过与实体屏显示是两种不同验收，实体连接和单次上传留给用户操作。

## Handoff

执行前须先获得用户对本计划和执行方式的确认。实施时每项任务按“写失败测试、观察正确失败、最小实现、完整回归、审查差异、保护原有改动”的顺序进行；若发现新功能必须改变已验收设备协议，停止并重新设计，不做猜测性硬件试验。
