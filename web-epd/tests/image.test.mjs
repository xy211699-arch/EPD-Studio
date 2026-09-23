import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateSource = readFileSync(join(root, 'js/upload-state.js'), 'utf8');
const mainSource = readFileSync(join(root, 'js/main.js'), 'utf8');
const cropSource = readFileSync(join(root, 'js/crop.js'), 'utf8');

function harness() {
  const nodes = new Map();
  const images = [];
  const drawn = [];
  const cropCallbacks = [];
  let resets = 0;
  let dithers = 0;
  class FakeImage {
    constructor() { this.width = 400; this.height = 300; images.push(this); }
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', files: [], disabled: false, parentElement: { style: {} } });
    return nodes.get(id);
  }
  const context = {
    document: { body: {}, getElementById: node, querySelector: () => null },
    URL: { createObjectURL: (file) => file.name, revokeObjectURL: () => {} },
    Image: FakeImage,
    console,
    Uint8Array,
  };
  vm.createContext(context);
  vm.runInContext(stateSource, context);
  vm.runInContext(mainSource, context);
  context.canvasMock = { width: 400, height: 300 };
  context.ctxMock = { drawImage: (image) => drawn.push(image.src), fillRect: () => {} };
  context.cropMock = {
    isCropMode: () => false,
    exitCropMode: () => {},
    initializeCrop: () => {},
    resetStates: () => { resets++; },
    finishCrop: (callback) => { cropCallbacks.push(callback); },
  };
  context.ditherMock = () => { dithers++; };
  vm.runInContext('canvas = canvasMock; ctx = ctxMock; cropManager = cropMock; convertDithering = ditherMock', context);
  return { context, node, images, drawn, cropCallbacks, resets: () => resets, dithers: () => dithers };
}

test('late image decode cannot replace newer selected image', () => {
  const app = harness();
  app.node('imageFile').files = [{ name: 'A.png' }];
  app.context.updateImage();
  app.node('imageFile').files = [{ name: 'B.png' }];
  app.context.updateImage();
  app.images[1].onload();
  app.images[0].onload();
  assert.deepEqual(app.drawn, ['B.png']);
});

test('late crop completion cannot mark a newly selected image ready', () => {
  const app = harness();
  app.node('imageFile').files = [{ name: 'A.png' }];
  app.context.applyDither();
  app.node('imageFile').files = [{ name: 'B.png' }];
  app.context.updateImage();
  app.cropCallbacks[0]();
  assert.equal(app.dithers(), 0);
  assert.equal(vm.runInContext('uploadState.hasImage', app.context), false);
});

test('new matching-ratio image resets prior crop transform', () => {
  const app = harness();
  app.node('imageFile').files = [{ name: 'B.png' }];
  app.context.updateImage();
  app.images[0].onload();
  assert.equal(app.resets(), 1);
});

test('stale crop image load cannot draw over a newer preview', () => {
  const images = [];
  let draws = 0;
  let callbacks = 0;
  class FakeImage { constructor() { images.push(this); } }
  const context = {
    document: { getElementById: () => ({ files: [{ name: 'A.png' }] }) },
    URL: { createObjectURL: (file) => file.name, revokeObjectURL: () => {} },
    Image: FakeImage,
    canvasMock: {},
    ctxMock: { drawImage: () => { draws++; } },
  };
  vm.createContext(context);
  vm.runInContext(cropSource, context);
  vm.runInContext('manager = new CropManager(canvasMock, ctxMock)', context);
  context.manager.finishCrop(() => { callbacks++; }, () => false);
  images[0].onload();
  assert.equal(draws, 0);
  assert.equal(callbacks, 0);
});
