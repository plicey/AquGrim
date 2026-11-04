const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('Mugetsu installer validates WASM before replacing stock files and records provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugetsu-install-'));
  try {
    for (const dir of ['scripts', 'built', 'source', 'res/ruffle']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../../scripts/install-mugetsu-web.js'), path.join(root, 'scripts/install.js'));
    const target = path.join(root, 'res/ruffle');
    fs.writeFileSync(path.join(target, 'old.js'), 'stock');
    fs.writeFileSync(path.join(root, 'built/ruffle.js'), 'custom engine');
    fs.writeFileSync(path.join(root, 'built/core.wasm'), 'invalid');
    fs.writeFileSync(path.join(root, 'source/LICENSE'), 'license');
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/install.js'), path.join(root, 'built'), path.join(root, 'source')]);
    assert.notStrictEqual(run().status, 0);
    assert.strictEqual(fs.readFileSync(path.join(target, 'old.js'), 'utf8'), 'stock');
    fs.writeFileSync(path.join(root, 'built/core.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    const result = run();
    assert.strictEqual(result.status, 0, result.stderr.toString());
    assert.ok(!fs.existsSync(path.join(target, 'old.js')));
    const marker = JSON.parse(fs.readFileSync(path.join(target, 'engine.json'), 'utf8'));
    assert.strictEqual(marker.name, 'Mugetsu Web');
    assert.strictEqual(marker.files['core.wasm'].length, 64);
    assert.strictEqual(fs.readFileSync(path.join(target, 'LICENSE_MUGETSU'), 'utf8'), 'license');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shipped Mugetsu engine files match the pinned build manifest', () => {
  const crypto = require('crypto');
  const directory = path.join(__dirname, '../../res/ruffle');
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'engine.json'), 'utf8'));
  assert.strictEqual(metadata.name, 'Mugetsu Web');
  assert.strictEqual(metadata.commit, '49eeabc9bd8743b90827ae988b0c9e0ad9f3ba06');
  assert.ok(metadata.files['ruffle.js']);
  assert.ok(Object.keys(metadata.files).some(name => name.endsWith('.wasm')));
  for (const [name, expected] of Object.entries(metadata.files)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
    assert.strictEqual(hash, expected, name);
  }
});
