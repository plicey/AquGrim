#!/usr/bin/env node
'use strict';
// AFK probe for ticket #15: drives the running harness's window over the DevTools protocol
// (there is no xdotool here) and reports what the client does after a login attempt with
// deliberately wrong credentials. New file, so the committed harness.js stays as it is.
//
//   node docs/research/local-origin/drive-probe.js --port=9333 [--user=x] [--pass=y]
//
// Needs the harness started with --remote-debugging-port=<port>. Scripted clicks are
// page coordinates in CSS pixels: the username box, the password box, then Login.

const argOf = function (name, dflt) {
    const hit = process.argv.filter(function (a) { return a.indexOf('--' + name + '=') === 0; })[0];
    return hit ? hit.slice(name.length + 3) : dflt;
};
const CDP_PORT = Number(argOf('port', 9333));
const USER = argOf('user', 'aqspikewronguser');
const PASS = argOf('pass', 'wrongpass123');
const SETTLE_MS = Number(argOf('settle', 14000));
const USERNAME_XY = argOf('username-xy', '500,208').split(',').map(Number);
const PASSWORD_XY = argOf('password-xy', '500,258').split(',').map(Number);
const LOGIN_XY = argOf('login-xy', '500,313').split(',').map(Number);

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function findTarget() {
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list');
            const list = await res.json();
            const page = list.filter(function (t) { return t.type === 'page' && t.url.indexOf('wrapper.html') >= 0; })[0];
            if (page) return page;
        } catch (e) { /* not up yet */ }
        await sleep(500);
    }
    throw new Error('no wrapper.html page target on ' + CDP_PORT);
}

function createSession(wsUrl) {
    return new Promise(function (resolve, reject) {
        const ws = new WebSocket(wsUrl);
        const pending = new Map();
        let nextId = 1;
        ws.onopen = function () {
            resolve({
                send: function (method, params) {
                    const id = nextId++;
                    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
                    return new Promise(function (res, rej) {
                        pending.set(id, { res: res, rej: rej });
                        setTimeout(function () {
                            if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); }
                        }, 10000);
                    });
                },
                close: function () { ws.close(); }
            });
        };
        ws.onerror = function (e) { reject(new Error('ws error')); };
        ws.onmessage = function (e) {
            let msg;
            try { msg = JSON.parse(e.data); } catch (err) { return; }
            if (msg.id && pending.has(msg.id)) {
                const p = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
                else p.res(msg.result);
            }
        };
    });
}

async function click(sess, x, y) {
    await sess.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' });
    await sess.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 });
    await sleep(60);
    await sess.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 });
}

async function typeText(sess, text) {
    for (const ch of text) {
        // Virtual key codes are uppercase ASCII for letters; Flash reads the key events,
        // so send the full down/char/up trio the way Chromium does.
        const vk = ch.toUpperCase().charCodeAt(0);
        await sess.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch,
            windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sess.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch,
            windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sess.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch,
            windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sleep(40);
    }
}

async function main() {
    const target = await findTarget();
    console.log('[drive] target ' + target.url.slice(0, 100));
    const sess = await createSession(target.webSocketDebuggerUrl);
    console.log('[drive] settling ' + SETTLE_MS + 'ms so the login screen is up');
    await sleep(SETTLE_MS);

    console.log('[drive] click username @ ' + USERNAME_XY);
    await click(sess, USERNAME_XY[0], USERNAME_XY[1]);
    await typeText(sess, USER);
    await sleep(400);
    console.log('[drive] click password @ ' + PASSWORD_XY);
    await click(sess, PASSWORD_XY[0], PASSWORD_XY[1]);
    await typeText(sess, PASS);
    await sleep(400);
    console.log('[drive] click Login @ ' + LOGIN_XY);
    await click(sess, LOGIN_XY[0], LOGIN_XY[1]);
    console.log('[drive] submitted; watching for 45s');
    await sleep(45000);
    sess.close();
    console.log('[drive] done');
}

main().catch(function (e) { console.error('[drive] FAILED: ' + e.message); process.exit(1); });
