#!/usr/bin/env node
/**
 * Exercises the YouTube ad blocking against a real browser.
 *
 * The unit tests cover the payload walk in isolation; the parts that actually
 * broke in the past cannot be reached that way. Whether the XHR hook runs
 * before the page's own handler, whether a skip button our cosmetic rules have
 * hidden can still be clicked, and whether the player fallback mutes and seeks
 * an ad are all browser behaviour.
 *
 * So: load the unpacked extension into headless Chromium, point
 * `www.youtube.com` at a local server with `--host-resolver-rules`, and serve
 * a fixture watch page from it. The origin really is youtube.com, which is what
 * the scriptlet's host gate keys off. HTTPS with a throwaway certificate is
 * required because youtube.com is HSTS-preloaded and will not be loaded over
 * plain HTTP.
 *
 * Usage: npm run test:e2e
 */
import { createServer } from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'e2e', 'youtube-fixture.html');

const SERVER_PORT = 8443;
const DEBUG_PORT = 9333;
const PAGE_TIMEOUT_MS = 45000;

/** Chromium-family browsers that can load an unpacked extension headless. */
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

/** Innertube payloads the fixture requests. */
const PLAYER_PAYLOAD = {
  videoDetails: { videoId: 'fixture-video' },
  streamingData: { formats: [{ itag: 18 }] },
  adPlacements: [{ adPlacementRenderer: {} }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
};
const NEXT_PAYLOAD = {
  contents: {
    sectionListRenderer: {
      contents: [
        {
          itemSectionRenderer: {
            contents: [
              { videoRenderer: { videoId: 'organic-1' } },
              { adSlotRenderer: { adLayoutMetadata: {} } },
              { promotedSparklesWebRenderer: {} },
              { videoRenderer: { videoId: 'organic-2' } },
            ],
          },
        },
      ],
    },
  },
};

/**
 * Pauses for a number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds an installed Chromium-family browser, including the one Playwright
 * ships in the container image.
 * @returns {string}
 */
function resolveBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const playwrightRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(playwrightRoot)) {
    for (const entry of readdirSync(playwrightRoot)) {
      // The headless shell cannot load extensions; only full chromium builds.
      if (!entry.startsWith('chromium-')) continue;
      const candidate = join(playwrightRoot, entry, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `No Chromium-based browser found. Set CHROME_PATH, or install one of:\n  ${BROWSER_CANDIDATES.join('\n  ')}`,
  );
}

/**
 * Generates a throwaway certificate for the fixture host and returns it with
 * the base64 SHA-256 of its public key, which is what Chrome's
 * --ignore-certificate-errors-spki-list takes.
 * @param {string} dir
 * @returns {Promise<{key: Buffer, cert: Buffer, spki: string}>}
 */
async function createCertificate(dir) {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-nodes',
    '-subj', '/CN=www.youtube.com',
    '-addext', 'subjectAltName=DNS:www.youtube.com,DNS:example.test',
  ]);

  const { stdout } = await run('sh', [
    '-c',
    `openssl x509 -in "${certPath}" -pubkey -noout `
      + '| openssl pkey -pubin -outform der '
      + '| openssl dgst -sha256 -binary | openssl enc -base64',
  ]);

  return {
    key: await readFile(keyPath),
    cert: await readFile(certPath),
    spki: stdout.trim(),
  };
}

/**
 * Minimal Chrome DevTools Protocol client over the browser endpoint. Node's
 * built-in WebSocket is enough, which keeps this dependency-free.
 */
class DevToolsClient {
  /**
   * @param {WebSocket} socket
   */
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        return; // Event, not a command result.
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(JSON.stringify(message.error)));
      } else {
        entry.resolve(message.result);
      }
    });
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<any>}
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

/**
 * Polls an HTTP endpoint until it answers with JSON.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function waitForEndpoint(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Not listening yet.
    }
    await wait(500);
  }
  throw new Error(`DevTools endpoint never came up: ${url}`);
}

/**
 * Opens a page and waits for the fixture to publish its results.
 * @param {DevToolsClient} client
 * @param {string} url
 * @returns {Promise<Record<string, any>>}
 */
async function collectResults(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  let results = null;

  while (Date.now() < deadline) {
    try {
      const evaluated = await client.send(
        'Runtime.evaluate',
        { expression: 'window.__results || null', returnByValue: true, awaitPromise: true },
        sessionId,
      );
      results = evaluated.result && evaluated.result.value;
      if (results) break;
    } catch {
      // Execution context not ready yet.
    }
    await wait(250);
  }

  const title = await client.send(
    'Runtime.evaluate',
    { expression: 'document.title', returnByValue: true },
    sessionId,
  ).then((evaluated) => evaluated.result.value).catch(() => null);

  await client.send('Target.closeTarget', { targetId });

  if (!results) {
    throw new Error(`fixture published no results for ${url} (page title: ${JSON.stringify(title)})`);
  }
  if (title !== 'ShieldBlock YouTube fixture') {
    throw new Error(`unexpected page loaded for ${url}: ${JSON.stringify(title)}`);
  }

  return results;
}

