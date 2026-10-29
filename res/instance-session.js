// Extra AquGrim processes start from a copy of the main instance's data, then run entirely in a
// temporary directory. Settings and login changes disappear with that instance; explicit file
// save dialogs still default to the main data folders.
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTANCE_FLAG = '--aquastar-instance';
const APP_NAME = 'AquGrim';
const LEGACY_APP_NAME = 'AquaStar';
const LEGACY_PREFIX = 'aquastar';
const APP_PREFIX = 'aquagrim';
const SKIP = {
    'Cache': true,
    'Code Cache': true,
    'GPUCache': true,
    'ShaderCache': true,
    'GrShaderCache': true,
    'GraphiteDawnCache': true,
    'Crash Reports': true,
    'Dictionaries': true,
    'blob_storage': true,
    'SingletonLock': true,
    'SingletonCookie': true,
    'SingletonSocket': true,
    'DevToolsActivePort': true,
    'profiles': true,
    'SS': true
};
let current = null;

// Existing installs keep their cookies, settings and stores: move the old folder and the files
// named after it into the AquGrim names. A failed rename leaves the old copy readable.
function migrateLegacyData(root) {
    const target = path.join(root, APP_NAME);
    const legacy = path.join(root, LEGACY_APP_NAME);
    try {
        if (!fs.existsSync(target) && fs.existsSync(legacy)) fs.renameSync(legacy, target);
    } catch (error) {
        console.error('[AquGrim] Could not move ' + legacy + ': ' + error.message);
    }
    let entries;
    try {
        entries = fs.readdirSync(target, { withFileTypes: true });
    } catch (error) {
        return target;
    }
    entries.forEach(function (entry) {
        if (!entry.isFile() || entry.name.toLowerCase().indexOf(LEGACY_PREFIX) !== 0) return;
        const to = path.join(target, APP_PREFIX + entry.name.slice(LEGACY_PREFIX.length));
        if (fs.existsSync(to)) return;
        try {
            fs.renameSync(path.join(target, entry.name), to);
        } catch (error) {
            console.error('[AquGrim] Could not rename ' + entry.name + ': ' + error.message);
        }
    });
    return target;
}

function seedCopy(source, destination) {
    let entries;
    try {
        entries = fs.readdirSync(source, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    entries.forEach(function (entry) {
        if (SKIP[entry.name] || entry.name.indexOf('.org.chromium.Chromium.') === 0) return;
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        try {
            if (entry.isDirectory()) {
                fs.mkdirSync(to, { recursive: true });
                seedCopy(from, to);
            } else if (entry.isFile()) {
                fs.copyFileSync(from, to);
            }
        } catch (error) {
            console.error('[AquGrim] Could not seed instance file ' + from + ': ' + error.message);
        }
    });
}

function configure(app, argv) {
    const persistent = migrateLegacyData(app.getPath('appData'));
    const additional = (argv || []).slice(1).indexOf(INSTANCE_FLAG) !== -1;
    fs.mkdirSync(persistent, { recursive: true });
    const appData = additional
        ? fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-instance-'))
        : persistent;
    if (additional) seedCopy(persistent, appData);
    app.setPath('userData', appData);
    app.aquaStarDataDirectory = appData;
    app.aquaStarPersistentDataDirectory = persistent;
    current = {
        appData: appData,
        userData: appData,
        persistentAppData: persistent,
        additional: additional
    };
    return current;
}

function launch(options) {
    const opts = options || {};
    const spawn = opts.spawn || childProcess.spawn;
    const appImage = opts.appImage || '';
    const executable = appImage || opts.execPath;
    const args = [];
    if (!appImage && opts.defaultApp) args.push(opts.appPath);
    args.push(INSTANCE_FLAG);
    (opts.argv || []).forEach(function (arg) {
        if (arg === '--no-sandbox' && args.indexOf(arg) === -1) args.push(arg);
    });
    const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
    if (child && typeof child.on === 'function') {
        child.on('error', opts.onError || function (error) {
            console.error('[AquGrim] Could not start another instance: ' + error.message);
        });
    }
    if (child && typeof child.unref === 'function') child.unref();
    return { executable: executable, args: args };
}

function cleanup() {
    if (!current || !current.additional) return;
    try {
        if (typeof fs.rmSync === 'function') fs.rmSync(current.userData, { recursive: true, force: true });
        else fs.rmdirSync(current.userData, { recursive: true });
    } catch (error) {
        // Chromium can still hold a file at quit; the OS temp cleaner removes the rest.
    }
    current = null;
}

module.exports = {
    APP_NAME: APP_NAME,
    INSTANCE_FLAG: INSTANCE_FLAG,
    migrateLegacyData: migrateLegacyData,
    cleanup: cleanup,
    configure: configure,
    current: function () { return current; },
    launch: launch
};
