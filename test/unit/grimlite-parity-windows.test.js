// The parity plugin's small surfacing windows (ticket #25): Notepad, Eye Dropper and About.
// The reference is Grimlite-Li (Grimoire/UI/Notepad.cs, EyeDropper.cs, AboutForm.cs); the
// expected values below are computed from that C# source, not from the code under test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require('../../res/platform');
const notepadDumps = require('../../plugins/grimlite-parity/features/notepad/dumps.js');
const notepadSource = require('../../plugins/grimlite-parity/features/notepad/game-source.js');
const eyedropper = require('../../plugins/grimlite-parity/features/eyedropper/colour.js');
const about = require('../../plugins/grimlite-parity/features/about/credits.js');
const reload = require('../../plugins/grimlite-parity/features/about/reload.js');
const { createAbout } = require('../../plugins/grimlite-parity/features/about/about.js');

const pluginRoot = path.join(__dirname, '../../plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version;
// Root.cs puts Eye Dropper above Notepad in the Tools menu and About in a menu of its own;
// this port keeps that order inside its single Grimlite menu.
const WINDOW_IDS = ['grimlite-parity-eyedropper', 'grimlite-parity-notepad', 'grimlite-parity-about'];

function activateParity(deps) {
  const plugin = {
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  };
  return platform.activatePlugin(plugin, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: deps || {}
  });
}

// Ticket #25: three small surfacing windows, in the app's own conventions - sandboxed, no
// Flash, dark local pages - and none of them needing a permission the manifest does not
// declare (the Host refuses a call whose permission is missing, so activating at all is the
// check for that).
test('the parity plugin registers the notepad, eye dropper and about windows', async () => {
  const activated = await activateParity();
  const windows = activated.host._getState().featureWindows;

  WINDOW_IDS.forEach(function (id) {
    const found = windows.filter(function (w) {
      return w.id === id;
    });
    assert.strictEqual(found.length, 1, 'missing feature window ' + id);
    const config = found[0].config;
    assert.strictEqual(config.webPreferences.sandbox, true, id + ' must be sandboxed');
    assert.strictEqual(config.webPreferences.plugins, false, id + ' must not load Flash');
    assert.strictEqual(config.webPreferences.contextIsolation, true, id + ' must isolate contexts');
    assert.strictEqual(config.webPreferences.nodeIntegration, false, id + ' must not expose Node');
    assert.strictEqual(config.useContentSize, true, id + ' sizes its content, like the platform\'s');
    assert.ok(/^file:\/\//.test(found[0].url), id + ' must be a local page');
    // The page is the plugin's own file, and it exists on disk.
    const pagePath = require('url').fileURLToPath(found[0].url);
    assert.ok(pagePath.indexOf(pluginRoot) === 0, id + ' page must live in the plugin');
    assert.ok(fs.existsSync(pagePath), 'missing page file: ' + pagePath);
    // Sandboxed preloads may only require electron, so every window needs its own file.
    const preload = config.webPreferences.preload;
    assert.ok(typeof preload === 'string' && fs.existsSync(preload), id + ' needs a preload');
    assert.strictEqual(
      fs.readFileSync(preload, 'utf8').indexOf('require(') !== -1 &&
        /require\((['"])electron\1\)/.test(fs.readFileSync(preload, 'utf8')),
      true,
      id + ' preload must require electron only'
    );
  });
});

test('the grimlite menu opens each of the three windows', async () => {
  const opened = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) {
      opened.push(id);
      return {};
    }
  });
  const state = activated.host._getState();
  const items = [];
  state.menus.forEach(function (contributor) {
    contributor({ labels: {}, keybinds: {} }).forEach(function (top) {
      items.push(top);
      (top.submenu || []).forEach(function (item) {
        items.push(item);
      });
    });
  });

  const labels = items.map(function (item) {
    return item.label;
  });
  ['Eye Dropper', 'Notepad', 'About'].forEach(function (label) {
    assert.ok(labels.indexOf(label) !== -1, 'menu is missing ' + label + ' (has ' + labels.join(', ') + ')');
  });

  ['Eye Dropper', 'Notepad', 'About'].forEach(function (label) {
    items.filter(function (item) { return item.label === label; }).forEach(function (item) {
      item.click();
    });
  });
  assert.deepStrictEqual(opened, WINDOW_IDS);
});

// A window that declared webSecurity:false or plugins:true would need unsafe-renderer. These
// three use neither (the bot-file window's store permission is #24's, not theirs): if
// activating needed a permission the manifest does not declare, the Host would have thrown
// above.
test('the three windows need no permission the manifest does not already declare', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.ok(manifest.permissions.indexOf('unsafe-renderer') === -1, 'these windows need no unsafe renderer');
  const activated = await activateParity();
  WINDOW_IDS.forEach(function (id) {
    assert.strictEqual(
      activated.host._getState().featureWindows.filter(function (w) { return w.id === id; }).length,
      1
    );
  });
});

