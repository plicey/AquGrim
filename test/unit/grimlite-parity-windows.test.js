// The parity plugin's small surfacing windows (ticket #25): Notepad, Eye Dropper and About.
// The reference is Grimlite-Li (Grimoire/UI/Notepad.cs, EyeDropper.cs, AboutForm.cs); the
// expected values below are computed from that C# source, not from the code under test.
const assert = require('assert');

const notepadDumps = require('../../plugins/grimlite-parity/features/notepad/dumps.js');
const eyedropper = require('../../plugins/grimlite-parity/features/eyedropper/colour.js');
const about = require('../../plugins/grimlite-parity/features/about/credits.js');
const reload = require('../../plugins/grimlite-parity/features/about/reload.js');

// Notepad.cs richTextBox1_TextChanged: the equipped class lowercased on line 1, then one
// "Skill-<i>" block per action, whose properties are printed in name order as
// "<name>:<value>, " with any name containing "desc" or "auras" left out.
test('the notepad skill dump matches the reference format, skipping desc and auras names', () => {
  const dump = notepadDumps.skillDump('Void Highlord', [
    { desc: 'not printed', skillID: 1, cooldown: 2, name: 'x', auras: [] },
    { sDesc: 'kept: .NET Contains is case-sensitive', range: 5 }
  ]);
  assert.strictEqual(
    dump,
    'void highlord' +
      '\r\nSkill-0\r\n' +
      'cooldown:2, name:x, skillID:1, ' +
      '\r\nSkill-1\r\n' +
      'range:5, sDesc:kept: .NET Contains is case-sensitive, '
  );
});

test('the notepad skill dump prints only the class name when the game returns no actions', () => {
  assert.strictEqual(notepadDumps.skillDump('Void Highlord', []), 'void highlord');
  assert.strictEqual(notepadDumps.skillDump('Void Highlord', null), 'void highlord');
  assert.strictEqual(notepadDumps.skillDump('', null), '');
});

test('the notepad skill dump prints an object value as JSON and skips any name containing auras', () => {
  // "auras2" is skipped because .NET Contains("auras") matches inside the name, and the
  // array-valued field that is kept is printed as JSON.
  assert.strictEqual(
    notepadDumps.skillDump('Paladin', [{ auras2: ['a', 'b'], perks: ['a', 'b'], tag: { k: 1 }, none: null }]),
    'paladin' + '\r\nSkill-0\r\n' + 'none:null, perks:["a","b"], tag:{"k":1}, '
  );
});

// Notepad.cs mapitems branch: "Player map items :" then one "[id] = value" per known id,
// with a missing value printed as null (Root.SaveRecentMapItemMerged writes that same shape).
test('the notepad map-item dump lists the ids it is given', () => {
  assert.strictEqual(
    notepadDumps.mapItemDump([[23725, 'Balmblossom (battleon)'], [7, null]]),
    'Player map items :\n[23725] = Balmblossom (battleon)\n[7] = null'
  );
});

test('the notepad map-item dump is just the header when nothing is known yet', () => {
  assert.strictEqual(notepadDumps.mapItemDump([]), 'Player map items :\n');
  assert.strictEqual(notepadDumps.mapItemDump(null), 'Player map items :\n');
});

// EyeDropper.cs prints one line per capture, built from Color.ToArgb() ("X2" on the packed
// ARGB int, so always eight digits), the three decimal channels and the RRGGBB half of it.
test('the eye dropper prints ARGB hex, decimal channels and RRGGBB, as the reference does', () => {
  assert.strictEqual(
    eyedropper.formatColour({ r: 0, g: 0, b: 0, a: 255 }),
    '#FF000000 / 0, 0, 0 / #000000'
  );
  assert.strictEqual(
    eyedropper.formatColour({ r: 255, g: 0, b: 128, a: 255 }),
    '#FFFF0080 / 255, 0, 128 / #FF0080'
  );
  // A one-digit channel is zero padded, never printed short.
  assert.strictEqual(
    eyedropper.formatColour({ r: 5, g: 10, b: 15, a: 255 }),
    '#FF050A0F / 5, 10, 15 / #050A0F'
  );
});

// EyeDropper.cs picks the readout text colour with Color.GetBrightness() > 0.7, which is the
// HSL lightness - (max + min) / 2 / 255 - not the perceived luminance.
test('the eye dropper readout text follows the reference brightness rule', () => {
  assert.strictEqual(eyedropper.readoutTextColour({ r: 255, g: 255, b: 255 }), '#000000');
  assert.strictEqual(eyedropper.readoutTextColour({ r: 135, g: 206, b: 235 }), '#000000');
  assert.strictEqual(eyedropper.readoutTextColour({ r: 255, g: 0, b: 0 }), '#ffffff');
  assert.strictEqual(eyedropper.readoutTextColour({ r: 255, g: 255, b: 0 }), '#ffffff');
  assert.strictEqual(eyedropper.readoutTextColour({ r: 0, g: 0, b: 0 }), '#ffffff');
});

