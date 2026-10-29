const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

test('game quality defaults to medium and stays selectable', () => {
  const constant = fs.readFileSync(path.join(ROOT, 'res/const.js'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'res/features/settings/settings.html'), 'utf8');
  assert.ok(/exports\.defaultGameQuality\s*=\s*'medium'/.test(constant));
  assert.ok(constant.indexOf("gameQuality:       exports.defaultGameQuality") !== -1);
  assert.ok(constant.indexOf("'low': { label: 'Low (Fastest)' }") !== -1);
  assert.ok(settings.indexOf("gameQuality:       'select'") !== -1);
  assert.ok(settings.indexOf('gameQuality:     kb.gameQualityChoices') !== -1);
});

test('the Flash wrapper validates and applies the selected quality', () => {
  const wrapper = fs.readFileSync(path.join(ROOT, 'res/swf_wrapper.html'), 'utf8');
  const instances = fs.readFileSync(path.join(ROOT, 'res/instances.js'), 'utf8');
  assert.ok(wrapper.indexOf("params.get('quality') || 'medium'") !== -1);
  assert.ok(wrapper.indexOf("['low', 'medium', 'high', 'best']") !== -1);
  assert.ok(wrapper.indexOf("{name:'quality', value: quality}") !== -1);
  assert.strictEqual((instances.match(/quality: keybinds\.keybinds && keybinds\.keybinds\.gameQuality/g) || []).length, 2);
  assert.strictEqual(wrapper.indexOf("name:'salign'"), -1, 'scale=showall must center the stage');
});

test('game quality does not enable background throttling', () => {
  const flash = fs.readFileSync(path.join(ROOT, 'res/flash.js'), 'utf8');
  assert.ok(flash.indexOf("appendSwitch('disable-renderer-backgrounding')") !== -1);
  assert.ok(flash.indexOf("appendSwitch('disable-background-timer-throttling')") !== -1);
});
