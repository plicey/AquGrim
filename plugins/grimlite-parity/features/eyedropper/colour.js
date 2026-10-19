// The Eye Dropper's colour maths, kept apart from the window so it can be checked without a
// screen. Reference: Grimlite-Li Grimoire/UI/EyeDropper.cs (+ .Designer.cs for the layout).

function hex2(value) {
    return Math.round(Number(value) || 0)
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
}

/**
 * One readout line, exactly as EyeDropper.cs builds it:
 * `#<AARRGGBB> / <r>, <g>, <b> / #<RRGGBB>`.
 * @param {{r: number, g: number, b: number, a: number}} colour 0-255 channels
 */
function formatColour(colour) {
    const c = colour || {};
    const argb = hex2(c.a) + hex2(c.r) + hex2(c.g) + hex2(c.b);
    return '#' + argb + ' / ' + [c.r, c.g, c.b].map(function (v) { return Math.round(Number(v) || 0); }).join(', ') +
        ' / #' + argb.slice(2);
}

/** The same colour as a CSS hex string, for painting the readout swatch. */
function cssColour(colour) {
    const c = colour || {};
    return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
}

/**
 * Text colour for the readout box: Color.GetBrightness() > 0.7 means black text. GetBrightness
 * is HSL lightness, (max + min) / 2, scaled to 0-1.
 */
function readoutTextColour(colour) {
    const c = colour || {};
    const channels = [c.r, c.g, c.b].map(function (v) { return Number(v) || 0; });
    const brightness = (Math.max.apply(null, channels) + Math.min.apply(null, channels)) / 2 / 255;
    return brightness > 0.7 ? '#000000' : '#ffffff';
}

/**
 * Map a cursor position (DIP, in the display's own coordinates) onto the captured image.
 * The thumbnail can be any scale, so each axis is fitted independently and clamped inside.
 */
function imagePoint(imageSize, display, point) {
    const size = (display && display.size) || { width: 1, height: 1 };
    const origin = (display && display.bounds) || { x: 0, y: 0 };
    const width = Math.max(1, Number(imageSize && imageSize.width) || 1);
    const height = Math.max(1, Number(imageSize && imageSize.height) || 1);
    const scaleX = width / Math.max(1, Number(size.width) || 1);
    const scaleY = height / Math.max(1, Number(size.height) || 1);
    const clamp = function (value, max) { return Math.min(max, Math.max(0, Math.round(value))); };
    return {
        x: clamp(((Number(point.x) || 0) - (Number(origin.x) || 0)) * scaleX, width - 1),
        y: clamp(((Number(point.y) || 0) - (Number(origin.y) || 0)) * scaleY, height - 1)
    };
}

/**
 * Read one pixel out of a nativeImage bitmap, whose bytes are BGRA on every platform Electron
 * supports. `buffer` is `toBitmap()`: 4 bytes a pixel, rows top to bottom.
 */
function readPixel(buffer, width, x, y) {
    const offset = (Math.max(0, Math.round(y)) * Math.max(1, Math.round(width)) + Math.max(0, Math.round(x))) * 4;
    return {
        b: buffer[offset],
        g: buffer[offset + 1],
        r: buffer[offset + 2],
        a: buffer[offset + 3]
    };
}

// The reference's eyedropper control draws a magnified preview around the cursor: a 150x150
// square at 15x, which is the 10x10 source pixels this returns. The page scales each one up.
const PREVIEW_SIZE = 150;
const PREVIEW_ZOOM = 15;
const PREVIEW_SOURCE = PREVIEW_SIZE / PREVIEW_ZOOM;

/** The 10x10 block of source pixels around a point, as flat RGBA bytes. */
function previewPixels(buffer, imageSize, at, sourceSize) {
    const span = Math.max(1, Math.round(Number(sourceSize) || PREVIEW_SOURCE));
    const half = Math.floor(span / 2);
    const width = Math.max(1, Number(imageSize && imageSize.width) || 1);
    const height = Math.max(1, Number(imageSize && imageSize.height) || 1);
    const clamp = function (value, max) { return Math.min(max, Math.max(0, Math.round(value))); };
    const data = [];
    for (let y = 0; y < span; y++) {
        for (let x = 0; x < span; x++) {
            const pixel = readPixel(buffer, width,
                clamp((Number(at && at.x) || 0) - half + x, width - 1),
                clamp((Number(at && at.y) || 0) - half + y, height - 1));
            data.push(pixel.r, pixel.g, pixel.b, pixel.a === undefined ? 255 : pixel.a);
        }
    }
    return { width: span, height: span, data: data };
}

module.exports = {
    formatColour: formatColour,
    cssColour: cssColour,
    readoutTextColour: readoutTextColour,
    imagePoint: imagePoint,
    readPixel: readPixel,
    previewPixels: previewPixels,
    PREVIEW_SIZE: PREVIEW_SIZE,
    PREVIEW_ZOOM: PREVIEW_ZOOM,
    PREVIEW_SOURCE: PREVIEW_SOURCE
};
