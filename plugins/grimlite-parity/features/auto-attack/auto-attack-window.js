const presets = require('../chrome/skill-presets.js');

function createAutoAttackWindow(deps) {
    deps = deps || {};
    const store = deps.store;

    function source() {
        return presets.createPresetSource({ store: store, files: [] });
    }

    function register(host) {
        host.ipc.handle('autoAttackSkillSetGet', function () {
            return { text: source().rawCustom() };
        });
        host.ipc.handle('autoAttackSkillSetSave', function (event, text) {
            source().setCustom(text);
            return { ok: true, text: source().rawCustom() };
        });
    }

    return { register: register };
}

function createFromHost(host) {
    return createAutoAttackWindow({
        store: host.getStore(presets.STORE_NAMESPACE)
    });
}

module.exports = {
    createAutoAttackWindow: createAutoAttackWindow,
    createFromHost: createFromHost
};
