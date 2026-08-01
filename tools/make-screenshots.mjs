#!/usr/bin/env node
/**
 * Renders Chrome Web Store screenshots from the extension's real UI.
 *
 * popup.html and options.html are copied into a scratch directory with a
 * chrome.* stub injected, so the pages run outside the extension and show
 * representative data. Each frame is then rendered headless at exactly
 * 1280x800 and flattened to a 24-bit PNG, which is what the store accepts.
 *
 * Usage: npm run screenshots
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(REPO_ROOT, 'tools', 'screenshots');
const BUILD_DIR = join(REPO_ROOT, 'dist', 'store-build');
const OUT_DIR = join(REPO_ROOT, 'dist', 'store');

const WIDTH = 1280;
const HEIGHT = 800;

/** Chromium-family browsers that can render the frames headless. */
const BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

/**
 * Finds an installed Chromium-family browser.
 * @returns {Promise<string>}
 */
async function resolveBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // Not this one.
    }
  }
  throw new Error(`No Chromium-based browser found. Looked in:\n  ${BROWSER_CANDIDATES.join('\n  ')}`);
}

/**
 * Copies an extension page into the build dir with the chrome stub injected
 * ahead of its own script, so the page's JS finds the API it expects.
 * @param {string} fileName
 * @returns {Promise<void>}
 */
async function stageExtensionPage(fileName) {
  const html = await readFile(join(REPO_ROOT, fileName), 'utf8');
  const injected = html.replace(
    /<script(\s[^>]*)?\ssrc="/,
    '<script src="stub.js"></script>\n    <script$1 src="',
  );

  if (injected === html) {
    throw new Error(`Could not inject the stub into ${fileName}`);
  }

  await writeFile(join(BUILD_DIR, fileName), injected);
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Serves the build directory over HTTP.
 *
 * The pages must not be loaded from `file://`: popup.js is an ES module, and
 * Chromium treats every file URL as an opaque origin, so the module request
 * fails CORS and the page's script never runs.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
async function startServer() {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
    try {
      const body = await readFile(join(BUILD_DIR, path));
      response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  const browser = await resolveBrowser();

  await rm(BUILD_DIR, { recursive: true, force: true });
  await mkdir(BUILD_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  for (const asset of ['popup.js', 'options.js', 'icons']) {
    await cp(join(REPO_ROOT, asset), join(BUILD_DIR, asset), { recursive: true });
  }
  await cp(SRC_DIR, BUILD_DIR, { recursive: true });
  await stageExtensionPage('popup.html');
  await stageExtensionPage('options.html');

  const frames = (await readdir(SRC_DIR))
    .filter((name) => /^shot-\d+\.html$/.test(name))
    .sort();

  const server = await startServer();

  for (const frame of frames) {
    const index = frame.match(/\d+/)[0];
    const output = join(OUT_DIR, `screenshot-${index}.png`);

    await run(browser, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
      '--virtual-time-budget=12000',
      '--run-all-compositor-stages-before-draw',
      `--screenshot=${output}`,
      `http://127.0.0.1:${server.port}/${frame}`,
    ], { timeout: 90000 });

    // The store rejects PNGs with an alpha channel. Headless Chromium usually
    // writes none already, so only flatten when one is actually present —
    // sips errors out if asked to remove an alpha channel that isn't there.
    const probe = await run('sips', ['-g', 'hasAlpha', output]);
    if (/hasAlpha:\s*yes/.test(probe.stdout)) {
      await run('sips', ['-s', 'format', 'png', '--setProperty', 'hasAlpha', 'false', output, '--out', output]);
    }

    const size = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', output]);
    const width = /pixelWidth:\s*(\d+)/.exec(size.stdout)?.[1];
    const height = /pixelHeight:\s*(\d+)/.exec(size.stdout)?.[1];
    if (Number(width) !== WIDTH || Number(height) !== HEIGHT) {
      throw new Error(`${frame} rendered at ${width}x${height}, expected ${WIDTH}x${HEIGHT}`);
    }

    console.log(`  ${frame}  ->  dist/store/screenshot-${index}.png  (${width}x${height}, no alpha)`);
  }

  await server.close();
  console.log(`\n${frames.length} screenshots at ${WIDTH}x${HEIGHT} in dist/store/`);
}

await main();
