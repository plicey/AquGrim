const assert = require('assert');
const path = require('path');
const { createSetDialogs, createAccountSource } = require('../../plugins/grimlite-parity/features/sets/set-dialogs');

test('account libraries use encoded case-insensitive live identity and fail closed', async () => {
    let name = '../Alice';
    let logged = true;
    const account = createAccountSource({ botGame: () => ({
        helper: async () => logged, call: async () => name
    }) });
    const key = await account();
    name = '../ALICE';
    assert.strictEqual(await account(), key);
    name = '.._Alice';
    assert.notStrictEqual(await account(), key);
    assert.match(key, /^[0-9a-f]+$/);
    logged = false;
    assert.strictEqual(await account(), null);
});

test('account paths reject stale same-name tokens and pending saves after switching', async () => {
    let key = '61';
    let finish;
    const writes = [];
    const directories = [];
    const dialogs = createSetDialogs({ account: async () => key, defaultDirectory: '/persistent/Sets',
        listSets: directory => { directories.push(directory); return [{ name: 'farm.gset', path: 'farm.gset' }]; },
        readText: () => '{"Set":[]}', writeText: file => writes.push(file),
        showSaveDialog: () => new Promise(resolve => { finish = resolve; }),
        showOpenDialog: async () => ({ filePaths: ['/legacy/farm.gset'] }) });
    const token = (await dialogs.list())[0].path;
    assert.strictEqual(directories[0], path.join('/persistent/Sets', 'accounts', '61'));
    key = '62';
    await assert.rejects(dialogs.openByPath(token), /Account changed/);
    await dialogs.bindAccount();
    const pending = dialogs.save([]);
    await new Promise(resolve => setImmediate(resolve));
    key = '61';
    finish({ filePath: '/persistent/Sets/accounts/62/farm.gset' });
    await assert.rejects(pending, /Account changed/);
    assert.deepStrictEqual(writes, []);
    await assert.rejects(dialogs.save([]), /Account changed/);
    key = null;
    await assert.rejects(dialogs.list(), /Log in/);
    await assert.rejects(dialogs.save([]), /Log in/);
    assert.strictEqual((await dialogs.open()).error, null);
});

test('set snapshot and equip retain their starting account across asynchronous game reads', async () => {
    const { createSetsWindow } = require('../../plugins/grimlite-parity/features/sets/sets-window');
    let key = '61';
    let saved = false;
    const equipped = [];
    const game = {
        readInventory: async () => {
            key = '62';
            return [{ name: 'Sword', category: 'Sword', isEquipped: true }];
        },
        sleep: async () => {}, equipItem: async name => { equipped.push(name); }
    };
    const window = createSetsWindow({ account: async () => key, game,
        dialogs: { save: async () => { saved = true; } } });
    const snapshot = await window.handle('saveEquippedSet');
    assert.match(snapshot.error, /Account changed/);
    assert.strictEqual(saved, false);
    key = '61';
    game.readInventory = async () => {
        key = '62';
        return [{ name: 'Sword', category: 'Sword', isEquipped: false }];
    };
    const equip = await window.handle('equipSet', null, [[{ name: 'Sword', type: 'Weapon' }]]);
    assert.match(equip.error, /Account changed/);
    assert.deepStrictEqual(equipped, []);
});

test('loading or saving an external set adds it to the current account quick-select library', async () => {
    const fs = require('fs');
    const os = require('os');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-set-library-'));
    try {
        let key = '61';
        const external = path.join(directory, 'farm.gset');
        fs.writeFileSync(external, '{"Set":[]}');
        const dialogs = createSetDialogs({ account: async () => key,
            defaultDirectory: path.join(directory, 'Sets'),
            showOpenDialog: async () => ({ filePaths: [external] }),
            showSaveDialog: async () => ({ filePath: external }) });
        await dialogs.open();
        const listed = await dialogs.list();
        assert.strictEqual(listed.length, 1, 'loaded external set is offered by quick select');
        assert.deepStrictEqual((await dialogs.openByPath(listed[0].path)).entries, []);
        await dialogs.open();
        assert.strictEqual((await dialogs.list()).length, 1, 'reopening does not duplicate a set');
        const entries = [{ type: 'Weapon', name: 'Sword' }];
        await dialogs.save(entries, true);
        const updated = await dialogs.list();
        assert.strictEqual(updated.length, 2, 'different contents with the same name keep both sets');
        assert.deepStrictEqual((await dialogs.openByPath(listed[0].path)).entries, []);
        const documents = await Promise.all(updated.map(entry => dialogs.openByPath(entry.path)));
        assert.ok(documents.some(document => document.entries.some(entry => entry.name === 'Sword')));
        key = '62';
        assert.deepStrictEqual(await dialogs.list(), [], 'other accounts do not inherit the set');
        assert.ok(fs.existsSync(external), 'the original file is preserved');
    } finally {
        fs.rmdirSync(directory, { recursive: true });
    }
});

test('native set dialogs start in an existing account folder on the first save or load', async () => {
    const fs = require('fs');
    const os = require('os');
    const { createFromHost } = require('../../plugins/grimlite-parity/features/sets/set-dialogs');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-set-default-'));
    let key = '61';
    const asked = [];
    const check = (options, saving) => {
        const folder = saving ? path.dirname(options.defaultPath) : options.defaultPath;
        assert.strictEqual(folder, path.join(directory, 'Sets', 'accounts', key));
        assert.ok(fs.statSync(folder).isDirectory(), 'account folder exists before the native dialog opens');
        asked.push(folder);
        return { canceled: true };
    };
    try {
        const dialogs = createFromHost({ persistentAppDataDirectory: directory, getStore: () => null }, {
            account: async () => key,
            electron: { dialog: {
                showSaveDialog: async (owner, options) => check(options, true),
                showOpenDialog: async (owner, options) => check(options, false)
            } }
        });
        await dialogs.save([], true);
        key = '62';
        await dialogs.open();
        assert.strictEqual(asked.length, 2);
    } finally { fs.rmdirSync(directory, { recursive: true }); }
});
