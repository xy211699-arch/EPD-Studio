import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js', 'quota.js');

function loadQuota(extra = {}) {
  const sandbox = { ...extra };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(script, 'utf8'), sandbox);
  return sandbox.EpdQuota;
}

const payload = {
  status: 'ok', source: 'codex-auth', updated_at: '2026-09-25T13:00:00Z', plan_type: 'plus',
  five_hour: { used_percent: 28, remaining_percent: 72, window_minutes: 300, reset_at: 1790262000 },
  seven_day: { used_percent: 23, remaining_percent: 77, window_minutes: 10080, reset_at: 1790866800 },
};

test('normalizes a successful quota response and preserves both windows', () => {
  const quota = loadQuota();
  const normalized = quota.normalizeQuota(payload);
  assert.equal(normalized.status, 'ok');
  assert.equal(normalized.five_hour.remaining_percent, 72);
  assert.equal(normalized.seven_day.remaining_percent, 77);
});

test('normalizes unavailable quota without inventing percentages', () => {
  const quota = loadQuota();
  const normalized = quota.normalizeQuota({ status: 'unavailable', error: 'network' });
  assert.equal(normalized.status, 'unavailable');
  assert.equal(normalized.five_hour, null);
  assert.equal(normalized.seven_day, null);
});

test('fetches only the local quota endpoint with no credentials in the browser', async () => {
  const calls = [];
  const quota = loadQuota();
  const response = await quota.fetchQuota(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, async json() { return payload; } };
  });
  assert.equal(response.status, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/__quota');
  assert.equal(calls[0].options.cache, 'no-store');
});
