const assert = require('assert');
const vm = require('vm');

function method(source, name, args) {
  const start = source.indexOf('{', source.indexOf('function ' + name + '('));
  assert.ok(start >= 0, name);
  let end = start + 1, depth = 1;
  while (depth) { const c = source[end++]; if (c === '{') depth++; if (c === '}') depth--; }
  const body = source.slice(start + 1, end - 1)
    .replace(/\b(var\s+\w+):(?:\*|\w+)/g, '$1')
    .replace(/\s+as MovieClip/g, '')
    .replace(/catch\s*\((\w+):Error\)/g, 'catch($1)')
    .replace(/MovieClip\(parent\)/g, 'this.parent');
  return vm.runInNewContext('(function(' + (args || '') + '){with(this){' + body + '}})', {
    trace() {}, Loader: value => value, Boolean, getQualifiedClassName: () => 'Game',
    Event: { ENTER_FRAME: 'frame', INIT: 'init', COMPLETE: 'complete' },
    TimerEvent: { TIMER: 'timer' }, ProgressEvent: { PROGRESS: 'progress' },
    IOErrorEvent: { IO_ERROR: 'io' }, SecurityErrorEvent: { SECURITY_ERROR: 'security' }
  });
}

module.exports = method;
