import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const files = ['index.html', 'css/main.css', 'js/dithering.js', 'js/rle.js', 'js/paint.js', 'js/crop.js', 'js/main.js', 'favicon.png'];

test('published application has a dedicated app directory with descriptive script names', () => {
  const repository = join(root, '..');
  const app = join(repository, 'app');
  for (const path of ['index.html', 'launch.py', 'js/dashboard.js', 'js/quota.js', 'js/tabs.js', 'js/upload.js']) {
    assert.ok(existsSync(join(app, path)), path);
  }
  const oldDirectory = join(repository, 'web-epd');
  if (existsSync(oldDirectory)) assert.deepEqual(readdirSync(oldDirectory), []);
});

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

test('page and repository README use the current EPD icon', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const readme = readFileSync(join(root, '..', 'README.md'), 'utf8');
  assert.ok(statSync(join(root, 'epd-icon.svg')).size > 0);
  assert.ok(html.includes('href="epd-icon.svg"'));
  assert.ok(readme.includes('src="web-epd/epd-icon.svg"'));
});
