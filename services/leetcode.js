const axios = require("axios");
const fs = require("fs/promises");
const { pool , prisma } = require('../database/db.js')
const log = require("../utils/logger");

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}
//
// FOR ACCOUNT SUBMISSION NUMBER.
//
// matchedUser(username: $username) {
//             submitStats {
//                 acSubmissionNum {
//                     difficulty
//                     count
//                 }
//             }
//         }

async function getFullUserData(username,retries=2) {
    log("leetcode.js","getFullUserData","Request received");

    const query = `
    query fullData($username: String!, $limit: Int!) {

        userContestRanking(username: $username) {
            rating
            globalRanking
            attendedContestsCount
        }
        recentAcSubmissionList(username: $username, limit: $limit) {
            id
            title
            titleSlug
            timestamp
        }
    }
`;

    const variables = {
        username,
        limit:20
    };
    try{
    const response = await axios.post(
        "https://leetcode.com/graphql/",
        {
            query,
            variables
        },
        {
            headers: {
            "Content-Type": "application/json",
            "Referer": "https://leetcode.com",
            "User-Agent": "Mozilla/5.0"
            },
            timeout : 30000
        }
    );

    log("leetcode.js","getFullUserData","Request resolved");
    return response.data;
    } catch(err) {

        if (
            err.response &&
            err.response.status === 504 &&
            retries > 0
        )  {

            console.log("Server overloaded. Waiting...");

            await sleep(120000); // 120 sec

            return getFullUserData(username, retries - 1);
        }
        log("leetcode.js","getFullUserData","Error ",err);
        throw err;
    }
}

async function getBatchProblemData(titleSlugs) {
    if (titleSlugs.length === 0) {
        return {data:{}};
    }
    const queryFields = titleSlugs
        .map((slug, index) => `
            q${index}: question(titleSlug: "${slug}") {
                questionId
                title
                difficulty

                topicTags {
                    name
                    slug
                }
            }
        `)
        .join("\n");

    const query = `
        query {
            ${queryFields}
        }
    `;

    const response = await axios.post(
        "https://leetcode.com/graphql/",
        {
            query
        },
        {
            headers: {
            "Content-Type": "application/json",
            "Referer": "https://leetcode.com",
            "User-Agent": "Mozilla/5.0"
            },
            timeout : 10000
        }
    );

    return response.data;
}
async function checkavailability(slugs){
    const result = await pool.query(
    `
    SELECT problemcode
    FROM "Problem"
    WHERE platformid = $1
    AND problemcode = ANY($2)
    `,
    [1, slugs]
    );
    const existing = new Set(
        result.rows.map(
            r => r.problemcode
        )
    );
    const missingSlugs = slugs.filter(
            slug => !existing.has(slug)
    );
    return missingSlugs;
}
async function processleetcodedata(lchandle){
    try{
    const fulldata = await getFullUserData(lchandle);

    const rating = Math.trunc(fulldata.data.userContestRanking.rating); //rating
    const problemlist = fulldata.data.recentAcSubmissionList; // problem list to search.

    const titleslugs = new Set(problemlist.map(p => p.titleSlug)); //titles to search problems
    //convert to an array.
    const arr = [...titleslugs];
    //get only problems list which are not avaialable in the data.
    const missingslugs = await checkavailability(arr);
    //get the problem data.
    const problemsdata = await getBatchProblemData(missingslugs);
    //create unique problem dataset.
    const unique_problems = [];
    const solved_problems = [];

    Object.entries(problemsdata.data).forEach(([qkey,value],index) => {
        //data for unique_problems.
        const problemtitle = value.title;
        const problemcode = value.questionId;
        const difficulty = value.difficulty;
        const rating = value.difficulty === "Easy" ? 1 : value.difficulty === "Medium" ? 2 : 3;
        const tags = value.topicTags.map(tag => tag.slug);
        
        //data for solved_problems.
        const status = "Accepted";
        const language = "C++"; // hardcoded may need to change later
        const timestamp = (problemlist.find(
            p => p.title === problemtitle
        )?.timestamp)*1000;
        const solvedat = new Date(timestamp * 1000);
 
        unique_problems.push({
            problemtitle,
            problemcode,
            difficulty,
            rating,
            tags
        })

        solved_problems.push({
            problemid:problemcode,
            status,
            language,
            timestamp,
            solvedat
        })
    });
    return {rating,unique_problems,solved_problems};
    } catch (err) {
        console.error("ERROR:", err);
        return null;
    }

}
async function main(){
    try{
    const fulldata = await getFullUserData("saragadam_Lokesh")

    // console.log(RecentAC.data.recentAcSubmissionList.length)
    // const difficulty_object = fulldata.data.matchedUser.submitStats.acSubmissionNum;
    const leetcoderating = fulldata.data.userContestRanking.rating;
    const problemlist = fulldata.data.recentAcSubmissionList;

    const titleslugs = new Set(
        problemlist.map(p => p.titleSlug)
    );
    const json = [];
    console.log("extracted titleslugs.")
    json.push(fulldata);
    json.push(leetcoderating,problemlist);
    json.push([...titleslugs]);
    const arr = [...titleslugs];
    const missingslugs = await checkavailability(arr);
    const problemsdata = await getBatchProblemData(missingslugs);
    json.push(problemsdata);
    await fs.writeFile(
        'Leetcode_Data.json',
        JSON.stringify(json, null, 2)
    );
    } catch(err){
    console.log(err);
    console.log("RESPONSE:");
    console.log(err.response);

    console.log("REQUEST:");
    console.log(err.request);

    console.log("MESSAGE:");
    console.log(err.message);
    }
};
// main();
module.exports = {processleetcodedata};