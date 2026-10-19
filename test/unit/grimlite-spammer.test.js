// The packet spammer (spec #19 / ticket #27). Reference: Grimoire/UI/PacketSpammer.cs and
// Grimoire/Tools/Spammer.cs at 816d9cd. Every expected value below is read off that C# source:
// the XML file shape, the delay spinner's bounds, the button words, and the send loop's order.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const spammer = require('../../plugins/grimlite-parity/features/packets/spammer.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-spammer');

// A stand-in for host.packets.send: it records the direction and text of every frame, so the
// loop's behaviour is observable without a relay.
function wire(options) {
  const opts = options || {};
  const sent = [];
  return {
    sent: sent,
    send: function (frame) {
      sent.push(frame.direction + ' ' + frame.text);
      return opts.accept === false ? false : true;
    }
  };
}

// Pacing is injected, so a test drives the loop rather than waiting on it.
function clock() {
  const waits = [];
  let release = null;
  return {
    waits: waits,
    sleep: function (ms) {
      waits.push(ms);
      return new Promise(function (resolve) { release = resolve; });
    },
    // Let the loop run to its next wait, then stop it where it stands.
    tick: function () {
      const resolve = release;
      release = null;
      if (resolve) resolve();
      return new Promise(function (done) { setImmediate(done); });
    }
  };
}

test('the spammer file is the reference\'s own XML shape, and reads one authored elsewhere', () => {
  const elsewhere = fs.readFileSync(path.join(FIXTURES, 'elsewhere.xml'), 'utf8');
  const loaded = spammer.parseFile(elsewhere);

  assert.strictEqual(loaded.ok, true, loaded.error);
  // PacketSpammer.LoadConfig walks the root's own child nodes (XElement.Load(...).Nodes()), so a
  // packet nested inside another element is not a list entry, and a comment is not a packet.
  assert.deepStrictEqual(loaded.packets, [
    '%xt%zm%aggroMon%1%2%3%',
    '%xt%zm%gar%1%2%w%',
    "<msg t='sys'>A & B</msg>"
  ], 'the packet list is the root\'s own <packet> children, entities decoded');
  // <spamspeed> is the delay this port reads (the reference's own reader has a defect here: it
  // assigns item.Name - the literal "spamspeed" - to a string and then tests it for digits, so
  // every load resets the spinner to its 2000 fallback. The file's value is plainly the delay).
  assert.strictEqual(loaded.delay, 750);

  // A file the reference wrote. XmlWriter.Create(file) with WriteStartDocument never called:
  // no declaration, no indentation (Indent is off by default), one line, UTF-8 with its BOM.
  const written = spammer.serializeFile({ packets: ['%xt%zm%gar%1%2%w%', "<msg t='sys'>A & B</msg>"], delay: 1000 });
  assert.strictEqual(written.charAt(0), '\uFEFF', 'the reference writes UTF-8 with its BOM');
  assert.strictEqual(written.indexOf('<?xml'), -1, 'WriteStartDocument is never called');
  assert.strictEqual(written.indexOf('\n'), -1, 'XmlWriter indents nothing by default');
  assert.ok(/^\uFEFF<autoer><packet>[^<]*<\/packet><packet>/.test(written), JSON.stringify(written));
  assert.ok(written.indexOf('<author>Author</author>') !== -1,
    'the reference always writes its <author> placeholder: ' + JSON.stringify(written));
  assert.ok(/<spamspeed>1000<\/spamspeed><\/autoer>$/.test(written), JSON.stringify(written));
  // A packet is text in the file, so what XML must escape is escaped and nothing else changes.
  assert.ok(written.indexOf('&lt;msg') !== -1 && written.indexOf('&amp; B') !== -1,
    'a packet carrying markup stays readable XML: ' + JSON.stringify(written));
  // And it round-trips: what this port writes, it reads back, packets and delay intact.
  const again = spammer.parseFile(written);
  assert.strictEqual(again.ok, true, again.error);
  assert.deepStrictEqual(again.packets, ['%xt%zm%gar%1%2%w%', "<msg t='sys'>A & B</msg>"]);
  assert.strictEqual(again.delay, 1000);
});