/**
 * Serves the fixture and the Innertube payloads it fetches.
 * @param {{key: Buffer, cert: Buffer}} credentials
 * @param {string} fixture
 * @returns {import('node:https').Server}
 */
function createFixtureServer(credentials, fixture) {
  return createServer(credentials, (request, response) => {
    if (request.url.startsWith('/youtubei/v1/player')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(PLAYER_PAYLOAD));
      return;
    }
    if (request.url.startsWith('/youtubei/v1/next')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(NEXT_PAYLOAD));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fixture);
  });
}

/**
 * Every assertion, as [label, actual, expected] once the pages have reported.
 * @param {Record<string, any>} youtube
 * @param {Record<string, any>} offsite
 * @returns {Array<[string, unknown, unknown]>}
 */
function buildChecks(youtube, offsite) {
  const json = (value) => JSON.stringify(value);

  return [
    // The inline bootstrap globals.
    ['ytInitialPlayerResponse ad keys removed', json(youtube.bootstrapAdKeys), '[]'],
    ['ytInitialPlayerResponse video kept', youtube.bootstrapVideoId, 'fixture-video'],
    ['ytInitialPlayerResponse streams kept', youtube.bootstrapFormats, 1],
    ['ytInitialData ad entry dropped', json(youtube.initialDataEntries), '["organic"]'],

    // The XHR ordering regression: the page's own handler, registered between
    // open() and send(), must see a body with no ad data in it.
    ['XHR handler sees no ad data', youtube.xhrRawHasAds, false],

    // Non-player Innertube endpoints.
    ['fetch body carries no ad data', youtube.fetchRawHasAds, false],
    ['fetch ads dropped, organic kept', json(youtube.fetchEntries), '["organic-1","organic-2"]'],

    // Cosmetic layer, and the skip click that it hides.
    ['feed ad hidden', youtube.feedAdDisplay, 'none'],
    ['skip button hidden by cosmetics', youtube.skipButtonDisplay, 'none'],
    ['hidden skip button still clicked', youtube.skipClicks > 0, true],

    // The player fallback.
    ['ad muted', youtube.adMuted, true],
    ['ad run up to 16x', youtube.adPlaybackRate, 16],
    ['ad seeked to its end', youtube.adCurrentTime, youtube.adDuration],
    ['unmuted once the ad ends', youtube.betweenAdsMuted, false],
    ['ad caught within 100ms of the class flip',
      youtube.reMuteLatencyMs >= 0 && youtube.reMuteLatencyMs < 100, true],

    // Off YouTube the scriptlet installs nothing at all.
    ['inert off YouTube', offsite.hooked, false],
    ['off-YouTube payload untouched', offsite.bootstrapAdKeys.length, 4],
    ['off-YouTube XHR untouched', offsite.xhrRawHasAds, true],
    ['off-YouTube video untouched', offsite.adMuted, false],
    ['off-YouTube skip button untouched', offsite.skipClicks, 0],
  ];
}

const workDir = await mkdtemp(join(tmpdir(), 'shieldblock-e2e-'));
const profileDir = await mkdtemp(join(tmpdir(), 'shieldblock-profile-'));
let browser = null;
let server = null;

try {
  const browserPath = resolveBrowser();
  const credentials = await createCertificate(workDir);
  const fixture = await readFile(FIXTURE_PATH, 'utf8');

  server = createFixtureServer(credentials, fixture);
  await new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', resolve));

  browser = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--disable-extensions-except=${REPO_ROOT}`,
    `--load-extension=${REPO_ROOT}`,
    `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${SERVER_PORT},MAP example.test 127.0.0.1:${SERVER_PORT}`,
    // youtube.com is HSTS-preloaded, so a cert error cannot be clicked past.
    // Pinning the fixture certificate's public key is the supported way in.
    `--ignore-certificate-errors-spki-list=${credentials.spki}`,
    // A sandbox may export HTTPS_PROXY, and Chrome would then send the mapped
    // hostname to that proxy instead of resolving it locally.
    '--no-proxy-server',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const version = await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const client = new DevToolsClient(socket);

  // Let the MV3 service worker register its rulesets before the first page.
  await wait(4000);

  const youtube = await collectResults(client, 'https://www.youtube.com/watch?v=fixture');
  const offsite = await collectResults(client, 'https://example.test/watch?v=fixture');

  const checks = buildChecks(youtube, offsite);
  let failures = 0;

  for (const [label, actual, expected] of checks) {
    const ok = Object.is(actual, expected);
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }

  console.log(`\n${checks.length - failures}/${checks.length} checks passed`);

  if (failures > 0) {
    console.error('\nfixture results:', JSON.stringify({ youtube, offsite }, null, 2));
    process.exitCode = 1;
  }
} finally {
  if (browser) browser.kill('SIGKILL');
  if (server) server.close();

  // The browser is still flushing its profile when it is killed, so removing
  // the directory can race it. Cleanup is housekeeping — never the verdict.
  await wait(250);
  for (const dir of [workDir, profileDir]) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.warn(`could not remove ${dir}; it is a temp directory and can be left behind`);
    }
  }
}
