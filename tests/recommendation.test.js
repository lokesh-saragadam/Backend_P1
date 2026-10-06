jest.mock('../database/client', () => ({ prisma: {} }));
const { calculateLeetCodeLearnerLevel, rankLeetCodeCandidates, LEETCODE_CHALLENGE_OFFSET } = require('../services/recommendation.service');

function profile(solved = []) {
    return { acceptedProblems: new Map(solved.map((difficulty, index) => [index + 1, { difficulty }])), tagStats: {}, recentProblemIds: new Set(), recentTags: [] };
}
function candidate(problemId, difficulty) { return { problemId, difficulty, tags: [] }; }

test('LeetCode cold start begins at Easy and receives the configured challenge offset', () => {
    const learnerLevel = calculateLeetCodeLearnerLevel(profile());
    expect(learnerLevel).toBe(1);
    expect(learnerLevel + LEETCODE_CHALLENGE_OFFSET).toBeCloseTo(1.2);
});

test('Medium ranks ahead of Hard at an upper-Medium learner level', () => {
    const learner = profile(['Medium', 'Hard']);
    const ranked = rankLeetCodeCandidates([candidate(1, 'Easy'), candidate(2, 'Medium'), candidate(3, 'Hard')], learner);
    expect(ranked.map(row => row.problem.difficulty)).toEqual(['Medium', 'Hard', 'Easy']);
    expect(ranked[0].componentScores.targetLevel).toBeCloseTo(2.6);
    expect(ranked[0].reasonCodes).toContain('APPROPRIATE_DIFFICULTY');
});
