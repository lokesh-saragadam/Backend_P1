const { prisma } = require('./client');

async function getCandidateProblems(
    profile, platformName,
    { minRating, maxRating, difficulties, take = 500 } = {}
) {
    const platformId = profile.platformIdByName[platformName];
    if (!platformId) return [];
    return prisma.problem.findMany({
        where: {
            platformId,
            ...(difficulties?.length ? { difficulty: { in: difficulties } } : {}),

            ...(minRating != null || maxRating != null
                ? {
                    problemRating: {
                        ...(minRating != null
                            ? { gte: minRating }
                            : {}),
                        ...(maxRating != null
                            ? { lte: maxRating }
                            : {})
                    }
                }
                : {}),

            submissions: {
                none: {
                    userId: profile.userId,
                    normalizedVerdict: 'ACCEPTED'
                }
            },
            recommendations: {
                none: {
                    userId: profile.userId,
                    outcome: 'NOT_YET_KNOWN'
                }
            },
        },

        include: {
            platform: {
                select: {
                    name: true
                }
            },
            metadata: true
        },

        take,

        orderBy: {
            problemId: 'asc'
        }
    });
}


async function getVisibleRecommendations(userId, platformName, limit) {
    return prisma.recommendation.findMany({
        where: {
            userId,
            outcome: 'NOT_YET_KNOWN',
            problem: { platform: { name: platformName } }
        },

        include: {
            problem: {
                include: {
                    platform: {
                        select: {
                            name: true
                        }
                    },
                    metadata: true
                }
            }
        },

        orderBy: [
            { score: 'desc' },
            { recommendedAt: 'desc' }
        ],

        take: limit
    });
}


async function calculateDifficultyRange(profile) {
    const submissions = await prisma.submission.findMany({
        where: {
            userId: profile.userId,

            problem: {
                platformId: {
                    in: profile.connectedPlatformIds
                },

                problemRating: {
                    not: null
                }
            }
        },

        select: {
            normalizedVerdict: true,

            problem: {
                select: {
                    problemRating: true
                }
            }
        },

        orderBy: {
            submittedAtMs: 'desc'
        },

        take: 300
    });

    const acceptedRatings = [];

    for (const submission of submissions) {
        const rating = submission.problem?.problemRating;

        if (rating == null) {
            continue;
        }

        if (submission.normalizedVerdict === 'ACCEPTED') {
            acceptedRatings.push(rating);
        }
    }

    // Not enough solved rated problems to estimate ability.
    if (acceptedRatings.length < 5) {
        return {
            min: 800,
            max: 1200
        };
    }

    acceptedRatings.sort((a, b) => a - b);

    // 75th percentile of successfully solved problems.
    const index = Math.floor(
        acceptedRatings.length * 0.75
    );

    const ability = acceptedRatings[index];
    console.log(
        'acceptedRatings:',
        acceptedRatings,
        'types:',
        acceptedRatings.map(x => typeof x)
    );
    const min = Math.max(
        800,
        ability - 150
    );

    const max = Math.min(
        3500,
        ability + 200
    );

    return {
        min,
        max
    };
}


module.exports = {
    getCandidateProblems,
    getVisibleRecommendations,
    calculateDifficultyRange
};
