// The About window's version line and credit links, taken from Grimlite-Li:
// Grimoire/UI/AboutForm.cs (label text and Process.Start targets) and its .Designer.cs
// (which controls exist, and the y-order they are stacked in).

function versionLine(appVersion) {
    const version = String(appVersion == null ? '' : appVersion);
    return version ? 'Version ' + version : 'Version';
}

/** The reference this port is measured against, shown under the version. */
function referenceLine() {
    return 'Grimlite-Li parity (reference Li 1.9.3b)';
}

/**
 * The credit entries in the order the form stacks them, each with the label the designer gives
 * it. `url: null` is a name with no reachable handler: AboutForm.cs has `pictureBox1_Click`
 * (the jib-akbr link) commented out, and pbKuzyph's only handler is that same method, so
 * neither is clickable upstream and neither is a link here. Vicinity4519's handler exists but
 * no control is wired to it, so it does not appear at all.
 */
function creditLinks() {
    return [
        { label: 'Froztt13', url: 'https://github.com/Froztt13/Grimlite-Li' },
        { label: 'Kuzyph', url: null },
        { label: 'Zee', url: 'https://ko-fi.com/zeesnuts' },
        {
            label: 'Dropbox link',
            url: 'https://www.dropbox.com/sh/zdmgaqrrxt4bc1x/AAB_kKx1eV9wWrfox7VGoNXWa?dl=0'
        },
        { label: 'wisp/satan', url: 'https://github.com/wispie' },
        { label: 'cat', url: 'https://github.com/0zl' },
        { label: 'Biney', url: 'https://www.mpgh.net/forum/member.php?u=4062680' },
        { label: 'EmperorArts', url: 'https://www.mpgh.net/forum/member.php?u=2374072' }
    ];
}

module.exports = {
    versionLine: versionLine,
    referenceLine: referenceLine,
    creditLinks: creditLinks
};
