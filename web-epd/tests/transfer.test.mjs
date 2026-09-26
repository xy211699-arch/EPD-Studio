import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const mainSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'main.js'), 'utf8');
const rleSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'rle.js'), 'utf8');
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const INIT = 0x01;
const REFRESH = 0x05;
const WRITE_IMG = 0x30;
const SET_SLOT = 0x31;
const jsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');

function customHarness(options = {}) {
  const app = makeHarness({ imageSelected: false, ...options });
  app.context.alert = () => {};
  app.context.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  for (const file of ['static-dashboard.js', 'dithering.js']) {
    vm.runInContext(readFileSync(join(jsRoot, file), 'utf8'), app.context);
  }
  app.node('dashboardCanvas').getContext = () => ({ putImageData: (image) => { app.preview = image; } });
  app.context.document.createElement = () => ({ getContext: () => ({
    measureText: () => ({ width: 20 }), clearRect() {}, fillText() {},
    getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  }) });
  vm.runInContext("deviceConfig = { driver: '16', size: '4.2_400_300', color: 'threeColor' }", app.context);
  app.context.handleNotify(new TextEncoder().encode('slots=15 0 0'), 1);
  app.commands = [];
  app.context.fakeWrite = async (command, payload) => { app.commands.push([command, payload]); return true; };
  vm.runInContext('write = fakeWrite', app.context);
  app.context.renderCustomImage();
  return app;
}

test('custom upload uses two native planes without a file or matching file-view controls', async () => {
  const app = customHarness();
  assert.equal(app.node('customUploadButton').disabled, false);
  app.context.cropMock.isCropMode = () => true;
  assert.equal((await app.context.sendimg('custom')).ok, true);
  assert.deepEqual(app.commands.slice(0, 2).map(([cmd]) => cmd), [SET_SLOT, INIT]);
  assert.equal(app.commands.at(-1)[0], REFRESH);
  const planes = [[], []];
  for (const [cmd, data] of app.commands) if (cmd === WRITE_IMG) {
    planes[(data[0] & 15) === 15 ? 0 : 1].push(...data.slice(1));
  }
  assert.deepEqual(planes.map((plane) => plane.length), [15000, 15000]);
  for (let i = 0; i < 120000; i++) {
    const mask = 128 >> (i % 8);
    const bw = Boolean(planes[0][i >> 3] & mask);
    const red = Boolean(planes[1][i >> 3] & mask);
    const rgba = !red ? [255, 0, 0, 255] : bw ? [255, 255, 255, 255] : [0, 0, 0, 255];
    assert.deepEqual(Array.from(app.preview.data.slice(i * 4, i * 4 + 4)), rgba);
  }
  assert.equal(app.node('imageFile').files.length, 0);
  assert.equal(app.node('dashboardStatus').textContent, app.node('status').textContent);
});

test('custom preflight rejects invalid pixels, config, slot and planes before any command', async () => {
  for (const setup of [
    'customPixels = null', 'customPixels = new Uint8Array(119999)',
    'customPixels[0] = 3', "deviceConfig.driver = '01'", "deviceConfig.size = 'bad'",
    "deviceConfig.color = 'blackWhiteColor'", 'deviceSlots = null',
    'deviceSlots.count = 0', 'deviceSlots.selected = 256',
    'processImageData = () => new Uint8Array(29999)',
  ]) {
    const app = customHarness();
    assert.equal(app.node('customUploadButton').disabled, false, 'fixture must be ready before mutation');
    vm.runInContext(setup, app.context);
    assert.equal((await app.context.sendimg('custom')).ok, false, setup);
    assert.deepEqual(app.commands, [], setup);
  }
});

test('pending custom transfer blocks generation, connection controls and duplicate upload', async () => {
  const app = customHarness({ holdInitDelay: true });
  const pixels = vm.runInContext('customPixels', app.context);
  const first = app.context.sendimg('custom');
  await new Promise((resolve) => setImmediate(resolve));
  for (const id of ['customUploadButton', 'sendimgbutton', 'generateDashboard', 'customConnectButton', 'connectbutton']) {
    assert.equal(app.node(id).disabled, true, id);
  }
  assert.equal((await app.context.sendimg('custom')).ok, false);
  app.context.renderCustomImage();
  assert.equal(vm.runInContext('customPixels', app.context), pixels);
  app.delayed.shift()();
  assert.equal((await first).ok, true);
  assert.equal(app.commands.filter(([cmd]) => cmd === INIT).length, 1);
  assert.equal(app.node('customUploadButton').disabled, false);
});

