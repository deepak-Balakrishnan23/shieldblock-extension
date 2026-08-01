#!/usr/bin/env node
/**
 * Builds the Chrome Web Store upload package.
 *
 * Only runtime files go in: dev tooling, tests, docs, and CI config would be
 * shipped to every user and reviewed by Chrome for no reason.
 *
 * Usage: npm run package
 */
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(REPO_ROOT, 'dist');
const STAGE_DIR = join(DIST_DIR, 'chrome');

/** Everything the extension needs at runtime, and nothing else. */
const RUNTIME_ENTRIES = [
  'manifest.json',
  'background.js',
  'filter-compiler.js',
  'content.js',
  'cosmetic.js',
  'heuristic.js',
  'ml-classifier.js',
  'sponsorblock.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'icons',
  'rules',
  'scriptlets',
];

/**
 * Returns a human-readable byte size.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'manifest.json'), 'utf8'));
  const zipName = `shieldblock-ai-v${manifest.version}.zip`;
  const zipPath = join(DIST_DIR, zipName);

  // Clear only this script's own outputs. Wiping all of dist/ would delete the
  // store screenshots that `npm run screenshots` writes alongside the package.
  await rm(STAGE_DIR, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(STAGE_DIR, { recursive: true });

  for (const entry of RUNTIME_ENTRIES) {
    await cp(join(REPO_ROOT, entry), join(STAGE_DIR, entry), { recursive: true });
  }

  // Zip the staged contents, not the folder, so the manifest sits at the root of
  // the archive — Chrome rejects a package with the manifest inside a subfolder.
  await run('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: STAGE_DIR });

  const { size } = await stat(zipPath);
  const ruleCount = manifest.declarative_net_request.rule_resources.length;

  console.log([
    `Package   dist/${zipName}`,
    `Size      ${formatSize(size)}`,
    `Version   ${manifest.version}`,
    `Rulesets  ${ruleCount}`,
    '',
    'Upload this zip at https://chrome.google.com/webstore/devconsole',
  ].join('\n'));
}

await main();
