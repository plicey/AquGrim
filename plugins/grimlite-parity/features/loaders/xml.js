// The grabber tree as XML, both directions. Reference: Grimlite-Li 816d9cd,
// Grimoire/UI/Loaders.cs:156-212 - SaveNodes writes the TreeView with an XmlTextWriter over
// Encoding.ASCII in Formatting.Indented, node text in a t attribute and node.Tag in tg.
//
// The padding is the reference's own oddity and is kept as it is: a text carrying a colon has the
// part before the first colon padded out to nine columns, and everything after the *second* colon
// is dropped, because the reference writes Split(':')[1] - one field and no more.
//
// Pure: text in, text out. Nothing here opens a dialog or touches a file.
const DECLARATION = '<?xml version="1.0" encoding="us-ascii"?>';
const ROOT = 'TreeView';

const ERRORS = {
    notXml: 'This file is not a TreeView XML export from the grabbers.'
};

/** The reference's "9 > Split(':')[0].Length" padding, with Split(':')[1] as the second field. */
function padText(text) {
    const value = String(text == null ? '' : text);
    const parts = value.split(':');
    // No colon at all is the writer's own catch branch: the text goes out untouched.
    if (parts.length < 2) return value;
    let padding = '';
    for (let times = parts[0].length; times < 9; times++) padding += ' ';
    return parts[0] + ':' + padding + parts[1];
}

/** XmlTextWriter escapes an attribute value, tabs and line ends included. */
function escapeAttribute(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\t/g, '&#x9;')
        .replace(/\r/g, '&#xD;')
        .replace(/\n/g, '&#xA;');
}

function unescapeAttribute(text) {
    return String(text == null ? '' : text)
        .replace(/&#x([0-9A-Fa-f]+);/g, function (all, hex) {
            return String.fromCharCode(parseInt(hex, 16));
        })
        .replace(/&#([0-9]+);/g, function (all, digits) {
            return String.fromCharCode(parseInt(digits, 10));
        })
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function attributes(node) {
    const parts = [' t="' + escapeAttribute(padText(node && node.text)) + '"'];
    if (node && node.tag !== undefined && node.tag !== null) {
        parts.push(' tg="' + escapeAttribute(String(node.tag)) + '"');
    }
    return parts.join('');
}

function writeNode(node, level, out) {
    const indent = '  '.repeat(level);
    const children = (node && node.children) || [];
    if (!children.length) {
        out.push(indent + '<n' + attributes(node) + ' />');
        return;
    }
    out.push(indent + '<n' + attributes(node) + '>');
    children.forEach(function (child) { writeNode(child, level + 1, out); });
    out.push(indent + '</n>');
}

/** The document btnSave_Click writes, XmlTextWriter's own line endings included. */
function toXml(rows) {
    const out = [DECLARATION, '', '<' + ROOT + '>'];
    (Array.isArray(rows) ? rows : []).forEach(function (row) { writeNode(row, 1, out); });
    out.push('</' + ROOT + '>');
    return out.join('\r\n') + '\r\n';
}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttributes(source) {
    const found = {};
    let match;
    ATTRIBUTE.lastIndex = 0;
    while ((match = ATTRIBUTE.exec(source)) !== null) {
        found[match[1]] = unescapeAttribute(match[2] === undefined ? match[3] : match[2]);
    }
    return found;
}

/**
 * Read a document this window wrote - or the reference wrote, which is the same shape. A file
 * that is not a TreeView export, or one that stops halfway, is refused rather than half-read:
 * the tree a user is about to act on must be the tree the file holds.
 */
function fromXml(text) {
    const source = String(text == null ? '' : text);
    if (!/^\s*<\?xml\b/.test(source) || source.indexOf('<' + ROOT) === -1) {
        throw new Error(ERRORS.notXml);
    }

    const body = source.replace(/^\s*<\?xml[^>]*\?>/, '');
    const stack = [];
    let rows = null;
    let index = 0;
    let match;

    TAG.lastIndex = 0;
    while ((match = TAG.exec(body)) !== null) {
        // Anything that is not whitespace between two tags is content this format never writes.
        if (body.slice(index, match.index).trim() !== '') throw new Error(ERRORS.notXml);
        index = TAG.lastIndex;

        const closing = match[1] === '/';
        const name = match[2];
        const selfClosed = match[4] === '/';

        if (closing) {
            const open = stack.pop();
            if (!open || open.name !== name) throw new Error(ERRORS.notXml);
            if (name === ROOT && rows === null) rows = open.node ? open.node.children : [];
            continue;
        }

        const found = readAttributes(match[3] || '');
        if (name === ROOT) {
            if (stack.length || rows !== null) throw new Error(ERRORS.notXml);
            stack.push({ name: ROOT, node: null });
            rows = [];
            if (selfClosed) stack.pop();
            continue;
        }
        if (name !== 'n' || !stack.length) throw new Error(ERRORS.notXml);

        const parent = stack[stack.length - 1];
        const list = parent.node ? parent.node.children : rows;
        if (!list) throw new Error(ERRORS.notXml);
        const node = { text: found.t === undefined ? '' : found.t, children: [] };
        if (found.tg !== undefined) node.tag = found.tg;
        list.push(node);
        if (!selfClosed) stack.push({ name: 'n', node: node });
    }

    if (body.slice(index).trim() !== '' || stack.length || rows === null) {
        throw new Error(ERRORS.notXml);
    }
    return rows;
}

module.exports = {
    DECLARATION: DECLARATION,
    ROOT: ROOT,
    ERRORS: ERRORS,
    padText: padText,
    toXml: toXml,
    fromXml: fromXml
};
