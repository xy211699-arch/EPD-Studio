import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js', 'main.js'), 'utf8');
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'index.html'), 'utf8');

function harness({ failService = false, failNotifications = false, notifyOnStart = false } = {}) {
  const nodes = new Map();
  const timers = [];
  let requestCount = 0;
  let connectCount = 0;
  let disconnectHandler;
  let connected = false;
  let valueChangedHandler;
  const characteristic = {
    startNotifications: async () => {
      if (failNotifications) throw new Error('notifications unavailable');
      if (notifyOnStart && valueChangedHandler) {
        valueChangedHandler({ target: { value: Uint8Array.from([0x14, 0x13, 0x06, 0x05, 0x04, 0x03, 0x02, 0x16]) } });
      }
    },
    addEventListener: (name, fn) => { if (name === 'characteristicvaluechanged') valueChangedHandler = fn; },
  };
  const service = { getCharacteristic: async (id) => id.startsWith('62750002') ? characteristic : { readValue: async () => ({ getUint8: () => 0x16 }) } };
  const server = { get connected() { return connected; }, getPrimaryService: async () => {
    if (failService) throw new Error('service unavailable');
    return service;
  } };
  const device = {
    name: 'NRF-EPD-9691',
    addEventListener: (name, fn) => { if (name === 'gattserverdisconnected') disconnectHandler = fn; },
    gatt: {
      get connected() { return connected; },
      connect: async () => { connectCount++; connected = true; return server; },
      disconnect: () => { connected = false; if (disconnectHandler) disconnectHandler(); },
    },
  };
  const context = {
    document: { body: {}, getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, innerHTML: '' });
      return nodes.get(id);
    } },
    navigator: { bluetooth: { requestDevice: async () => { requestCount++; return device; } } },
    setTimeout: (callback) => { timers.push(callback); },
    console: { error: () => {}, log: () => {} },
    Uint8Array,
    TextDecoder,
    Date,
    TextDecoder,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.fakeLog = () => {};
  context.fakeWrite = async () => true;
  vm.runInContext('addLog = fakeLog; write = fakeWrite', context);
  return {
    context,
    device,
    timers,
    node: (id) => context.document.getElementById(id),
    requests: () => requestCount,
    connects: () => connectCount,
    disconnect: () => device.gatt.disconnect(),
  };
}

test('Connect asks for a device only after the user action', async () => {
  const app = harness();
  assert.equal(app.requests(), 0);
  await app.context.preConnect();
  assert.equal(app.requests(), 1);
  await app.timers.shift()();
  assert.equal(app.connects(), 1);
});

test('Reconnect reuses the same device without a second chooser', async () => {
  const app = harness();
  await app.context.preConnect();
  await app.timers.shift()();
  app.disconnect();
  assert.equal(app.node('reconnectbutton').disabled, false);
  await app.context.reConnect();
  await app.timers.shift()();
  assert.equal(app.requests(), 1);
  assert.equal(app.connects(), 2);
});

test('Reconnect on a fresh page does not schedule a connection', async () => {
  const app = harness();
  const result = await app.context.reConnect();
  assert.equal(result, false);
  assert.equal(app.timers.length, 0);
  assert.equal(app.connects(), 0);
});

test('battery notification uses the official millivolt conversion and clears on disconnect', async () => {
  const app = harness();
  await app.context.preConnect();
  await app.timers.shift()();
  assert.equal(app.node('batteryStatus').hidden, true);

  app.context.handleNotify(new TextEncoder().encode('t=1790255043 bat=2707'), 1);
  assert.equal(app.node('batteryStatus').hidden, false);
  assert.equal(app.node('batteryValue').textContent, '23% / 2.71V');
  assert.equal(app.context.batteryPercentFromMv(2707), 23);

  app.disconnect();
  assert.equal(app.node('batteryStatus').hidden, true);
  assert.equal(app.node('batteryValue').textContent, '--');
});

test('custom connection controls mirror connection state and allow same-device reconnect', async () => {
  const app = harness();
  app.context.updateButtonStatus();
  assert.equal(app.node('customReconnectButton').disabled, true);
  await app.context.preConnect();
  assert.equal(app.node('customConnectButton').disabled, true);
  await app.timers.shift()();
  assert.equal(app.node('customConnectButton').textContent, '断开');
  app.disconnect();
  assert.equal(app.node('customConnectButton').textContent, '连接');
  assert.equal(app.node('customReconnectButton').disabled, false);
  await app.context.reConnect();
  await app.timers.shift()();
  assert.equal(app.requests(), 1);
  assert.equal(app.connects(), 2);
});

test('repeated Connect clicks do not request two devices', async () => {
  const app = harness();
  await Promise.all([app.context.preConnect(), app.context.preConnect()]);
  assert.equal(app.requests(), 1);
  assert.equal(app.timers.length, 1);
});

