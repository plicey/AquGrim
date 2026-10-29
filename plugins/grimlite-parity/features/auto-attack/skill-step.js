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
    if (/^(if\b|cooldown\b)/i.test(step) &&
        (before.match(/\{/g) || []).length !== (before.match(/\}/g) || []).length) {
      throw new Error('Blocks cannot be nested. Select steps outside a block.');
    }
    // Preserve whitespace while separating a step inserted inside an existing token.
    var prefix = /[^;,\r\n\s][^\S\r\n]*$/.test(before) ? ';' : '';
    var suffix = /^[^\S\r\n]*[^;,\r\n\s]/.test(after) ? ';' : '';
    return { text: before + prefix + step + suffix + after,
      caret: before.length + prefix.length + step.length + suffix.length };
  }

  function block(condition, comparator, threshold, text) {
    if (!condition) throw new Error('Choose HP or MP for the block.');
    if (/[{}]|\b(if|else|cooldown)\b/i.test(text)) throw new Error('Blocks cannot be nested.');
    var predicate = format('1', condition, comparator, threshold).slice(2);
    return 'if ' + predicate + ' {\n' + (text.trim() || '1;2') + '\n}';
  }

  function cooldown(text, skill) {
    var skills = text.trim() || skill;
    if (!/^[1-4](?:[;,\s]+[1-4])*[;,\s]*$/.test(skills)) {
      throw new Error('Select only skills 1 to 4 for Cooldown.');
    }
    return 'cooldown { ' + skills.split(/[;,\s]+/).filter(Boolean).join(';') + ' }';
  }

  function wait(duration) {
    if (!/^\d+$/.test(duration) || Number(duration) < 1 || Number(duration) > 60000) {
      throw new Error('Wait must be from 1 to 60000ms.');
    }
    return 'wait ' + Number(duration) + 'ms';
  }

  var api = { format: format, insert: insert, block: block, cooldown: cooldown, wait: wait };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.autoAttackStep = api;
})();
