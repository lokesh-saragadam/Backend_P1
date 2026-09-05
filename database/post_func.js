const { DatabaseError } = require('pg');
const { pool , prisma } = require('./db')
const log = require("../utils/logger");
const platformMap = {};

async function post_platforms(db,platforms){
    log("post_func.js","post_platforms","Request received");

    for(const elem in platforms){
        try{
        const platform = await db.Platform.upsert({
            where: {
                name: elem
            },
            update: {},
            create: {
                name: elem
            }
        });
    } catch (err) {
        console.log(err);
    }
    }
    log("post_func.js","post_platforms","Request resolved");
    return platformMap;
};
async function post_userhandles(db,user_handle,userid,platformid,rating){
    log("post_func.js","post_userhandles","Request received");

    try{
    const platforms = await prisma.platform.findMany();
    // console.log(platforms);
    const result = await db.UserHandle.create({
        data:{
            userid,
            platformid,
            handle: user_handle,
            rating
        }
    });
    } catch (err) {
        console.log(err);
    }
    log("post_func.js","post_userhandles","Request resolved");

};
async function post_problems(db, platformid, unique_problems) {
    log("post_func.js", "post_problems", "Request received");

    const problem_map = new Map();
    let successCount = 0;

    // Execute all upserts concurrently
    await Promise.all(
        unique_problems.map(async (element) => {
            try {
                const result = await db.Problem.upsert({
                    where: {
                        platformid_problemcode: {
                            platformid: platformid,
                            problemcode: element.problemcode
                        }
                    },
                    update: {
                        problemtitle: element.problemtitle,
                        difficulty: element.difficulty,
                        rating: element.rating,
                        tags: element.tags
                    },
                    create: {
                        platformid: platformid,
                        problemcode: element.problemcode,
                        problemtitle: element.problemtitle,
                        difficulty: element.difficulty,
                        rating: element.rating,
                        tags: element.tags
                    }
                });

                // Map the platform's string ID to our DB's Int ID
                // JavaScript Maps are safe to update concurrently like this
                problem_map.set(element.problemcode, result.problemid);

            } catch (err) {
                console.error("First failing problem:", element);
                console.error(err);
                throw err;
            }
        })
    );

    // If Promise.all finishes without throwing, all were successful
    successCount += unique_problems.length;

    log("post_func.js", "post_problems", "Request resolved");
    
    console.log(`Unique problems have been stored/updated. Received ${unique_problems.length}, Success ${successCount}`);
    return problem_map;
}
async function post_solved_problems(db, userid, submissions, problem_map) {
    log("post_func.js", "post_solved_problems", "Request received");
    console.log("Problem Map:", problem_map);

    let successCount = 0;

    // 1. Format all valid submissions into a single massive array
    const formattedSubmissions = submissions.reduce((acc, elem) => {
        const mappedProblemid = problem_map.get(elem.problemid);
        if (!mappedProblemid) return acc; // Skip missing problems

        let unixTimestamp = elem.timestamp 
            ? BigInt(elem.timestamp) 
            : (elem.solvedat ? BigInt(new Date(elem.solvedat).getTime()) : BigInt(Date.now()));

        const submissionKey = `${userid}_${mappedProblemid}_${unixTimestamp.toString()}`;

        acc.push({
            userid: userid,
            problemid: mappedProblemid,
            statusDisplay: elem.status,
            language: elem.language,
            timestamp: unixTimestamp,
            submissionKey: submissionKey
        });

        return acc;
    }, []);

    // 2. Insert them all in one single network request
    if (formattedSubmissions.length > 0) {
        await db.Submission.createMany({
            data: formattedSubmissions,
            skipDuplicates: true // Acts like an upsert: ignores it if the submissionKey already exists
        });
    }
    
    log("post_func.js", "post_solved_problems", "Request resolved");
    console.log(`The problems have been logged into the database. Received ${submissions.length}, Upserted ${successCount}`);
}

async function postproblems(db,userid,platformid,unique_problems,solved_problems){
    log("post_func.js","postproblems","Request received");

    const problem_map = await post_problems(db,platformid,unique_problems);
    console.log("Returned map:", problem_map);
    console.log(problem_map instanceof Map);
    await post_solved_problems(db,userid,solved_problems,problem_map);
    log("post_func.js","postproblems","Request resolved");
    
}

async function synced(db,userid){
    log("post_func.js","synced","Request received");

    await db.UserHandle.updateMany({
        where: {
            userid: userid,
            platformid: {
                in: [1, 2]
            }
        },
        data: {
            last_synced_at: new Date()
        }
    });
    log("post_func.js","synced","Request resolved");

}

async function postnewuser(userid,platforms,lcdata,cfdata){
    log("post_func.js","postnewuser","Request received");

    const lcusername = platforms.Leetcode;
    const cfusername = platforms.Codeforces;
    await prisma.$transaction(async (tx) => {

        if(userid === -1){
            throw new Error("User already exists");
        }
        console.log("User Id" ,userid)
        await post_platforms(tx, platforms);

        await post_userhandles(
            tx,
            lcusername,
            userid,
            1,
            lcdata.rating
        );

        await post_userhandles(
            tx,
            cfusername,
            userid,
            2,
            cfdata.rating
        );

        await postproblems(
            tx,
            userid,
            1,
            lcdata.unique_problems,
            lcdata.solved_problems
        );

        await postproblems(
            tx,
            userid,
            2,
            cfdata.unique_problems,
            cfdata.solved_problems
        );
        

    },{
            maxWait: 10000, // 10 seconds to wait for a database connection
            timeout: 30000  // 30 seconds before the entire transaction times out
        });
    // console.error(err);
    log("post_func.js","postnewuser","Request resolved");

}


module.exports = {postnewuser};