test('unknown sources cannot upload even when the file source is ready', async () => {
  const app = makeHarness();
  const commands = [];
  app.context.fakeWrite = async (cmd) => { commands.push(cmd); return true; };
  vm.runInContext('write = fakeWrite', app.context);
  assert.equal((await app.context.sendimg('unknown')).ok, false);
  assert.deepEqual(commands, []);
});

test('custom overwrite cancellation and packet failure never refresh', async () => {
  const app = customHarness();
  app.context.handleNotify(new TextEncoder().encode('slots=15 1 0'), 2);
  app.context.confirm = () => false;
  assert.equal((await app.context.sendimg('custom')).ok, false);
  assert.deepEqual(app.commands, []);
  app.context.confirm = () => true;
  app.context.fakeWrite = async (cmd) => { app.commands.push([cmd]); return cmd !== WRITE_IMG; };
  vm.runInContext('write = fakeWrite', app.context);
  assert.equal((await app.context.sendimg('custom')).ok, false);
  assert.deepEqual(app.commands.map(([cmd]) => cmd), [SET_SLOT, INIT, WRITE_IMG]);
});

function makeHarness({ imageSelected = true, holdInitDelay = false } = {}) {
  const nodes = new Map();
  const delayed = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, innerHTML: '', parentElement: { style: {} } });
    return nodes.get(id);
  }
  node('mtusize').value = 20;
  node('interleavedcount').value = 50;
  node('canvasSize').value = '4.2_400_300';
  node('ditherMode').value = 'blackWhiteColor';
  node('epddriver').value = '01';
  node('epddriver').selectedIndex = 0;
  node('epddriver').options = [{ getAttribute: (name) => name === 'data-size' ? '4.2_400_300' : 'blackWhiteColor' }];
  node('imageFile').files = imageSelected ? [{ name: 'test.png' }] : [];
  const logs = [];
  const context = {
    document: { body: {}, getElementById: node },
    console,
    Date,
    Uint8Array,
    TextDecoder,
    setTimeout: (callback, ms) => {
      if (holdInitDelay && ms === 200) delayed.push(callback);
      else callback();
    },
    processImageData: () => Uint8Array.of(0xff, 0x00),
    canvasMock: { width: 400, height: 300 },
    ctxMock: { getImageData: () => ({ data: new Uint8ClampedArray(4), width: 400, height: 300 }) },
    cropMock: { isCropMode: () => false },
    logs,
  };
  vm.createContext(context);
  vm.runInContext(rleSource, context);
  vm.runInContext(mainSource, context);
  vm.runInContext("canvas = canvasMock; ctx = ctxMock; cropManager = cropMock; rleSupport = false; startTime = Date.now(); gattServer = { connected: true }; epdCharacteristic = {}; deviceConfig = { driver: '01', size: '4.2_400_300', color: 'blackWhiteColor' }; addLog = (message) => logs.push(message);", context);
  return { context, node, logs, delayed };
}

test('first failed image packet aborts the image transfer', async () => {
  const { context } = makeHarness();
  let calls = 0;
  context.fakeWrite = async () => { calls++; return false; };
  vm.runInContext('write = fakeWrite', context);
  await assert.rejects(context.writeImage(Uint8Array.of(0x11, 0x22)), /WRITE_IMG.*1/);
  assert.equal(calls, 1);
});

test('a disconnected GATT server blocks writes even while the characteristic object remains', async () => {
  const { context } = makeHarness();
  vm.runInContext('gattServer.connected = false', context);
  assert.equal(await context.write(INIT), false);
});

test('middle failed packet prevents later packets', async () => {
  const { context } = makeHarness();
  let calls = 0;
  context.fakeWrite = async () => ++calls !== 2;
  vm.runInContext('write = fakeWrite', context);
  await assert.rejects(context.writeImage(new Uint8Array(50)), /WRITE_IMG.*2/);
  assert.equal(calls, 2);
});

test('invalid transfer sizes stop before any image packet', async () => {
  for (const [mtu, interval] of [[2, 50], [0, 50], ['abc', 50], [20, -1], [20, 'abc']]) {
    const { context, node } = makeHarness();
    node('mtusize').value = mtu;
    node('interleavedcount').value = interval;
    let calls = 0;
    context.fakeWrite = async () => { calls++; return true; };
    vm.runInContext('write = fakeWrite', context);
    await assert.rejects(context.writeImage(Uint8Array.of(1, 2)), /MTU|confirm interval/i);
    assert.equal(calls, 0);
  }
});

