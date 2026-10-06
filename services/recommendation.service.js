const { prisma } = require('../database/client');
const { buildLearnerProfile } = require('./recommendationProfile.service');
const { getCandidateProblems, getVisibleRecommendations, calculateDifficultyRange } = require('../database/recommendation.repository');

const MODEL_VERSION = 'rule-based-v1';

/**
 * TODO(RECOMMENDATION_ALGORITHM): Implement the transparent rule-based score.
 * Return [{ problem, score, reasonCodes, componentScores }]. Do not hide the
 * reasons: they are part of the learning experience and debugging surface.
 */
function rankCandidates(candidates, profile, difficultyRange) {
    const MAX_TAG_HISTORY = 5;

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

async function generateRecommendations(userId, limit = 5) {
    const profile = await buildLearnerProfile(userId);
    console.log('PROFILE BUILT');
    const difficultyRange = await calculateDifficultyRange(profile);
    console.log('DIFFICULTY RANGE:',difficultyRange);
    const candidates = await getCandidateProblems(profile,{minRating: difficultyRange.min, maxRating: difficultyRange.max});
     console.log('CANDIDATES:',candidates.length);
     if (candidates.length > 0) {
        console.log('FIRST CANDIDATE:',JSON.stringify(candidates[0],null,2));
    }
    const ranked = rankCandidates(candidates, profile, difficultyRange).slice(0, limit);
    console.log("ranked : ",ranked.length);
    // Once rankCandidates is implemented, persist its output here. Keep this
    // write separate from ranking so a bad scorer cannot corrupt event history.
    console.log('top 3 ranked:', ranked.slice(0, 3).map(r => ({
            problemId: r.problem.problemId,
            score: r.score,
            reasonCodes: r.reasonCodes,
        })));
    if (ranked.length) {
        
        await prisma.recommendation.createMany({
            data: ranked.map(row => ({ userId, problemId: row.problem.problemId, score: row.score,
                reasonCodes: row.reasonCodes, componentScores: row.componentScores, modelVersion: MODEL_VERSION }))
        });
    }
    return ranked;
}

async function listRecommendations(userId, limit = 5) {
    let recommendations = await getVisibleRecommendations(userId, limit);
    if (recommendations.length < limit) await generateRecommendations(userId, limit - recommendations.length);
    recommendations = await getVisibleRecommendations(userId, limit);
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

module.exports = { MODEL_VERSION, rankCandidates, generateRecommendations, listRecommendations, recordRecommendationEvent };
