// The Bots tab's folder tree (#36), over the directory the user chose. Reference:
// Grimoire/UI/BotManager.cs - UpdateTree (the "Number of Bots: N" count is every *.gbot below the
// root), AddTreeNodes (one level at a time: subdirectories first, each with a "Loading..." child,
// then this directory's own *.gbot files), treeBots_AfterExpand (expanding replaces that child),
// treeBots_AfterSelect (selecting a file loads it; ctrl-clicking adds a CmdLoadBot instead),
// btnSavedAdd ("Add folder" creates one under the root) and btnSetBotsDir (a folder dialog).
//
// Every call takes the root, because the reference reads txtSaved.Text for each of them and only
// enumerates direct children - that is what keeps expansion one level at a time.
const fs = require('fs');
const path = require('path');

const LAZY = 'Loading...';
const EXTENSION = '.gbot';

function directories(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(function (entry) { return entry.isDirectory(); })
            .map(function (entry) { return entry.name; })
            .sort();
    } catch (error) {
        // A directory that vanished (or cannot be read) has no children; the tree keeps working.
        return [];
    }
}

function files(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(function (entry) { return entry.isFile() && entry.name.endsWith(EXTENSION); })
            .map(function (entry) { return entry.name; })
            .sort();
    } catch (error) {
        return [];
    }
}

/** One level of the tree: folders (each one level away) then this folder's bots. */
function list(dir) {
    const nodes = directories(dir).map(function (name) {
        return { name: name, type: 'folder', lazy: LAZY };
    });
    return nodes.concat(files(dir).map(function (name) {
        return { name: name, type: 'bot' };
    }));
}

/** The root tree: the same one level, with no parent node to hang it on. */
function roots(dir) {
    return list(dir);
}

/** UpdateTree's count: every *.gbot anywhere below the root. */
function count(dir) {
    let total = 0;
    directories(dir).forEach(function (name) { total += count(path.join(dir, name)); });
    return total + files(dir).length;
}

/** treeBots_AfterSelect: Path.Combine(root, node.FullPath). */
function resolve(root, segments) {
    const parts = Array.isArray(segments) ? segments : String(segments == null ? '' : segments).split(path.sep);
    return path.join.apply(path, [root].concat(parts.filter(function (part) { return part.length; })));
}

function isBot(file) {
    try {
        return fs.statSync(file).isFile() && file.endsWith(EXTENSION);
    } catch (error) {
        return false;
    }
}

/**
 * The ctrl-click branch: a CmdLoadBot pointing at the file, with the path relative to the bots
 * directory (the reference writes "Bots" + the part below the root, because its files sit in a
 * Bots/ folder beside the exe; here the relative path *is* the part below the root).
 */
function loadCommand(root, file) {
    const relative = path.relative(root, file);
    return { BotFileName: path.basename(file), BotFilePath: relative };
}

/** btnSavedAdd: create the named folder under the root, and only if it is missing. */
function addFolder(root, name) {
    const wanted = String(name == null ? '' : name).trim();
    if (!wanted) return null;
    const target = path.join(root, wanted);
    // A name that climbs out of the bots directory is not a folder the tree can show.
    if (path.relative(root, target).split(path.sep)[0] === '..') return null;
    if (fs.existsSync(target)) return null;
    try {
        fs.mkdirSync(target, { recursive: true });
        return target;
    } catch (error) {
        return null;
    }
}

module.exports = {
    list: list,
    roots: roots,
    count: count,
    resolve: resolve,
    isBot: isBot,
    loadCommand: loadCommand,
    addFolder: addFolder,
    LAZY: LAZY,
    EXTENSION: EXTENSION
};
