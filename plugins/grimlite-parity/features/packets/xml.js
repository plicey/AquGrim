// The smallest XML reader the spammer and the tamperer files need, because Node has no XML parser
// and this repo adds no dependency for one (spec #19's stack). It is not a general parser: it
// walks one document, tracks nesting, decodes the five named entities plus numeric ones, and
// ignores comments, processing instructions and CDATA markers. Anything malformed is an error the
// caller reports, never a half-read document.
//
// The reference reads these files with System.Xml.Linq (XElement.Load), so the two behaviours
// that matter here are its own: an element's value is its whole text content, and a lookup by
// name finds a direct child, never a descendant.

const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
};

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (match, body) {
        if (body.charAt(0) === '#') {
            const code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            return isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
    });
}

function escapeText(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Parse one document into {name, children, text} where text is the element's whole text content,
 * in document order, including text that follows a child element (XElement.Value does exactly
 * that). Returns null when the document is not well formed enough to walk.
 */
function parse(source) {
    const text = String(source == null ? '' : source).replace(/^\uFEFF/, '');
    const root = { name: '#document', children: [], text: '' };
    const stack = [root];
    let i = 0;

    function top() { return stack[stack.length - 1]; }
    // Entity references are decoded the way an XML parser hands text over; CDATA is already
    // literal, so it is appended as it stands.
    function addText(value) {
        if (!value) return;
        top().text += decodeEntities(value);
    }

    while (i < text.length) {
        const open = text.indexOf('<', i);
        if (open === -1) { addText(text.slice(i)); break; }
        addText(text.slice(i, open));
        i = open;

        if (text.startsWith('<!--', i)) {
            const end = text.indexOf('-->', i + 4);
            if (end === -1) return null;
            i = end + 3;
            continue;
        }
        if (text.startsWith('<![CDATA[', i)) {
            const end = text.indexOf(']]>', i + 9);
            if (end === -1) return null;
            // CDATA is literal text: an element's value carries it undecoded.
            top().text += text.slice(i + 9, end);
            i = end + 3;
            continue;
        }
        if (text.startsWith('<?', i) || text.startsWith('<!', i)) {
            const end = text.indexOf('>', i);
            if (end === -1) return null;
            i = end + 1;
            continue;
        }
        const close = text.indexOf('>', i);
        if (close === -1) return null;
        const body = text.slice(i + 1, close);
        i = close + 1;

        if (body.charAt(0) === '/') {
            const name = body.slice(1).trim();
            if (stack.length < 2 || top().name !== name) return null;
            stack.pop();
            continue;
        }

        const selfClosing = body.charAt(body.length - 1) === '/';
        const inner = selfClosing ? body.slice(0, -1) : body;
        const nameMatch = inner.match(/^\s*([^\s/>]+)/);
        if (!nameMatch) return null;
        const element = {
            name: nameMatch[1],
            children: [],
            text: ''
        };
        top().children.push(element);
        if (!selfClosing) stack.push(element);
    }

    if (stack.length !== 1) return null;   // an element left open is not a document
    const found = root.children.filter(function (child) { return child.name !== '#document'; });
    return found.length ? root : null;
}

/** The first direct child with this name, or null. XElement.Element() looks at children only. */
function child(element, name) {
    if (!element) return null;
    for (let i = 0; i < element.children.length; i++) {
        if (element.children[i].name === name) return element.children[i];
    }
    return null;
}

function childrenNamed(element, name) {
    if (!element) return [];
    return element.children.filter(function (child_) { return child_.name === name; });
}

module.exports = {
    parse: parse,
    child: child,
    childrenNamed: childrenNamed,
    decodeEntities: decodeEntities,
    escapeText: escapeText
};
