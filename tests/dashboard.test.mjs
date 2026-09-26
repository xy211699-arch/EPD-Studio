import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js', 'dashboard.js');
const mainScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js', 'main.js');

function loadDashboard(extra = {}) {
  const sandbox = { ...extra };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(script, 'utf8'), sandbox);
  return sandbox.EpdStaticDashboard;
}

const markerText = ({ x, y, color, point }) => point(x, y, color);
const at = (pixels, x, y) => pixels[y * 400 + x];
const JULY = new Date('2026-07-01T20:32:00+08:00');
const JULY_THIRD = new Date('2026-07-03T20:32:00+08:00');
const SEPTEMBER_25 = new Date('2026-09-25T13:07:00+08:00');
const OCTOBER_1 = new Date('2026-10-01T09:05:00+08:00');
const LUNAR_NEW_YEAR_EVE = new Date('2026-02-16T12:00:00+08:00');
const LUNAR_NEW_YEAR = new Date('2026-02-17T12:00:00+08:00');

test('fresh dashboard has deterministic 400x300 three-color pixels', () => {
  const dashboard = loadDashboard();
  const first = dashboard.createPixels(markerText, undefined, JULY);
  const second = dashboard.createPixels(markerText, undefined, JULY);
  assert.equal(first.length, 120000);
  assert.deepEqual(first, second);
  assert.equal(dashboard.validatePixels(first), true);
  assert.equal(first[0], 0);
  assert.ok(first.includes(1));
  assert.ok(first.includes(2));
});

test('pixel validation rejects wrong length, wrong type and a fourth color', () => {
  const dashboard = loadDashboard();
  assert.equal(dashboard.validatePixels(new Uint8Array(119999)), false);
  assert.equal(dashboard.validatePixels(new Array(120000).fill(0)), false);
  const pixels = new Uint8Array(120000);
  pixels[401] = 3;
  assert.equal(dashboard.validatePixels(pixels), false);
});

