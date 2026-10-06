const { prisma } = require('../database/client');
const { buildLearnerProfile } = require('./recommendationProfile.service');
const { getCandidateProblems, getVisibleRecommendations, calculateDifficultyRange } = require('../database/recommendation.repository');

const PLATFORM_CODEFORCES = 'Codeforces';
const PLATFORM_LEETCODE = 'Leetcode';
const MODEL_VERSIONS = { Codeforces: 'codeforces-rule-based-v1', Leetcode: 'leetcode-difficulty-fit-v1' };
const LEETCODE_LEVEL = { Easy: 1, Medium: 2, Hard: 3 };
const LEETCODE_LEARNING_VALUE = { Easy: 0.25, Medium: 1, Hard: 0.65 };
const LEETCODE_CHALLENGE_OFFSET = 0.2;

/**
 * TODO(RECOMMENDATION_ALGORITHM): Implement the transparent rule-based score.
 * Return [{ problem, score, reasonCodes, componentScores }]. Do not hide the
 * reasons: they are part of the learning experience and debugging surface.
 */
function rankCodeforcesCandidates(candidates, profile, difficultyRange) {
    function clamp(value, min = 0, max = 1) {
        return Math.max(min, Math.min(max, value));
    }

    function getSeenScore(problemId) {
        if (profile.acceptedProblemIds.has(problemId)) {
            return 0;
        }

        if (profile.attemptedProblemIds.has(problemId)) {
            return 0.25;
        }

        return 1;
    }

    function getTagWeaknessScore(tags) {
        if (!tags || tags.length === 0) {
            return 0.5;
        }

        let total = 0;
        let count = 0;

        for (const tag of tags) {
            const stat = profile.tagStats[tag];

            // No history for this tag.
            // Treat it as neutral rather than strong or weak.
            if (!stat || stat.attemptedProblems === 0) {
                total += 0.5;
                count++;
                continue;
            }

            /*
             * Bayesian-style smoothing:
             *
             * prior = 50% acceptance
             * prior strength = 2 problems
             *
             * This prevents:
             *   1/1 AC -> falsely considering a tag very strong
             */
            const smoothedAcceptance =
                (stat.acceptedProblems + 1) /
                (stat.attemptedProblems + 2);

            const weakness = 1 - smoothedAcceptance;

            total += weakness;
            count++;
        }

        return count > 0 ? total / count : 0.5;
    }

    function getTagNoveltyScore(tags) {
        if (!tags || tags.length === 0) {
            return 0;
        }

        let unseenTags = 0;

        for (const tag of tags) {
            const stat = profile.tagStats[tag];

            if (!stat || stat.attemptedProblems === 0) {
                unseenTags++;
            }
        }

        return unseenTags / tags.length;
    }

    function getFreshnessScore(problemId, tags) {
        const problemIsRecent =
            profile.recentProblemIds.has(problemId);

        let recentTagFraction = 0;

        if (tags && tags.length > 0) {
            let recentTags = 0;

            for (const tag of tags) {
                if (profile.recentTags.includes(tag)) {
                    recentTags++;
                }
            }

            recentTagFraction = recentTags / tags.length;
        }

        const problemRecency = problemIsRecent ? 1 : 0;

        return clamp(
            1 - 0.5 * problemRecency - 0.5 * recentTagFraction
        );
    }

    function getDifficultyScore(problem, difficultyRange) {
        if (problem.problemRating == null) {
            return 0.5;
        }
        // console.log('difficultyRange:', difficultyRange);
        const { min, max } = difficultyRange;

        if (min >= max) {
            return 1;
        }

        const rating = problem.problemRating;

        // Ideal region: roughly the middle 50% of the range.
        const idealMin = min + (max - min) * 0.35;
        const idealMax = min + (max - min) * 0.70;

        if (rating >= idealMin && rating <= idealMax) {
            return 1;
        }

        if (rating < idealMin) {
            return Math.max(
                0,
                rating / idealMin
            );
        }

        return Math.max(
            0,
            1 - (rating - idealMax) / (max - idealMax)
        );
    }

    function getTagCoverageScore(tags) {
        if (!tags || tags.length === 0) {
            return 0;
        }

        let knownTags = 0;

        for (const tag of tags) {
            if (
                profile.tagStats[tag] &&
                profile.tagStats[tag].attemptedProblems > 0
            ) {
                knownTags++;
            }
        }

        return knownTags / tags.length;
    }

    return candidates
        .map(problem => {
            const seenScore =
                getSeenScore(problem.problemId);
            // console.log("seen score passed");
            const tagWeaknessScore =
                getTagWeaknessScore(problem.tags);
            // console.log("tagWeaknessScore passed");

            const difficultyScore =
                getDifficultyScore(problem,difficultyRange);
            // console.log("difficultyScore passed");

            const freshnessScore =
                getFreshnessScore(
                    problem.problemId,
                    problem.tags
                );
            // console.log("freshnessScore passed");

            const tagNoveltyScore =
                getTagNoveltyScore(problem.tags);
            // console.log("tagNoveltyScore passed");
            /*
             * A candidate containing completely unknown tags
             * shouldn't dominate the recommendation system.
             *
             * Give some value to novelty, but don't let it
             * overpower demonstrated weaknesses.
             */
            const tagCoverageScore =
                getTagCoverageScore(problem.tags);

            // console.log("tag coverage score passed");
            const score =
                0.25 * seenScore +
                0.25 * tagWeaknessScore +
                0.20 * difficultyScore +
                0.15 * freshnessScore +
                0.10 * tagNoveltyScore +
                0.05 * tagCoverageScore;
            // console.log("final score listed");
            const reasonCodes = [];

            if (seenScore === 1) {
                reasonCodes.push('UNSEEN');
            } else if (seenScore === 0.25) {
                reasonCodes.push('PREVIOUSLY_ATTEMPTED');
            }

            if (tagWeaknessScore >= 0.6) {
                reasonCodes.push('WEAK_TAG');
            }

            if (difficultyScore >= 0.75) {
                reasonCodes.push('APPROPRIATE_DIFFICULTY');
            }

            if (freshnessScore >= 0.75) {
                reasonCodes.push('FRESH_TOPIC');
            }

            if (tagNoveltyScore > 0) {
                reasonCodes.push('NEW_TAG');
            }

            return {
                problem,
                score,
                reasonCodes,
                componentScores: {
                    seenScore,
                    tagWeaknessScore,
                    difficultyScore,
                    freshnessScore,
                    tagNoveltyScore,
                    tagCoverageScore
                }
            };
        })
        .sort((a, b) => b.score - a.score);
}

