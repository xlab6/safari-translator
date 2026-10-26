#!/usr/bin/env node
/**
 * Manifest / packaging linter.
 *
 * Verifies the MV2 manifest shape, that every referenced file exists, that
 * declared icon sizes match the actual PNGs, that HTML has no inline script
 * (Safari's extension CSP blocks it) and that all shipped scripts parse.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT = path.resolve(__dirname, '..', 'extension');
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${path.relative(EXT, file)}: ${error.message}`);
    return null;
  }
}

function exists(relative, label) {
  const file = path.resolve(EXT, relative);
  if (!fs.existsSync(file)) {
    fail(`${label}: missing ${relative}`);
    return false;
  }
  return true;
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function checkIcon(relative, expected, label) {
  if (!exists(relative, label)) return;
  const size = pngSize(path.resolve(EXT, relative));
  if (!size) {
    fail(`${label}: ${relative} is not a PNG`);
    return;
  }
  if (size.width !== size.height) fail(`${label}: ${relative} is not square (${size.width}x${size.height})`);
  if (expected && size.width !== expected) {
    fail(`${label}: ${relative} is ${size.width}px, expected ${expected}px`);
  }
}

function checkHtml(relative) {
  if (!exists(relative, 'html')) return;
  const html = fs.readFileSync(path.resolve(EXT, relative), 'utf8');

  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [, attrs, body] of inline) {
    if (!/\bsrc\s*=/.test(attrs) && body.trim()) {
      fail(`${relative}: inline <script> is blocked by the extension CSP`);
    }
  }

  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(?:https?:|data:|mailto:|#|\/\/)/i.test(ref)) continue;
    const clean = ref.split('?')[0].split('#')[0];
    exists(clean, `${relative} reference`);
  }
}

function checkScripts(relative) {
  if (!exists(relative, 'script')) return;
  try {
    execFileSync(process.execPath, ['--check', path.resolve(EXT, relative)], { stdio: 'pipe' });
  } catch (error) {
    const detail = (error.stderr || '').toString().trim().split('\n').slice(0, 3).join(' ');
    fail(`${relative}: syntax error${detail ? ` — ${detail}` : ''}`);
  }
}

const manifest = readJson(path.join(EXT, 'manifest.json'));

if (manifest) {
  if (manifest.manifest_version !== 2) fail('manifest_version must be 2 for Safari App Extensions');
  if (!manifest.name) fail('name is required');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('version must be semver-like (x.y.z)');
  if (!manifest.description) fail('description is required');

  const permissions = manifest.permissions || [];
  for (const required of ['storage', 'contextMenus']) {
    if (!permissions.includes(required)) fail(`permissions: missing "${required}"`);
  }
  if (!permissions.includes('*://*/*')) fail('permissions: missing host permission "*://*/*"');

  if (!manifest.background || !Array.isArray(manifest.background.scripts)) {
    fail('background.scripts must be an array');
  } else {
    if (manifest.background.scripts.length < 2) fail('background.scripts should load common.js and providers.js first');
    manifest.background.scripts.forEach((script) => checkScripts(script));
  }

  const icons = manifest.icons || {};
  const sizes = Object.keys(icons).map(Number).sort((a, b) => a - b);
  if (sizes.length < 4) fail('icons: declare at least 16/32/48/128 sizes');
  for (const size of sizes) {
    if (!Number.isFinite(size) || size <= 0) fail(`icons: invalid size key "${size}"`);
    checkIcon(icons[size], size, 'icons');
  }
  if (!icons['128']) fail('icons: missing 128px icon (used by Safari settings)');
  if (!icons['512']) notes.push('icons: a 512px icon is recommended for the App Store');

  const action = manifest.browser_action;
  if (!action) {
    fail('browser_action is required');
  } else {
    if (action.default_popup) checkHtml(action.default_popup);
    else fail('browser_action.default_popup is required');
    if (action.default_title === undefined) notes.push('browser_action.default_title is recommended');
    if (action.default_icon) {
      for (const [size, file] of Object.entries(action.default_icon)) {
        checkIcon(file, Number(size), 'browser_action.default_icon');
      }
    }
  }

  const options = manifest.options_ui;
  if (!options || !options.page) {
    fail('options_ui.page is required');
  } else {
    checkHtml(options.page);
    // Safari does not support `open_in_tab` (it warns during conversion), so
    // the options page is simply opened in a tab by Safari itself.
  }

  const scripts = manifest.content_scripts;
  if (!Array.isArray(scripts) || scripts.length === 0) {
    fail('content_scripts is required');
  } else {
    for (const entry of scripts) {
      if (!Array.isArray(entry.matches) || !entry.matches.includes('<all_urls>')) {
        fail('content_scripts.matches should contain "<all_urls>"');
      }
      if (entry.run_at !== 'document_start') {
        notes.push('content_scripts.run_at: "document_start" keeps the selection button responsive');
      }
      (entry.js || []).forEach((file) => checkScripts(file));
      (entry.css || []).forEach((file) => exists(file, 'content_scripts.css'));
      if (entry.all_frames) {
        notes.push('content_scripts.all_frames: true injects the selection UI into every iframe');
      }
    }
  }

  for (const resource of manifest.web_accessible_resources || []) {
    exists(resource, 'web_accessible_resources');
  }

  if (manifest.update_url) fail('update_url is not used by Safari App Extensions');
}

for (const file of ['popup.html', 'options.html', 'popup.js', 'options.js', 'content.js']) {
  const full = path.join(EXT, file);
  if (!fs.existsSync(full)) fail(`missing ${file}`);
}

const iconDir = path.join(EXT, 'icons');
if (fs.existsSync(iconDir)) {
  for (const file of fs.readdirSync(iconDir)) {
    if (file.endsWith('.png')) checkIcon(path.join('icons', file), null, 'icons');
  }
}

if (notes.length) {
  console.log('notes:');
  for (const note of notes) console.log(`  · ${note}`);
}

if (errors.length) {
  console.error(`\n✗ manifest check failed (${errors.length}):`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}

console.log('✓ manifest, assets and scripts look good');
