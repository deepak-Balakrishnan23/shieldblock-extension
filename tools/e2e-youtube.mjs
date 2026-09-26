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
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'e2e', 'youtube-fixture.html');

const SERVER_PORT = 8443;
const PAGE_TIMEOUT_MS = 45000;

/**
 * System browsers to fall back on.
 *
 * Only a fallback: released Google Chrome no longer loads an unpacked
 * extension while it is being driven. Chrome 152 on a CI runner started
 * cleanly, loaded its own bundled extensions and silently ignored
 * --load-extension. Plain Chromium builds still honour it, which is why the
 * Playwright browser below is preferred over anything listed here.
 */
const SYSTEM_BROWSER_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** Where `playwright install chromium` puts its browsers. */
const PLAYWRIGHT_ROOTS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  '/opt/pw-browsers',
  join(homedir(), '.cache', 'ms-playwright'),
  join(homedir(), 'Library', 'Caches', 'ms-playwright'),
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
const GUIDE_PAYLOAD = {
  items: [
    { guideEntryRenderer: { entryData: { guideEntryData: { guideEntryId: 'FEwhat_to_watch' } } } },
    { guideEntryRenderer: { entryData: { guideEntryData: { guideEntryId: 'FEsubscriptions' } } } },
  ],
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
 * Finds a Chromium build installed by Playwright.
 *
 * `chromium_headless_shell-*` is deliberately not matched: the shell cannot
 * load extensions at all.
 * @returns {string | null}
 */
function findPlaywrightChromium() {
  const relativePaths = [
    ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];

  for (const root of PLAYWRIGHT_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue;
      for (const relative of relativePaths) {
        const candidate = join(root, entry, ...relative);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/**
 * Finds a browser that can be driven with an unpacked extension loaded.
 * @returns {string}
 */
function resolveBrowser() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  const playwrightChromium = findPlaywrightChromium();
  if (playwrightChromium) {
    return playwrightChromium;
  }

  for (const candidate of SYSTEM_BROWSER_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'No Chromium-based browser found. Run `npx playwright install chromium`, '
      + 'or point CHROME_PATH at a Chromium build that still honours --load-extension.',
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
 * Minimal Chrome DevTools Protocol client over the browser's debugging pipe.
 *
 * The pipe rather than --remote-debugging-port because current Google Chrome
 * refuses --load-extension when a debugging *port* is open; the pipe, together
 * with --enable-unsafe-extension-debugging, is the supported way to drive a
 * browser that has an unpacked extension loaded. Messages are JSON, NUL
 * delimited, written to fd 3 and read back from fd 4. No dependencies needed.
 */
class DevToolsClient {
  /**
   * @param {import('node:stream').Writable} outgoing
   * @param {import('node:stream').Readable} incoming
   */
  constructor(outgoing, incoming) {
    this.outgoing = outgoing;
    this.nextId = 1;
    this.pending = new Map();

    let buffer = '';
    incoming.on('data', (chunk) => {
      buffer += chunk;
      let end = buffer.indexOf('\0');
      while (end !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\0');
        if (raw) this.receive(raw);
      }
    });
  }

  /**
   * @param {string} raw
   * @returns {void}
   */
  receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
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
    this.outgoing.write(`${JSON.stringify(payload)}\0`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
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
 * Fails loudly when the browser came up without the extension.
 *
 * Every check in this file assumes the extension is running, so without this
 * a browser that quietly ignored --load-extension reports a wall of unrelated
 * failures instead of the one fact that explains them.
 * @param {DevToolsClient} client
 * @param {() => string} readStderr
 * @returns {Promise<void>}
 */
async function requireExtensionLoaded(client, readStderr) {
  // Look for this extension's own service worker. Matching any
  // chrome-extension:// target is not enough — the browser ships its own, and
  // treating one of those as proof let a run with no extension loaded report
  // twelve unrelated failures instead of the one fact behind them.
  let targetInfos = [];

  for (let attempt = 0; attempt < 30; attempt += 1) {
    ({ targetInfos } = await client.send('Target.getTargets'));
    const loaded = targetInfos.some((target) => /^chrome-extension:\/\/[a-p]+\/background\.js$/
      .test(String(target.url)));
    if (loaded) {
      return;
    }
    await wait(500);
  }

  const version = await client.send('Browser.getVersion').catch(() => ({}));
  const stderr = readStderr();
  throw new Error(
    'the browser started but never loaded the extension, so no check below would mean anything.\n'
      + `  browser: ${version.product || 'unknown'}\n`
      + `  extension dir: ${REPO_ROOT}\n`
      + `  targets: ${JSON.stringify(targetInfos.map((t) => `${t.type} ${t.url}`), null, 2)}\n`
      + (stderr ? `  browser stderr:\n${stderr}\n` : ''),
  );
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
    // Carries no ads, so it should come back exactly as sent.
    if (request.url.startsWith('/youtubei/v1/guide')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(GUIDE_PAYLOAD));
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

    // The window between `ad-showing` going on and the ad's media being
    // swapped in. Acting there blanks the video the viewer asked for.
    ['viewer video not seeked before the ad loads', youtube.viewersVideoCurrentTime, 0],
    ['viewer video not sped up before the ad loads', youtube.viewersVideoRate, 1],
    ['viewer video not muted before the ad loads', youtube.viewersVideoMuted, false],

    // An Innertube response with no ads in it is handed back as the server
    // sent it, rather than re-serialized.
    ['ad-free response passed through', youtube.guideContentType, 'application/json'],
    ['cleaned response rebuilt', youtube.nextContentType, 'application/json; charset=utf-8'],

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
    '--remote-debugging-pipe',
    `--disable-extensions-except=${REPO_ROOT}`,
    `--load-extension=${REPO_ROOT}`,
    `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${SERVER_PORT},MAP example.test 127.0.0.1:${SERVER_PORT}`,
    // youtube.com is HSTS-preloaded, so a cert error cannot be clicked past.
    // Pinning the fixture certificate's public key is the supported way in.
    `--ignore-certificate-errors-spki-list=${credentials.spki}`,
    // A sandbox may export HTTPS_PROXY, and Chrome would then send the mapped
    // hostname to that proxy instead of resolving it locally.
    '--no-proxy-server',
    // Current Chrome refuses --load-extension while it is being debugged
    // unless this is passed too. Without it the browser comes up fine, with no
    // extension, and every check fails for a reason the output never states.
    '--enable-unsafe-extension-debugging',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

  let browserStderr = '';
  browser.stderr.on('data', (chunk) => {
    browserStderr = (browserStderr + chunk).slice(-2000);
  });

  const client = new DevToolsClient(browser.stdio[3], browser.stdio[4]);

  // Let the MV3 service worker register its rulesets before the first page.
  await wait(4000);
  await requireExtensionLoaded(client, () => browserStderr);

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
