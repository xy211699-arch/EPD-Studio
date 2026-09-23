import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const mainSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'main.js'), 'utf8');
const INIT = 0x01;
const REFRESH = 0x05;
const WRITE_IMG = 0x30;

function makeHarness({ imageSelected = true } = {}) {
  const nodes = new Map();
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
    setTimeout: () => 0,
    processImageData: () => Uint8Array.of(0xff, 0x00),
    canvasMock: { width: 400, height: 300 },
    ctxMock: { getImageData: () => ({ data: new Uint8ClampedArray(4), width: 400, height: 300 }) },
    cropMock: { isCropMode: () => false },
    logs,
  };
  vm.createContext(context);
  vm.runInContext(mainSource, context);
  vm.runInContext("canvas = canvasMock; ctx = ctxMock; cropManager = cropMock; rleSupport = false; startTime = Date.now(); gattServer = { connected: true }; epdCharacteristic = {}; deviceConfig = { driver: '01', size: '4.2_400_300', color: 'blackWhiteColor' }; addLog = (message) => logs.push(message);", context);
  return { context, node, logs };
}

test('first failed image packet aborts the image transfer', async () => {
  const { context } = makeHarness();
  let calls = 0;
  context.fakeWrite = async () => { calls++; return false; };
  vm.runInContext('write = fakeWrite', context);
  await assert.rejects(context.writeImage(Uint8Array.of(0x11, 0x22)), /WRITE_IMG.*1/);
  assert.equal(calls, 1);
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
    await assert.rejects(context.writeImage(Uint8Array.of(1, 2)), /MTU|确认间隔/);
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
