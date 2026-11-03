const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

test('game quality defaults to low and stays selectable', () => {
  const constant = fs.readFileSync(path.join(ROOT, 'res/const.js'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'res/features/settings/settings.html'), 'utf8');
  assert.ok(/exports\.defaultGameQuality\s*=\s*'low'/.test(constant));
  assert.ok(constant.indexOf("gameQuality:       exports.defaultGameQuality") !== -1);
  assert.ok(constant.indexOf("'low': { label: 'Low (Fastest, Default)' }") !== -1);
  assert.ok(settings.indexOf("gameQuality:       'select'") !== -1);
  assert.ok(settings.indexOf('gameQuality:     kb.gameQualityChoices') !== -1);
});

test('Ruffle receives quality and has no Flash routing fallback', () => {
  const wrapper = fs.readFileSync(path.join(ROOT, 'res/ruffle_wrapper.html'), 'utf8');
  const instances = fs.readFileSync(path.join(ROOT, 'res/instances.js'), 'utf8');
  assert.ok(wrapper.includes("params.get('quality') || 'low'"));
  assert.ok(wrapper.includes("quality: quality"));
  assert.ok(instances.includes('constant.wrapRuffleUrl('));
  assert.ok(!instances.includes('constant.wrapSwfUrl('));
});

test('game quality does not enable background throttling', () => {
  const flash = fs.readFileSync(path.join(ROOT, 'res/flash.js'), 'utf8');
  assert.ok(flash.indexOf("appendSwitch('disable-renderer-backgrounding')") !== -1);
  assert.ok(flash.indexOf("appendSwitch('disable-background-timer-throttling')") !== -1);
  assert.ok(flash.indexOf("appendSwitch('enable-gpu-rasterization')") !== -1);
  assert.ok(flash.indexOf("appendSwitch('enable-zero-copy')") !== -1);
  assert.ok(flash.indexOf("appendSwitch('force_high_performance_gpu')") !== -1);
});

test('Wayland shortcuts avoid the global shortcut approval portal', () => {
  const source = fs.readFileSync(path.join(ROOT, 'res/keybindings.js'), 'utf8');
  assert.ok(source.includes("process.env.XDG_SESSION_TYPE === 'wayland'"));
  assert.ok(source.includes('addKeybind(keybind, func, onlyHTML, considerDF);'));
});
