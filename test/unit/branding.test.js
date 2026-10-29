const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

test('visible app branding and stored data paths are AquGrim', () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  const constant = fs.readFileSync(path.join(ROOT, 'res/const.js'), 'utf8');
  const menu = fs.readFileSync(path.join(ROOT, 'res/windows/menu.js'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT, 'res/windows/config.js'), 'utf8');
  assert.ok(/const appDisplayName = "AquGrim"/.test(constant));
  assert.ok(/const appName\s+= "AquGrim"/.test(constant), 'stored data paths use the app name');
  assert.strictEqual(pkg.name, 'aquagrim');
  assert.strictEqual(pkg.productName, 'AquGrim');
  assert.ok(menu.indexOf('constant.appDisplayName || \'AquGrim\'') !== -1);
  assert.ok(config.indexOf("title: 'AquGrim - Settings'") !== -1);
});

test('the Grimlite-derived plugin displays as AquGrim without changing its id or paths', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'plugins/grimlite-parity/plugin.json'), 'utf8'));
  const words = require(path.join(ROOT, 'plugins/grimlite-parity/locales/en-US.js'));
  assert.strictEqual(manifest.id, 'grimlite-parity');
  assert.strictEqual(manifest.name, 'AquGrim');
  assert.strictEqual(manifest.author, 'AquGrim');
  assert.strictEqual(words.windowTitles.primary, 'AquGrim');
  assert.strictEqual(words.menuMessages.grimliteMenu, 'Client');
  assert.ok(words.dialogMessages.helpDetailExtra({}).indexOf('AquGrim') === 0);
});

test('provided game windows use AquGrim titles', () => {
  const aqw = require(path.join(ROOT, 'plugins/adventure-quest-worlds/locales/en-US.js'));
  assert.ok(String(aqw.remindersMessages.title).indexOf('AquGrim') === 0);
  assert.ok(String(aqw.todoMessages.title).indexOf('AquGrim') === 0);
  assert.ok(String(aqw.strategyMessages.title).indexOf('AquGrim') === 0);
  assert.ok(String(aqw.inventoryMessages.title).indexOf('AquGrim') === 0);
});