// LoadConfig reads with XElement.Load, which takes any well-formed document: the root's name is
// not part of what it reads, and what it walks is that root's own children.
test('any well-formed root loads: its own <packet> children are the list', () => {
  const elsewhere = spammer.parseFile(
    '<spammer><packet>%xt%zm%gar%1%2%w%</packet><rules>' +
    '<packet>%xt%zm%nested%</packet></rules><spamspeed>250</spamspeed></spammer>');
  assert.strictEqual(elsewhere.ok, true, elsewhere.error);
  assert.deepStrictEqual(elsewhere.packets, ['%xt%zm%gar%1%2%w%'],
    'a list under another root loads, and an element nested deeper is still not a list entry');
  assert.strictEqual(elsewhere.delay, 250, 'and <spamspeed> is read wherever the root puts it');

  // The writer's own root still reads back, and a root whose children are not packets is an empty
  // list rather than an error - the reference adds nothing for an element it does not recognise.
  const written = spammer.serializeFile({ packets: ['%xt%zm%one%'], delay: 1000 });
  assert.deepStrictEqual(spammer.parseFile(written).packets, ['%xt%zm%one%']);
  const nothing = spammer.parseFile('<anything><other>text</other></anything>');
  assert.strictEqual(nothing.ok, true, nothing.error);
  assert.deepStrictEqual(nothing.packets, []);
  assert.strictEqual(nothing.delay, spammer.FALLBACK_DELAY_MS);
});

test('the spammer file reports a file it cannot read instead of an empty list', () => {
  const notXml = spammer.parseFile('<autoer><packet>unterminated');
  assert.strictEqual(notXml.ok, false);
  assert.deepStrictEqual(notXml.packets, [], 'a file that will not read is never a half-read list');
  assert.ok(/xml|read/i.test(notXml.error), notXml.error);

  // A file with no spamspeed at all: the reference's own fallback (2000) applies to the delay
  // only; the packets it does carry are still the list.
  const noSpeed = spammer.parseFile('<autoer><packet>%xt%zm%gar%1%2%w%</packet></autoer>');
  assert.strictEqual(noSpeed.ok, true, noSpeed.error);
  assert.deepStrictEqual(noSpeed.packets, ['%xt%zm%gar%1%2%w%']);
  assert.strictEqual(noSpeed.delay, spammer.FALLBACK_DELAY_MS);

  // A spamspeed that is not a number falls back the same way, never to NaN.
  const badSpeed = spammer.parseFile('<autoer><spamspeed>soon</spamspeed></autoer>');
  assert.strictEqual(badSpeed.delay, spammer.FALLBACK_DELAY_MS);
});

test('the spinner keeps the reference\'s own bounds, and the file keeps them too', () => {
  // DarkNumericUpDown numDelay: Minimum 100, Maximum 61000, Value 1000, Increment 10.
  assert.strictEqual(spammer.DELAY_MIN_MS, 100);
  assert.strictEqual(spammer.DELAY_MAX_MS, 61000);
  assert.strictEqual(spammer.DELAY_DEFAULT_MS, 1000);
  assert.strictEqual(spammer.FALLBACK_DELAY_MS, 2000);

  // The loop is what carries the bounds: a delay outside them is clamped, never used raw.
  assert.strictEqual(spammer.clampDelay(1), 100);
  assert.strictEqual(spammer.clampDelay(999999), 61000);
  assert.strictEqual(spammer.clampDelay('250'), 250);
  // LoadConfig's own fallback for a spamspeed that is not all digits: 2000.
  assert.strictEqual(spammer.clampDelay('nothing'), spammer.FALLBACK_DELAY_MS);

  // The sniffer's embedded block has its own spinner (PacketLogger.numSpamDelay: 0..2000), so a
  // loop built for it paces with those bounds, not the Spammer window's 100..61000.
  const waits = [];
  const sniffer = spammer.createSpammer({
    send: function () { return true; },
    sleep: function (ms) { waits.push(ms); return new Promise(function () {}); },
    minDelay: 0,
    maxDelay: 2000
  });
  sniffer.start(['a'], 0);
  assert.deepStrictEqual(waits, [0], '0 ms is a real delay for the sniffer block');
  sniffer.start(['a'], 99999);
  assert.deepStrictEqual(waits, [0, 2000], 'and its own maximum holds');
  sniffer.stop();
});

