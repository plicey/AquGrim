const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const guard = path.resolve(__dirname, '../../res/stdio.js');

function run(closedStream, guarded, otherError) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      ${guarded ? `require(${JSON.stringify(guard)});` : ''}
      process.on('message', () => {
        ${otherError ? "process.stdout.emit('error', Object.assign(new Error('unexpected I/O failure'), {code:'EIO'}));" : `process.${closedStream}.write('startup log\\n');`}
        setTimeout(() => process.exit(0), 50);
      });
      process.send('ready');
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    child.once('error', reject);
    child.once('message', () => {
      if (closedStream) child[closedStream].destroy();
      child.send('write');
    });
    child.once('exit', code => resolve({ code, errors }));
  });
}

test('startup survives a launcher closing either output pipe', async () => {
  const baseline = await run('stdout', false);
  assert.notStrictEqual(baseline.code, 0, 'the unguarded broken pipe reproduces the crash');
  assert.match(baseline.errors, /EPIPE/, 'reproduce the exact reported error');
  for (const stream of ['stdout', 'stderr']) {
    assert.strictEqual((await run(stream, true)).code, 0, stream + ' EPIPE must not crash the app');
  }
});

test('stdio guard preserves failures other than broken output pipes', async () => {
  const result = await run(null, true, true);
  assert.notStrictEqual(result.code, 0);
  assert.match(result.errors, /unexpected I\/O failure/);
});
