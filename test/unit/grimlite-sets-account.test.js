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