test('ImageData conversion yields exact opaque white, black and red', () => {
  const dashboard = loadDashboard();
  const pixels = new Uint8Array(120000);
  pixels[1] = 1;
  pixels[2] = 2;
  class ImageDataStub {
    constructor(data, width, height) { Object.assign(this, { data, width, height }); }
  }
  const image = dashboard.toImageData(pixels, ImageDataStub);
  assert.equal(image.width, 400);
  assert.equal(image.height, 300);
  assert.deepEqual(Array.from(image.data.slice(0, 12)), [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  pixels[0] = 3;
  assert.throws(() => dashboard.toImageData(pixels, ImageDataStub), { name: 'TypeError', message: '无效的三色点阵' });
});

test('July 2026 starts on Wednesday and ends with Friday the 31st', () => {
  const calls = [];
  loadDashboard().createPixels(args => { calls.push(args); args.point(args.x, args.y, args.color); }, undefined, JULY);
  const day = value => calls.find(call => call.text === String(value) && call.kind === 'day');
  const weekdays = calls.filter(call => ['一', '二', '三', '四', '五', '六', '日'].includes(call.text));
  assert.equal(day(1).x, day(8).x);
  assert.equal(day(1).y + 44, day(8).y);
  assert.equal(day(1).x + 7, weekdays[2].x);
  assert.equal(day(2).x + 7, weekdays[3].x);
  assert.equal(day(31).x, day(3).x);
  assert.equal(day(31).y, day(27).y);
  assert.equal(calls.filter(call => call.kind === 'day').length, 31);
});

test('September 25 2026 uses the current date, lunar date and Mid-Autumn label', () => {
  const calls = [];
  const dashboard = loadDashboard();
  dashboard.createPixels(args => { calls.push(args); markerText(args); }, {
    status: 'unavailable', five_hour: null, seven_day: null,
  }, SEPTEMBER_25);
  const texts = calls.map(call => call.text);
  assert.ok(texts.includes('2026'));
  assert.ok(texts.includes('9'));
  assert.ok(texts.includes('丙午年八月十五'));
  assert.ok(texts.includes('中秋'));
  assert.ok(texts.includes('13:07刷新'));
  const day25 = calls.find(call => call.text === '25' && call.kind === 'day');
  const weekdays = calls.filter(call => ['一', '二', '三', '四', '五', '六', '日'].includes(call.text));
  assert.equal(day25.x + 7, weekdays[4].x);
});

test('lunar conversion and festival labels are deterministic and two characters', () => {
  const dashboard = loadDashboard();
  const lunar = dashboard.lunarDateFor(SEPTEMBER_25);
  assert.deepEqual(JSON.parse(JSON.stringify(lunar)), { yearName: '丙午', monthName: '八月', monthNumber: 8, dayNumber: 15, dayLabel: '十五' });
  assert.equal(dashboard.festivalLabelFor(SEPTEMBER_25, lunar), '中秋');
  assert.equal(dashboard.lunarDayLabelFor(10), '初十');
  for (const label of Object.values(dashboard.FESTIVAL_LABELS)) assert.equal([...label].length, 2);
});

test('six-row months fit the fixed calendar area', () => {
  const dashboard = loadDashboard();
  const calendar = dashboard.calendarForMonth(new Date('2026-08-01T12:00:00+08:00'));
  assert.equal(calendar.weekCount, 6);
  assert.equal(calendar.days.length, 31);
});

test('two-digit months leave a stable gap before the month label', () => {
  const calls = [];
  loadDashboard().createPixels(args => { calls.push(args); markerText(args); }, undefined, OCTOBER_1);
  const month = calls.find(call => call.text === '10');
  const monthLabel = calls.find(call => call.text === '月');
  assert.ok(monthLabel.x - month.x >= 20);
});

test('traditional first and twelfth lunar months map to festivals', () => {
  const dashboard = loadDashboard();
  const eve = dashboard.lunarDateFor(LUNAR_NEW_YEAR_EVE);
  const newYear = dashboard.lunarDateFor(LUNAR_NEW_YEAR);
  assert.equal(eve.monthNumber, 12);
  assert.equal(dashboard.festivalLabelFor(LUNAR_NEW_YEAR_EVE, eve), '除夕');
  assert.equal(newYear.monthNumber, 1);
  assert.equal(dashboard.festivalLabelFor(LUNAR_NEW_YEAR, newYear), '春节');
});

test('date cells share the exact centers of the weekday header columns', () => {
  const calls = [];
  loadDashboard().createPixels(args => { calls.push(args); markerText(args); }, undefined, JULY);
  const weekdays = calls.filter(call => ['一', '二', '三', '四', '五', '六', '日'].includes(call.text));
  const day = value => calls.find(call => call.text === String(value) && call.kind === 'day');
  assert.equal(day(1).x + 7, weekdays[2].x);
  assert.equal(day(2).x + 7, weekdays[3].x);
  assert.equal(day(31).x + 7, weekdays[4].x);
});

test('dashboard includes capacity labels and fixed pixel dinosaur region', () => {
  const calls = [];
  const pixels = loadDashboard().createPixels(args => { calls.push(args.text); markerText(args); }, undefined, JULY);
  for (const label of ['5h', '7d', '72%', '77%', '20:32刷新', '努力搬砖ing']) assert.ok(calls.includes(label), label);
  let dinosaurInk = 0;
  for (let y = 215; y < 277; y++) for (let x = 225; x < 285; x++) dinosaurInk += at(pixels, x, y) === 1;
  assert.ok(dinosaurInk > 100);
});

test('dashboard uses live five-hour and seven-day remaining percentages', () => {
  const calls = [];
  loadDashboard().createPixels(args => { calls.push(args.text); markerText(args); }, {
    status: 'ok', updated_at: '2026-09-25T13:07:00+08:00', plan_type: 'pro',
    five_hour: { remaining_percent: 41 }, seven_day: { remaining_percent: 88 },
  }, SEPTEMBER_25);
  for (const label of ['41%', '88%', '13:07刷新', 'Pro']) assert.ok(calls.includes(label), label);
});

test('dashboard does not invent quota values when the live source is unavailable', () => {
  const calls = [];
  loadDashboard().createPixels(args => { calls.push(args.text); markerText(args); }, {
    status: 'unavailable', five_hour: null, seven_day: null,
  }, SEPTEMBER_25);
  assert.ok(calls.includes('--'));
  assert.equal(calls.includes('72%'), false);
  assert.equal(calls.includes('77%'), false);
});

test('dashboard removes the battery widget and centers the weekday header cells', () => {
  const calls = [];
  loadDashboard().createPixels(args => { calls.push(args); markerText(args); }, undefined, JULY);
  assert.equal(calls.some(call => call.text === '80%'), false);
  const weekdays = calls.filter(call => ['一', '二', '三', '四', '五', '六', '日'].includes(call.text));
  assert.deepEqual(weekdays.map(call => call.x), [25, 53, 82, 110, 138, 167, 195]);
});

test('red retains priority over black and regeneration never overlays an old frame', () => {
  const dashboard = loadDashboard();
  const first = dashboard.createPixels(({ point }) => { point(12, 9, 2); point(12, 9, 1); point(399, 299, 1); }, undefined, JULY);
  const second = dashboard.createPixels(markerText, undefined, JULY);
  assert.equal(at(first, 12, 9), 2);
  assert.equal(at(first, 399, 299), 1);
  assert.equal(at(second, 399, 299), 0);
});

test('white lettering cuts through the red selected-day tile', () => {
  const pixels = loadDashboard().createPixels(markerText, undefined, JULY_THIRD);
  assert.equal(at(pixels, 127, 66), 2);
  assert.equal(at(pixels, 131, 66), 0);
});

test('browser text rasterization keeps a crisp low-alpha edge threshold', () => {
  const points = [];
  const context = {
    clearRect() {},
    fillText() {},
    measureText() { return { width: 3 }; },
    getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 255]) }; },
  };
  const dashboard = loadDashboard({ document: { createElement() { return { width: 0, height: 0, getContext() { return context; } }; } } });
  dashboard.browserStampText({ text: 'abc', x: 5, y: 6, size: 1, color: 2, point: (x, y, color) => points.push([x, y, color]) });
  assert.deepEqual(points, [[5, 6, 2], [6, 6, 2], [7, 6, 2]]);
});