test('failed initialization prevents image writes and refresh', async () => {
  const { context } = makeHarness();
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return false; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, [INIT]);
});

test('failed image packet never sends REFRESH', async () => {
  const { context } = makeHarness();
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return command !== WRITE_IMG; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, [INIT, WRITE_IMG]);
});

test('failed REFRESH is reported as failure', async () => {
  const { context, logs } = makeHarness();
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return command !== REFRESH; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, [INIT, WRITE_IMG, REFRESH]);
  assert.equal(logs.some((message) => String(message).includes('发送完成')), false);
});

test('no selected image prevents any device write', async () => {
  const { context } = makeHarness({ imageSelected: false });
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, []);
});

test('missing device-reported configuration prevents INIT and upload', async () => {
  const { context } = makeHarness();
  vm.runInContext('deviceConfig = null', context);
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, []);
});

test('edited driver selection cannot override device-reported configuration', async () => {
  const { context, node } = makeHarness();
  node('epddriver').value = '03';
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, []);
});

test('a second upload cannot start while the first is pending', async () => {
  const { context } = makeHarness();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const commands = [];
  context.fakeWrite = async (command) => {
    commands.push(command);
    if (command === INIT) await pending;
    return true;
  };
  vm.runInContext('write = fakeWrite', context);
  const first = context.sendimg();
  const second = context.sendimg();
  release();
  const secondResult = await second;
  await first;
  assert.equal(secondResult.ok, false);
  assert.equal(commands.filter((command) => command === INIT).length, 1);
});

test('occupied current slot requires confirmation before any device write', async () => {
  const { context } = makeHarness();
  const prompts = [];
  context.confirm = (message) => { prompts.push(message); return false; };
  context.handleNotify(new TextEncoder().encode('slots=15 1 0'), 1);
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.equal(prompts.length, 1);
  assert.deepEqual(commands, []);
});

test('confirmed current slot is selected before image initialization', async () => {
  const { context } = makeHarness();
  context.confirm = () => true;
  context.handleNotify(new TextEncoder().encode('slots=15 1 0'), 1);
  const commands = [];
  context.fakeWrite = async (command, data) => {
    commands.push([command, data == null ? null : Array.from(data)]);
    return true;
  };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, true);
  assert.deepEqual(commands[0], [SET_SLOT, [0, 0]]);
  assert.equal(commands[1][0], INIT);
  assert.equal(commands.at(-1)[0], REFRESH);
});

test('image packets wait for the source-site initialization interval', async () => {
  const { context, delayed } = makeHarness({ holdInitDelay: true });
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const pending = context.sendimg();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands, [INIT]);
  assert.equal(delayed.length, 1);
  delayed.shift()();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(commands[1], WRITE_IMG);
  assert.equal(commands.at(-1), REFRESH);
});

test('default transfer confirms every eleventh image packet like the source site', async () => {
  const { context, node } = makeHarness();
  const defaultInterval = html.match(/id="interleavedcount" value="(\d+)"/);
  assert.ok(defaultInterval);
  node('interleavedcount').value = Number(defaultInterval[1]);
  node('mtusize').value = 3;
  const responses = [];
  context.fakeWrite = async (command, _data, withResponse) => {
    if (command === WRITE_IMG) responses.push(withResponse);
    return true;
  };
  vm.runInContext('write = fakeWrite', context);
  await context.writeImage(new Uint8Array(12));
  assert.deepEqual(responses, [false, false, false, false, false, false, false, false, false, false, true, false]);
});

test('retry after writing an initially empty slot requires overwrite confirmation', async () => {
  const { context } = makeHarness();
  context.handleNotify(new TextEncoder().encode('slots=15 0 0'), 1);
  const prompts = [];
  context.confirm = (message) => { prompts.push(message); return false; };
  const commands = [];
  context.fakeWrite = async (command) => {
    commands.push(command);
    return command !== WRITE_IMG;
  };
  vm.runInContext('write = fakeWrite', context);
  const first = await context.sendimg();
  assert.equal(first.ok, false);
  assert.deepEqual(commands, [SET_SLOT, INIT, WRITE_IMG]);
  const second = await context.sendimg();
  assert.equal(second.ok, false);
  assert.equal(prompts.length, 1);
  assert.deepEqual(commands, [SET_SLOT, INIT, WRITE_IMG]);
});

test('slot index outside a single byte never reaches the device', async () => {
  const { context } = makeHarness();
  context.handleNotify(new TextEncoder().encode('slots=300 0 256'), 1);
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, []);
});

