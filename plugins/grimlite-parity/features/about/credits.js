// The About window describes AquGrim, with the client tools' upstream credits kept:
// Grimlite-Li's AboutForm.cs (Process.Start targets), its .Designer.cs (the three team headings)
// and its .resx (the credits prose). The upstream version is attributed, not presented as ours.

// Program.cs of the upstream client: Version "Li 1.9.3b", ReleaseDate "10-10-2026".
const REFERENCE_VERSION = 'Li 1.9.3b';
const REFERENCE_RELEASE_DATE = '10-10-2026';

const ABOUT_SUMMARY = 'AquGrim is a free desktop companion for AdventureQuest Worlds. ' +
    'It runs the classic Flash client in its own window and adds the Grimlite tools for it: ' +
    'the bot manager, auto attack, Maid, item pickup, equipment sets, packet tools and ' +
    'quality-of-life options.';

/** The upstream client whose tools this port reproduces, shown in the credits card. */
function upstreamLine() {
    return 'Client tools ported from Grimlite ' + REFERENCE_VERSION + ' (' + REFERENCE_RELEASE_DATE + ')';
}

/** The running port's own version, in the shape the reference uses for its version line. */
function portLine(appVersion) {
    const version = String(appVersion == null ? '' : appVersion);
    return version ? 'AquGrim ' + version : 'AquGrim';
}

// The project's own credit first, then the AquaStar shell it runs on, then the three upstream
// headings AboutForm.Designer.cs stacks down the left (darkLabel3 y=100, darkLabel1 y=243,
// darkLabel5 y=349). `url: null` is a name whose handler is commented out upstream
// (pictureBox1_Click covers the jib-akbr link), so it is shown unlinked.
const TEAMS = [
    {
        heading: 'The AquGrim Project',
        links: [
            { label: 'plicey/AquGrim', url: 'https://github.com/plicey/AquGrim' }
        ]
    },
    {
        heading: 'The AquaStar Platform',
        links: [
            { label: 'aquaspy/AquaStar', url: 'https://github.com/aquaspy/AquaStar' }
        ]
    },
    {
        heading: 'The Grimlite Li Team',
        links: [
            { label: 'Froztt13', url: 'https://github.com/Froztt13/Grimlite-Li' },
            { label: 'Kuzyph', url: null },
            { label: 'Zee', url: 'https://ko-fi.com/zeesnuts' },
            {
                label: 'Dropbox link',
                url: 'https://www.dropbox.com/sh/zdmgaqrrxt4bc1x/AAB_kKx1eV9wWrfox7VGoNXWa?dl=0'
            }
        ]
    },
    {
        heading: 'The Grimlite Team',
        links: [
            { label: 'wisp/satan', url: 'https://github.com/wispie' },
            { label: 'cat', url: 'https://github.com/0zl' }
        ]
    },
    {
        heading: 'The Previous Grimoire Team',
        links: [
            { label: 'Biney', url: 'https://www.mpgh.net/forum/member.php?u=4062680' },
            { label: 'EmperorArts', url: 'https://www.mpgh.net/forum/member.php?u=2374072' }
        ]
    }
];

// rtbCredits.Text, word for word from AboutForm.resx.
const CREDITS_PROSE = [
    'Credits',
    '',
    '',
    '133spider https://github.com/133spider/',
    '\u2937 AQLite https://github.com/133spider/AQLite',
    'rodit https://github.com/rodit/',
    '\u2937 RBot https://github.com/rodit/RBot',
    'root https://twitter.com/root_ae',
    '\u2937 for wanting to be credited'
].join('\n');

/** Every team section, in the form's own order. */
function teams() {
    return TEAMS.map(function (team) {
        return {
            heading: team.heading,
            links: team.links.map(function (link) { return Object.assign({}, link); })
        };
    });
}

/** The flat credit list, for the page's link handler and the allow-list it checks against. */
function creditLinks() {
    return TEAMS.reduce(function (all, team) { return all.concat(team.links); }, [])
        .map(function (link) { return Object.assign({}, link); });
}

module.exports = {
    REFERENCE_VERSION: REFERENCE_VERSION,
    REFERENCE_RELEASE_DATE: REFERENCE_RELEASE_DATE,
    ABOUT_SUMMARY: ABOUT_SUMMARY,
    CREDITS_PROSE: CREDITS_PROSE,
    upstreamLine: upstreamLine,
    portLine: portLine,
    teams: teams,
    creditLinks: creditLinks
};
