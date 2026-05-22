#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';

const mediaRoot = path.resolve(process.argv[2] || './takeout-20260520T011015Z-3-001');
const urlBase = process.argv[3] || '/takeout-20260520T011015Z-3-001/';
const outPath = path.resolve(process.argv[4] || './media-index.json');
const debounceMs = 800;

let timer = null;
let busy = false;
let queued = false;

function runBuild() {
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  const child = spawn(process.execPath, [path.resolve('./scripts/build-media-index.mjs'), mediaRoot, urlBase, outPath], {
    stdio: 'inherit'
  });
  child.on('exit', () => {
    busy = false;
    if (queued) {
      queued = false;
      runBuild();
    }
  });
}

function scheduleBuild() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(runBuild, debounceMs);
}

runBuild();
watch(mediaRoot, { recursive: true }, () => scheduleBuild());
console.log(`Watching: ${mediaRoot}`);
