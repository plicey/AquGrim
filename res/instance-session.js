// Extra AquGrim processes start from a copy of the main instance's data, then run entirely in a
// temporary directory. Settings and login changes disappear with that instance; explicit file
// save dialogs still default to the main data folders.
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTANCE_FLAG = '--aquastar-instance';
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
            console.error('[AquaStar] Could not seed instance file ' + from + ': ' + error.message);
        }
    });
}

function configure(app, argv) {
    const persistent = path.join(app.getPath('appData'), 'AquaStar');
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
            console.error('[AquaStar] Could not start another instance: ' + error.message);
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
    INSTANCE_FLAG: INSTANCE_FLAG,
    cleanup: cleanup,
    configure: configure,
    current: function () { return current; },
    launch: launch
};
