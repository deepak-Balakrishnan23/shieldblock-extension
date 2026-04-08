#!/usr/bin/env node

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const sourceRoot = path.join(root, 'src');
const targets = process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox'];

const entries = {
  background: path.join(sourceRoot, 'background/index.ts'),
  popup: path.join(sourceRoot, 'popup/index.ts'),
  content: path.join(sourceRoot, 'content/core.ts'),
  annoyances: path.join(sourceRoot, 'content/annoyances.ts'),
  youtube: path.join(sourceRoot, 'content/youtube.ts'),
  youtubeHook: path.join(sourceRoot, 'page/youtube-hook.ts'),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      copyFile(sourcePath, targetPath);
    }
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeChromeManifest() {
  return {
    manifest_version: 3,
    name: 'ShieldBlock AI - Ad Blocker',
    version: '3.0.0',
    description: 'Hybrid ad blocker for Chrome and Firefox with YouTube-specific ad stripping and local privacy protections.',
    permissions: [
      'declarativeNetRequestWithHostAccess',
      'storage',
      'tabs',
      'activeTab',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    action: {
      default_popup: 'popup.html',
      default_icon: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
    icons: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    declarative_net_request: {
      rule_resources: [
        { id: 'ads', enabled: true, path: 'rules/ads.json' },
        { id: 'trackers', enabled: true, path: 'rules/trackers.json' },
        { id: 'patterns', enabled: true, path: 'rules/patterns.json' },
        { id: 'popups', enabled: true, path: 'rules/popups.json' },
        { id: 'youtube', enabled: true, path: 'rules/youtube.json' },
        { id: 'malware', enabled: true, path: 'rules/malware.json' },
      ],
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js', 'annoyances.js'],
        run_at: 'document_start',
      },
      {
        matches: ['*://*.youtube.com/*'],
        js: ['youtube.js'],
        run_at: 'document_start',
      },
    ],
    web_accessible_resources: [
      {
        resources: ['page/youtube-hook.js', 'model/ad_classifier.json'],
        matches: ['<all_urls>'],
      },
    ],
  };
}

function makeFirefoxManifest() {
  return {
    ...makeChromeManifest(),
    browser_specific_settings: {
      gecko: {
        id: 'shieldblock@baladhak.local',
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  };
}

function buildFallbackUpdate() {
  const payload = {
    dynamicRules: [
      {
        id: 100001,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: '||youtube.com/youtubei/v1/player/ad_break',
          resourceTypes: ['xmlhttprequest'],
        },
      },
      {
        id: 100002,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: '||youtube.com/api/stats/ads',
          resourceTypes: ['xmlhttprequest', 'image'],
        },
      },
    ],
    siteFixes: {
      youtubeExtraSelectors: ['ytd-search-pyv-renderer', 'ytd-banner-promo-renderer'],
      sponsoredKeywords: ['sponsored', 'promoted', 'install', 'visit site'],
    },
  };
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {
    version: '2026.03.30',
    generatedAt: new Date().toISOString(),
    payload,
    integrity: {
      algorithm: 'SHA-256',
      sha256,
    },
  };
}

async function buildTarget(target) {
  const outDir = path.join(distRoot, target);
  cleanDir(outDir);

  await esbuild.build({
    entryPoints: {
      background: entries.background,
      popup: entries.popup,
      content: entries.content,
      annoyances: entries.annoyances,
      youtube: entries.youtube,
      'page/youtube-hook': entries.youtubeHook,
    },
    outdir: outDir,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    minify: false,
    platform: 'browser',
  });

  copyDir(path.join(root, 'icons'), path.join(outDir, 'icons'));
  copyDir(path.join(root, 'rules'), path.join(outDir, 'rules'));
  copyDir(path.join(root, 'model'), path.join(outDir, 'model'));

  for (const doc of [
    'README.md',
    'ARCHITECTURE.md',
    'TESTING.md',
    'TEST_REPORT.md',
    'LEGAL_AND_POLICY.md',
    'PRIVACY_POLICY.md',
    'CHROME_WEB_STORE_DESCRIPTION.md',
    'REVIEWER_NOTES.md',
    'PRE_SUBMISSION_CHECKLIST.md',
  ]) {
    if (fs.existsSync(path.join(root, doc))) {
      copyFile(path.join(root, doc), path.join(outDir, doc));
    }
  }

  ensureDir(path.join(outDir, 'updates'));
  writeJson(path.join(outDir, 'updates/fallback-update.json'), buildFallbackUpdate());
  copyFile(path.join(root, 'static/popup.html'), path.join(outDir, 'popup.html'));

  writeJson(
    path.join(outDir, 'manifest.json'),
    target === 'firefox' ? makeFirefoxManifest() : makeChromeManifest()
  );
}

Promise.all(targets.map(buildTarget))
  .then(() => {
    console.log(`Built targets: ${targets.join(', ')}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
