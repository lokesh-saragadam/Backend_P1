const { prisma } = require('../database/client');

/**
 * Returns factual learner signals. This file deliberately does not decide what
 * to recommend; keeping data preparation separate makes the future scorer
 * testable and explainable.
 */
async function buildLearnerProfile(userId) {
    const submissions = await prisma.submission.findMany({
        where: { userId },
        select: {
            problemId: true, normalizedVerdict: true, submittedAtMs: true,
            problem: { select: { tags: true, difficulty: true, problemRating: true, platformId: true } }
        },
        orderBy: { submittedAtMs: 'desc' }
    });
    const handles = await prisma.userHandle.findMany({
        where: { userId }, select: { platformId: true, contestRating: true }
    });

    const profile = {
        userId,
        connectedPlatformIds: handles.map(handle => handle.platformId),
        contestRatingByPlatformId: Object.fromEntries(handles.map(handle => [handle.platformId, handle.contestRating])),
        acceptedProblemIds: new Set(),
        attemptedProblemIds: new Set(),
        tagStats: {},
        recentProblemIds: new Set(),
        recentTags: []
    };
    const tagProblemStats = {};
    for (const submission of submissions) {
        profile.attemptedProblemIds.add(submission.problemId);
        if (submission.normalizedVerdict === 'ACCEPTED') profile.acceptedProblemIds.add(submission.problemId);
        if (profile.recentProblemIds.size < 20) profile.recentProblemIds.add(submission.problemId);

        for (const tag of submission.problem.tags) {
            const stat = tagProblemStats[tag] ||= { acceptedEvents : 0 , failedEvents : 0,attemptedProblems: new Set(), acceptedProblems: new Set(), failedProblems: new Set(), attempts : 0, lastAttemptedAtMs: null };
            stat.attempts++;
            stat.attemptedProblems.add(submission.problemId);
            if (submission.normalizedVerdict === 'ACCEPTED') {
                if( stat.failedProblems.has(submission.problemId)) stat.failedProblems.delete(submission.problemId);
                stat.acceptedProblems.add(submission.problemId);
                stat.acceptedEvents++;
            }
            if (submission.normalizedVerdict === 'FAILED'  ) {
                if(! stat.acceptedProblems.has(submission.problemId)) stat.failedProblems.add(submission.problemId);
                stat.failedEvents++;
            }
            if (stat.lastAttemptedAtMs === null) stat.lastAttemptedAtMs = submission.submittedAtMs.toString();
            if (profile.recentTags.length < 20) profile.recentTags.push(tag);
        }
    }
    profile.tagStats = Object.fromEntries(Object.entries(tagProblemStats).map(([tag, stat]) => [tag, {
        attemptedProblems:stat.attemptedProblems.size,
        acceptedProblems:stat.acceptedProblems.size,
        failedProblems:stat.failedProblems.size,
        attempts: stat.attempts,
        acceptedEvents: stat.acceptedEvents,
        failedEvents : stat.failedEvents,
        acceptanceRate: stat.attempts > 4 ? stat.acceptedProblems.size / stat.attemptedProblems.size : 0,
        lastAttemptedAtMs: stat.lastAttemptedAtMs
    }]));
    return profile;
}

module.exports = { buildLearnerProfile };
