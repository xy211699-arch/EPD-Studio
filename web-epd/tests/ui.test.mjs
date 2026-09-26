import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

test('single upload workspace has the required controls but no hardware commands', () => {
  for (const id of ['connectbutton', 'reconnectbutton', 'imageFile', 'canvas', 'canvasSize', 'ditherMode', 'ditherAlg', 'ditherStrength', 'ditherContrast', 'crop-zoom-in', 'crop-zoom-out', 'crop-move-left', 'crop-move-right', 'crop-move-up', 'crop-move-down', 'sendimgbutton', 'status', 'log', 'epddriver', 'epdpins', 'mtusize', 'interleavedcount']) {
    assert.ok(ids.has(id), `${id} missing`);
  }
  for (const id of ['setDriverbutton', 'sendcmdbutton', 'calendarmodebutton', 'clockmodebutton', 'clearscreenbutton', 'brush-mode', 'text-mode', 'debug-toggle']) {
    assert.ok(!ids.has(id), `${id} must not be exposed`);
  }
  assert.ok(html.includes('js/upload-state.js'));
  assert.ok(html.indexOf('js/upload-state.js') < html.indexOf('js/main.js'));
  assert.ok(html.includes('css/app.css'));
});

test('EVA-inspired styles include approved colors, keyboard focus, and narrow layout', () => {
  const path = join(root, 'css', 'app.css');
  assert.ok(existsSync(path), 'app.css missing');
  const css = readFileSync(path, 'utf8');
  for (const token of ['#F4F3F1', '#1F1E1C', '#E8590C', ':focus-visible', '@media']) {
    assert.ok(css.includes(token), `${token} missing`);
  }
});

test('two upload tabs keep existing controls and show only the file view initially', () => {
  for (const id of ['viewTabs', 'tab-file', 'tab-custom', 'view-file', 'view-custom', 'connectbutton', 'reconnectbutton', 'imageFile', 'canvas', 'sendimgbutton', 'status']) {
    assert.ok(ids.has(id), `${id} missing`);
  }
  assert.match(html, /<main\b(?=[^>]*\bid="view-file")(?=[^>]*\brole="tabpanel")(?=[^>]*\baria-labelledby="tab-file")[^>]*>/);
  assert.match(html, /<main\b(?=[^>]*\bid="view-custom")(?=[^>]*\brole="tabpanel")(?=[^>]*\baria-labelledby="tab-custom")(?=[^>]*\bhidden(?:\s|>))[^>]*>/);
  assert.ok(html.indexOf('js/view-tabs.js') < html.indexOf('js/main.js'));
  assert.match(html, /<nav\b[^>]*id="viewTabs"[^>]*class="view-tabs"/);
  assert.match(html, /id="tab-file"[^>]*>01&nbsp;&nbsp;Original<\/button>/);
  assert.match(html, /id="tab-custom"[^>]*>02&nbsp;&nbsp;Custom<\/button>/);
  assert.equal((html.match(/class="view-tabs"/g) || []).length, 1);
  const customStart = html.indexOf('id="view-custom"');
  const connectStep = html.indexOf('id="customConnectButton"', customStart);
  const generateStep = html.indexOf('id="generateDashboard"', customStart);
  assert.ok(connectStep > customStart && generateStep > connectStep, 'Custom must connect before generating');
});

test('quota controls expose both account windows without exposing credentials', () => {
  for (const id of ['refreshQuotaButton', 'quotaStatusText', 'quotaUpdated', 'quotaFiveHour', 'quotaSevenDay', 'quotaTopValue']) {
    assert.ok(ids.has(id), `${id} missing`);
  }
  assert.ok(html.includes('js/quota-state.js'));
  assert.ok(html.indexOf('js/quota-state.js') < html.indexOf('js/main.js'));
  assert.ok(!html.includes('access_token'));
});

test('browser initialization works without removed paint controls and never asks for Bluetooth', () => {
  const elements = new Map();
  const context2d = { fillRect: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 400, height: 300 }) };
  const document = {
    body: { classList: { add: () => {}, remove: () => {} } },
    addEventListener: () => {},
    getElementById(id) {
      if (!ids.has(id)) return null;
      if (!elements.has(id)) {
        const listeners = new Map();
        const element = {
          value: '', files: [], disabled: false, style: {},
          addEventListener: (type, listener) => { listeners.set(type, listener); },
          removeEventListener: (type) => { listeners.delete(type); },
          setAttribute: () => {}, focus: () => {},
          click: () => { listeners.get('click')?.({}); },
          classList: { add: () => {}, remove: () => {}, contains: () => false },
          parentNode: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
          getContext: () => context2d,
          width: 400, height: 300,
        };
        elements.set(id, element);
      }
      return elements.get(id);
    },
    querySelector: () => ({ style: {}, textContent: '' }),
  };
  let chooserCalls = 0;
  const sandbox = {
    document,
    navigator: { bluetooth: { requestDevice: () => { chooserCalls++; throw new Error('Unexpected chooser'); } } },
    console, Uint8Array, Uint8ClampedArray, Date, URLSearchParams,
    window: { location: { search: '', pathname: '/' } },
  };
  vm.createContext(sandbox);
  for (const file of ['js/paint.js', 'js/crop.js', 'js/upload-state.js', 'js/view-tabs.js', 'js/quota-state.js', 'js/main.js']) {
    if (existsSync(join(root, file))) vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox);
  }
  assert.doesNotThrow(() => document.body.onload());
  assert.ok(document.getElementById('customUploadButton'));
  assert.equal(document.getElementById('customUploadButton').disabled, true);
  assert.equal(document.getElementById('customReconnectButton').disabled, true);
  vm.runInContext('connect = () => { globalThis.connectCalls++; }', sandbox);
  sandbox.connectCalls = 0;
  const custom = document.getElementById('tab-custom');
  custom.click();
  assert.equal(document.getElementById('view-file').hidden, true);
  assert.equal(document.getElementById('view-custom').hidden, false);
  assert.equal(chooserCalls, 0);
  assert.equal(sandbox.connectCalls, 0);
});
