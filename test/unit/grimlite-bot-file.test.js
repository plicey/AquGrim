// The .gbot reader and writer (spec #19, ticket #24). The format is Newtonsoft.Json with
// TypeNameHandling.All: every object carries a $type, every list is a $type/$values wrapper,
// enums are integers because no StringEnumConverter is registered, and a key absent from the
// file means "the C# default of that property".
//
// Fixtures are hand-made and small. Expected values are from the reference C# at 816d9cd
// (Grimoire/Botting/Configuration.cs and the command classes), never from the code under test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bots = require('../../plugins/grimlite-parity/bot/bots.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-bots');

function fixtureText(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function parsedFixture(name) {
  const result = bots.parseBot(fixtureText(name));
  assert.strictEqual(result.ok, true, name + ': ' + result.error);
  return result.bot;
}

const IBOT_LIST = 'System.Collections.Generic.List`1[[Grimoire.Botting.IBotCommand, Grimoire]], mscorlib';

test('the bot reader parses every fixture, unwraps the list wrappers and keeps unknown keys', () => {
  const plain = parsedFixture('plain.gbot');
  assert.strictEqual(plain.Commands.length, 3);
  assert.strictEqual(plain.Skills.length, 2);
  assert.strictEqual(plain.Quests.length, 0);
  assert.strictEqual(plain.Commands[1].$type, 'Grimoire.Botting.Commands.Map.CmdJoin, Grimoire');

  // all three Skill.SkillType values; the absent one is Normal (0)
  const sets = parsedFixture('skill-sets.gbot');
  assert.deepStrictEqual(sets.Skills.map(function (s) { return s.Type === undefined ? 0 : s.Type; }), [2, 0, 0, 1]);
  assert.strictEqual(sets.Quests.length, 4);

  // legacy keys current Grimlite drops, and a key no build ever had
  const legacy = parsedFixture('legacy-keys.gbot');
  assert.strictEqual(legacy.DropDelay, 250);
  assert.strictEqual(legacy.ReloginEvery, 600);
  assert.deepStrictEqual(legacy.SomethingNobodyKnows, { nested: [1, 2, 3] });

  // a nested folder, and the command beside the gzipped description
  const nested = parsedFixture('nested/compressed-description.gbot');
  assert.strictEqual(nested.Commands.length, 1);
});

test('a byte-order mark and a trailing newline do not make a bot unreadable', () => {
  const text = fixtureText('plain.gbot');
  const withBom = '\uFEFF' + text;
  assert.strictEqual(bots.parseBot(withBom).ok, true);
  assert.strictEqual(bots.parseBot(text + '\n').ok, true);
  assert.strictEqual(bots.parseBot(text + '\r\n').bot.Commands.length, 3);
});

test('an unreadable bot is an error the user can act on, not a silent empty bot', () => {
  const notJson = bots.parseBot('{ "Commands": ');
  assert.strictEqual(notJson.ok, false);
  assert.strictEqual(notJson.error, bots.ERRORS.parse);
  assert.strictEqual(notJson.bot, null);

  // JSON, but not a bot: a bare array is not a Configuration
  assert.deepStrictEqual(bots.parseBot('[1, 2, 3]'), { ok: false, error: bots.ERRORS.parse, bot: null });
  assert.deepStrictEqual(bots.parseBot('null'), { ok: false, error: bots.ERRORS.parse, bot: null });
  // a Configuration with no Commands list is an empty bot, not an error: the reference reads
  // it with MissingMemberHandling.Ignore
  assert.deepStrictEqual(bots.parseBot('{}'), { ok: true, error: null, bot: {} });
});

test('a bot round-trips byte-exact: nothing is added, dropped or reordered by a load-then-save', () => {
  ['plain.gbot', 'skill-sets.gbot', 'legacy-keys.gbot', 'always-write.gbot',
    'nested/compressed-description.gbot'].forEach(function (name) {
    const text = fixtureText(name);
    assert.strictEqual(bots.serializeBot(parsedFixture(name)), text, name + ' did not survive a round trip');
  });
});

test('re-serialising preserves whichever line ending the file came in with', () => {
  const text = fixtureText('plain.gbot');
  const crlf = fixtureText('plain.gbot').split('\n').join('\r\n');
  assert.strictEqual(bots.serializeBot(bots.parseBot(text).bot, { eol: '\r\n' }), crlf);
  assert.strictEqual(bots.serializeBot(bots.parseBot(text).bot), text);
  // UTF-8, no BOM, no trailing newline - what File.WriteAllText produces
  assert.strictEqual(bots.serializeBot(bots.parseBot(text).bot, { eol: '\r\n' }).indexOf('\uFEFF'), -1);
  assert.strictEqual(crlf.charAt(crlf.indexOf('\n') - 1), '\r', 'every break is CRLF');
  assert.strictEqual(/[^\r]\n/.test(crlf), false, 'no lone LF left behind');
  assert.strictEqual(text.slice(-1), '}');
});

test('enums stay zero-based integers and $type strings stay byte-exact', () => {
  const text = bots.serializeBot(parsedFixture('skill-sets.gbot'));
  // not "2" and not "Label": the reference registers no StringEnumConverter
  assert.ok(/"Type": 2/.test(text), 'Skill.Type must serialise as an integer');
  assert.ok(/"Type": 1/.test(text), 'Safe skills too');
  assert.ok(text.indexOf('"$type": "Grimoire.Game.Data.Skill, Grimoire"') !== -1);
  assert.ok(text.indexOf('"$type": "' + IBOT_LIST + '"') !== -1);
  assert.ok(text.indexOf('"$type": "Grimoire.Botting.Configuration, Grimoire"') !== -1);
});

test('the fields the reference forces with DefaultValueHandling.Include survive a round trip', () => {
  // always-write.gbot was written the way the reference's own SaveConfiguration writes these
  // commands: the [JsonProperty(DefaultValueHandling = Include)] members are present even at
  // their default value, and a load-then-save must give them back unchanged.
  const text = fixtureText('always-write.gbot');
  assert.ok(text.indexOf('"ghostAccept": false') !== -1, 'CmdAcceptQuest.ghostAccept');
  assert.ok(text.indexOf('"ReAccept": true') !== -1, 'CmdCompleteQuest.ReAccept');
  assert.ok(text.indexOf('"PassDropList": true') !== -1, 'CmdLoadBot.PassDropList');
  assert.ok(text.indexOf('"PassSkillPreset": false') !== -1, 'CmdLoadBot.PassSkillPreset');
  assert.strictEqual(bots.serializeBot(parsedFixture('always-write.gbot')), text);
});

test('every command the reference forces a default on is listed, so a new one is written right', () => {
  // The seven C# [JsonProperty(DefaultValueHandling = Include)] command members at 816d9cd and
  // nothing else - an eighth would change the format and must fail here.
  assert.deepStrictEqual(bots.WRITE_ALWAYS, {
    'Grimoire.Botting.Commands.Item.CmdSell, Grimoire': { Qty: '1' },
    'Grimoire.Botting.Commands.Map.CmdMoveToCell2, Grimoire': { stop: false, maxcell: 5 },
    'Grimoire.Botting.Commands.Misc.CmdLoadBot, Grimoire': { PassDropList: true, PassSkillPreset: false },
    'Grimoire.Botting.Commands.Quest.CmdAcceptQuest, Grimoire': { ghostAccept: false },
    'Grimoire.Botting.Commands.Quest.CmdCompleteQuest, Grimoire': { ReAccept: false }
  });

  // a command the author builds is emitted with them, and reads back with the author's values
  const accept = bots.newCommand('Grimoire.Botting.Commands.Quest.CmdAcceptQuest, Grimoire', {
    Quest: { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 8912 }
  });
  assert.deepStrictEqual(accept, {
    $type: 'Grimoire.Botting.Commands.Quest.CmdAcceptQuest, Grimoire',
    Quest: { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 8912 },
    ghostAccept: false
  });
  const text = bots.serializeBot({ Commands: bots.wrapList('Commands', [accept]) });
  assert.ok(text.indexOf('"ghostAccept": false') !== -1, text);
  // a command with no forced member is passed through as the author built it
  assert.deepStrictEqual(
    bots.newCommand('Grimoire.Botting.Commands.Misc.CmdLabel, Grimoire', { Name: 'START' }),
    { $type: 'Grimoire.Botting.Commands.Misc.CmdLabel, Grimoire', Name: 'START' }
  );
});

test('the reader reconstructs the omitted defaults, both non-zero initialisers included', () => {
  const plain = parsedFixture('plain.gbot');
  // The document keeps the keys the file had and gains none: defaults are a read-time view
  // (Grimoire's own C# initialisers), never something a load-then-save writes back.
  assert.strictEqual(plain.optionDelay, undefined);
  assert.strictEqual(plain.HidePlayers, undefined);

  const config = bots.configuration(plain);
  assert.strictEqual(config.SkillDelay, 150); // C# initialiser, not 0
  assert.strictEqual(config.optionDelay, 500); // C# initialiser, not 0
  assert.strictEqual(config.WalkSpeed, 20); // present in the file, so the file wins
  assert.strictEqual(config.EnablePickup, false);
  assert.strictEqual(config.RestartUponDeath, false);
  assert.strictEqual(config.Author, '');
  assert.strictEqual(config.Server, null);
  assert.strictEqual(config.FollowName, null);
  assert.deepStrictEqual(config.Boosts, []);
  assert.deepStrictEqual(config.NotifyUponDrop, []);
  assert.deepStrictEqual(config.Commands, plain.Commands);

  const bare = bots.configuration({});
  assert.strictEqual(bare.SkillDelay, 150);
  assert.strictEqual(bare.optionDelay, 500);
  assert.strictEqual(bare.RelogDelay, 0);
  assert.strictEqual(bare.RestMp, 0);
  assert.strictEqual(bare.WaitForAllSkills, false);
});

test('the omitted defaults never overwrite a key the file actually carried', () => {
  const doc = parsedFixture('plain.gbot');
  const text = bots.serializeBot(doc);
  assert.strictEqual(text, fixtureText('plain.gbot'));
  assert.strictEqual(text.indexOf('optionDelay'), -1, 'a load-then-save must not write a default back');
  assert.strictEqual(JSON.parse(text).WalkSpeed, 20);
});

test('a gzipped description is read as its text and written back untouched', () => {
  const doc = parsedFixture('nested/compressed-description.gbot');
  // The stored value is base64+gzip; a save must not re-encode it.
  assert.strictEqual(/^H4sI/.test(doc.Description), true, 'fixture must stay compressed on disk');
  const text = bots.description(doc);
  assert.strictEqual(text.slice(0, 5), '{\\rtf');
  assert.ok(text.indexOf('Join ultradarkon-9099') !== -1, text.slice(0, 60));
  // plain text comes back as itself
  assert.strictEqual(bots.description(parsedFixture('legacy-keys.gbot')), 'Written by an older build.');
  assert.strictEqual(bots.description({}), '');
  assert.strictEqual(bots.description({ Description: null }), '');
});

test('a hand-built bot serialises in the reference dialect and reads back', () => {
  const bot = {
    $type: bots.CONFIGURATION_TYPE,
    Commands: bots.wrapList('Commands', [
      { $type: 'Grimoire.Botting.Commands.Map.CmdJoin, Grimoire', Map: 'yulgar-1', Cell: 'Enter', Pad: 'Spawn', Try: 1 }
    ]),
    Skills: bots.wrapList('Skills', []),
    Quests: bots.wrapList('Quests', []),
    Author: '',
    Description: '',
    Boosts: bots.wrapList('Boosts', []),
    Drops: bots.wrapList('Drops', [])
  };
  const text = bots.serializeBot(bot);
  // two-space indentation, like the reference (Newtonsoft Formatting.Indented)
  assert.strictEqual(text.split('\n')[1].slice(0, 2), '  ');
  assert.strictEqual(text.split('\n')[1].slice(2, 3) !== ' ', true, 'exactly two spaces, not three');
  assert.strictEqual(text.indexOf('\t'), -1);
  const round = bots.parseBot(text);
  assert.strictEqual(round.ok, true, round.error);
  assert.strictEqual(round.bot.Commands.length, 1);
  assert.strictEqual(round.bot.Commands[0].Map, 'yulgar-1');
  assert.strictEqual(round.bot.Commands[0].Try, 1);
  assert.strictEqual(round.bot.$type, 'Grimoire.Botting.Configuration, Grimoire');
  assert.ok(text.indexOf('"$values"') !== -1);
});
