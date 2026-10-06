const { buildCanonicalProblemUrl } = require('../utils/canonicalProblemUrl');

test('builds the canonical LeetCode URL from a verified title slug', () => {
    expect(buildCanonicalProblemUrl('Leetcode', { titleSlug: 'repeated-string-match' }))
        .toBe('https://leetcode.com/problems/repeated-string-match/');
});
test('builds the canonical Codeforces URL from contest and index storage', () => {
    expect(buildCanonicalProblemUrl('Codeforces', { platformProblemId: '2269-B' }))
        .toBe('https://codeforces.com/problemset/problem/2269/B');
});
test('does not construct URLs from malformed catalog data', () => {
    expect(buildCanonicalProblemUrl('Codeforces', { platformProblemId: 'bad/id' })).toBeNull();
    expect(buildCanonicalProblemUrl('Leetcode', { titleSlug: '../bad' })).toBeNull();
});
