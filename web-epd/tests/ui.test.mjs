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

test('browser initialization works without removed paint controls and never asks for Bluetooth', () => {
  const elements = new Map();
  const context2d = { fillRect: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 400, height: 300 }) };
  const document = {
    body: { classList: { add: () => {}, remove: () => {} } },
    addEventListener: () => {},
    getElementById(id) {
      if (!ids.has(id)) return null;
      if (!elements.has(id)) {
        const element = {
          value: '', files: [], disabled: false, style: {},
          addEventListener: () => {}, removeEventListener: () => {},
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
  for (const file of ['js/paint.js', 'js/crop.js', 'js/upload-state.js', 'js/main.js']) {
    if (existsSync(join(root, file))) vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox);
  }
  assert.doesNotThrow(() => document.body.onload());
  assert.equal(chooserCalls, 0);
});