test('the spammer sends chosen packets in order, at the delay, and stops on demand', async () => {
  const link = wire();
  const time = clock();
  const indexes = [];
  const spam = spammer.createSpammer({
    send: link.send,
    sleep: time.sleep,
    onIndex: function (index) { indexes.push(index); }
  });

  assert.strictEqual(spam.running(), false);
  spam.start(['a', 'b', 'c'], 250);
  assert.strictEqual(spam.running(), true);

  // Spammer.Spam sends packet[index] first and only then waits, so a Start is one frame at once.
  assert.deepStrictEqual(link.sent, ['toServer a']);
  await time.tick();
  assert.deepStrictEqual(link.sent, ['toServer a', 'toServer b']);
  await time.tick();
  assert.deepStrictEqual(link.sent, ['toServer a', 'toServer b', 'toServer c']);
  await time.tick();
  // The list wraps rather than ending: `if (index >= _packets.Count) index = 0;`.
  assert.deepStrictEqual(link.sent, ['toServer a', 'toServer b', 'toServer c', 'toServer a']);
  assert.deepStrictEqual(time.waits, [250, 250, 250, 250], 'the delay is the configured one');
  // IndexChanged fires before each send, so the window highlights the row being sent.
  assert.deepStrictEqual(indexes, [0, 1, 2, 0]);

  spam.stop();
  assert.strictEqual(spam.running(), false);
  await time.tick();
  assert.strictEqual(link.sent.length, 4, 'Stop ends the loop: nothing is sent after it');

  // Starting again after a Stop runs the list from its first entry, like the reference's loop.
  spam.start(['x'], 250);
  assert.deepStrictEqual(link.sent.slice(-1), ['toServer x']);
  spam.stop();
});

test('the spammer never sends an empty list, and a refused write is reported not hidden', async () => {
  const link = wire({ accept: false });
  const time = clock();
  const spam = spammer.createSpammer({ send: link.send, sleep: time.sleep });

  spam.start([], 250);
  assert.strictEqual(spam.running(), false, 'nothing to send is not a running spammer');
  assert.deepStrictEqual(link.sent, []);

  // A frame the relay would not take is still attempted the next time round (the client may be
  // between connections), and the count of unwritten frames is the window's to report.
  spam.start(['a'], 250);
  assert.deepStrictEqual(link.sent, ['toServer a']);
  assert.strictEqual(spam.sentCount(), 0, 'a refused write is not a sent frame');
  assert.strictEqual(spam.failedCount(), 1);
  spam.stop();
});

test('send once writes exactly one frame, from the box the reference sends from', () => {
  const link = wire();
  const spam = spammer.createSpammer({ send: link.send, sleep: function () { return Promise.resolve(); } });

  // PacketSpammer.btnSend_Click: "if (txtPacket.TextLength > 0)" - an empty box sends nothing.
  assert.strictEqual(spam.sendOnce(''), false);
  assert.deepStrictEqual(link.sent, []);

  assert.strictEqual(spam.sendOnce('%xt%zm%gar%1%2%w%'), true);
  assert.deepStrictEqual(link.sent, ['toServer %xt%zm%gar%1%2%w%']);
  assert.strictEqual(spam.running(), false, 'send once does not start the loop');

  // And it is the server side, the only side the reference\'s Send once writes to.
  const refused = wire({ accept: false });
  const offline = spammer.createSpammer({ send: refused.send, sleep: function () {} });
  assert.strictEqual(offline.sendOnce('%xt%zm%gar%1%2%w%'), false,
    'a frame with no connection to write on is refused, not queued');
});
