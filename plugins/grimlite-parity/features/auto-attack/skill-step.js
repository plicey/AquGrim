(function () {
  var shared = typeof module !== 'undefined' && module.exports
    ? require('./operators.js')
    : window.autoAttackOperators;
  var COMPARATORS = shared.INCLUSIVE;
  var COMPARATOR_LABELS = shared.LABELS;
  var SLOTS = shared.SLOTS;
  var SLOT_LABELS = shared.SLOT_LABELS;
  var SLOT_RANGE = shared.SLOT_RANGE;
  var SLOT_ONE = new RegExp('^' + shared.SLOT_PATTERN + '$');
  var SLOT_LIST = new RegExp('^' + shared.SLOT_PATTERN + '(?:[;,\\s]+' + shared.SLOT_PATTERN +
    ')*[;,\\s]*$');

  function format(skill, condition, comparator, threshold) {
    if (!SLOT_ONE.test(skill)) throw new Error('Choose a skill from ' + SLOT_RANGE + '.');
    if (condition === '') return skill;
    if (condition !== 'SH' && condition !== 'SM') throw new Error('Choose HP or MP.');
    if (COMPARATORS.indexOf(comparator) === -1) throw new Error('Choose a comparison.');
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

  function aura(condition, name, comparator, stacks, text) {
    if (condition !== 'AURA' && condition !== 'TAURA') throw new Error('Choose my aura or the target aura.');
    var clean = String(name === null || name === undefined ? '' : name).trim();
    if (!clean) throw new Error('Enter an aura name.');
    if (/[{};,"\r\n]/.test(clean)) {
      throw new Error('Aura names cannot contain { } ; , " or line breaks.');
    }
    if (COMPARATORS.indexOf(comparator) === -1) throw new Error('Choose a comparison.');
    if (!/^\d+$/.test(String(stacks))) throw new Error('Enter whole stacks of 0 or more.');
    var body = String(text === null || text === undefined ? '' : text).trim() || '1;2';
    if (/[{}]|\b(if|else|cooldown)\b/i.test(body)) throw new Error('Blocks cannot be nested.');
    return 'if ' + (condition === 'TAURA' ? 'target aura ' : 'aura ') + '"' + clean + '"' +
      comparator + Number(stacks) + ' {\n' + body + '\n}';
  }

  function cooldown(text, skill) {
    var skills = text.trim() || skill;
    if (!SLOT_LIST.test(skills)) {
      throw new Error('Select only skills ' + SLOT_RANGE + ' for Cooldown.');
    }
    return 'cooldown { ' + skills.split(/[;,\s]+/).filter(Boolean).join(';') + ' }';
  }

  function wait(duration) {
    if (!/^\d+$/.test(duration) || Number(duration) < 1 || Number(duration) > 60000) {
      throw new Error('Wait must be from 1 to 60000ms.');
    }
    return 'wait ' + Number(duration) + 'ms';
  }

  function spam(skill, duration) {
    return 'spam ' + format(skill, '', '', '') + ' ' + wait(duration).slice(5);
  }

  function spamUntil(skill, condition, comparator, threshold, duration) {
    if (!condition) throw new Error('Choose HP or MP for the stop condition.');
    var predicate = format(skill, condition, comparator, threshold).slice(2);
    return 'spam ' + skill + ' until ' + predicate + ' max ' + wait(duration).slice(5);
  }

  var api = { format: format, insert: insert, block: block, aura: aura, cooldown: cooldown, wait: wait,
    spam: spam, spamUntil: spamUntil, comparators: COMPARATORS, comparatorLabels: COMPARATOR_LABELS,
    slots: SLOTS, slotLabels: SLOT_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.autoAttackStep = api;
})();
