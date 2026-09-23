let bleDevice, gattServer;
let epdService, epdCharacteristic;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let paintManager, cropManager;
let rleSupport;
let uploadInProgress = false;
let connectionInProgress = false;
const uploadState = globalThis.EpdUploadState ? globalThis.EpdUploadState.createUploadState() : null;

const EpdCmd = {
  SET_PINS: 0x00,
  INIT: 0x01,
  CLEAR: 0x02,
  SEND_CMD: 0x03,
  SEND_DATA: 0x04,
  REFRESH: 0x05,
  SLEEP: 0x06,

  SET_TIME: 0x20,

  WRITE_IMG: 0x30, // v1.6

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

const canvasSizes = [
  { name: '1.54_152_152', width: 152, height: 152 },
  { name: '1.54_200_200', width: 200, height: 200 },
  { name: '2.13_104_212', width: 104, height: 212 },
  { name: '2.13_122_250', width: 122, height: 250 },
  { name: '2.66_152_296', width: 152, height: 296 },
  { name: '2.66_184_360', width: 184, height: 360 },
  { name: '2.9_128_296', width: 128, height: 296 },
  { name: '2.9_168_384', width: 168, height: 384 },
  { name: '3.5_184_384', width: 184, height: 384 },
  { name: '3.5_360_600', width: 360, height: 600 },
  { name: '3.7_240_416', width: 240, height: 416 },
  { name: '3.7_280_480', width: 280, height: 480 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '3.98_768_552', width: 768, height: 552 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '5.83_600_448', width: 600, height: 448 },
  { name: '5.83_648_480', width: 648, height: 480 },
  { name: '7.5_640_384', width: 640, height: 384 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '7.5_880_528', width: 880, height: 528 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4.0E6_600_400', width: 600, height: 400 },
  { name: '7.3E6_800_480', width: 800, height: 480 },
];

function hex2bytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(bytes);
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2);
    }, "");
}

function intToHex(intIn) {
  let stringOut = ("0000" + intIn.toString(16)).substr(-4)
  return stringOut.substring(2, 4) + stringOut.substring(0, 2);
}

function resetVariables() {
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  rleSupport = false;
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic) {
    addLog("服务不可用，请检查蓝牙连接");
    return false;
  }
  let payload = [cmd];
  if (data) {
    if (typeof data == 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data)
  }
  addLog(bytes2hex(payload), '⇑');
  try {
    if (withResponse)
      await epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload));
    else
      await epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
  } catch (e) {
    console.error(e);
    if (e.message) addLog("write: " + e.message);
    return false;
  }
  return true;
}

