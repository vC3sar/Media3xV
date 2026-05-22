(function () {
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function bustCache(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_r=${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async function loadImageWithRetry(src, options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : 2;
    const retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 180;
    let attempt = 0;
    let lastError = null;

    while (attempt <= retries) {
      try {
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = 'async';
          img.loading = 'eager';
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Error loading image: ${src}`));
          img.src = attempt === 0 ? src : bustCache(src);
        });
        return image;
      } catch (err) {
        lastError = err;
        if (attempt >= retries) break;
        await delay(retryDelayMs * (attempt + 1));
      }
      attempt += 1;
    }

    throw lastError || new Error(`Error loading image: ${src}`);
  }

  class VideoQueueLoader {
    constructor(options = {}) {
      this.maxConcurrent = Number.isInteger(options.maxConcurrent) ? options.maxConcurrent : 2;
      this.retryCount = Number.isInteger(options.retryCount) ? options.retryCount : 2;
      this.retryBaseDelayMs = Number.isInteger(options.retryBaseDelayMs) ? options.retryBaseDelayMs : 220;
      this.queue = [];
      this.activeCount = 0;
      this.entryByKey = new Map();
    }

    getState(key) {
      return this.entryByKey.get(key)?.state || 'idle';
    }

    enqueue(task) {
      const key = task.key;
      if (!key) throw new Error('Video task key is required');
      if (this.entryByKey.has(key)) return this.entryByKey.get(key).promise;

      const entry = {
        key,
        state: 'queued',
        cancelled: false,
        attempt: 0,
        priority: task.priority || 'normal',
        run: task.run,
        onStateChange: task.onStateChange,
        resolve: null,
        reject: null,
        promise: null
      };
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      this.entryByKey.set(key, entry);
      this.queue.push(entry);
      this._sortQueue();
      entry.onStateChange?.('queued');
      this._drain();
      return entry.promise;
    }

    cancel(key) {
      const entry = this.entryByKey.get(key);
      if (!entry) return;
      entry.cancelled = true;
      if (entry.state === 'queued') {
        this.queue = this.queue.filter(e => e.key !== key);
        this.entryByKey.delete(key);
      }
    }

    cancelByPrefix(prefix) {
      [...this.entryByKey.keys()].forEach(key => {
        if (key.startsWith(prefix)) this.cancel(key);
      });
    }

    _sortQueue() {
      const rank = p => (p === 'high' ? 0 : 1);
      this.queue.sort((a, b) => rank(a.priority) - rank(b.priority));
    }

    async _runEntry(entry) {
      if (entry.cancelled) {
        this.entryByKey.delete(entry.key);
        entry.reject(new Error('cancelled'));
        return;
      }
      entry.state = 'loading';
      entry.onStateChange?.('loading');
      try {
        while (entry.attempt <= this.retryCount) {
          try {
            const result = await entry.run(entry.attempt);
            entry.state = 'loaded';
            entry.onStateChange?.('loaded');
            this.entryByKey.delete(entry.key);
            entry.resolve(result);
            return;
          } catch (err) {
            if (entry.cancelled) throw new Error('cancelled');
            if (entry.attempt >= this.retryCount) throw err;
            entry.attempt += 1;
            await delay(this.retryBaseDelayMs * entry.attempt);
          }
        }
      } catch (err) {
        if (String(err?.message || '').includes('cancelled')) {
          this.entryByKey.delete(entry.key);
          entry.reject(err);
          return;
        }
        entry.state = 'failed';
        entry.onStateChange?.('failed');
        this.entryByKey.delete(entry.key);
        entry.reject(err);
      }
    }

    _drain() {
      while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
        const entry = this.queue.shift();
        if (!entry || entry.cancelled) continue;
        this.activeCount += 1;
        this._runEntry(entry).finally(() => {
          this.activeCount -= 1;
          this._drain();
        });
      }
    }
  }

  function loadVideoMetadata(videoEl, src, attempt = 0) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        videoEl.onloadedmetadata = null;
        videoEl.onerror = null;
      };
      videoEl.onloadedmetadata = () => {
        cleanup();
        resolve(videoEl);
      };
      videoEl.onerror = () => {
        cleanup();
        reject(new Error(`Error loading video metadata: ${src}`));
      };
      videoEl.preload = 'metadata';
      videoEl.src = attempt === 0 ? src : bustCache(src);
      videoEl.load();
    });
  }

  function loadVideoPreview(videoEl, src, attempt = 0) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let seekStarted = false;
      const timeoutMs = 2800;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        videoEl.onloadedmetadata = null;
        videoEl.onloadeddata = null;
        videoEl.onseeked = null;
        videoEl.ontimeupdate = null;
        videoEl.onerror = null;
      };

      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(videoEl);
      };

      const fail = reason => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Error loading video preview (${reason}): ${src}`));
      };

      const startSeek = () => {
        if (seekStarted) return;
        seekStarted = true;
        const dur = Number(videoEl.duration);
        const target = Number.isFinite(dur) && dur > 0
          ? Math.min(0.1, dur / 2)
          : 0.1;
        try {
          videoEl.currentTime = target;
        } catch (_) {
          // Some streams reject random seeks very early; let loadeddata handle it.
        }
      };

      videoEl.onloadedmetadata = () => {
        startSeek();
      };
      videoEl.onseeked = () => {
        done();
      };
      videoEl.ontimeupdate = () => {
        done();
      };
      videoEl.onloadeddata = () => {
        if (!seekStarted) {
          startSeek();
          // Keep waiting for seeked/timeupdate briefly.
          setTimeout(() => done(), 120);
          return;
        }
        done();
      };
      videoEl.onerror = () => fail('decode error');

      timer = setTimeout(() => {
        if (!seekStarted) fail('metadata timeout');
        else fail('seek timeout');
      }, timeoutMs);

      videoEl.preload = 'metadata';
      videoEl.src = attempt === 0 ? src : bustCache(src);
      videoEl.load();
    });
  }

  function promoteVideoFull(videoEl, src) {
    videoEl.preload = 'auto';
    if (!videoEl.src || videoEl.src !== src) {
      videoEl.src = src;
    }
    videoEl.load();
  }

  function releaseVideo(videoEl) {
    if (!videoEl) return;
    try { videoEl.pause(); } catch (_) {}
    videoEl.removeAttribute('src');
    try { videoEl.load(); } catch (_) {}
  }

  window.MediaLoader = {
    loadImageWithRetry,
    VideoQueueLoader,
    loadVideoMetadata,
    loadVideoPreview,
    promoteVideoFull,
    releaseVideo
  };
})();
