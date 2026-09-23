import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'main.js'), 'utf8');

function harness() {
  const nodes = new Map();
  const timers = [];
  let requestCount = 0;
  let connectCount = 0;
  let disconnectHandler;
  let connected = false;
  const characteristic = { startNotifications: async () => {}, addEventListener: () => {} };
  const service = { getCharacteristic: async (id) => id.startsWith('62750002') ? characteristic : { readValue: async () => ({ getUint8: () => 0x16 }) } };
  const server = { get connected() { return connected; }, getPrimaryService: async () => service };
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
    console,
    Uint8Array,
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

test('repeated Connect clicks do not request two devices', async () => {
  const app = harness();
  await Promise.all([app.context.preConnect(), app.context.preConnect()]);
  assert.equal(app.requests(), 1);
  assert.equal(app.timers.length, 1);
});
