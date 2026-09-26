import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const modulePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'view-tabs.js');

function makeElement() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    hidden: false,
    tabIndex: 0,
    focusCount: 0,
    addEventListener(type, listener) { listeners.set(type, listener); },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    focus() { this.focusCount++; },
    fire(type, event = {}) { listeners.get(type)?.(event); },
  };
}

function makeTabsHarness() {
  const tabs = { file: makeElement(), custom: makeElement() };
  const panels = { file: makeElement(), custom: makeElement() };
  const selections = [];
  let busy = false;
  let bluetoothCalls = 0;
  const sandbox = { bluetooth: { requestDevice() { bluetoothCalls++; } } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(modulePath, 'utf8'), sandbox);
  const controller = sandbox.EpdViewTabs.create({
    tabs, panels, isBusy: () => busy, onSelect: id => selections.push(id),
  });
  return { tabs, panels, controller, selections, setBusy: value => { busy = value; }, bluetoothCalls: () => bluetoothCalls };
}

test('file starts visible and switching to custom preserves both panels', () => {
  const app = makeTabsHarness();
  const filePanel = app.panels.file;
  assert.equal(app.controller.active, 'file');
  assert.equal(filePanel.hidden, false);
  assert.equal(app.panels.custom.hidden, true);
  assert.equal(app.tabs.file.getAttribute('aria-selected'), 'true');
  assert.equal(app.tabs.custom.tabIndex, -1);
  assert.deepEqual(app.selections, []);
  assert.equal(app.controller.select('custom'), true);
  assert.equal(app.panels.file, filePanel);
  assert.equal(filePanel.hidden, true);
  assert.equal(app.panels.custom.hidden, false);
  assert.equal(app.tabs.custom.getAttribute('aria-selected'), 'true');
  assert.equal(app.tabs.file.tabIndex, -1);
  assert.deepEqual(app.selections, ['custom']);
  assert.equal(app.bluetoothCalls(), 0);
});

test('unknown tab, same tab, and busy transfer cause no transition', () => {
  const app = makeTabsHarness();
  assert.equal(app.controller.select('missing'), false);
  assert.equal(app.controller.select('file'), false);
  app.setBusy(true);
  assert.equal(app.controller.select('custom'), false);
  assert.equal(app.controller.active, 'file');
  assert.deepEqual(app.selections, []);
});

test('click and Arrow keys, Home, and End switch tabs with keyboard focus', () => {
  const app = makeTabsHarness();
  app.tabs.custom.fire('click');
  assert.equal(app.controller.active, 'custom');
  let prevented = 0;
  const key = (tab, value) => tab.fire('keydown', { key: value, preventDefault() { prevented++; } });
  key(app.tabs.custom, 'ArrowRight');
  assert.equal(app.controller.active, 'file');
  assert.equal(app.tabs.file.focusCount, 1);
  key(app.tabs.file, 'ArrowLeft');
  assert.equal(app.controller.active, 'custom');
  key(app.tabs.custom, 'Home');
  assert.equal(app.controller.active, 'file');
  key(app.tabs.file, 'End');
  assert.equal(app.controller.active, 'custom');
  assert.equal(prevented, 4);
  assert.equal(app.tabs.custom.focusCount, 2);
  app.setBusy(true);
  key(app.tabs.custom, 'Home');
  assert.equal(app.controller.active, 'custom');
  assert.equal(app.tabs.file.focusCount, 2);
  assert.equal(app.bluetoothCalls(), 0);
});
