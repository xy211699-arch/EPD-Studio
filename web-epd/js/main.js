let bleDevice, gattServer;
let epdService, epdCharacteristic;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let paintManager, cropManager;
let rleSupport;
let uploadInProgress = false;
let connectionInProgress = false;
let disconnecting = false;
let deviceConfig = null;
let deviceSlots = null;
let batteryMv = null;
let configNotificationSeen = false;
let imageRevision = 0;
let customPixels = null;
let quotaState = globalThis.EpdQuota ? globalThis.EpdQuota.emptyQuota() : { status: 'unavailable', five_hour: null, seven_day: null };
let quotaController = null;
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
  SET_SLOT: 0x31,

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
  deviceConfig = null;
  deviceSlots = null;
  batteryMv = null;
  configNotificationSeen = false;
}

// Match the official epdiy.cn battery conversion: the device reports millivolts.
function batteryPercentFromMv(millivolts) {
  const scaled = millivolts * 2047 / 3600;
  if (scaled > 1705) return 100;
  if (scaled > 1584) return 28 + Math.floor((scaled - 1584) * 72 / 121);
  if (scaled > 1360) return 4 + Math.floor((scaled - 1360) * 24 / 224);
  if (scaled > 1136) return Math.floor((scaled - 1136) * 4 / 224);
  return 0;
}

function renderBatteryStatus() {
  const statusNode = document.getElementById('batteryStatus');
  const valueNode = document.getElementById('batteryValue');
  if (!statusNode || !valueNode) return;
  const connected = Boolean(gattServer && gattServer.connected);
  if (!connected || !Number.isFinite(batteryMv) || batteryMv < 0) {
    statusNode.hidden = true;
    valueNode.textContent = '--';
    return;
  }
  const percent = batteryPercentFromMv(batteryMv);
  valueNode.textContent = `${percent}% / ${(batteryMv / 1000).toFixed(2)}V`;
  statusNode.hidden = false;
}

function hasValidCurrentSlot() {
  if (!deviceSlots) return false;
  const { count, selected } = deviceSlots;
  return Number.isSafeInteger(count) && count >= 0 &&
    (count === 0 || (Number.isInteger(selected) && selected >= 0 && selected < count && selected <= 0xff));
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic || !gattServer || !gattServer.connected) {
    addLog("服务不可用，请检查蓝牙连接。");
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
    if (e.message) addLog("写入失败: " + e.message);
    return false;
  }
  return true;
}

function getTransferSettings() {
  const mtu = Number(document.getElementById('mtusize').value);
  const interleavedCount = Number(document.getElementById('interleavedcount').value);
  if (!Number.isInteger(mtu) || mtu < 3 || mtu > 255) {
    throw new Error('MTU must be an integer from 3 to 255');
  }
  if (!Number.isInteger(interleavedCount) || interleavedCount < 0 || interleavedCount > 500) {
    throw new Error('Confirm interval must be an integer from 0 to 500');
  }
  return { chunkSize: mtu - 2, interleavedCount, rleSupported: rleSupport === true };
}

