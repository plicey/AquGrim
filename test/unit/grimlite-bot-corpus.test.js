// The ticket's corpus claim (#24): every bot in the reference corpus parses, and a bot that
// came through this reader and writer unchanged is still the same file. The corpus is the
// reference clone's own Resources/Bots (60 files); it is not in this repo, so the test skips
// when it is not on the machine, the way the pack check skips without a dist/.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bots = require('../../plugins/grimlite-parity/bot/bots.js');

// Overridable so a maintainer can point it at another checkout.
const CORPUS_ROOTS = [
  process.env.GRIMLITE_CORPUS,
  '/var/tmp/grimlite-src/Resources/Bots',
  '/var/tmp/aq-origin/ref/Grimlite-Li-master/Resources/Bots'
].filter(Boolean);

function corpusRoot() {
  for (let i = 0; i < CORPUS_ROOTS.length; i++) {
    if (fs.existsSync(CORPUS_ROOTS[i])) return CORPUS_ROOTS[i];
  }
  return null;
}

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.toLowerCase().endsWith('.gbot')) out.push(full);
  });
  return out;
}

test('every bot in the reference corpus parses, and re-serialises to the bytes it came from', () => {
  const root = corpusRoot();
  if (!root) {
    console.log('  (skip corpus assert: no reference clone on this machine; ' +
      'set GRIMLITE_CORPUS=/path/to/Resources/Bots to run it)');
    return;
  }

  const files = walk(root, []);
  assert.ok(files.length >= 60, 'expected the full corpus, found ' + files.length);

  const failures = [];
  files.forEach(function (file) {
    const text = fs.readFileSync(file, 'utf8');
    const result = bots.parseBot(text);
    if (!result.ok) {
      failures.push(path.relative(root, file) + ': ' + result.error);
      return;
    }
    // The line ending is the file's own: the corpus is mixed (the reference writes through
    // .NET), so a rewrite that forced one would not be byte-exact for half of it.
    const eol = text.indexOf('\r\n') !== -1 && text.indexOf('\n') === text.indexOf('\r\n') + 1
      ? '\r\n'
      : '\n';
    const rewritten = bots.serializeBot(result.bot, { eol: eol });
    if (rewritten !== text) {
      failures.push(path.relative(root, file) + ': rewrite is not byte-identical');
    }
  });

  assert.deepStrictEqual(failures, [], failures.length + ' of ' + files.length + ' corpus bots failed');
  console.log('  (corpus: ' + files.length + ' bots parsed and re-serialised byte-exact)');
});

test('the corpus covers the shapes the ticket names, so a green run means something', () => {
  const root = corpusRoot();
  if (!root) {
    console.log('  (skip corpus assert: no reference clone on this machine)');
    return;
  }
  const files = walk(root, []);
  const seen = { nested: false, labelSkill: false, safeSkill: false, plainSkill: false, compressed: false,
    dropDelay: false, reloginEvery: false, wrappedList: false };

  files.forEach(function (file) {
    if (path.relative(root, file).split(path.sep).length > 2) seen.nested = true;
    const bot = bots.parseBot(fs.readFileSync(file, 'utf8')).bot;
    (bot.Skills || []).forEach(function (skill) {
      if (skill.Type === 2) seen.labelSkill = true;
      else if (skill.Type === 1) seen.safeSkill = true;
      else if (skill.Type === undefined) seen.plainSkill = true;
    });
    if (typeof bot.Description === 'string' && bots.description(bot) !== bot.Description) seen.compressed = true;
    if (bot.DropDelay !== undefined) seen.dropDelay = true;
    if (bot.ReloginEvery !== undefined) seen.reloginEvery = true;
    if (Object.prototype.hasOwnProperty.call(bot, 'Commands')) seen.wrappedList = true;
  });

  Object.keys(seen).forEach(function (shape) {
    assert.strictEqual(seen[shape], true, 'the corpus no longer covers: ' + shape);
  });
});
