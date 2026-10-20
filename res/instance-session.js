// Extra AquGrim processes share one app-data configuration. Chromium still needs a private
// userData directory per process so each open account has separate cookies and Flash state;
// that session lives in the OS temp directory and carries no profile name or saved config.
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTANCE_FLAG = '--aquastar-instance';
let current = null;

function configure(app, argv) {
    const appData = path.join(app.getPath('appData'), 'AquaStar');
    const additional = (argv || []).slice(1).indexOf(INSTANCE_FLAG) !== -1;
    fs.mkdirSync(appData, { recursive: true });
    const userData = additional
        ? fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-instance-'))
        : appData;
    app.setPath('userData', userData);
    current = { appData: appData, userData: userData, additional: additional };
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