async function writeImage(data, step = 'bw', settings = getTransferSettings()) {
  const { chunkSize, interleavedCount, rleSupported } = settings;
  let noReplyCount = interleavedCount;
  const stepText = step === 'bw' ? '黑白' : '红色';

  // Use RLE only when its complete encoded stream is smaller than the
  // original data. Each RLE chunk contains complete codes.
  // Every RLE code needs at least two bytes; smaller chunks must stay uncompressed.
  const rleChunks = rleSupported && chunkSize >= 2 ? rleCompressMTU(data, chunkSize) : null;
  const rleLength = rleChunks ? rleChunks.reduce((total, chunk) => total + chunk.length, 0) : data.length;
  const useRle = rleSupported && rleLength < data.length;
  const totalChunks = useRle ? rleChunks.length : Math.ceil(data.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    let chunk;
    if (useRle) {
      chunk = rleChunks[i];
    } else {
      const off = i * chunkSize;
      chunk = data.slice(off, off + chunkSize);
    }

    const currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${stepText}数据块: ${i + 1}/${totalChunks}，耗时: ${currentTime}s`);

    const payload = [
      rleSupported
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
      throw new Error(`WRITE_IMG ${step} ${i + 1}/${totalChunks} write failed`);
    }
  }
}

async function setDriver() {
  await write(EpdCmd.SET_PINS, document.getElementById("epdpins").value);
  await write(EpdCmd.INIT, document.getElementById("epddriver").value);
}

async function syncTime(mode) {
  if (mode === 2) {
    if (!confirm('时钟模式使用全刷，主要用于修复老化屏残影问题。是否继续？')) return;
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
    addLog("时间已同步。");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

async function clearScreen() {
  if (confirm('确认清除屏幕内容？')) {
    await write(EpdCmd.CLEAR);
    addLog("清屏指令已发送。");
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

function customDeviceReady() {
  return deviceConfig && deviceConfig.driver === '16' &&
    deviceConfig.size === '4.2_400_300' && deviceConfig.color === 'threeColor';
}

async function sendimg(source = 'file') {
  if (uploadInProgress) return { ok: false, error: 'An upload is already in progress' };
  if (source !== 'file' && source !== 'custom') {
    setStatus('图片来源无效');
    return { ok: false, error: 'Invalid image source' };
  }
  const isCustom = source === 'custom';
  if (!isCustom && cropManager.isCropMode()) {
    alert("Finish cropping before sending.");
    return { ok: false, error: 'Crop is not finished' };
  }

  const imageFile = document.getElementById('imageFile');
  if (!isCustom && (!imageFile.files || imageFile.files.length === 0)) {
    setStatus('请先选择图片');
    return { ok: false, error: 'No image selected' };
  }
  if (!isCustom && uploadState && !uploadState.hasImage) {
    setStatus('图片预览尚未准备好');
    return { ok: false, error: 'Image is not ready' };
  }
  if (!gattServer || !gattServer.connected || !epdCharacteristic) {
    setStatus('设备未连接，请先连接或重连。');
    return { ok: false, error: 'Display is offline' };
  }

  if (!deviceConfig) {
    setStatus('等待设备配置');
    return { ok: false, error: 'Device configuration is not confirmed' };
  }

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = isCustom ? 'threeColor' : document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const driver = isCustom ? deviceConfig.driver : epdDriverSelect.value;
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];

  if (isCustom && !customDeviceReady()) {
    setStatus('自定义点阵需要 0x16 驱动、400 × 300 和三色模式。');
    return { ok: false, error: 'Custom pixels do not match the device configuration' };
  }
  if (!isCustom && (!selectedOption || driver !== deviceConfig.driver ||
      selectedOption.getAttribute('data-size') !== canvasSize ||
      selectedOption.getAttribute('data-color') !== ditherMode ||
      canvasSize !== deviceConfig.size || ditherMode !== deviceConfig.color)) {
    setStatus('画布尺寸或颜色模式与设备不匹配。');
    return { ok: false, error: 'Image settings do not match the device' };
  }

  if (deviceConfig.driver === '16' && (!hasValidCurrentSlot() || (isCustom && deviceSlots.count === 0))) {
    setStatus('等待有效的设备槽位后才能上传。');
    return { ok: false, error: 'Device slot information is not confirmed' };
  }

  if (deviceSlots && deviceSlots.count > 0) {
    const { usedMask, selected } = deviceSlots;
    if (!hasValidCurrentSlot()) {
      setStatus('当前设备图片槽位无效。');
      return { ok: false, error: 'The current device image slot is invalid' };
    }
    if ((usedMask & (1n << BigInt(selected))) !== 0n &&
        !confirm(`槽位 ${selected + 1} 已有图片，上传会覆盖原图片。是否继续？`)) {
      setStatus('上传已取消，原图片未被覆盖。');
      return { ok: false, error: '用户取消覆盖图片槽位' };
    }
  }

  uploadInProgress = true;
  if (uploadState) uploadState.setStatus('sending');
  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";
  updateButtonStatus(true);
  try {
    const transferSettings = getTransferSettings();
    if (isCustom && !globalThis.EpdStaticDashboard.validatePixels(customPixels)) {
      throw new Error('Generate a valid 120000-pixel tri-color matrix first');
    }
    const imageData = isCustom ? EpdStaticDashboard.toImageData(customPixels) : ctx.getImageData(0, 0, canvas.width, canvas.height);
    const processedData = processImageData(imageData, ditherMode);
    if (isCustom && (!(processedData instanceof Uint8Array) || processedData.length !== 30000)) {
      throw new Error('Custom pixels must encode as two 15000-byte planes');
    }

    if (deviceSlots && deviceSlots.count > 0) {
      const selectedSlot = deviceSlots.selected;
      if (await write(EpdCmd.SET_SLOT, [0, selectedSlot]) !== true) {
        throw new Error('SET_SLOT write failed');
      }
      // Treat an attempted upload as occupied until reconnect, even if a later packet fails.
      if (deviceSlots) deviceSlots.usedMask |= 1n << BigInt(selectedSlot);
    }

    if (await write(EpdCmd.INIT) !== true) {
      throw new Error('INIT write failed');
    }
    await new Promise(resolve => setTimeout(resolve, 200));

    if (ditherMode === 'threeColor') {
      const halfLength = Math.floor(processedData.length / 2);
      const blackWhiteData = processedData.slice(0, halfLength);
      const redWhiteData = processedData.slice(halfLength);
      if (['08', '09', '0e', '0f'].includes(driver)) {
        await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw', transferSettings);
      } else {
        await writeImage(blackWhiteData, 'bw', transferSettings);
        await writeImage(redWhiteData, 'red', transferSettings);
      }
    } else if (ditherMode === 'blackWhiteColor') {
      if (['08', '09', '0e', '0f'].includes(driver)) {
        const emptyData = new Uint8Array(processedData.length).fill(0xFF);
        await writeImage(convertUC8159(processedData, emptyData), 'bw', transferSettings);
      } else {
        await writeImage(processedData, 'bw', transferSettings);
      }
    } else if (ditherMode === 'fourColor' || ditherMode === 'sixColor') {
      await writeImage(processedData, 'bw', transferSettings);
    } else {
      throw new Error('The current firmware does not support this color mode');
    }

    if (await write(EpdCmd.REFRESH) !== true) {
      throw new Error('REFRESH write failed');
    }

    const sendTime = (new Date().getTime() - startTime) / 1000.0;
    const message = `传输完成，请检查屏幕。耗时: ${sendTime}s`;
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
    alert("Finish cropping the image first. Download cancelled.");
    return;
  }

  const mode = document.getElementById('ditherMode').value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, mode);

  if (mode === 'sixColor' && processedData.length !== canvas.width * canvas.height) {
    console.log(`Expected ${canvas.width * canvas.height} bytes, received ${processedData.length}`);
    addLog('数据大小不匹配，请检查图片尺寸和颜色模式。');
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
  for (const id of ['reconnectbutton', 'customReconnectButton']) {
    const reconnect = document.getElementById(id);
    if (reconnect) reconnect.disabled = !bleDevice || connected || connectionInProgress || uploadInProgress;
  }
  for (const id of ['connectbutton', 'customConnectButton']) {
    const connect = document.getElementById(id);
    if (connect) {
      connect.disabled = connectionInProgress || uploadInProgress;
      connect.textContent = connected ? '断开' : '连接';
    }
  }
  const customSend = document.getElementById('customUploadButton');
  if (customSend) customSend.disabled = !connected || !customDeviceReady() || !hasValidCurrentSlot() ||
    deviceSlots.count === 0 || !globalThis.EpdStaticDashboard?.validatePixels(customPixels) ||
    forceDisabled || connectionInProgress || uploadInProgress;
  const generate = document.getElementById('generateDashboard');
  if (generate) generate.disabled = connectionInProgress || uploadInProgress;
  const send = document.getElementById('sendimgbutton');
  if (send) send.disabled = !connected || !deviceConfig || !imageReady ||
    (deviceConfig.driver === '16' && !hasValidCurrentSlot()) || forceDisabled || connectionInProgress || uploadInProgress;
  for (const id of ['sendcmdbutton', 'calendarmodebutton', 'clockmodebutton', 'clearscreenbutton', 'setDriverbutton']) {
    const button = document.getElementById(id);
    if (button) button.disabled = !connected || forceDisabled || connectionInProgress || uploadInProgress;
  }
  renderConnectionStatus();
  renderBatteryStatus();
}

function renderConnectionStatus() {
  const connected = Boolean(gattServer && gattServer.connected);
  const label = uploadInProgress ? 'TRANSFERRING' : connectionInProgress ? 'CONNECTING' : connected ? 'ONLINE' : bleDevice ? 'DISCONNECTED' : 'OFFLINE';
  const phase = uploadInProgress ? 'sending' : connectionInProgress ? 'connecting' : connected ? 'connected' : bleDevice ? 'error' : 'idle';
  const stateNode = document.getElementById('connectionState');
  const dotNode = document.getElementById('connectionDot');
  const nameNode = document.getElementById('deviceName');
  const guideNode = document.getElementById('guideText');
  if (stateNode) stateNode.textContent = label;
  if (dotNode) dotNode.className = `status-dot ${phase}`;
  if (nameNode) nameNode.textContent = bleDevice ? bleDevice.name : 'NOT SELECTED';
  if (guideNode) guideNode.textContent = uploadInProgress ? '传输进行中，请保持设备连接。' : connected ? '请检查预览后手动上传。' : bleDevice ? '连接已断开，可点击“重连”。' : '先连接墨水屏，然后选择图片并预览。';
}

function disconnect() {
  if (disconnecting) return;
  disconnecting = true;
  try {
    resetVariables();
    if (bleDevice && bleDevice.gatt && bleDevice.gatt.connected) {
      try { bleDevice.gatt.disconnect(); }
      catch (error) { addLog(`断开 GATT 失败：${error.message || error}`); }
    }
    if (uploadState) uploadState.setStatus('error');
    addLog('已断开连接。');
    setStatus('设备已断开，可点击“重连”。');
    document.getElementById("connectbutton").innerHTML = '连接';
    updateButtonStatus();
  } finally {
    disconnecting = false;
  }
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
      setStatus(e.name === 'NotFoundError' ? '已取消设备选择' : '蓝牙设备选择失败，请检查 Edge 和蓝牙状态。');
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
  // The firmware sends the binary configuration first, but registering the
  // listener before startNotifications makes that ordering non-critical.
  // Keep a content check as a second guard so a textual status packet can
  // never be interpreted as pin/model configuration.
  const isText = data.every(byte => byte >= 0x20 && byte <= 0x7e);
  const isConfig = !configNotificationSeen && data.length >= 8 && !isText;
  if (isConfig) {
    configNotificationSeen = true;
    addLog(`收到配置：${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    if (data.length < 8) {
      setStatus('设备配置数据不完整，请勿上传。');
      return;
    }
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    epddriver.value = bytes2hex(data.slice(7, 8));
    const selectedOption = epddriver.options[epddriver.selectedIndex];
    if (!selectedOption) {
      setStatus('设备驱动未被当前网页识别，请勿上传。');
      return;
    }
    deviceConfig = {
      driver: epddriver.value,
      size: selectedOption.getAttribute('data-size'),
      color: selectedOption.getAttribute('data-color'),
    };
    updateDitcherOptions();
    if (deviceConfig.driver === '16' && !hasValidCurrentSlot()) setStatus('等待有效的设备槽位后才能上传。');
    updateButtonStatus();
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
    } else if (msg.startsWith('slots=')) {
      const match = /^slots=(\d+)\s+(\d+)(?:\s+(-?\d+))?$/.exec(msg.trim());
      if (match) {
        const count = Number(match[1]);
        const priorMask = deviceSlots && deviceSlots.count === count ? deviceSlots.usedMask : 0n;
        deviceSlots = {
          count,
          usedMask: BigInt(match[2]) | priorMask,
          selected: match[3] === undefined ? -1 : Number(match[3]),
        };
        if (deviceConfig && deviceConfig.driver === '16') {
          setStatus(hasValidCurrentSlot() ? '设备槽位已收到，请检查预览后上传。' : '设备槽位信息无效。');
        }
        updateButtonStatus();
      }
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const parts = msg.substring(2).trim().split(/\s+/);
      const t = parseInt(parts[0]) + new Date().getTimezoneOffset() * 60;
      addLog(`远端时间: ${new Date(t * 1000).toLocaleString()}`);
      addLog(`本地时间: ${new Date().toLocaleString()}`);
      const batteryToken = parts.find((part) => part.startsWith('bat='));
      if (batteryToken) {
        const reportedMv = Number.parseInt(batteryToken.slice(4), 10);
        if (Number.isFinite(reportedMv) && reportedMv >= 0) {
          batteryMv = reportedMv;
          renderBatteryStatus();
        }
      }
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
    addLog('固件版本较低，本地网页可能无法完整支持，请先核对设备兼容性。');
    setStatus('设备固件版本较低，请核对后再上传。');
  }

  // Register before enabling notifications: some firmware sends its binary
  // configuration immediately when the CCCD is written.
  epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
    handleNotify(event.target.value, msgIndex++);
  });

  try {
    await epdCharacteristic.startNotifications();
  } catch (e) {
    console.error(e);
    if (e.message) addLog("startNotifications: " + e.message);
    disconnect();
    return;
  }

  if (await write(EpdCmd.INIT) !== true) {
    addLog('连接初始化写入失败');
    disconnect();
    return;
  }

  document.getElementById("connectbutton").innerHTML = '断开';
  if (uploadState) uploadState.setStatus('connected');
  if (!deviceConfig) setStatus('已连接，等待设备配置通知。');
  updateButtonStatus();
}

