// Named profiles let separate AquGrim processes sign into different game accounts. Electron's
// cookies and Flash shared objects live under userData, so each profile moves that path while
// settings and bot files stay in the shared appData directory.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_PROFILE = 'default';
let current = null;

function normalize(value) {
    const input = String(value == null ? '' : value).trim();
    if (!input) throw new Error('Instance name cannot be empty.');
    if (/[\\/]/.test(input)) throw new Error('Instance name cannot contain slashes.');
    if (input.toLowerCase() === DEFAULT_PROFILE) return DEFAULT_PROFILE;
    const name = input.toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 48);
    if (!name) throw new Error('Instance name must contain a letter or number.');
    return name;
}

function fromArgs(argv, env) {
    let requested = null;
    (argv || []).slice(1).forEach(function (arg, index, args) {
        if (arg === '--profile') {
            const value = args[index + 1];
            if (!value || String(value).charAt(0) === '-') {
                throw new Error('--profile needs an instance name.');
            }
            requested = value;
        } else if (arg.indexOf('--profile=') === 0) {
            requested = arg.slice('--profile='.length);
        }
    });
    if (requested === null && env && env.AQUASTAR_PROFILE) {
        requested = env.AQUASTAR_PROFILE;
    }
    return requested === null ? DEFAULT_PROFILE : normalize(requested);
}

function userDataDirectory(appData, name) {
    return name === DEFAULT_PROFILE
        ? appData
        : path.join(appData, 'profiles', name);
}

function configure(app, argv, env) {
    const appData = path.join(app.getPath('appData'), 'AquaStar');
    const name = fromArgs(argv, env);
    const userData = userDataDirectory(appData, name);
    fs.mkdirSync(userData, { recursive: true });
    app.setPath('userData', userData);
    current = { name: name, appData: appData, userData: userData, isDefault: name === DEFAULT_PROFILE };
    return current;
}

function createNext(appData) {
    const directory = path.join(appData, 'profiles');
    fs.mkdirSync(directory, { recursive: true });
    const used = new Set(fs.readdirSync(directory));
    let number = 2;
    while (used.has('account-' + number)) number++;
    const name = 'account-' + number;
    fs.mkdirSync(path.join(directory, name), { recursive: true });
    return name;
}

function launch(name, options) {
    const profile = normalize(name);
    const opts = options || {};
    const spawn = opts.spawn || childProcess.spawn;
    const appImage = opts.appImage || '';
    const executable = appImage || opts.execPath;
    const args = [];
    if (!appImage && opts.defaultApp) args.push(opts.appPath);
    args.push('--profile=' + profile);
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

module.exports = {
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    configure: configure,
    createNext: createNext,
    current: function () { return current; },
    fromArgs: fromArgs,
    launch: launch,
    normalize: normalize,
    userDataDirectory: userDataDirectory
};
