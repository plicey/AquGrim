// The bot file window's main-process half (#24): open, see, edit, save back. The Bot Manager
// (#36) grows the real editor over this; today the window shows the document as text, which is
// enough to prove a bot makes the round trip through the app.
//
// A bot is a user document, so nothing here picks a path: every read and write goes through the
// dialogs in bot/bot-dialogs.js, which are the user's own file dialogs.
const bots = require('../../bot/bots.js');
const { createFromHost } = require('../../bot/bot-dialogs.js');

function createBotFileFeature(host, deps) {
    deps = deps || {};
    const dialogs = deps.dialogs || createFromHost(host, deps);

    function handle(channel, event, args) {
        void event;
        if (channel === 'openBot') {
            return dialogs.open(null).then(function (result) {
                if (result.canceled) return { canceled: true };
                return {
                    canceled: false,
                    path: result.path,
                    // The window edits the file's own text, so a save writes back what it read.
                    text: result.bot ? bots.serializeBot(result.bot) : null,
                    error: result.error || null
                };
            });
        }
        if (channel === 'saveBot') {
            const text = args && args[0];
            const parsed = bots.parseBot(text);
            if (!parsed.ok) {
                // Refused before the dialog: an unreadable document must not overwrite a file.
                return Promise.resolve({ canceled: false, path: null, error: parsed.error });
            }
            return dialogs.save(null, parsed.bot, { path: (args && args[1]) || null });
        }
        if (channel === 'getBotFileMessages') {
            return Promise.resolve(host.getLocaleStrings('botFileMessages') || {});
        }
        throw new Error('[AquGrim:grimlite-parity] unknown bot file channel "' + channel + '"');
    }

    function attach() {
        host.ipc.handle('openBot', function (event, path) {
            void path;
            return handle('openBot', event, [null]);
        });
        host.ipc.handle('saveBot', function (event, text, path) {
            return handle('saveBot', event, [text, path]);
        });
        host.ipc.handle('getBotFileMessages', function (event) {
            return handle('getBotFileMessages', event, []);
        });
    }

    return { handle: handle, attach: attach };
}

module.exports = {
    createBotFileFeature: createBotFileFeature
};