// Notepad.cs's helpers read the game (`world.actions.active`, the recent map items). Until the
// bridge ticket (#28) lands there is no game to read, so the source reports nothing rather than
// inventing a value - the dump formatters above are what this ticket owns.
test('the notepad game source reports nothing until a game source is attached', () => {
  const source = notepadSource.createGameSource();
  assert.strictEqual(source.equippedClass(), '');
  assert.deepStrictEqual(source.skillActions(), []);
  assert.deepStrictEqual(source.mapItems(), []);
});

test('the notepad game source hands the dumps what the attached provider reports', () => {
  const source = notepadSource.createGameSource();
  source.attach({
    equippedClass: function () { return 'Void Highlord'; },
    skillActions: function () { return [{ skillID: 1 }]; },
    mapItems: function () { return { 7: 'Balmblossom (battleon)', 23725: 'Balmblossom (tercess)' }; }
  });
  assert.strictEqual(source.equippedClass(), 'Void Highlord');
  assert.deepStrictEqual(source.skillActions(), [{ skillID: 1 }]);
  // Ids are handed over lowest first, the order Root.SaveRecentMapItemMerged writes the file in.
  assert.deepStrictEqual(source.mapItems(), [[7, 'Balmblossom (battleon)'], [23725, 'Balmblossom (tercess)']]);
  source.attach({ equippedClass: function () { throw new Error('no game'); } });
  assert.strictEqual(source.equippedClass(), '', 'a provider that throws is not a dump crash');
});

