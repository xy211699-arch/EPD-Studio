import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', 'css/main.css', 'js/dithering.js', 'js/rle.js', 'js/paint.js', 'js/crop.js', 'js/main.js', 'favicon.png'];

test('local snapshot contains all browser assets with provenance', () => {
  for (const file of files) assert.ok(statSync(join(root, file)).size > 0, file);
  const source = readFileSync(join(root, 'SOURCE.md'), 'utf8');
  for (const file of files) assert.ok(source.includes(file), `${file} provenance`);
});

test('page loads local scripts in original dependency order and no remote analytics', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const names = ['dithering.js', 'rle.js', 'paint.js', 'crop.js', 'main.js'];
  let previous = -1;
  for (const name of names) {
    const index = html.indexOf(name);
    assert.ok(index > previous, `${name} order`);
    previous = index;
  }
  assert.ok(!html.includes('hm.baidu.com'));
});