test('glyph rasterization does not expand neighboring pixels', () => {
  const points = [];
  const context = {
    clearRect() {}, fillText() {}, measureText() { return { width: 1 }; },
    getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, 255]) }; },
  };
  const dashboard = loadDashboard({ document: { createElement() { return { width: 0, height: 0, getContext() { return context; } }; } } });
  dashboard.browserStampText({ text: 'x', x: 5, y: 6, size: 10, color: 1, point: (x, y, color) => points.push([x, y, color]) });
  assert.deepEqual(points, [[5, 6, 1]]);
});

test('loading generator leaves button clicks and preview rendering to page controller', () => {
  const clickHandlers = [];
  let paints = 0;
  const button = { addEventListener(type, handler) { if (type === 'click') clickHandlers.push(handler); } };
  const canvas = { getContext() { return { putImageData() { paints++; } }; } };
  const status = { textContent: 'Waiting for dashboard' };
  const elements = { generateDashboard: button, dashboardCanvas: canvas, dashboardStatus: status };
  const dashboard = loadDashboard({ document: { getElementById(id) { return elements[id]; } } });
  assert.equal(typeof dashboard.createPixels, 'function');
  assert.equal(clickHandlers.length, 0);
  assert.equal(paints, 0);
  assert.equal(status.textContent, 'Waiting for dashboard');
});

test('one manual click creates stored pixels and visible preview without Bluetooth', () => {
  const elements = new Map();
  let chooserCalls = 0;
  let previewPaints = 0;
  let lastImage;
  const document = {
    body: {},
    createElement() {
      const canvas = { width: 0, height: 0 };
      const context = {
        clearRect() {}, fillText() {}, measureText(text) { return { width: text.length * 12 }; },
        getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; },
      };
      canvas.getContext = () => context;
      return canvas;
    },
    getElementById(id) {
      if (!elements.has(id)) {
        const listeners = new Map();
        const node = {
          width: 400, height: 300, value: '', files: [], disabled: false, style: {},
          addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(callback);
          },
          click() { for (const callback of listeners.get('click') || []) callback(); },
          listenerCount(type) { return (listeners.get(type) || []).length; },
          getContext() { return id === 'dashboardCanvas'
            ? { putImageData(image) { previewPaints++; lastImage = image; } }
            : { fillRect() {} }; },
        };
        elements.set(id, node);
      }
      return elements.get(id);
    },
  };
  const sandbox = {
    document,
    navigator: { bluetooth: { requestDevice() { chooserCalls++; throw new Error('Unexpected Bluetooth'); } } },
    EpdViewTabs: { create() {} },
    PaintManager: class {},
    CropManager: class { initCropTools() {} },
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(script, 'utf8'), sandbox);
  vm.runInContext(readFileSync(mainScript, 'utf8'), sandbox);
  document.body.onload();
  const button = document.getElementById('generateDashboard');
  assert.equal(button.listenerCount('click'), 1);
  assert.equal(previewPaints, 0);
  button.click();
  const pixels = vm.runInContext('customPixels', sandbox);
  assert.equal(sandbox.EpdStaticDashboard.validatePixels(pixels), true);
  assert.equal(lastImage.width, 400);
  assert.equal(lastImage.height, 300);
  assert.deepEqual(Array.from(lastImage.data.slice(0, 4)), [255, 255, 255, 255]);
  assert.equal(previewPaints, 1);
  assert.match(document.getElementById('dashboardStatus').textContent, /看板已生成/);
  assert.equal(chooserCalls, 0);
  button.click();
  assert.equal(previewPaints, 2);
  assert.notEqual(vm.runInContext('customPixels', sandbox), pixels);
});
