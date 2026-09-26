(function () {
  'use strict';

  const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

  function emptyQuota(status = 'unavailable', error = '等待读取额度') {
    return { status, source: 'codex-app-server', updated_at: null, plan_type: null, five_hour: null, seven_day: null, error: error || null };
  }

  function normalizeWindow(window) {
    if (!window || typeof window !== 'object') return null;
    const remaining = Number(window.remaining_percent);
    const used = Number(window.used_percent);
    const percent = Number.isFinite(remaining) ? remaining : Number.isFinite(used) ? 100 - used : NaN;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    return {
      used_percent: Number.isFinite(used) ? Math.round(Math.max(0, Math.min(100, used))) : 100 - Math.round(percent),
      remaining_percent: Math.round(percent),
      window_minutes: Number.isFinite(Number(window.window_minutes)) ? Number(window.window_minutes) : null,
      reset_at: Number.isFinite(Number(window.reset_at)) ? Number(window.reset_at) : null,
    };
  }

  function normalizeQuota(payload) {
    if (!payload || typeof payload !== 'object') return emptyQuota('unavailable', '额度响应无效');
    if (payload.status !== 'ok') return emptyQuota(payload.status || 'unavailable', payload.error || '额度暂不可用');
    const fiveHour = normalizeWindow(payload.five_hour);
    const sevenDay = normalizeWindow(payload.seven_day);
    if (!fiveHour || !sevenDay) return emptyQuota('unavailable', '额度窗口数据不完整');
    return {
      status: 'ok', source: payload.source || 'codex-app-server', updated_at: payload.updated_at || null,
      plan_type: typeof payload.plan_type === 'string' ? payload.plan_type : null,
      five_hour: fiveHour, seven_day: sevenDay, error: null,
    };
  }

  async function fetchQuota(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') return emptyQuota('unavailable', '浏览器不支持额度请求');
    try {
      const response = await fetchImpl('/__quota', { cache: 'no-store' });
      if (!response || !response.ok) return emptyQuota('unavailable', '额度服务暂不可用');
      return normalizeQuota(await response.json());
    } catch (_error) {
      return emptyQuota('unavailable', '额度服务暂不可用');
    }
  }

  function createController({ fetchImpl = globalThis.fetch, onChange = () => {}, intervalMs = REFRESH_INTERVAL_MS } = {}) {
    let timer = null;
    let state = emptyQuota();
    async function refresh() {
      state = await fetchQuota(fetchImpl);
      onChange(state);
      return state;
    }
    return {
      getState: () => state,
      refresh,
      start() {
        void refresh();
        if (typeof globalThis.setInterval === 'function' && timer === null) timer = globalThis.setInterval(() => void refresh(), intervalMs);
      },
      stop() {
        if (timer !== null && typeof globalThis.clearInterval === 'function') globalThis.clearInterval(timer);
        timer = null;
      },
    };
  }

  globalThis.EpdQuota = { emptyQuota, normalizeQuota, fetchQuota, createController, REFRESH_INTERVAL_MS };
})();