async function writeImage(data, step = 'bw') {
  const mtu = Number(document.getElementById('mtusize').value);
  const interleavedCount = Number(document.getElementById('interleavedcount').value);
  if (!Number.isInteger(mtu) || mtu < 3 || mtu > 255) {
    throw new Error('MTU 必须是 3 至 255 的整数');
  }
  if (!Number.isInteger(interleavedCount) || interleavedCount < 0 || interleavedCount > 500) {
    throw new Error('确认间隔必须是 0 至 500 的整数');
  }
  const chunkSize = mtu - 2;
  let noReplyCount = interleavedCount;
  let totalRleLength = 0;
  const stepText = step === 'bw' ? '数据块' : '红色块';

  // Use RLE only when its complete encoded stream is smaller than the
  // original data. Each RLE chunk contains complete codes.
  const rleChunks = rleSupport ? rleCompressMTU(data, chunkSize) : null;
  const rleLength = rleChunks ? rleChunks.reduce((total, chunk) => total + chunk.length, 0) : data.length;
  const useRle = rleSupport && rleLength < data.length;
  const totalChunks = useRle ? rleChunks.length : Math.ceil(data.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    let chunk;
    if (useRle) {
      chunk = rleChunks[i];
      totalRleLength += chunk.length;
    } else {
      const off = i * chunkSize;
      chunk = data.slice(off, off + chunkSize);
    }

    const currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${stepText}: ${i + 1}/${totalChunks}, 总用时: ${currentTime}s`);

    const payload = [
      rleSupport
        ?
        (step === 'bw' ? 0x00 : 0x01) | (i === 0 ? 0x02 : 0x00) | (useRle ? 0x04 : 0x00)
        :
        (step === 'bw' ? 0x0F : 0x00) | (i === 0 ? 0x00 : 0xF0)
      ,
      ...chunk,
    ];
    let accepted;
    if (noReplyCount > 0) {
      accepted = await write(EpdCmd.WRITE_IMG, payload, false);
      noReplyCount--;
    } else {
      accepted = await write(EpdCmd.WRITE_IMG, payload, true);
      noReplyCount = interleavedCount;
    }
    if (accepted !== true) {
      throw new Error(`WRITE_IMG ${step} ${i + 1}/${totalChunks} 写入失败`);
    }
  }
}

async function setDriver() {
  await write(EpdCmd.SET_PINS, document.getElementById("epdpins").value);
  await write(EpdCmd.INIT, document.getElementById("epddriver").value);
}

async function syncTime(mode) {
  if (mode === 2) {
    if (!confirm('提醒：时钟模式目前使用全刷实现，此功能目前多用于修复老化屏残影问题，不建议长期开启，是否继续？')) return;
  }
  const timestamp = new Date().getTime() / 1000;
  const data = new Uint8Array([
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF,
    -(new Date().getTimezoneOffset() / 60),
    mode
  ]);
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

async function clearScreen() {
  if (confirm('确认清除屏幕内容?')) {
    await write(EpdCmd.CLEAR);
    addLog("清屏指令已发送！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

async function sendcmd() {
  const cmdTXT = document.getElementById('cmdTXT').value;
  if (cmdTXT == '') return;
  const bytes = hex2bytes(cmdTXT);
  await write(bytes[0], bytes.length > 1 ? bytes.slice(1) : null);
}

function convertUC8159(blackWhiteData, redWhiteData) {
  const halfLength = blackWhiteData.length;
  let payloadData = new Uint8Array(halfLength * 4);
  let payloadIdx = 0;
  let black_data, color_data, data;
  for (let i = 0; i < halfLength; i++) {
    black_data = blackWhiteData[i];
    color_data = redWhiteData[i];
    for (let j = 0; j < 8; j++) {
      if ((color_data & 0x80) == 0x00) data = 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data = 0x00;  // black
      else data = 0x03;  // white
      data = (data << 4) & 0xFF;
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      j++;
      if ((color_data & 0x80) == 0x00) data |= 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data |= 0x00;  // black
      else data |= 0x03;  // white
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      payloadData[payloadIdx++] = data;
    }
  }
  return payloadData;
}

async function sendimg() {
  if (uploadInProgress) return { ok: false, error: '已有图片正在传输' };
  if (cropManager.isCropMode()) {
    alert("请先完成图片裁剪！发送已取消。");
    return { ok: false, error: '图片裁剪尚未完成' };
  }

  const imageFile = document.getElementById('imageFile');
  if (!imageFile.files || imageFile.files.length === 0) {
    setStatus('请先选择图片');
    return { ok: false, error: '未选择图片' };
  }
  if (uploadState && !uploadState.hasImage) {
    setStatus('图片尚未完成预览处理');
    return { ok: false, error: '图片尚未就绪' };
  }
  if (!gattServer || !gattServer.connected || !epdCharacteristic) {
    setStatus('设备未连接，请先连接或重连');
    return { ok: false, error: '设备未连接' };
  }

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];

  if (!selectedOption || selectedOption.getAttribute('data-size') !== canvasSize ||
      selectedOption.getAttribute('data-color') !== ditherMode) {
    setStatus('画布尺寸或颜色模式与设备驱动不匹配，请核对后再上传');
    return { ok: false, error: '图片设置与设备驱动不匹配' };
  }

  uploadInProgress = true;
  if (uploadState) uploadState.setStatus('sending');
  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";
  updateButtonStatus(true);
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const processedData = processImageData(imageData, ditherMode);

    if (await write(EpdCmd.INIT) !== true) {
      throw new Error('INIT 写入失败');
    }

    if (ditherMode === 'threeColor') {
      const halfLength = Math.floor(processedData.length / 2);
      const blackWhiteData = processedData.slice(0, halfLength);
      const redWhiteData = processedData.slice(halfLength);
      if (['08', '09', '0e', '0f'].includes(epdDriverSelect.value)) {
        await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw');
      } else {
        await writeImage(blackWhiteData, 'bw');
        await writeImage(redWhiteData, 'red');
      }
    } else if (ditherMode === 'blackWhiteColor') {
      if (['08', '09', '0e', '0f'].includes(epdDriverSelect.value)) {
        const emptyData = new Uint8Array(processedData.length).fill(0xFF);
        await writeImage(convertUC8159(processedData, emptyData), 'bw');
      } else {
        await writeImage(processedData, 'bw');
      }
    } else if (ditherMode === 'fourColor' || ditherMode === 'sixColor') {
      await writeImage(processedData, 'bw');
    } else {
      throw new Error('当前固件不支持此颜色模式');
    }

    if (await write(EpdCmd.REFRESH) !== true) {
      throw new Error('REFRESH 写入失败');
    }

    const sendTime = (new Date().getTime() - startTime) / 1000.0;
    const message = `传输命令已完成，请检查屏幕。耗时: ${sendTime}s`;
    addLog(message);
    setStatus(message);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addLog(`上传失败：${message}`);
    setStatus(`上传失败：${message}`);
    return { ok: false, error: message };
  } finally {
    uploadInProgress = false;
    if (uploadState) uploadState.setStatus(gattServer && gattServer.connected ? 'connected' : 'error');
    updateButtonStatus();
  }
}

function downloadDataArray() {
  if (cropManager.isCropMode()) {
    alert("请先完成图片裁剪！下载已取消。");
    return;
  }

  const mode = document.getElementById('ditherMode').value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, mode);

  if (mode === 'sixColor' && processedData.length !== canvas.width * canvas.height) {
    console.log(`错误：预期${canvas.width * canvas.height}字节，但得到${processedData.length}字节`);
    addLog('数组大小不匹配。请检查图像尺寸和模式。');
    return;
  }

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    const hexValue = (processedData[i] & 0xff).toString(16).padStart(2, '0');
    dataLines.push(`0x${hexValue}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const colorModeValue = mode === 'sixColor' ? 0 : mode === 'fourColor' ? 1 : mode === 'blackWhiteColor' ? 2 : 3;
  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    `const uint8_t colorMode = ${colorModeValue};`
  ].join('\n');

  const blob = new Blob([arrayContent], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'imagedata.h';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateButtonStatus(forceDisabled = false) {
  const connected = Boolean(gattServer && gattServer.connected);
  const imageInput = document.getElementById('imageFile');
  const imageReady = uploadState ? uploadState.hasImage : Boolean(imageInput && imageInput.files && imageInput.files.length);
  const reconnect = document.getElementById('reconnectbutton');
  if (reconnect) reconnect.disabled = !bleDevice || connected || connectionInProgress || uploadInProgress;
  const connect = document.getElementById('connectbutton');
  if (connect) connect.disabled = connectionInProgress || uploadInProgress;
  const send = document.getElementById('sendimgbutton');
  if (send) send.disabled = !connected || !imageReady || forceDisabled || connectionInProgress || uploadInProgress;
  for (const id of ['sendcmdbutton', 'calendarmodebutton', 'clockmodebutton', 'clearscreenbutton', 'setDriverbutton']) {
    const button = document.getElementById(id);
    if (button) button.disabled = !connected || forceDisabled || connectionInProgress || uploadInProgress;
  }
  renderConnectionStatus();
}

function renderConnectionStatus() {
  const connected = Boolean(gattServer && gattServer.connected);
  const label = uploadInProgress ? '传输中' : connectionInProgress ? '连接中' : connected ? '已连接' : bleDevice ? '已断开' : '未连接';
  const phase = uploadInProgress ? 'sending' : connectionInProgress ? 'connecting' : connected ? 'connected' : bleDevice ? 'error' : 'idle';
  const stateNode = document.getElementById('connectionState');
  const dotNode = document.getElementById('connectionDot');
  const nameNode = document.getElementById('deviceName');
  const guideNode = document.getElementById('guideText');
  if (stateNode) stateNode.textContent = label;
  if (dotNode) dotNode.className = `status-dot ${phase}`;
  if (nameNode) nameNode.textContent = bleDevice ? bleDevice.name : '尚未选择设备';
  if (guideNode) guideNode.textContent = uploadInProgress ? '图片正在传输，请保持页面与设备连接。' : connected ? '选择图片并确认预览，准备好后手动上传。' : bleDevice ? '连接已断开，可点击“重连”。' : '先连接墨水屏，然后选择图片并预览。';
}

function disconnect() {
  resetVariables();
  if (uploadState) uploadState.setStatus('error');
  addLog('已断开连接.');
  setStatus('设备已断开，可点击“重连”');
  document.getElementById("connectbutton").innerHTML = '连接';
  updateButtonStatus();
}

async function preConnect() {
  if (connectionInProgress || uploadInProgress) return false;
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) {
      bleDevice.gatt.disconnect();
    }
    return true;
  }
  else {
    connectionInProgress = true;
    if (uploadState) uploadState.setStatus('connecting');
    updateButtonStatus();
    resetVariables();
    try {
      bleDevice = await navigator.bluetooth.requestDevice({
        optionalServices: ['62750001-d828-918d-fb46-b6c11c675aec'],
        acceptAllDevices: true
      });
    } catch (e) {
      console.error(e);
      if (e.message) addLog("requestDevice: " + e.message);
      setStatus(e.name === 'NotFoundError' ? '已取消设备选择' : '蓝牙设备选择失败，请检查 Edge 与蓝牙状态');
      if (uploadState) uploadState.setStatus('error');
      connectionInProgress = false;
      updateButtonStatus();
      return false;
    }

    if (uploadState) uploadState.setDevice(bleDevice);
    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    setTimeout(async function () {
      try { await connect(); }
      finally {
        connectionInProgress = false;
        updateButtonStatus();
      }
    }, 300);
    return true;
  }
}