// The screen thumbnail is scaled to whatever size the capture returned, so the cursor point
// (in DIP, relative to the display's own origin) has to be mapped onto the image's pixels.
test('the eye dropper maps a screen point onto the captured image, per display', () => {
  const primary = { bounds: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } };
  assert.deepStrictEqual(
    eyedropper.imagePoint({ width: 3840, height: 2160 }, primary, { x: 100, y: 50 }),
    { x: 200, y: 100 }
  );
  // A second display starts at its own origin, so the point is made relative to it first.
  const second = { bounds: { x: 1920, y: 0 }, size: { width: 1280, height: 720 } };
  assert.deepStrictEqual(
    eyedropper.imagePoint({ width: 1280, height: 720 }, second, { x: 2000, y: 300 }),
    { x: 80, y: 300 }
  );
  // A point outside the display lands on the nearest edge instead of reading out of bounds.
  assert.deepStrictEqual(
    eyedropper.imagePoint({ width: 1920, height: 1080 }, primary, { x: -40, y: 2000 }),
    { x: 0, y: 1079 }
  );
});

test('the eye dropper reads a BGRA pixel out of a raw bitmap buffer', () => {
  // Two pixels: opaque red (BGRA 00 00 FF FF) then half-alpha blue (FF 00 00 80).
  const bitmap = Buffer.from([0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x80]);
  assert.deepStrictEqual(eyedropper.readPixel(bitmap, 2, 0, 0), { r: 255, g: 0, b: 0, a: 255 });
  assert.deepStrictEqual(eyedropper.readPixel(bitmap, 2, 1, 0), { r: 0, g: 0, b: 255, a: 128 });
});

// AboutForm.cs sets lblVersion to `Version {Program.Version} ({Program.ReleaseDate})`; this
// port shows its own app version in the same shape, with the reference named alongside.
test('the about window builds its version line from the running app version', () => {
  assert.strictEqual(about.versionLine('2.0.0'), 'Version 2.0.0');
  assert.strictEqual(about.versionLine(''), 'Version');
  assert.strictEqual(about.referenceLine(), 'Grimlite-Li parity (reference Li 1.9.3b)');
});

// The clickable credits of AboutForm.cs, in the order the form stacks them (the control
// y-coordinates in AboutForm.Designer.cs): one whose handler is commented out upstream has no
// url here either, and the labels the designer gives each one are kept.
test('the about window lists the reference credit links, and only the reachable ones', () => {
  const links = about.creditLinks();
  assert.deepStrictEqual(links, [
    { label: 'Froztt13', url: 'https://github.com/Froztt13/Grimlite-Li' },
    { label: 'Kuzyph', url: null },
    { label: 'Zee', url: 'https://ko-fi.com/zeesnuts' },
    { label: 'Dropbox link', url: 'https://www.dropbox.com/sh/zdmgaqrrxt4bc1x/AAB_kKx1eV9wWrfox7VGoNXWa?dl=0' },
    { label: 'wisp/satan', url: 'https://github.com/wispie' },
    { label: 'cat', url: 'https://github.com/0zl' },
    { label: 'Biney', url: 'https://www.mpgh.net/forum/member.php?u=4062680' },
    { label: 'EmperorArts', url: 'https://www.mpgh.net/forum/member.php?u=2374072' }
  ]);
});

// Labels the parity plugin must not claim: the jib-akbr and Vicinity4519 GitHub links exist in
// AboutForm.cs as handlers, but no control on the form is wired to them.
test('the about window invents no credit the reference does not reach', () => {
  const urls = about.creditLinks().map(function (link) { return link.url; }).filter(Boolean);
  assert.strictEqual(urls.length, 7);
  urls.forEach(function (url) { assert.ok(/^https:\/\//.test(url), 'not a link: ' + url); });
  assert.ok(urls.indexOf('https://github.com/Vicinity4519/Grimlite-Li') === -1);
  assert.ok(urls.indexOf('https://github.com/jib-akbr/Grimlite-Li') === -1);
});

// AboutForm.cs's btnLoadSWF_Click re-initialises the game movie. This port reloads every window
// the platform classifies as the plugin's game, and reports how many it reloaded.
test('the about reload control re-initialises exactly the game windows', () => {
  const reloaded = [];
  const windows = [
    { url: 'http://127.0.0.1:1234/game/gamefiles/Loader4.swf?ver=b' },
    { url: 'file:///plugins/grimlite-parity/features/about/about.html' },
    { url: 'https://game.aq.com/game/' }
  ].map(function (entry) {
    return {
      aquaStarSwfUrl: entry.url,
      webContents: {
        getURL: function () { return entry.url; },
        reload: function () { reloaded.push(entry.url); }
      }
    };
  });

  const count = reload.gameMovie({
    windows: windows,
    isGameUrl: function (url) { return /Loader4\.swf|\.aq\.com/.test(url); }
  });

  assert.strictEqual(count, 2);
  assert.deepStrictEqual(reloaded, [
    'http://127.0.0.1:1234/game/gamefiles/Loader4.swf?ver=b',
    'https://game.aq.com/game/'
  ]);
  assert.strictEqual(reload.gameMovie({ windows: [], isGameUrl: function () { return true; } }), 0);
  assert.strictEqual(reload.gameMovie({ windows: null, isGameUrl: function () { return true; } }), 0);
});

test('the about reload control skips a window whose webContents is gone', () => {
  let reloaded = 0;
  const count = reload.gameMovie({
    windows: [{ aquaStarSwfUrl: 'https://game.aq.com/game/', webContents: null }],
    isGameUrl: function () { return true; },
    onError: function () { reloaded += 100; }
  });
  assert.strictEqual(count, 0);
  assert.strictEqual(reloaded, 0, 'a missing webContents is not an error, it is a closed window');
});
