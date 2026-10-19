// Run the test suite behind hard limits so a runaway test cannot take the machine down.
// The limits are deliberately generous for this suite (about 140 MB peak) but low enough that
// Node aborts before the host OOMs.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const entry = path.join(root, 'test/run.js');
const heapMb = Number(process.env.AQUASTAR_TEST_HEAP_MB || 512);
const vmemKb = Number(process.env.AQUASTAR_TEST_VMEM_MB || 2000) * 1024;
const timeoutMs = Number(process.env.AQUASTAR_TEST_TIMEOUT_MS || 120000);
const nodeArgs = ['--max-old-space-size=' + heapMb, entry];

console.log('test: heap ' + heapMb + ' MB, vmem ' + Math.round(vmemKb / 1024) +
  ' MB, timeout ' + Math.round(timeoutMs / 1000) + 's');

const child = process.platform === 'linux'
  ? spawn('bash', ['-c', 'ulimit -v "$1" 2>/dev/null || true; shift; exec "$@"',
    'aquastar-test', String(vmemKb), process.execPath].concat(nodeArgs), {
    cwd: root,
    stdio: 'inherit'
  })
  : spawn(process.execPath, nodeArgs, { cwd: root, stdio: 'inherit' });

const timer = setTimeout(function () {
  console.error('test: timed out after ' + timeoutMs + ' ms; killing the runner');
  child.kill('SIGKILL');
}, timeoutMs);

child.on('error', function (error) {
  clearTimeout(timer);
  console.error('test: could not start the runner: ' + (error && error.message ? error.message : error));
  process.exit(1);
});

child.on('exit', function (code, signal) {
  clearTimeout(timer);
  if (signal) {
    console.error('test: runner ended by signal ' + signal +
      ' (memory limit or timeout reached)');
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
