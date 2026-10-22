const presets = require('../chrome/skill-presets.js');

function payload(value) {
    return value && typeof value === 'object' ? value : {};
}

function createAutoAttackWindow(deps) {
    deps = deps || {};
    const source = deps.presets || presets.createPresetSource({ store: deps.store, files: [] });
    const className = typeof deps.className === 'function' ? deps.className : function () { return ''; };
    const onUse = typeof deps.onUse === 'function' ? deps.onUse : function () {};

    function detectedClass() {
        return Promise.resolve().then(function () { return className(); })
            .then(function (value) { return String(value === null || value === undefined ? '' : value).trim(); })
            .catch(function () { return ''; });
    }

    function snapshot(name) {
        return Promise.resolve(name === undefined ? detectedClass() : name).then(function (wanted) {
            const current = String(wanted === null || wanted === undefined ? '' : wanted).trim();
            const draft = source.draftFor(current);
            const list = source.presetList(current).map(function (one) {
                return { name: one.name, stored: one.stored };
            });
            return {
                className: current,
                presets: list,
                selected: draft ? draft.name : null,
                text: draft ? draft.text : ''
            };
        });
    }

    function register(host) {
        host.ipc.handle('autoAttackSkillSetGet', function () {
            source.reload();
            return snapshot();
        });

        host.ipc.handle('autoAttackSkillSetDraft', function (event, data) {
            const args = payload(data);
            source.setDraft(args.className, args.text, args.name);
            return snapshot(args.className);
        });

        host.ipc.handle('autoAttackPresetLoad', function (event, data) {
            const args = payload(data);
            const loaded = source.loadPreset(args.className, args.name);
            if (!loaded) return { ok: false, error: 'that preset no longer exists' };
            onUse(loaded.text);
            return snapshot(args.className).then(function (state) {
                return Object.assign({ ok: true, error: null }, state);
            });
        });

        host.ipc.handle('autoAttackPresetSave', function (event, data) {
            const args = payload(data);
            try {
                source.savePreset(args.className, args.name, args.text);
                return snapshot(args.className).then(function (state) {
                    return Object.assign({ ok: true, error: null }, state);
                });
            } catch (error) {
                return { ok: false, error: (error && error.message) || String(error) };
            }
        });

        host.ipc.handle('autoAttackPresetDelete', function (event, data) {
            const args = payload(data);
            try {
                source.deletePreset(args.className, args.name);
                return snapshot(args.className).then(function (state) {
                    return Object.assign({ ok: true, error: null }, state);
                });
            } catch (error) {
                return { ok: false, error: (error && error.message) || String(error) };
            }
        });

        host.ipc.handle('autoAttackSkillSetDefault', function (event, data) {
            const args = payload(data);
            source.clearDraft(args.className);
            onUse('');
            return snapshot(args.className).then(function (state) {
                return Object.assign({ ok: true, error: null }, state);
            });
        });

        host.ipc.handle('autoAttackSkillSetUseDraft', function (event, data) {
            const args = payload(data);
            const draft = source.setDraft(args.className, args.text, null);
            onUse(draft ? draft.text : '');
            return snapshot(args.className).then(function (state) {
                return Object.assign({ ok: true, error: null }, state);
            });
        });
    }

    return { register: register };
}

function createFromHost(host, deps) {
    deps = deps || {};
    return createAutoAttackWindow({
        store: host.getStore(presets.STORE_NAMESPACE),
        presets: deps.presets,
        className: deps.className,
        onUse: deps.onUse
    });
}

module.exports = {
    createAutoAttackWindow: createAutoAttackWindow,
    createFromHost: createFromHost
};
