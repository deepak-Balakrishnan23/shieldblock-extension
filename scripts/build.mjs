#!/usr/bin/env node

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const distRoot = path.join(root, 'dist', 'chrome');

const entryPoints = {
  background: path.join(sourceRoot, 'background/index.ts'),
  content: path.join(sourceRoot, 'content/core.ts'),
  'page-bridge': path.join(sourceRoot, 'content/page-bridge.ts'),
  popup: path.join(sourceRoot, 'popup/index.ts'),
  options: path.join(sourceRoot, 'options/index.ts'),
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function copyFile(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyDir(source, target) {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      copyFile(sourcePath, targetPath);
    }
  }
}

function manifest() {
  return {
    manifest_version: 3,
    name: 'ShieldBlock',
    version: '4.0.0',
    description: 'Production-style website and app blocker with dynamic MV3 navigation rules, YouTube hardening, schedules, and a fail-safe overlay.',
    permissions: [
      'alarms',
      'storage',
      'tabs',
      'declarativeNetRequest',
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
    options_page: 'options.html',
    icons: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['page-bridge.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: true,
      },
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        run_at: 'document_start',
        all_frames: true,
      },
    ],
  };
}

function cleanDist() {
  fs.rmSync(distRoot, { recursive: true, force: true });
  ensureDir(distRoot);
}

async function build() {
  cleanDist();

  await esbuild.build({
    entryPoints,
    outdir: distRoot,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    minify: false,
  });

  copyDir(path.join(root, 'icons'), path.join(distRoot, 'icons'));
  copyFile(path.join(root, 'static/popup.html'), path.join(distRoot, 'popup.html'));
  copyFile(path.join(root, 'static/options.html'), path.join(distRoot, 'options.html'));
  copyFile(path.join(root, 'static/blocked.html'), path.join(distRoot, 'blocked.html'));
  copyFile(path.join(root, 'static/styles.css'), path.join(distRoot, 'styles.css'));
  copyFile(path.join(root, 'README.md'), path.join(distRoot, 'README.md'));
  copyFile(path.join(root, 'ARCHITECTURE.md'), path.join(distRoot, 'ARCHITECTURE.md'));
  copyFile(path.join(root, 'TESTING.md'), path.join(distRoot, 'TESTING.md'));
  writeJson(path.join(distRoot, 'manifest.json'), manifest());
}

build()
  .then(() => console.log('Built dist/chrome'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
