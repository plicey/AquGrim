// The condition operators shared by the preset parser (main process), the Auto Attack editor
// (renderer) and the runtime comparison. One table: adding or retiring an operator here changes
// the grammar, the editor's choices and the labels together.
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
        compare: compare
    };
});
