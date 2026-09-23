import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const statePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'upload-state.js');

function freshState() {
  assert.ok(existsSync(statePath), 'upload-state module must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(statePath, 'utf8'), context);
  return context.EpdUploadState.createUploadState();
}

test('fresh page cannot reconnect or upload', () => {
  const state = freshState();
  assert.equal(state.status, 'idle');
  assert.equal(state.canReconnect(), false);
  assert.equal(state.canUpload(), false);
});

test('selected device can be reconnected only while disconnected', () => {
  const state = freshState();
  state.setDevice({ name: 'NRF-EPD-9691' });
  assert.equal(state.canReconnect(), true);
  state.setStatus('connecting');
  assert.equal(state.canReconnect(), false);
  state.setStatus('connected');
  assert.equal(state.canReconnect(), false);
  state.setStatus('error');
  assert.equal(state.canReconnect(), true);
});

test('upload needs connection and a decoded image and cannot overlap', () => {
  const state = freshState();
  state.setDevice({ name: 'NRF-EPD-9691' });
  state.setStatus('connected');
  assert.equal(state.canUpload(), false);
  state.setImage(true);
  assert.equal(state.canUpload(), true);
  state.setStatus('sending');
  assert.equal(state.busy, true);
  assert.equal(state.canUpload(), false);
  assert.equal(state.canReconnect(), false);
  state.setStatus('error');
  assert.equal(state.hasImage, true);
  assert.equal(state.canUpload(), false);
});
