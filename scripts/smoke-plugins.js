#!/usr/bin/env node
/**
 * Lightweight smoke checks for the plugin system (no Electron window).
 * Exit 1 on failure. Safe for CI alongside npm test.
 *
 * Manual PPAPI / UI checklist: docs/FLASH_CHECKLIST.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const platform = require(path.join(root, 'res', 'platform'));

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK:', msg);
  }
}

const aqw = path.join(root, 'plugins', 'adventure-quest-worlds');
const example = path.join(root, 'plugins', 'example-companion');
const parity = path.join(root, 'plugins', 'grimlite-parity');
// The real app version: a bundled plugin that declares a newer apiVersion or a higher
// minAppVersion must be discoverable by the build it ships in.
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

ok(fs.existsSync(path.join(aqw, 'plugin.json')), 'AQW plugin.json');
ok(fs.existsSync(path.join(example, 'plugin.json')), 'example plugin.json');
ok(fs.existsSync(path.join(example, 'assets', 'boxmover.swf')), 'example boxmover.swf');
ok(fs.statSync(path.join(example, 'assets', 'boxmover.swf')).size > 500, 'boxmover.swf size');
ok(fs.existsSync(path.join(example, 'assets', 'rectangle.swf')), 'example rectangle.swf');
ok(fs.statSync(path.join(example, 'assets', 'rectangle.swf')).size > 500, 'rectangle.swf size');
ok(fs.existsSync(path.join(example, 'flash', 'BoxMover.as')), 'BoxMover.as source');
ok(fs.existsSync(path.join(example, 'flash', 'StaticRect.as')), 'StaticRect.as source');
ok(fs.existsSync(path.join(parity, 'plugin.json')), 'parity plugin.json');
ok(
  fs.existsSync(path.join(parity, 'features', 'placeholder', 'placeholder.html')),
  'parity placeholder page'
);
ok(
  fs.existsSync(path.join(parity, 'features', 'bot-file', 'bot-file.html')),
  'parity bot file page'
);
ok(fs.existsSync(path.join(parity, 'bot', 'bots.js')), 'parity bot file reader/writer');

// The bot file window's preload is sandboxed, so it may only require('electron').
const botPreload = fs.readFileSync(
  path.join(parity, 'features', 'bot-file', 'preload_bot_file.js'),
  'utf8'
);
ok(botPreload.indexOf("require('electron')") !== -1, 'bot file preload requires electron');
ok(botPreload.indexOf("require('../../") === -1, 'bot file preload requires nothing project-local');

// The Bot Manager (ticket #36) is the same shape: a plugin page and a sandboxed preload.
ok(
  fs.existsSync(path.join(parity, 'features', 'bot-manager', 'bot-manager.html')),
  'parity bot manager page'
);
ok(
  fs.existsSync(path.join(parity, 'bot', 'command-catalog.js')),
  'parity command catalog present'
);
const managerPreload = fs.readFileSync(
  path.join(parity, 'features', 'bot-manager', 'preload_bot_manager.js'),
  'utf8'
);
ok(managerPreload.indexOf("require('electron')") !== -1, 'bot manager preload requires electron');
ok(
  managerPreload.indexOf("require('../..") === -1,
  'bot manager preload requires nothing project-local'
);

// A bot file the app writes must stay readable by the reference client: round-trip a fixture.
const bots = require(path.join(parity, 'bot', 'bots.js'));
const samplePath = path.join(root, 'test', 'fixtures', 'grimlite-bots', 'plain.gbot');
const sampleText = fs.readFileSync(samplePath, 'utf8');
const sampleBot = bots.parseBot(sampleText);
ok(sampleBot.ok, 'a bundled .gbot fixture parses: ' + sampleBot.error);
ok(bots.serializeBot(sampleBot.bot) === sampleText, '.gbot fixture re-serialises byte-exact');

const discovered = platform.discoverPlugins({
  bundledDir: path.join(root, 'plugins'),
  appVersion: appVersion,
  log: function () {}
});
const ids = discovered.plugins.map(function (p) { return p.manifest.id; });
ok(ids.indexOf('adventure-quest-worlds') !== -1, 'discover AQW');
ok(ids.indexOf('example-companion') !== -1, 'discover example-companion');
ok(ids.indexOf('grimlite-parity') !== -1, 'discover grimlite-parity');
ok(ids.indexOf('my-flash-game') === -1, 'skip _template');

const exManifest = JSON.parse(fs.readFileSync(path.join(example, 'plugin.json'), 'utf8'));
const validated = platform.manifestSchema.validateManifest(exManifest, { appVersion: appVersion });
ok(validated.ok, 'example manifest validates: ' + ((validated.errors || []).join('; ')));

// The app must be able to run the apiVersion the newer bundled plugin declares.
const parityManifest = JSON.parse(fs.readFileSync(path.join(parity, 'plugin.json'), 'utf8'));
const parityValidated = platform.manifestSchema.validateManifest(parityManifest, {
  appVersion: appVersion
});
ok(parityValidated.ok, 'parity manifest validates: ' + ((parityValidated.errors || []).join('; ')));

const preload = fs.readFileSync(
  path.join(example, 'features', 'dashboard', 'preload_dashboard.js'),
  'utf8'
);
ok(preload.indexOf('preload-bridge') === -1, 'dashboard preload is sandboxed-self-contained');
ok(preload.indexOf("require('electron')") !== -1, 'dashboard preload requires electron only');

const aqwHelp = fs.readFileSync(path.join(aqw, 'locales', 'en-US.js'), 'utf8');
ok(aqwHelp.indexOf('helpDetailExtra') !== -1, 'AQW help uses helpDetailExtra');
ok(aqwHelp.indexOf('helpDetail:') === -1 || aqwHelp.indexOf('helpDetailExtra') !== -1,
  'AQW does not replace platform helpDetail wholesale');

const exHelp = fs.readFileSync(path.join(example, 'locales', 'en-US.js'), 'utf8');
ok(exHelp.indexOf('helpDetailExtra') !== -1, 'example help uses helpDetailExtra');
ok(exHelp.indexOf('exampleNewBoxMover') !== -1, 'example menuMessages include New BoxMover');
ok(exHelp.indexOf('injectDemoMessages') !== -1, 'example injectDemoMessages present');
ok(exHelp.indexOf('windowTitles') !== -1, 'example windowTitles present');

const exHelpPt = fs.readFileSync(path.join(example, 'locales', 'pt-BR.js'), 'utf8');
ok(exHelpPt.indexOf('Nova janela BoxMover') !== -1, 'example pt-BR menu strings');

const localeSrc = fs.readFileSync(path.join(root, 'res', 'locale.js'), 'utf8');
ok(localeSrc.indexOf('helpDetailExtra') !== -1, 'locale.js composes helpDetailExtra');
ok(localeSrc.indexOf('resolveLangFile') !== -1, 'locale.js has language fallback resolver');

const platformHelp = fs.readFileSync(path.join(root, 'res', 'po', 'en-US.js'), 'utf8');
ok(platformHelp.indexOf('Active-plugin shortcuts') !== -1, 'platform help is plugin-aware');
ok(platformHelp.indexOf('AQW Wiki') === -1, 'platform help has no AQW wiki line');
ok(platformHelp.indexOf('appLanguage') !== -1, 'platform settings expose appLanguage');

const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
ok(mainSrc.indexOf('applyWindowMenu(win, bootGameUrl)') !== -1, 'boot reapplies per-window menu');
ok(mainSrc.indexOf('appLanguage') !== -1, 'boot respects appLanguage preference');

ok(fs.existsSync(path.join(root, 'docs', 'FLASH_CHECKLIST.md')), 'FLASH_CHECKLIST.md exists');

if (process.exitCode) {
  console.error('smoke-plugins: FAILED');
  process.exit(1);
}
console.log('smoke-plugins: all checks passed');
console.log('Manual Flash checklist: docs/FLASH_CHECKLIST.md');
