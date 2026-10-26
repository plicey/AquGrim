(function () {
  function format(skill, condition, comparator, threshold) {
    if (!/^[1-4]$/.test(skill)) throw new Error('Choose a skill from 1 to 4.');
    if (condition === '') return skill;
    if (condition !== 'SH' && condition !== 'SM') throw new Error('Choose HP or MP.');
    if (['>=', '<=', '='].indexOf(comparator) === -1) throw new Error('Choose a comparison.');
    if (!/^\d+$/.test(threshold) || Number(threshold) > 100) {
      throw new Error('Enter a whole percentage from 0 to 100.');
    }
    return skill + ':' + condition + comparator + Number(threshold);
  }

  function insert(text, start, end, step) {
    var before = text.slice(0, start);
    var after = text.slice(end);
    // Preserve whitespace while separating a step inserted inside an existing token.
    var prefix = /[^;,\r\n\s][^\S\r\n]*$/.test(before) ? ';' : '';
    var suffix = /^[^\S\r\n]*[^;,\r\n\s]/.test(after) ? ';' : '';
    return { text: before + prefix + step + suffix + after,
      caret: before.length + prefix.length + step.length + suffix.length };
  }

  var api = { format: format, insert: insert };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.autoAttackStep = api;
})();
