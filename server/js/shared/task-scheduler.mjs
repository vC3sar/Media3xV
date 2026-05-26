function createTaskScheduler(options = {}) {
  const limits = {
    ffprobe: Math.max(1, Number(options.ffprobe || 2)),
    thumb: Math.max(1, Number(options.thumb || 2)),
    transcode: Math.max(1, Number(options.transcode || 1)),
  };

  const queues = new Map();
  const active = new Map();
  const dedupe = new Map();

  for (const k of Object.keys(limits)) {
    queues.set(k, []);
    active.set(k, 0);
  }

  const metrics = {
    enqueued: 0,
    started: 0,
    completed: 0,
    failed: 0,
  };

  function snapshot() {
    const groups = {};
    for (const [k] of Object.entries(limits)) {
      groups[k] = {
        limit: limits[k],
        active: active.get(k) || 0,
        queued: (queues.get(k) || []).length,
      };
    }
    return {
      ...metrics,
      groups,
      dedupeSize: dedupe.size,
    };
  }

  function drain(group) {
    const q = queues.get(group);
    if (!q || !q.length) return;
    const limit = limits[group] || 1;
    while ((active.get(group) || 0) < limit && q.length > 0) {
      const job = q.shift();
      active.set(group, (active.get(group) || 0) + 1);
      metrics.started += 1;
      Promise.resolve()
        .then(job.run)
        .then((result) => {
          metrics.completed += 1;
          if (job.dedupeKey) dedupe.delete(job.dedupeKey);
          job.resolve(result);
        })
        .catch((err) => {
          metrics.failed += 1;
          if (job.dedupeKey) dedupe.delete(job.dedupeKey);
          job.reject(err);
        })
        .finally(() => {
          active.set(group, Math.max(0, (active.get(group) || 1) - 1));
          drain(group);
        });
    }
  }

  function enqueue(group, run, dedupeKey = "") {
    if (!queues.has(group)) {
      throw new Error(`Unknown scheduler group: ${group}`);
    }
    if (dedupeKey && dedupe.has(dedupeKey)) return dedupe.get(dedupeKey);
    metrics.enqueued += 1;
    const p = new Promise((resolve, reject) => {
      queues.get(group).push({ run, resolve, reject, dedupeKey });
      drain(group);
    });
    if (dedupeKey) dedupe.set(dedupeKey, p);
    return p;
  }

  return {
    enqueue,
    snapshot,
  };
}

export { createTaskScheduler };