async function reConnect() {
  if (bleDevice == null || connectionInProgress || uploadInProgress || bleDevice.gatt.connected) return false;
  connectionInProgress = true;
  if (uploadState) uploadState.setStatus('connecting');
  updateButtonStatus();
  resetVariables();
  addLog("正在重连");
  setTimeout(async function () {
    try { await connect(); }
    finally {
      connectionInProgress = false;
      updateButtonStatus();
    }
  }, 300);
  return true;
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx == 0) {
    addLog(`收到配置：${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    epddriver.value = bytes2hex(data.slice(7, 8));
    updateDitcherOptions();
  } else {
    if (textDecoder == null) textDecoder = new TextDecoder();
    const msg = textDecoder.decode(data);
    addLog(msg, '⇓');
    if (msg.startsWith('mtu=') && msg.length > 4) {
      const mtuSize = parseInt(msg.substring(4));
      document.getElementById('mtusize').value = mtuSize;
      addLog(`MTU 已更新为: ${mtuSize}`);
      if (msg.includes('rle=1')) {
        rleSupport = true;
        addLog('已开启 RLE 压缩传输支持');
      }
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const t = parseInt(msg.substring(2)) + new Date().getTimezoneOffset() * 60;
      addLog(`远端时间: ${new Date(t * 1000).toLocaleString()}`);
      addLog(`本地时间: ${new Date().toLocaleString()}`);
    }
  }
}

async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;

  try {
    addLog("正在连接: " + bleDevice.name);
    gattServer = await bleDevice.gatt.connect();
    addLog('  找到 GATT Server');
    epdService = await gattServer.getPrimaryService('62750001-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 EPD Service');
    epdCharacteristic = await epdService.getCharacteristic('62750002-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 Characteristic');
  } catch (e) {
    console.error(e);
    if (e.message) addLog("connect: " + e.message);
    disconnect();
    return;
  }

  try {
    const versionCharacteristic = await epdService.getCharacteristic('62750003-d828-918d-fb46-b6c11c675aec');
    const versionData = await versionCharacteristic.readValue();
    appVersion = versionData.getUint8(0);
    addLog(`固件版本: 0x${appVersion.toString(16)}`);
  } catch (e) {
    console.error(e);
    appVersion = 0x15;
  }

  if (appVersion < 0x16) {
    addLog('固件版本较低，本地网页可能无法完整支持；请先核对设备兼容性。');
    setStatus('设备固件版本较低，请核对后再上传');
  }

  try {
    await epdCharacteristic.startNotifications();
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
  } catch (e) {
    console.error(e);
    if (e.message) addLog("startNotifications: " + e.message);
  }

  if (await write(EpdCmd.INIT) !== true) {
    addLog('连接初始化写入失败');
    disconnect();
    return;
  }

  document.getElementById("connectbutton").innerHTML = '断开';
  if (uploadState) uploadState.setStatus('connected');
  updateButtonStatus();
}

function setStatus(statusText) {
  document.getElementById("status").textContent = statusText;
}

function addLog(logTXT, action = '') {
  const log = document.getElementById("log");
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ":" +
    String(now.getMinutes()).padStart(2, '0') + ":" +
    String(now.getSeconds()).padStart(2, '0') + " ";

  const logEntry = document.createElement('div');
  const timeSpan = document.createElement('span');
  logEntry.className = 'log-line';
  timeSpan.className = 'time';
  timeSpan.textContent = time;
  logEntry.appendChild(timeSpan);

  if (action !== '') {
    const actionSpan = document.createElement('span');
    actionSpan.className = 'action';
    actionSpan.innerHTML = action;
    logEntry.appendChild(actionSpan);
  }
  logEntry.appendChild(document.createTextNode(logTXT));

  log.appendChild(logEntry);
  log.scrollTop = log.scrollHeight;

  while (log.childNodes.length > 20) {
    log.removeChild(log.firstChild);
  }
}

function clearLog() {
  document.getElementById("log").innerHTML = '';
}

function fillCanvas(style) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setCanvasTitle(title) {
  const canvasTitle = document.querySelector('.canvas-title');
  if (canvasTitle) {
    canvasTitle.innerText = title;
    canvasTitle.style.display = title && title !== '' ? 'block' : 'none';
  }
}

function updateImage() {
  const imageFile = document.getElementById('imageFile');
  if (uploadState) uploadState.setImage(false);
  updateButtonStatus();
  if (imageFile.files.length == 0) {
    fillCanvas('white');
    return;
  }

  const image = new Image();
  image.onload = function () {
    URL.revokeObjectURL(this.src);
    if (image.width / image.height == canvas.width / canvas.height) {
      if (cropManager.isCropMode()) cropManager.exitCropMode();
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);
      convertDithering();
      if (uploadState) uploadState.setImage(true);
      setStatus('图片已准备好，请检查预览');
      updateButtonStatus();
    } else {
      setStatus('图片比例不同，请在预览区完成裁剪');
      cropManager.initializeCrop();
    }
  };
  image.onerror = function () {
    URL.revokeObjectURL(this.src);
    setStatus('图片无法解码，请重新选择文件');
    if (uploadState) uploadState.setImage(false);
    updateButtonStatus();
  };
  image.src = URL.createObjectURL(imageFile.files[0]);
}

function updateCanvasSize() {
  const selectedSizeName = document.getElementById('canvasSize').value;
  const selectedSize = canvasSizes.find(size => size.name === selectedSizeName);

  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;
  const resolution = document.getElementById('resolutionLabel');
  if (resolution) resolution.textContent = `${selectedSize.width} × ${selectedSize.height}`;

  updateImage();
}

function updateDitcherOptions() {
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  if (!selectedOption) {
    setStatus('设备驱动未被当前网页识别，请勿上传');
    return;
  }
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  if (colorMode) document.getElementById('ditherMode').value = colorMode;
  if (canvasSize) document.getElementById('canvasSize').value = canvasSize;

  updateCanvasSize(); // always update image
}

function rotateCanvas() {
  const currentWidth = canvas.width;
  const currentHeight = canvas.height;

  // Capture current canvas content
  const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

  // Swap canvas dimensions
  canvas.width = currentHeight;
  canvas.height = currentWidth;

  // Create temporary canvas for rotation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = currentWidth;
  tempCanvas.height = currentHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  // Draw rotated image on the resized canvas
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(tempCanvas, -currentWidth / 2, -currentHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  paintManager.clearHistory(); // Clear history as canvas size changed
  paintManager.clearElements(); // Clear stored text positions and line segments
  paintManager.saveToHistory(); // Save rotated canvas to history
}

function clearCanvas() {
  if (confirm('清除画布内容?')) {
    fillCanvas('white');
    paintManager.clearElements(); // Clear stored text positions and line segments
    if (cropManager.isCropMode()) cropManager.exitCropMode();
    paintManager.saveToHistory(); // Save cleared canvas to history
    return true;
  }
  return false;
}

function convertDithering() {
  paintManager.redrawTextElements();
  paintManager.redrawLineSegments();

  const contrast = parseFloat(document.getElementById('ditherContrast').value);
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustContrast(imageData, contrast);

  const alg = document.getElementById('ditherAlg').value;
  const strength = parseFloat(document.getElementById('ditherStrength').value);
  const mode = document.getElementById('ditherMode').value;
  const processedData = processImageData(ditherImage(imageData, alg, strength, mode), mode);
  const finalImageData = decodeProcessedData(processedData, canvas.width, canvas.height, mode);
  ctx.putImageData(finalImageData, 0, 0);

  paintManager.saveToHistory(); // Save dithered image to history
}

function applyDither() {
  const imageFile = document.getElementById('imageFile');
  if (!imageFile.files || imageFile.files.length === 0) return;
  if (uploadState) uploadState.setImage(false);
  updateButtonStatus();
  cropManager.finishCrop(() => {
    convertDithering();
    if (uploadState) uploadState.setImage(true);
    setStatus('图片已准备好，请检查预览');
    updateButtonStatus();
  });
}

function initEventHandlers() {
  document.getElementById("ditherStrength").addEventListener("input", (e) => {
    document.getElementById("ditherStrengthValue").innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
  document.getElementById("ditherContrast").addEventListener("input", (e) => {
    document.getElementById("ditherContrastValue").innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
}

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.get('debug');

  if (debugMode === 'true') {
    document.body.classList.add('dark-mode');
    link.innerHTML = '正常模式';
    link.setAttribute('href', window.location.pathname);
    addLog("注意：开发模式功能已开启！不懂请不要随意修改，否则后果自负！");
  } else {
    document.body.classList.remove('dark-mode');
    link.innerHTML = '开发模式';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

document.body.onload = () => {
  textDecoder = null;
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);

  cropManager.initCropTools();
  initEventHandlers();
  updateButtonStatus();
}
