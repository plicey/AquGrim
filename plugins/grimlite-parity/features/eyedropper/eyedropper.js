// Eye Dropper window - the capture and the readout. The reference (Grimoire/UI/EyeDropper.cs)
// uses a WinForms eyedropper control that snapshots the screen while the mouse is down; Electron
// has no such control, so the equivalent is: where is the cursor, which display is it on, and
// what is that display showing at the moment of the click.
const colour = require('./colour.js');

// Electron is reached at call time, not at activation: outside the app process require('electron')
// resolves to the npm shim, whose members are not the APIs.
function electronApi() {
    const electron = require('electron');
    return electron && electron.screen ? electron : null;
}

/** One thumbnail of the display, as { bitmap, size } - or null when the capture failed. */
async function captureDisplay(display) {
    try {
        const electron = electronApi();
        if (!electron) return null;
        const sources = await electron.desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: display.size.width, height: display.size.height }
        });
        const match = sources.filter(function (source) {
            return String(source.display_id) === String(display.id);
        })[0] || sources[0];
        if (!match || match.thumbnail.isEmpty()) return null;
        const size = match.thumbnail.getSize();
        return { bitmap: match.thumbnail.toBitmap(), size: size };
    } catch (error) {
        return null;
    }
}

/**
 * @param {object} [deps] all optional; production uses Electron's screen/desktopCapturer
 */
function createEyedropper(deps) {
    deps = deps || {};
    const getCursorPoint = deps.getCursorPoint || function () {
        const electron = electronApi();
        return electron ? electron.screen.getCursorScreenPoint() : { x: 0, y: 0 };
    };
    const getDisplayNearestPoint = deps.getDisplayNearestPoint || function (point) {
        const electron = electronApi();
        return electron ? electron.screen.getDisplayNearestPoint(point) : null;
    };
    const capture = deps.captureDisplay || captureDisplay;
    const getMessages = deps.getMessages || function () { return {}; };

    /**
     * Read the pixel at `point`. The page hands the point in: the reference captures while the
     * mouse is held down, so the position that counts is where the pick was made, not where the
     * cursor happens to be when the request reaches the main process.
     */
    async function pick(point) {
        point = point && typeof point.x === 'number' ? point : getCursorPoint();
        const display = getDisplayNearestPoint(point);
        if (!display) {
            return { colour: null, text: '', textColour: '#ffffff', cssColour: '', error: getMessages().captureFailed || 'Could not read the screen.' };
        }
        const captured = await capture(display);
        if (!captured) {
            return { colour: null, text: '', textColour: '#ffffff', cssColour: '', error: getMessages().captureFailed || 'Could not read the screen.' };
        }
        const at = colour.imagePoint(captured.size, display, point);
        const pixel = colour.readPixel(captured.bitmap, captured.size.width, at.x, at.y);
        return {
            colour: pixel,
            text: colour.formatColour(pixel),
            textColour: colour.readoutTextColour(pixel),
            cssColour: colour.cssColour(pixel),
            preview: colour.previewPixels(captured.bitmap, captured.size, at),
            error: null
        };
    }

    return {
        pick: pick,
        register: function (host) {
            host.ipc.handle('eyedropperMessages', function () {
                return getMessages();
            });
            host.ipc.handle('eyedropperPick', function (event, point) {
                return pick(point);
            });
        }
    };
}

module.exports = { createEyedropper: createEyedropper, captureDisplay: captureDisplay };
