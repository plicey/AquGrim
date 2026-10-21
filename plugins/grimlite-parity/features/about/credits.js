// The About window's version line and credit sections, taken from Grimlite-Li:
// Grimoire/UI/AboutForm.cs (label text and Process.Start targets), its .Designer.cs (the three
// team headings, their order and the logo) and its .resx (the credits prose).

// Program.cs: Version "Li 1.9.3b", ReleaseDate "10-10-2026"; AboutForm.cs writes them as
// `Version {Program.Version} ({Program.ReleaseDate})`.
const REFERENCE_VERSION = 'Li 1.9.3b';
const REFERENCE_RELEASE_DATE = '10-10-2026';

/** The reference's own version label. The app's own version is shown beside it. */
function versionLine() {
    return 'Version ' + REFERENCE_VERSION + ' (' + REFERENCE_RELEASE_DATE + ')';
}

/** The running port's own version, in the shape the reference uses for its version line. */
function portLine(appVersion) {
    const version = String(appVersion == null ? '' : appVersion);
    return version ? 'AquGrim ' + version : 'AquGrim';
}

// The three headings AboutForm.Designer.cs stacks down the left (darkLabel3 y=100, darkLabel1
// y=243, darkLabel5 y=349) with the controls under each. `url: null` is a name whose handler is
// commented out upstream (pictureBox1_Click covers the jib-akbr link), so it is shown unlinked.
const TEAMS = [
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
    CREDITS_PROSE: CREDITS_PROSE,
    versionLine: versionLine,
    portLine: portLine,
    teams: teams,
    creditLinks: creditLinks
};