test('partial GATT connection failure disconnects so manual reconnect is possible', async () => {
  const app = harness({ failService: true });
  await app.context.preConnect();
  await app.timers.shift()();
  assert.equal(app.device.gatt.connected, false);
  assert.equal(app.node('reconnectbutton').disabled, false);
  assert.equal(await app.context.reConnect(), true);
});

test('configuration sent while notifications are enabled is captured before INIT', async () => {
  const app = harness({ notifyOnStart: true });
  app.node('epddriver').options = [{ getAttribute: (key) => key === 'data-size' ? '4.2_400_300' : 'threeColor' }];
  app.node('epddriver').selectedIndex = 0;
  vm.runInContext('updateDitcherOptions = () => {}', app.context);
  await app.context.preConnect();
  await app.timers.shift()();
  assert.equal(vm.runInContext('deviceConfig && deviceConfig.driver', app.context), '16');
});

test('a textual status packet before configuration does not poison configuration detection', () => {
  const app = harness();
  app.node('epddriver').options = [{ getAttribute: (key) => key === 'data-size' ? '4.2_400_300' : 'threeColor' }];
  app.node('epddriver').selectedIndex = 0;
  vm.runInContext('updateDitcherOptions = () => {}', app.context);
  app.context.handleNotify(new TextEncoder().encode('mtu=244 rle=1'), 0);
  app.context.handleNotify(Uint8Array.from([0x14, 0x13, 0x06, 0x05, 0x04, 0x03, 0x02, 0x16]), 1);
  assert.equal(vm.runInContext('deviceConfig && deviceConfig.driver', app.context), '16');
});

test('notification setup failure disconnects instead of presenting a usable connection', async () => {
  const app = harness({ failNotifications: true });
  await app.context.preConnect();
  await app.timers.shift()();
  assert.equal(app.device.gatt.connected, false);
  assert.equal(app.node('reconnectbutton').disabled, false);
});

test('upload stays disabled until a valid device configuration notification arrives', async () => {
  const app = harness();
  app.node('imageFile').files = [{ name: 'test.png' }];
  app.node('epddriver').options = [{ getAttribute: (key) => key === 'data-size' ? '4.2_400_300' : 'blackWhiteColor' }];
  app.node('epddriver').selectedIndex = 0;
  await app.context.preConnect();
  await app.timers.shift()();
  assert.equal(app.node('sendimgbutton').disabled, true);
  vm.runInContext('updateDitcherOptions = () => {}', app.context);
  app.context.handleNotify(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1]), 0);
  assert.equal(app.node('sendimgbutton').disabled, false);
});

test('driver 0x16 config selects the source-site three-color 400 x 300 mode', async () => {
  const app = harness();
  const select = app.node('epddriver');
  const options = [...html.matchAll(/<option value="([^"]+)" data-color="([^"]+)" data-size="([^"]+)"/g)]
    .map(([, value, color, size]) => ({ value, getAttribute: (key) => key === 'data-color' ? color : size }));
  let selectedIndex = -1;
  Object.defineProperties(select, {
    value: {
      get: () => options[selectedIndex]?.value ?? '',
      set: (value) => { selectedIndex = options.findIndex((option) => option.value === value); },
    },
    selectedIndex: { get: () => selectedIndex },
  });
  select.options = options;
  app.node('imageFile').files = [{ name: 'test.png' }];
  vm.runInContext('canvas = { width: 400, height: 300 }; updateImage = () => {}', app.context);
  await app.context.preConnect();
  await app.timers.shift()();
  app.context.handleNotify(Uint8Array.from([0x14, 0x13, 0x06, 0x05, 0x04, 0x03, 0x02, 0x16]), 0);
  assert.equal(select.value, '16');
  assert.equal(app.node('canvasSize').value, '4.2_400_300');
  assert.equal(app.node('ditherMode').value, 'threeColor');
  assert.equal(app.node('sendimgbutton').disabled, true);
  assert.match(app.node('status').textContent, /槽位/);
  app.context.handleNotify(new TextEncoder().encode('slots=15 1 0'), 1);
  assert.equal(app.node('sendimgbutton').disabled, false);
});

test('driver 0x16 keeps upload disabled for an incomplete slot notification', async () => {
  const app = harness();
  app.node('imageFile').files = [{ name: 'test.png' }];
  await app.context.preConnect();
  await app.timers.shift()();
  vm.runInContext("deviceConfig = { driver: '16', size: '4.2_400_300', color: 'threeColor' }", app.context);
  app.context.handleNotify(new TextEncoder().encode('slots=15 1'), 1);
  assert.equal(app.node('sendimgbutton').disabled, true);
});