// A page calling a bridge method its preload does not expose does nothing at all, silently.
// Both sides are plain text here, so the agreement can be checked without a renderer.
test('every bridge call a page makes is exposed by that page\'s preload', () => {
  const pages = [
    ['notepad', 'aquastarNotepad', 'notepad.html', 'preload_notepad.js'],
    ['eyedropper', 'aquastarEyedropper', 'eyedropper.html', 'preload_eyedropper.js'],
    ['about', 'aquastarAbout', 'about.html', 'preload_about.js']
  ];
  pages.forEach(function (page) {
    const dir = path.join(pluginRoot, 'features', page[0]);
    const html = fs.readFileSync(path.join(dir, page[2]), 'utf8');
    const preload = fs.readFileSync(path.join(dir, page[3]), 'utf8');

    // Pages bind the exposed object to a local name first (`var bridge = window.aquastarX || null`),
    // so calls are found through whatever identifier that page assigned it to.
    const bound = html.match(new RegExp('([A-Za-z0-9_]+)\\s*=\\s*window\\.' + page[1]));
    assert.ok(bound, page[0] + ' page never binds window.' + page[1]);
    const called = (html.match(new RegExp('\\b' + bound[1] + '\\.([A-Za-z0-9_]+)\\(', 'g')) || []).map(
      function (hit) {
        return hit.slice(bound[1].length + 1, -1);
      }
    );
    assert.ok(called.length > 0, page[0] + ' page never uses its bridge');

    const exposed = (preload.match(/^\s*([A-Za-z0-9_]+): function/gm) || []).map(function (line) {
      return line.trim().split(':')[0];
    });
    called.forEach(function (name) {
      assert.ok(
        exposed.indexOf(name) !== -1,
        page[3] + ' does not expose ' + name + ' (has ' + exposed.join(', ') + ')'
      );
    });

    // Every window's page loads the shared focus stylesheet, like the platform's own windows.
    assert.ok(html.indexOf('res/features/common/focus.css') !== -1, page[0] + ' needs the shared focus style');
    // Sandboxed preloads may only require electron.
    const requires = (preload.match(/require\((['"])[^'"]+\1\)/g) || []);
    requires.forEach(function (call) {
      assert.ok(call.indexOf('electron') !== -1, page[3] + ' must require electron only, got ' + call);
    });
    // A page whose inline script does not parse loads as a blank window, so each block is
    // checked as JavaScript here instead of waiting for a human to see nothing.
    const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
    assert.ok(blocks.length > 0, page[0] + ' has no inline script to check');
    blocks.forEach(function (block, index) {
      const source = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      assert.doesNotThrow(
        function () { new (require('vm').Script)(source); },
        page[2] + ' inline script ' + index + ' does not parse'
      );
    });
  });
});

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

// The reference's eyedropper control draws a 150x150 magnified preview at 15x, which is the
// 10x10 block around the cursor; the page scales each returned pixel back up.
test("the eye dropper preview is the reference's 10x10 block at 15x", () => {
  assert.strictEqual(eyedropper.PREVIEW_SIZE, 150);
  assert.strictEqual(eyedropper.PREVIEW_ZOOM, 15);
  assert.strictEqual(eyedropper.PREVIEW_SOURCE, 10);

  // Four pixels, 2x2: the read is clamped at the image edges.
  const bitmap = Buffer.from([
    0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0xff,
    0x00, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff
  ]);
  const preview = eyedropper.previewPixels(bitmap, { width: 2, height: 2 }, { x: 1, y: 1 }, 2);
  assert.deepStrictEqual(preview, {
    width: 2,
    height: 2,
    data: [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]
  });
});

// The reference's form is the picker, a swatch readout and the history box, with no caption text
// of this port's own and no placeholder.
test('the eye dropper page drops its extra labels and carries the preview canvas', () => {
  const page = fs.readFileSync(path.join(pluginRoot, 'features/eyedropper/eyedropper.html'), 'utf8');
  assert.ok(/id="preview"/.test(page), 'the magnified preview canvas must be there');
  assert.strictEqual(/id="hint"/.test(page), false, 'the extra hint is gone');
  assert.strictEqual(page.indexOf('No colour picked yet.'), -1, 'the readout starts empty');
  assert.ok(/<ul id="history"/.test(page), 'the history is a list');
});

// AboutForm.cs sets lblVersion to `Version {Program.Version} ({Program.ReleaseDate})`; Program.cs
// carries "Li 1.9.3b" and "10-10-2026". The port shows that reference line and its own version
// beside it.
test('the about window carries the reference version line', () => {
  assert.strictEqual(about.versionLine(), 'Version Li 1.9.3b (10-10-2026)');
  assert.strictEqual(about.portLine('2.0.0'), 'AquGrim 2.0.0');
  assert.strictEqual(about.portLine(null), 'AquGrim');
});

// AboutForm.Designer.cs's three team headings, in its own order, and rtbCredits.Text.
test('the about window carries the three team headings and the credits prose', () => {
  assert.deepStrictEqual(about.teams().map(function (team) { return team.heading; }), [
    'The Grimlite Li Team', 'The Grimlite Team', 'The Previous Grimoire Team'
  ]);
  assert.deepStrictEqual(about.teams()[0].links.map(function (link) { return link.label; }), [
    'Froztt13', 'Kuzyph', 'Zee', 'Dropbox link'
  ]);
  assert.ok(about.CREDITS_PROSE.indexOf('133spider https://github.com/133spider/') !== -1);
  assert.ok(about.CREDITS_PROSE.indexOf('\u2937 AQLite https://github.com/133spider/AQLite') !== -1);
  assert.ok(about.CREDITS_PROSE.indexOf('\u2937 for wanting to be credited') !== -1);
  // The logo beside the heading is the reference's own big icon, shipped in this feature folder.
  const page = fs.readFileSync(path.join(pluginRoot, 'features/about/about.html'), 'utf8');
  assert.ok(/id="logo"/.test(page));
  assert.ok(fs.existsSync(path.join(pluginRoot, 'features/about/grimoire-icon.png')));
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

// AboutForm.btnLoadSWF_Click checks the file, logs out and re-initialises the movie. The port's
// only accepted path is the platform's custom-game.swf, so the field cannot read an arbitrary file.
test('Load Game SWF checks the managed path, logs out and reloads the game', async () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-about-'));
  const managed = path.join(dir, 'custom-game.swf');
  fs.writeFileSync(managed, 'swf');
  const handlers = {};
  const calls = [];
  const reloaded = [];
  const feature = createAbout({
    appVersion: '9.9.9',
    customSwfPath: managed,
    getMessages: function () { return {}; },
    getWindows: function () {
      return [{ id: 1, webContents: { getURL: function () { return 'http://game/'; },
        reload: function () { reloaded.push(1); } } }];
    },
    isGameUrl: function () { return true; },
    game: { loaderCall: function (name, args) { calls.push([name, args]); return Promise.resolve(); } }
  });
  feature.register({ appDataDirectory: dir, ipc: { handle: function (channel, fn) {
    handlers[channel] = fn;
  } }, log: function () {} });

  const loaded = await handlers.aboutLoadSwf({}, managed);
  assert.deepStrictEqual(loaded, { loaded: 1, status: '' });
  assert.deepStrictEqual(calls, [['Logout', []]]);
  assert.strictEqual(reloaded.length, 1);

  const missing = await handlers.aboutLoadSwf({}, path.join(dir, 'missing.swf'));
  assert.strictEqual(missing.status, 'Use Settings - Custom SWF File to choose a different game SWF.');
  fs.unlinkSync(managed);
  const gone = await handlers.aboutLoadSwf({}, managed);
  assert.deepStrictEqual(gone, { loaded: 0, status: 'File not found.' });
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

// The Notepad's save path is the reference's Ctrl+S: a native save dialog with the same filter
// list (txt / gbot / all files) and the plain text written out.
test('the notepad save dialog writes the text it was given, with the reference filters', async () => {
  const notepad = require('../../plugins/grimlite-parity/features/notepad/notepad.js');
  const written = [];
  const dialogs = [];
  const window = notepad.createNotepad({
    showSaveDialog: function (owner, options) {
      dialogs.push(options);
      return Promise.resolve({ canceled: false, filePath: '/tmp/notes.txt' });
    },
    writeFile: function (filePath, text) { written.push([filePath, text]); },
    getMessages: function () { return {}; }
  });
  const handlers = {};
  window.register({
    ipc: {
      handle: function (channel, listener) { handlers[channel] = listener; }
    }
  });

  const result = await handlers['notepadSave']({}, 'hello');
  assert.deepStrictEqual(written, [['/tmp/notes.txt', 'hello']]);
  assert.deepStrictEqual(
    dialogs[0].filters.map(function (f) { return [f.name, f.extensions]; }),
    [['txt files', ['txt']], ['gbot files', ['gbot']], ['All files', ['*']]]
  );
  // SaveFileDialog's own default title: the reference never sets one.
  assert.strictEqual(dialogs[0].title, 'Save As');
  assert.ok(result.saved.indexOf('/tmp/notes.txt') !== -1);
});

test('a cancelled notepad save writes nothing', async () => {
  const notepad = require('../../plugins/grimlite-parity/features/notepad/notepad.js');
  let writes = 0;
  const window = notepad.createNotepad({
    showSaveDialog: function () { return Promise.resolve({ canceled: true }); },
    writeFile: function () { writes++; },
    getMessages: function () { return {}; }
  });
  const handlers = {};
  window.register({ ipc: { handle: function (c, l) { handlers[c] = l; } } });
  const result = await handlers['notepadSave']({}, 'hello');
  assert.deepStrictEqual(result, { canceled: true });
  assert.strictEqual(writes, 0);
});

test('a failed notepad save reports the reason instead of throwing at the window', async () => {
  const notepad = require('../../plugins/grimlite-parity/features/notepad/notepad.js');
  const window = notepad.createNotepad({
    showSaveDialog: function () { return Promise.resolve({ canceled: false, filePath: '/nope/x.txt' }); },
    writeFile: function () { throw new Error('EACCES'); },
    getMessages: function () { return {}; }
  });
  const handlers = {};
  window.register({ ipc: { handle: function (c, l) { handlers[c] = l; } } });
  const result = await handlers['notepadSave']({}, 'hello');
  assert.ok(/EACCES/.test(result.error), JSON.stringify(result));
});

// Notepad.cs is a plain text box with Font/Color on its right-click menu, an appending drag-drop
// and a Backspace guard; the page carries those and no permanent formatting toolbar.
test('the notepad page formats through the right-click menu, not a toolbar', () => {
  const page = fs.readFileSync(path.join(pluginRoot, 'features/notepad/notepad.html'), 'utf8');
  assert.ok(page.indexOf('id="menu"') !== -1 && page.indexOf('id="menuFont"') !== -1 &&
    page.indexOf('id="menuColor"') !== -1, 'the right-click menu must offer Font and Color');
  assert.ok(page.indexOf('contextmenu') !== -1, 'the menu must open on a right-click');
  assert.strictEqual(page.indexOf('id="bar"'), -1, 'the permanent toolbar is gone');
  assert.strictEqual(/id="save"/.test(page), false, 'saving is Ctrl+S only');
  assert.ok(page.indexOf("'\\r\\n' + String(reader.result) + '\\r\\n'") !== -1,
    'a dropped file is appended with CRLF');
  assert.ok(/Backspace/.test(page), 'an empty box must swallow Backspace');
});

// EyeDropper.cs reads the pixel under the pointer when the capture finishes. In Electron the
// screen comes from desktopCapturer, so the pick is composed from the cursor point, the display
// under it and that display's thumbnail - each handed in, so it can be checked without a screen.
test('the eye dropper picks the pixel under the cursor, in the reference formats', async () => {
  const eyedropperWindow = require('../../plugins/grimlite-parity/features/eyedropper/eyedropper.js');
  const display = { id: 7, bounds: { x: 0, y: 0, width: 4, height: 2 }, size: { width: 4, height: 2 } };
  // Four pixels: black, red, green, blue in BGRA.
  const bitmap = Buffer.from([
    0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff,
    0x10, 0x20, 0x30, 0xff, 0x40, 0x50, 0x60, 0xff, 0x70, 0x80, 0x90, 0xff, 0xa0, 0xb0, 0xc0, 0xff
  ]);
  const picker = eyedropperWindow.createEyedropper({
    getCursorPoint: function () { return { x: 2, y: 1 }; },
    getDisplayNearestPoint: function () { return display; },
    captureDisplay: function () {
      return Promise.resolve({ bitmap: bitmap, size: { width: 4, height: 2 } });
    }
  });

  const picked = await picker.pick();
  // The bytes for pixel (2, 1) are 70 80 90 A0 in bitmap order: B=0x70, G=0x80, R=0x90.
  assert.strictEqual(picked.text, '#FF908070 / 144, 128, 112 / #908070');
  assert.deepStrictEqual(picked.colour, { r: 144, g: 128, b: 112, a: 255 });
  assert.strictEqual(picked.cssColour, '#908070');
  assert.strictEqual(picked.textColour, '#ffffff');
});

test('a screen the eye dropper cannot capture reports an error instead of a colour', async () => {
  const eyedropperWindow = require('../../plugins/grimlite-parity/features/eyedropper/eyedropper.js');
  const picker = eyedropperWindow.createEyedropper({
    getCursorPoint: function () { return { x: 0, y: 0 }; },
    getDisplayNearestPoint: function () { return { size: { width: 1, height: 1 }, bounds: { x: 0, y: 0 } }; },
    captureDisplay: function () { return Promise.resolve(null); }
  });
  const picked = await picker.pick();
  assert.strictEqual(picked.colour, null);
  assert.ok(picked.error, 'a failed capture must say so');
});

// The reference reads the pixel under the cursor when the drag ends, not when the control is
// clicked: picking at click time would read whatever is under the button itself.
test('the eye dropper reads the pixel where the pick was released', async () => {
  const eyedropperWindow = require('../../plugins/grimlite-parity/features/eyedropper/eyedropper.js');
  let askedFor = null;
  const picker = eyedropperWindow.createEyedropper({
    getCursorPoint: function () {
      throw new Error('the cursor must not be read: the released point decides');
    },
    getDisplayNearestPoint: function (point) {
      askedFor = point;
      return { size: { width: 1, height: 1 }, bounds: { x: 0, y: 0 } };
    },
    captureDisplay: function () {
      return Promise.resolve({
        bitmap: Buffer.from([0x01, 0x02, 0x03, 0xff]),
        size: { width: 1, height: 1 }
      });
    }
  });
  const picked = await picker.pick({ x: 1500, y: 900 });
  assert.deepStrictEqual(askedFor, { x: 1500, y: 900 });
  assert.strictEqual(picked.text, '#FF030201 / 3, 2, 1 / #030201');
});
