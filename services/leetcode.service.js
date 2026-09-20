const axios = require('axios');
const { prisma } = require('../database/client');
const HttpError = require('../utils/httpError');

const RECENT_SUBMISSION_LIMIT = 20;
const METADATA_BATCH_SIZE = 20;
const headers = { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' };

function upstreamError() {
    return new HttpError(502, 'LeetCode returned incomplete data. Please try again.', 'LEETCODE_DATA_UNAVAILABLE');
}
async function requestGraphQL(query, variables, retriesRemaining = 2) {
    try {
        const response = await axios.post('https://leetcode.com/graphql/', { query, variables }, {
            headers, timeout: 20000
        });
        if (response.data?.errors?.length || !response.data?.data) throw upstreamError();
        return response.data.data;
    } catch (error) {
        const retryable = [429, 502, 503, 504].includes(error.response?.status) ||
            ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code);
        if (retryable && retriesRemaining > 0) {
            await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (2 - retriesRemaining)));
            return requestGraphQL(query, variables, retriesRemaining - 1);
        }
        throw error;
    }
}
async function fetchRecentAcceptedSubmissionsAndRating(leetcodeHandle) {
    return requestGraphQL(`query recentPractice($username: String!, $limit: Int!) {
        userContestRanking(username: $username) { rating }
        recentAcSubmissionList(username: $username, limit: $limit) {
            id titleSlug timestamp lang
        }
    }`, { username: leetcodeHandle, limit: RECENT_SUBMISSION_LIMIT });
}
async function loadCachedProblemsBySlugs(titleSlugs) {
    if (!titleSlugs.length) return [];
    return prisma.problem.findMany({
        where: { platform: { name: 'Leetcode' }, titleSlug: { in: titleSlugs } },
        select: { problemId: true, platformProblemId: true, titleSlug: true }
    });
}
async function fetchProblemMetadataBySlugs(titleSlugs) {
    const problems = [];
    for (let offset = 0; offset < titleSlugs.length; offset += METADATA_BATCH_SIZE) {
        const batch = titleSlugs.slice(offset, offset + METADATA_BATCH_SIZE);
        const declarations = batch.map((_, index) => '$slug' + index + ': String!').join(', ');
        const fields = batch.map((_, index) => 'q' + index + ': question(titleSlug: $slug' + index + ') { questionId title titleSlug difficulty topicTags { slug } }').join('\n');
        const variables = Object.fromEntries(batch.map((slug, index) => ['slug' + index, slug]));
        const response = await requestGraphQL('query problemMetadata(' + declarations + ') { ' + fields + ' }', variables);
        batch.forEach((requestedSlug, index) => {
            const metadata = response['q' + index];
            if (!metadata || !/^\d+$/.test(String(metadata.questionId)) ||
                metadata.titleSlug !== requestedSlug || typeof metadata.title !== 'string' ||
                !['Easy', 'Medium', 'Hard'].includes(metadata.difficulty) ||
                !Array.isArray(metadata.topicTags) ||
                metadata.topicTags.some(tag => typeof tag.slug !== 'string')) throw upstreamError();
            problems.push({
                platformProblemId: String(metadata.questionId), titleSlug: metadata.titleSlug,
                title: metadata.title, difficulty: metadata.difficulty,
                problemRating: null, tags: metadata.topicTags.map(tag => tag.slug)
            });
        });
    }
    return problems;
}
async function collectLeetCodeImportData(leetcodeHandle) {
    const leetcodeResponse = await fetchRecentAcceptedSubmissionsAndRating(leetcodeHandle);
    const recentAcceptedSubmissions = leetcodeResponse.recentAcSubmissionList;
    if (!Array.isArray(recentAcceptedSubmissions)) throw upstreamError();
    const submissions = recentAcceptedSubmissions.map(submission => {
        const submittedAtMs = Number(submission.timestamp) * 1000;
        if (!/^\d+$/.test(String(submission.id)) ||
            typeof submission.titleSlug !== 'string' || !/^[a-z0-9-]{1,255}$/.test(submission.titleSlug) ||
            !Number.isSafeInteger(submittedAtMs) || submittedAtMs < Date.UTC(2000, 0, 1) ||
            submittedAtMs > Date.now() + 86400000 ||
            (submission.lang != null && (typeof submission.lang !== 'string' || submission.lang.length > 50))) {
            throw upstreamError();
        }
        return {
            platformSubmissionId: String(submission.id), titleSlug: submission.titleSlug,
            submittedAtMs, verdict: 'Accepted', language: submission.lang || null
        };
    });
    const titleSlugs = [...new Set(submissions.map(submission => submission.titleSlug))];
    const cachedProblems = await loadCachedProblemsBySlugs(titleSlugs);
    const cachedSlugs = new Set(cachedProblems.map(problem => problem.titleSlug));
    const problems = await fetchProblemMetadataBySlugs(titleSlugs.filter(slug => !cachedSlugs.has(slug)));
    const problemIdBySlug = new Map([...cachedProblems, ...problems]
        .map(problem => [problem.titleSlug, problem.platformProblemId]));
    for (const submission of submissions) {
        submission.platformProblemId = problemIdBySlug.get(submission.titleSlug);
        if (!submission.platformProblemId) throw upstreamError();
    }
    const rating = leetcodeResponse.userContestRanking?.rating;
    return { contestRating: Number.isFinite(rating) ? Math.trunc(rating) : null, problems, submissions };
}
module.exports = { collectLeetCodeImportData, loadCachedProblemsBySlugs, fetchProblemMetadataBySlugs };

