(function (root) {
  const allowed = new Set(['idle', 'connecting', 'connected', 'sending', 'error']);

  function createUploadState() {
    let status = 'idle';
    let device = null;
    let imageReady = false;

    return {
      get status() { return status; },
      get hasDevice() { return device !== null; },
      get hasImage() { return imageReady; },
      get busy() { return status === 'connecting' || status === 'sending'; },
      setStatus(next) {
        if (!allowed.has(next)) throw new TypeError(`未知状态: ${next}`);
        status = next;
      },
      setDevice(value) { device = value || null; },
      setImage(isReady) { imageReady = Boolean(isReady); },
      canReconnect() {
        return device !== null && status !== 'connected' && status !== 'connecting' && status !== 'sending';
      },
      canUpload() {
        return status === 'connected' && imageReady;
      },
    };
  }

  root.EpdUploadState = { createUploadState };
})(globalThis);
