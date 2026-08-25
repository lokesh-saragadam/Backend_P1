//Imports
const { pool , prisma } = require('../database/db');
const asyncHandler = require('express-async-handler');

//Functions
const log = require("../utils/logger");
const { processcodeforcesdata } = require('../services/codeforces');
const { processleetcodedata } = require('../services/leetcode');
const { postnewuser } = require('../database/post_func');

const getProblems = asyncHandler( async (req, res) => {
    log("Problemcontrol.js","getProblems","Request received");
    const result = await prisma.Problem.findMany();
    log("Problemcontrol.js","getProblems","Request resolved");

    res.json(result.rows);
}); 

//@desc Save the new user data in the database.
//@req contains userid and platform usernames.
//@res needs no response but can stay the same.
const postUserData = asyncHandler(async (req, res) => {
    log("Problemcontrol.js","postUserData","Request received");

    const { userid, platforms } = req.body;
    const lcdata = await processleetcodedata(platforms.Leetcode);
    const cfdata = await processcodeforcesdata(platforms.Codeforces);
    console.log("lcdata : ",lcdata.solved_problems[0]);
    console.log("cfdata : ",cfdata.solved_problems[0]);
    await postnewuser(userid,platforms,lcdata,cfdata);

    log("Problemcontrol.js","postUserData","Request resolved");
    res.status(200).json({
    success: true,
    message: "Data has been received"
});
});

const PostProblemData = asyncHandler(async (req, res) => {
    log(
        "Problemcontrol.js",
        "PostProblemData",
        "Request received"
    );

    const { id } = req.params;
    const userId = Number(id);

    const { platform, submissions } = req.body;
    console.log(platform,submissions[0]);
    try {
        // =====================================================
        // 1. Validate request
        // =====================================================
        if (!platform) {
            console.log("Platform is required")
            return res.status(400).json({
                message: "Platform is required"
            });
        }

        if (!Array.isArray(submissions)) {
            console.log("Submissions must be an array")
            return res.status(400).json({
                message: "Submissions must be an array"
            });
        }

        // =====================================================
        // 2. Get platform
        // =====================================================
        const platformData = await prisma.platform.findUnique({
            where: {
                name: platform
            }
        });

        if (!platformData) {
            console.log(`Platform '${platform}' not found`);
            return res.status(400).json({
                message: `Platform '${platform}' not found`
            });
        }

        const platformId = platformData.platformid;

        // =====================================================
        // 3. Process everything inside transaction
        // =====================================================
        let result;

        try {
            result = await prisma.$transaction(async (tx) => {

                let problemsProcessed = 0;
                let submissionsCreated = 0;

                for (const submission of submissions) {

                    const {
                        problemcode,
                        problemtitle,
                        difficulty,
                        tags,
                        status,
                        language,
                        timestamp
                    } = submission;

                    if (
                        !problemcode ||
                        !problemtitle ||
                        !status ||
                        timestamp === undefined
                    ) {
                        console.warn(
                            "Skipping invalid submission:",
                            submission
                        );
                        continue;
                    }

                    let normalizedDifficulty = null;

                    if (
                        difficulty === "Easy" ||
                        difficulty === "Medium" ||
                        difficulty === "Hard"
                    ) {
                        normalizedDifficulty = difficulty;
                    }

                    const normalizedTags = Array.isArray(tags) ? tags : [];

                    let problem;
                    try {

                        problem = await tx.problem.upsert({
                            where: {
                                platformid_problemcode: {
                                    platformid: platformId,
                                    problemcode: String(problemcode)
                                }
                            },
                            create: {
                                platformid: platformId,
                                problemcode: String(problemcode),
                                problemtitle,
                                difficulty: normalizedDifficulty,
                                tags: normalizedTags
                            },
                            update: {
                                problemtitle,
                                difficulty: normalizedDifficulty,
                                tags: normalizedTags
                            }
                        });

                    } catch (error) {

                        console.error("❌ PROBLEM UPSERT FAILED");

                        console.error({
                            problemcode,
                            problemtitle,
                            difficulty: normalizedDifficulty,
                            tags: normalizedTags,
                            errorCode: error.code,
                            errorMessage: error.message,
                            errorMeta: error.meta,
                            error:error
                        });

                        throw error;
                    }

                    problemsProcessed++;

                    const submissionKey =
                        `${userId}_${problem.problemid}_${timestamp}`;

                    await tx.submission.upsert({
                        where: {
                            submissionKey
                        },

                        create: {
                            userid: userId,
                            problemid: problem.problemid,
                            statusDisplay: status,
                            language: language || null,
                            timestamp: BigInt(timestamp),
                            submissionKey
                        },

                        update: {
                            statusDisplay: status,
                            language: language || null,
                            problemid: problem.problemid
                        }
                    });
                }

                return {
                    problemsProcessed,
                    submissionsCreated
                };
            });

        } catch (error) {

            console.error("🔥 TRANSACTION FAILED 🔥");

            console.error({
                errorCode: error.code,
                errorMessage: error.message,
                errorMeta: error.meta
            });

            return res.status(500).json({
                success: false,
                message: "Failed to process submissions",
                error: error.message,
                code: error.code,
                meta: error.meta
            });
        }

        // =====================================================
        // 8. Response
        // =====================================================
        console.log(
            "Sync completed:",
            result
        );

        log(
            "Problemcontrol.js",
            "PostProblemData",
            "Request resolved"
        );

        res.status(200).json({
            success: true,
            result
        });

    } catch (error) {
        
        console.error(
            "Error saving LeetCode data:",
            error
        );
        
        // Use Express's next(error) pattern or send an error response explicitly 
        // since throwing inside asyncHandler will be caught by your error middleware
        res.status(500).json({
            success: false,
            message: "Failed to process submissions",
            error: error.message
        });
    }
});

module.exports = PostProblemData; // or however you are exporting it

module.exports = { getProblems , postUserData ,PostProblemData };