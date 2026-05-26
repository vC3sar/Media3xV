function createCacheService({ fs, path, thumbCacheDir, liveTempDir }) {
  async function safeClearDir(targetDir) {
    const resolved = path.resolve(targetDir);
    const allowed = new Set([
      path.resolve(thumbCacheDir),
      path.resolve(liveTempDir),
    ]);
    if (!allowed.has(resolved)) {
      throw new Error(`Directorio no permitido para limpieza: ${resolved}`);
    }
    await fs.mkdir(resolved, { recursive: true });
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.resolve(resolved, entry.name);
      if (!full.startsWith(resolved)) continue;
      await fs.rm(full, { recursive: true, force: true });
    }
  }

  async function dirSizeBytes(targetDir) {
    let total = 0;
    async function walkSize(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
          await walkSize(full);
          continue;
        }
        if (entry.isFile()) {
          const st = await fs.stat(full);
          total += Number(st.size || 0);
        }
      }
    }
    await fs.mkdir(targetDir, { recursive: true });
    await walkSize(path.resolve(targetDir));
    return total;
  }

  return { safeClearDir, dirSizeBytes };
}

export { createCacheService };