function setStatus(statusText) {
  document.getElementById("status").textContent = statusText;
  const customStatus = document.getElementById('dashboardStatus');
  if (customStatus) customStatus.textContent = statusText;
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
  const revision = ++imageRevision;
  const selectedFile = imageFile.files && imageFile.files[0];
  if (uploadState) uploadState.setImage(false);
  updateButtonStatus();
  if (!selectedFile) {
    fillCanvas('white');
    return;
  }

  const image = new Image();
  image.onload = function () {
    URL.revokeObjectURL(this.src);
    if (revision !== imageRevision || imageFile.files[0] !== selectedFile) return;
    if (image.width / image.height == canvas.width / canvas.height) {
      if (cropManager.isCropMode()) cropManager.exitCropMode();
      cropManager.resetStates();
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);
      convertDithering();
      if (uploadState) uploadState.setImage(true);
      setStatus('图片已准备好，请检查预览。');
      updateButtonStatus();
    } else {
      setStatus('图片比例不同，请在预览区完成裁剪。');
      cropManager.initializeCrop();
    }
  };
  image.onerror = function () {
    URL.revokeObjectURL(this.src);
    if (revision !== imageRevision || imageFile.files[0] !== selectedFile) return;
    setStatus('图片无法解码，请重新选择文件。');
    if (uploadState) uploadState.setImage(false);
    updateButtonStatus();
  };
  image.src = URL.createObjectURL(selectedFile);
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
    setStatus('设备驱动未被当前网页识别，请勿上传。');
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
  if (confirm('清除画布内容？')) {
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
  const selectedFile = imageFile.files[0];
  const revision = ++imageRevision;
  const isCurrent = () => revision === imageRevision && imageFile.files[0] === selectedFile;
  if (uploadState) uploadState.setImage(false);
  updateButtonStatus();
  cropManager.finishCrop(() => {
    if (!isCurrent()) return;
    convertDithering();
    if (uploadState) uploadState.setImage(true);
    setStatus('图片已准备好，请检查预览。');
    updateButtonStatus();
  }, isCurrent);
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

function renderCustomImage() {
  if (connectionInProgress || uploadInProgress) return;
  const dashboard = globalThis.EpdStaticDashboard;
  const pixels = dashboard.createPixels(undefined, quotaState);
  if (!dashboard.validatePixels(pixels)) {
    document.getElementById('dashboardStatus').textContent = '看板无效，无法生成预览。';
    return;
  }
  const image = dashboard.toImageData(pixels);
  document.getElementById('dashboardCanvas').getContext('2d').putImageData(image, 0, 0);
  customPixels = pixels;
  document.getElementById('dashboardStatus').textContent = '看板已生成，请检查预览。';
  updateButtonStatus();
}

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.get('debug');

  if (debugMode === 'true') {
    document.body.classList.add('dark-mode');
    link.innerHTML = 'Normal mode';
    link.setAttribute('href', window.location.pathname);
    addLog("开发模式已开启。");
  } else {
    document.body.classList.remove('dark-mode');
    link.innerHTML = 'Developer mode';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

function quotaResetLabel(windowData) {
  if (!windowData || !Number.isFinite(Number(windowData.reset_at))) return '重置 --';
  const date = new Date(Number(windowData.reset_at) * 1000);
  if (Number.isNaN(date.getTime())) return '重置 --';
  return `重置 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function quotaUpdatedLabel(updatedAt) {
  if (!updatedAt) return '未更新';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '未更新';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 更新`;
}

function renderQuotaState(nextState) {
  quotaState = nextState || { status: 'unavailable', five_hour: null, seven_day: null };
  const fiveHour = quotaState.status === 'ok' && quotaState.five_hour ? `${quotaState.five_hour.remaining_percent}%` : '--';
  const sevenDay = quotaState.status === 'ok' && quotaState.seven_day ? `${quotaState.seven_day.remaining_percent}%` : '--';
  const fiveNode = document.getElementById('quotaFiveHour');
  const sevenNode = document.getElementById('quotaSevenDay');
  const fiveReset = document.getElementById('quotaFiveHourReset');
  const sevenReset = document.getElementById('quotaSevenDayReset');
  const statusNode = document.getElementById('quotaStatusText');
  const updatedNode = document.getElementById('quotaUpdated');
  const topNode = document.getElementById('quotaTopValue');
  if (fiveNode) fiveNode.textContent = fiveHour;
  if (sevenNode) sevenNode.textContent = sevenDay;
  if (fiveReset) fiveReset.textContent = quotaResetLabel(quotaState.five_hour);
  if (sevenReset) sevenReset.textContent = quotaResetLabel(quotaState.seven_day);
  if (topNode) topNode.textContent = `${fiveHour} / ${sevenDay}`;
  if (statusNode) statusNode.textContent = quotaState.status === 'ok'
    ? '额度已更新'
    : quotaState.status === 'unauthenticated' ? '需要 Codex 登录' : (quotaState.error || '额度暂不可用');
  if (updatedNode) updatedNode.textContent = quotaUpdatedLabel(quotaState.updated_at);
  if (customPixels && globalThis.EpdStaticDashboard) renderCustomImage();
}

async function refreshQuota() {
  if (!quotaController) return;
  const button = document.getElementById('refreshQuotaButton');
  if (button) button.disabled = true;
  try {
    await quotaController.refresh();
  } finally {
    if (button) button.disabled = false;
  }
}

document.body.onload = () => {
  textDecoder = null;
  EpdViewTabs.create({
    tabs: {
      file: document.getElementById('tab-file'),
      custom: document.getElementById('tab-custom'),
    },
    panels: {
      file: document.getElementById('view-file'),
      custom: document.getElementById('view-custom'),
    },
    isBusy: () => connectionInProgress || uploadInProgress,
    onSelect: () => {},
  });
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);

  cropManager.initCropTools();
  initEventHandlers();
  document.getElementById('generateDashboard').addEventListener('click', renderCustomImage);
  const refreshQuotaButton = document.getElementById('refreshQuotaButton');
  if (globalThis.EpdQuota && refreshQuotaButton) {
    quotaController = globalThis.EpdQuota.createController({ onChange: renderQuotaState });
    refreshQuotaButton.addEventListener('click', refreshQuota);
    if (typeof globalThis.fetch === 'function') quotaController.start();
  }
  updateButtonStatus();
}
