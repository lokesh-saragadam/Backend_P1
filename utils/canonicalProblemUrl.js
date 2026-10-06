function buildCanonicalProblemUrl(platformName, { platformProblemId, title } = {}) {
    // console.log(typeof title);
    if (platformName === 'Leetcode' && typeof title === 'string') {
        const titleslug = title.trim().toLowerCase().replace(/\s+/g, '-');
        // console.log(titleslug);
        return `https://leetcode.com/problems/${titleslug}/`;
    }
    if (platformName === 'Codeforces' && typeof platformProblemId === 'string') {
        const match = /^(\d+)-([A-Za-z][A-Za-z0-9]*)$/.exec(platformProblemId);
        if (match) return `https://codeforces.com/problemset/problem/${match[1]}/${match[2]}`;
    }
    return null;
}
module.exports = { buildCanonicalProblemUrl };
