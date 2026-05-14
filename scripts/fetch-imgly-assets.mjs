/**
 * Downloads IMG.LY background-removal-data for the installed @imgly/background-removal
 * version and copies package/dist into public/background-removal (same-origin assets).
 * @see https://github.com/imgly/background-removal-js#custom-asset-serving
 *
 * Set SKIP_IMGLY_FETCH=1 to skip (browser will load default CDN assets instead).
 */
import { createWriteStream, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

if (process.env.SKIP_IMGLY_FETCH === '1') {
  console.log('[fetch-imgly-assets] SKIP_IMGLY_FETCH=1 — skipping download.');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgJson = join(root, 'node_modules/@imgly/background-removal/package.json');
const outDir = join(root, 'public/background-removal');
const marker = join(outDir, '.imgly-data-version');

if (!existsSync(pkgJson)) {
  console.warn('[fetch-imgly-assets] @imgly/background-removal not installed; skip.');
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(pkgJson, 'utf8'));

function hasWasmAssets() {
  try {
    return readdirSync(outDir).some((f) => f.endsWith('.wasm') || f.endsWith('.onnx'));
  } catch {
    return false;
  }
}

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === version && hasWasmAssets()) {
  console.log(`[fetch-imgly-assets] Cached assets for ${version} OK.`);
  process.exit(0);
}

const url = `https://staticimgly.com/@imgly/background-removal-data/${version}/package.tgz`;
const tgzPath = join(root, 'tmp-imgly-background-removal.tgz');
const extractRoot = join(root, 'tmp-imgly-extract');

console.log(`[fetch-imgly-assets] Downloading ${url} (large archive, first run may take several minutes)...`);

const res = await fetch(url);
if (!res.ok || !res.body) {
  throw new Error(`[fetch-imgly-assets] HTTP ${res.status} for ${url}`);
}

await mkdir(dirname(tgzPath), { recursive: true });
await pipeline(res.body, createWriteStream(tgzPath));

rmSync(extractRoot, { recursive: true, force: true });
await mkdir(extractRoot, { recursive: true });
execFileSync('tar', ['-xzf', tgzPath, '-C', extractRoot], { stdio: 'inherit' });

const distA = join(extractRoot, 'package', 'dist');
const distB = join(extractRoot, 'dist');
const distPath = existsSync(distA) ? distA : distB;
if (!existsSync(distPath)) {
  throw new Error('[fetch-imgly-assets] Could not find package/dist in archive.');
}

await mkdir(outDir, { recursive: true });
execFileSync('cp', ['-R', `${distPath}/.`, `${outDir}/`], { stdio: 'inherit' });

rmSync(extractRoot, { recursive: true, force: true });
rmSync(tgzPath, { force: true });
writeFileSync(marker, `${version}\n`, 'utf8');
console.log('[fetch-imgly-assets] Done. Assets in public/background-removal/');
