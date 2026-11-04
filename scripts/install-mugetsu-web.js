const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [built, source] = process.argv.slice(2);
if (!built || !source) throw new Error('Usage: node scripts/install-mugetsu-web.js <selfhosted dist> <Mugetsu source>');
const files = fs.readdirSync(built).filter(name => /\.(js|wasm)$/.test(name));
if (!files.includes('ruffle.js') || !files.some(name => name.endsWith('.wasm'))) {
  throw new Error('A complete self-hosted JS/WASM build is required');
}
for (const name of files.filter(name => name.endsWith('.wasm'))) {
  if (!WebAssembly.validate(fs.readFileSync(path.join(built, name)))) throw new Error('Invalid WebAssembly: ' + name);
}
const target = path.join(__dirname, '../res/ruffle');
const stage = path.join(__dirname, '../work/mugetsu-install');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const hashes = {};
for (const name of files) {
  const body = fs.readFileSync(path.join(built, name));
  fs.writeFileSync(path.join(stage, name), body);
  hashes[name] = crypto.createHash('sha256').update(body).digest('hex');
}
const metadata = {
  name: 'Mugetsu Web', version: '1.6.0-aqugrim.2',
  source: 'https://github.com/mugetsu-aqw/mugetsu',
  commit: '49eeabc9bd8743b90827ae988b0c9e0ad9f3ba06',
  ruffleCommit: 'fda41800ba47059dabec662585a388cf4dca8413',
  threading: 'sequential-wasm', files: hashes
};
fs.writeFileSync(path.join(stage, 'engine.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(stage, 'LICENSE_MUGETSU'));
for (const name of fs.readdirSync(built).filter(name => /^LICENSE/.test(name) || /\.LICENSE\.txt$/.test(name))) {
  const license = path.join(built, name);
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(stage, name));
}
// Install only after the entire artifact has been validated; preserve unrelated license files.
for (const name of fs.readdirSync(target).filter(name => /\.(js|wasm)$/.test(name))) fs.unlinkSync(path.join(target, name));
for (const name of fs.readdirSync(stage)) fs.copyFileSync(path.join(stage, name), path.join(target, name));
console.log(metadata.name + ' ' + metadata.version + ' installed (' + files.length + ' engine files)');