/** Weighted average across distinct solves; newest successful solve gets 1.5x weight. */
function calculateLeetCodeLearnerLevel(profile) {
    const solved = [...profile.acceptedProblems.values()].filter(problem => LEETCODE_LEVEL[problem.difficulty]);
    if (!solved.length) return 1;
    let weightedTotal = 0;
    let weights = 0;
    for (let index = 0; index < solved.length; index++) {
        const weight = 1 + ((solved.length - index - 1) / Math.max(solved.length - 1, 1)) * 0.5;
        weightedTotal += LEETCODE_LEVEL[solved[index].difficulty] * weight;
        weights += weight;
    }
    return weightedTotal / weights;
}

function rankLeetCodeCandidates(candidates, profile) {
    const learnerLevel = calculateLeetCodeLearnerLevel(profile);
    const targetLevel = Math.min(3, learnerLevel + LEETCODE_CHALLENGE_OFFSET);
    return candidates.map(problem => {
        const difficultyLevel = LEETCODE_LEVEL[problem.difficulty];
        if (!difficultyLevel) return null;
        const distanceFit = Math.max(0, 1 - Math.abs(difficultyLevel - targetLevel) / 2);
        const difficultyFit = distanceFit * LEETCODE_LEARNING_VALUE[problem.difficulty];
        const tagWeaknessScore = problem.tags.length ? problem.tags.reduce((total, tag) => {
            const stat = profile.tagStats[tag];
            return total + (!stat?.attemptedProblems ? 0.5 : 1 - ((stat.acceptedProblems + 1) / (stat.attemptedProblems + 2)));
        }, 0) / problem.tags.length : 0.5;
        const freshnessScore = profile.recentProblemIds.has(problem.problemId) ? 0 : 1;
        const score = 0.60 * difficultyFit + 0.25 * tagWeaknessScore + 0.15 * freshnessScore;
        const reasonCodes = ['UNSOLVED'];
        if (difficultyFit >= 0.7) reasonCodes.push('APPROPRIATE_DIFFICULTY');
        if (tagWeaknessScore >= 0.6) reasonCodes.push('WEAK_TAG');
        return { problem, score, reasonCodes, componentScores: { learnerLevel, targetLevel, difficultyLevel, distanceFit,
            learningValue: LEETCODE_LEARNING_VALUE[problem.difficulty], difficultyFit, tagWeaknessScore, freshnessScore } };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
}

async function generateRecommendations(userId, platformName, limit = 5) {
    const profile = await buildLearnerProfile(userId, platformName);
    const difficultyRange = platformName === PLATFORM_CODEFORCES ? await calculateDifficultyRange(profile) : null;
    const candidates = await getCandidateProblems(profile, platformName, difficultyRange ? { minRating: difficultyRange.min, maxRating: difficultyRange.max } : { difficulties: ['Easy', 'Medium', 'Hard'] });
    const ranked = (platformName === PLATFORM_LEETCODE ? rankLeetCodeCandidates(candidates, profile) : rankCodeforcesCandidates(candidates, profile, difficultyRange)).slice(0, limit);
    if (ranked.length) {
        
        await prisma.recommendation.createMany({
            data: ranked.map(row => ({ userId, problemId: row.problem.problemId, score: row.score,
                reasonCodes: row.reasonCodes, componentScores: row.componentScores, modelVersion: MODEL_VERSIONS[platformName] }))
        });
    }
    return ranked;
}

async function listRecommendations(userId, platformName = PLATFORM_CODEFORCES, limit = 5) {
    let recommendations = await getVisibleRecommendations(userId, platformName, limit);
    if (recommendations.length < limit) await generateRecommendations(userId, platformName, limit - recommendations.length);
    recommendations = await getVisibleRecommendations(userId, platformName, limit);
    return recommendations;
}

async function recordRecommendationEvent(userId, recommendationId, event) {
    const recommendation = await prisma.recommendation.findFirst({ where: { recommendationId, userId } });
    if (!recommendation) return null;
    const now = new Date();
    const updates = {
        shown: { shownAt: now }, opened: { openedAt: now }, started: { startedAt: now },
        dismissed: { dismissedAt: now, outcome: 'DISMISSED' },
        accepted: { outcome: 'ACCEPTED' }, attempted_not_solved: { outcome: 'ATTEMPTED_NOT_SOLVED' }
    };
    return prisma.recommendation.update({ where: { recommendationId }, data: updates[event] });
}

module.exports = { PLATFORM_CODEFORCES, PLATFORM_LEETCODE, LEETCODE_LEVEL, LEETCODE_LEARNING_VALUE,
    LEETCODE_CHALLENGE_OFFSET, calculateLeetCodeLearnerLevel, rankCodeforcesCandidates, rankLeetCodeCandidates,
    generateRecommendations, listRecommendations, recordRecommendationEvent };
