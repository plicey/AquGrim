// The packet tamperer (spec #19 / ticket #27). Reference: Grimoire/UI/PacketTamperer.cs at
// 816d9cd. Every expected value below is read off that C# source: the two capture switches and
// what each hooks, the filter, the two send buttons, the Clear button and the append shape.
const assert = require('assert');

const tamperer = require('../../plugins/grimlite-parity/features/packets/tamperer.js');

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

// The capture the window is wired to, in the shape host.packets.on hands a frame over.
function frame(direction, text) {
  return { id: 1, direction: direction, data: Buffer.from(text, 'utf8') };
}

test('each capture switch gates its own direction, and neither gates the other', () => {
  const link = wire();
  const capture = tamperer.createCapture({ send: link.send });

  // Both boxes start unticked: the reference hooks nothing until one is ticked
  // (chkFromServer_CheckedChanged / chkFromClient_CheckedChanged).
  capture.accept(frame('toServer', '%xt%zm%from-client%'));
  capture.accept(frame('toClient', "<msg t='sys'>from-server</msg>"));
  assert.deepStrictEqual(capture.lines(), [], 'nothing is captured with both switches off');

  capture.setCaptureFromClient(true);
  capture.accept(frame('toServer', '%xt%zm%from-client%'));
  capture.accept(frame('toClient', "<msg t='sys'>from-server</msg>"));
  assert.deepStrictEqual(capture.lines(), ['From client: %xt%zm%from-client%'],
    'the client switch shows client traffic and nothing else');

  capture.setCaptureFromClient(false);
  capture.setCaptureFromServer(true);
  capture.accept(frame('toServer', '%xt%zm%second-client%'));
  capture.accept(frame('toClient', "<msg t='sys'>second-server</msg>"));
  assert.deepStrictEqual(capture.lines(), [
    'From client: %xt%zm%from-client%',
    'From server: <msg t=\'sys\'>second-server</msg>'
  ], 'the server switch shows server traffic and nothing else');

  capture.setCaptureFromServer(false);
  capture.accept(frame('toServer', '%xt%zm%hidden-again%'));
  assert.strictEqual(capture.lines().length, 2,
    'turning both switches off stops capture without clearing what was captured');
});

test('the filter selects what is drawn and never what is kept', () => {
  const capture = tamperer.createCapture({ send: wire().send });
  capture.setCaptureFromClient(true);
  capture.setCaptureFromServer(true);

  capture.accept(frame('toServer', '%xt%zm%MoveToCell%yulgar-1%'));
  capture.accept(frame('toServer', '%xt%zm%gar%1%2%w%'));
  capture.accept(frame('toClient', "<msg t='sys'><body action='apiOK'/></msg>"));
  assert.strictEqual(capture.lines().length, 3, 'everything captured is drawn with no filter');

  // PacketTamperer: `packet.IndexOf(tbFilter.Text, StringComparison.OrdinalIgnoreCase) >= 0`.
  capture.setFilter('movetocell');
  assert.deepStrictEqual(capture.lines(), ['From client: %xt%zm%MoveToCell%yulgar-1%'],
    'the filter is case-insensitive, like the reference\'s');

  capture.setFilter('  apiok  ');
  assert.deepStrictEqual(capture.lines(), ['From server: <msg t=\'sys\'><body action=\'apiOK\'/></msg>'],
    'surrounding whitespace is not part of the filter');

  capture.setFilter('nothing-matches-this');
  assert.deepStrictEqual(capture.lines(), []);
  // Widening it again shows what was there all along: the filter is a view.
  capture.setFilter('');
  assert.strictEqual(capture.lines().length, 3, 'the filter loses no frame');
});

// The reference prints one captured packet per line, then a blank line
// (`txtReceive.AppendText(text + Environment.NewLine + Environment.NewLine)`).
test('a capture is appended in the reference\'s own two-line shape', () => {
  const capture = tamperer.createCapture({ send: wire().send });
  capture.setCaptureFromClient(true);
  capture.accept(frame('toServer', '%xt%zm%one%'));
  capture.accept(frame('toServer', '%xt%zm%two%'));
  assert.strictEqual(capture.text(), 'From client: %xt%zm%one%\n\nFrom client: %xt%zm%two%\n\n',
    'each line stands alone, with the reference\'s own blank line after it');

  // Clear empties what has been captured (`btnClear_Click`), and the capture switches stay put.
  capture.clear();
  assert.strictEqual(capture.text(), '');
  assert.strictEqual(capture.captureFromClient(), true, 'Clear does not untick a switch');
  capture.accept(frame('toServer', '%xt%zm%three%'));
  assert.strictEqual(capture.text(), 'From client: %xt%zm%three%\n\n', 'capture continues after Clear');
});

test('the two send actions write the edited frame to their own side', () => {
  const link = wire();
  const capture = tamperer.createCapture({ send: link.send });

  // btnToServer_Click / btnToClient_Click: `if (!string.IsNullOrEmpty(txtSend.Text))`.
  assert.strictEqual(capture.sendToServer(''), false);
  assert.strictEqual(capture.sendToClient(''), false);
  assert.deepStrictEqual(link.sent, [], 'an empty box sends nothing on either side');

  assert.strictEqual(capture.sendToServer('%xt%zm%edited-to-server%'), true);
  assert.strictEqual(capture.sendToClient("<msg t='sys'>edited-to-client</msg>"), true);
  assert.deepStrictEqual(link.sent, [
    'toServer %xt%zm%edited-to-server%',
    'toClient <msg t=\'sys\'>edited-to-client</msg>'
  ], 'each button writes its own side, and only its own');

  // A frame the relay will not take is refused to the window, never queued silently.
  const refused = tamperer.createCapture({ send: wire({ accept: false }).send });
  assert.strictEqual(refused.sendToServer('%xt%zm%nowhere%'), false);
  assert.strictEqual(refused.sendToClient('%xt%zm%nowhere%'), false);
});

test('the window is the reference\'s own controls, word for word', () => {
  // PacketTamperer.Designer.cs at 816d9cd: the two checkboxes, the filter label, the two send
  // buttons and Clear, with the rich boxes above.
  assert.deepStrictEqual(tamperer.LABELS, {
    title: 'Packet Tamperer',
    captureFromClient: 'Capture from client',
    captureFromServer: 'Capture from server',
    filterByText: 'Filter by text',
    sendToServer: 'Send to server',
    sendToClient: 'Send to client',
    clear: 'Clear',
    fromClient: 'From client',
    fromServer: 'From server'
  });
  // The reference's own two prefixes (FlashUtil_FlashCallClient / _FlashCallServer).
  assert.strictEqual(tamperer.linePrefix('toServer'), 'From client: ');
  assert.strictEqual(tamperer.linePrefix('toClient'), 'From server: ');
});
