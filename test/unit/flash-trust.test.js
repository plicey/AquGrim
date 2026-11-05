const assert = require('assert');
const flash = require('../../res/flash.js');

test('performance switches keep background and covered windows running', () => {
  const switches = new Set();
  flash.appendPerformanceSwitches({ commandLine: { appendSwitch: name => switches.add(name) } });
  ['disable-renderer-backgrounding', 'disable-background-timer-throttling',
    'disable-backgrounding-occluded-windows'].forEach(name => assert.ok(switches.has(name), name));
});

test('flash.refreshTrust empties and re-adds URLs', () => {
  const added = [];
  let emptyCount = 0;
  flash._setTrustManagerForTests({
    empty: function () {
      emptyCount++;
    },
    add: function (url) {
      added.push(url);
    }
  });
  flash.refreshTrust([
    'https://a.example/game.swf',
    'https://a.example/game.swf',
    'https://b.example/alt.swf',
    '',
    null
  ]);
  assert.strictEqual(emptyCount, 1);
  assert.deepStrictEqual(added, ['https://a.example/game.swf', 'https://b.example/alt.swf']);
  flash._setTrustManagerForTests(null);
});
