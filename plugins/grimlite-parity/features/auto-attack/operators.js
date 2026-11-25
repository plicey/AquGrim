// The condition operators and skill slots shared by the preset parser (main process), the Auto
// Attack editor (renderer) and the runtime comparison. One table each: adding or retiring an
// entry here changes the grammar, the editor's choices and the labels together.
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.autoAttackOperators = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    // The order matters for the parser's regex alternation: the two-character forms first.
    var OPERATORS = {
        '>=': function (actual, expected) { return actual >= expected; },
        '<=': function (actual, expected) { return actual <= expected; },
        '=': function (actual, expected) { return actual === expected; },
        '>': function (actual, expected, strict) { return strict ? actual > expected : actual >= expected; },
        '<': function (actual, expected, strict) { return strict ? actual < expected : actual <= expected; }
    };
    var LIST = Object.keys(OPERATORS);
    // The editor writes the inclusive forms only; strict > and < remain for hand-written text.
    var INCLUSIVE = LIST.filter(function (op) { return op.indexOf('=') !== -1; });
    var LABELS = { '>=': 'At least', '<=': 'At most', '=': 'Exactly' };
    // world.actions.active: 0 is the auto attack, 1-4 the class skills, 5 the equipped potion.
    var SLOTS = ['0', '1', '2', '3', '4', '5'];
    var SLOT_LABELS = {
        '0': 'Basic attack (button 1)',
        '1': 'Skill 1',
        '2': 'Skill 2',
        '3': 'Skill 3',
        '4': 'Skill 4',
        '5': 'Skill 5 (potion)'
    };

    function compare(operator, actual, expected, strict) {
        var check = OPERATORS[operator];
        return check ? check(actual, expected, strict === true) : null;
    }

    return {
        OPERATORS: OPERATORS,
        LIST: LIST,
        INCLUSIVE: INCLUSIVE,
        LABELS: LABELS,
        PATTERN: '(?:' + LIST.join('|') + ')',
        CAPTURE: '(' + LIST.join('|') + ')',
        SLOTS: SLOTS,
        SLOT_LABELS: SLOT_LABELS,
        SLOT_PATTERN: '(?:' + SLOTS.join('|') + ')',
        SLOT_CAPTURE: '(' + SLOTS.join('|') + ')',
        SLOT_RANGE: SLOTS[0] + ' to ' + SLOTS[SLOTS.length - 1],
        compare: compare
    };
});
