import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const repository = join(root, '..');
const files = ['index.html', 'css/main.css', 'js/dithering.js', 'js/rle.js', 'js/paint.js', 'js/crop.js', 'js/main.js'];

test('published application has a dedicated app directory with descriptive script names', () => {
  const app = join(repository, 'app');
  for (const path of ['index.html', 'launch.py', 'js/dashboard.js', 'js/quota.js', 'js/tabs.js', 'js/upload.js']) {
    assert.ok(existsSync(join(app, path)), path);
  }
  const oldDirectory = join(repository, 'web-epd');
  if (existsSync(oldDirectory)) assert.deepEqual(readdirSync(oldDirectory), []);
});

test('README uses the supplied root logo while the page keeps the original EPD favicon', () => {
  const logo = readFileSync(join(repository, 'logo.png'));
  assert.equal(createHash('sha256').update(logo).digest('hex').toUpperCase(), 'AC00D18BDAD3B4A7594E98DA2C112B7390AF0DA20182F56CA83A266A0709B8C8');
  const readme = readFileSync(join(repository, 'README.md'), 'utf8');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.ok(readme.includes('src="logo.png"'));
  assert.ok(html.includes('href="favicon.svg"'));
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'favicon.svg'))).digest('hex').toUpperCase(), '4F88EB3201A3BBC3911D7B863542F98CBEDFDAA79FCD6144D8C78BB9FA94A9EE');
});

test('published tree omits optional snapshots, sample image and CI workflow', () => {
  for (const path of ['reference', 'assets', '.github']) {
    assert.equal(existsSync(join(repository, path)), false, path);
  }
  const readme = readFileSync(join(repository, 'README.md'), 'utf8');
  const usage = readFileSync(join(repository, 'USAGE.md'), 'utf8');
  assert.ok(!readme.includes('actions/workflows'));
  assert.ok(!readme.includes('reference/'));
  assert.ok(!usage.includes('assets/'));
  assert.ok(!usage.includes('reference/'));
});

test('published tree excludes internal planning documents', () => {
  assert.equal(existsSync(join(repository, 'docs', 'superpowers')), false);
});

test('local application contains all browser assets', () => {
  for (const file of files) assert.ok(statSync(join(root, file)).size > 0, file);
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