test('RLE never creates a packet larger than a very small configured MTU', async () => {
  const { context, node } = makeHarness();
  node('mtusize').value = 3;
  vm.runInContext('rleSupport = true', context);
  const packetLengths = [];
  context.fakeWrite = async (command, payload) => {
    if (command === WRITE_IMG) packetLengths.push(1 + payload.length);
    return true;
  };
  vm.runInContext('write = fakeWrite', context);
  await context.writeImage(new Uint8Array(4).fill(0xaa));
  assert.ok(packetLengths.length > 0);
  assert.ok(packetLengths.every((length) => length <= 3), `oversized packets: ${packetLengths}`);
});

test('a stale slot notification cannot erase an attempted write warning', async () => {
  const { context } = makeHarness();
  context.handleNotify(new TextEncoder().encode('slots=15 0 0'), 1);
  const prompts = [];
  context.confirm = (message) => { prompts.push(message); return false; };
  const commands = [];
  context.fakeWrite = async (command) => {
    commands.push(command);
    return command !== WRITE_IMG;
  };
  vm.runInContext('write = fakeWrite', context);
  await context.sendimg();
  context.handleNotify(new TextEncoder().encode('slots=15 0 0'), 2);
  const retry = await context.sendimg();
  assert.equal(retry.ok, false);
  assert.equal(prompts.length, 1);
  assert.deepEqual(commands, [SET_SLOT, INIT, WRITE_IMG]);
});

test('driver 0x16 does not upload before its slot notification arrives', async () => {
  const { context, node } = makeHarness();
  node('epddriver').value = '16';
  node('epddriver').options = [{ getAttribute: (name) => name === 'data-size' ? '4.2_400_300' : 'threeColor' }];
  node('ditherMode').value = 'threeColor';
  vm.runInContext("deviceConfig = { driver: '16', size: '4.2_400_300', color: 'threeColor' }", context);
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, []);
});

test('invalid transfer settings stop before SET_SLOT or INIT', async () => {
  const { context, node } = makeHarness();
  context.handleNotify(new TextEncoder().encode('slots=15 0 0'), 1);
  node('mtusize').value = 2;
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const result = await context.sendimg();
  assert.equal(result.ok, false);
  assert.deepEqual(commands, []);
});

test('changing the driver control during INIT wait cannot change the active image encoding', async () => {
  const { context, node, delayed } = makeHarness({ holdInitDelay: true });
  node('epddriver').value = '16';
  node('epddriver').options = [{ getAttribute: (name) => name === 'data-size' ? '4.2_400_300' : 'threeColor' }];
  node('ditherMode').value = 'threeColor';
  vm.runInContext("deviceConfig = { driver: '16', size: '4.2_400_300', color: 'threeColor' }", context);
  context.handleNotify(new TextEncoder().encode('slots=15 0 0'), 1);
  const commands = [];
  context.fakeWrite = async (command) => { commands.push(command); return true; };
  vm.runInContext('write = fakeWrite', context);
  const pending = context.sendimg();
  await new Promise((resolve) => setImmediate(resolve));
  node('epddriver').value = '08';
  delayed.shift()();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(commands.filter((command) => command === WRITE_IMG).length, 2);
});

test('changing MTU during INIT wait cannot change the active packet size', async () => {
  const { context, node, delayed } = makeHarness({ holdInitDelay: true });
  node('mtusize').value = 8;
  context.processImageData = () => new Uint8Array(10);
  const packetLengths = [];
  context.fakeWrite = async (command, payload) => {
    if (command === WRITE_IMG) packetLengths.push(1 + payload.length);
    return true;
  };
  vm.runInContext('write = fakeWrite', context);
  const pending = context.sendimg();
  await new Promise((resolve) => setImmediate(resolve));
  node('mtusize').value = 3;
  delayed.shift()();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(packetLengths, [8, 6]);
});

test('RLE negotiation during INIT wait cannot change the active packet format', async () => {
  const { context, node, delayed } = makeHarness({ holdInitDelay: true });
  node('mtusize').value = 8;
  context.processImageData = () => new Uint8Array(20).fill(0xaa);
  const flags = [];
  context.fakeWrite = async (command, payload) => {
    if (command === WRITE_IMG) flags.push(payload[0]);
    return true;
  };
  vm.runInContext('write = fakeWrite', context);
  const pending = context.sendimg();
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext('rleSupport = true', context);
  delayed.shift()();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(flags, [0x0f, 0xff, 0xff, 0xff]);
});
