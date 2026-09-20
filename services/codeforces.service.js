const axios = require('axios');
const HttpError = require('../utils/httpError');

async function fetchCodeforces(method, params) {
    const response = await axios.get('https://codeforces.com/api/' + method, { params, timeout: 10000 });
    if (response.data?.status !== 'OK' || !Array.isArray(response.data.result)) {
        throw new HttpError(502, 'Codeforces returned incomplete data. Please try again.', 'CODEFORCES_DATA_UNAVAILABLE');
    }
    return response.data.result;
}
async function fetchUserSubmissions(handle) { return fetchCodeforces('user.status', { handle }); }
async function fetchUserProfile(handle) {
    const profiles = await fetchCodeforces('user.info', { handles: handle });
    if (!profiles[0]) throw new HttpError(502, 'Codeforces profile was not found.', 'CODEFORCES_DATA_UNAVAILABLE');
    return profiles[0];
}
function normalizeSubmissionsAndProblems(platformSubmissions) {
    const problemsById = new Map();
    const submissions = platformSubmissions.map(submission => {
        const problem = submission.problem;
        const submittedAtMs = submission.creationTimeSeconds * 1000;
        if (!problem || !Number.isSafeInteger(problem.contestId) || typeof problem.index !== 'string' ||
            !Number.isSafeInteger(submission.id) || !Number.isSafeInteger(submittedAtMs) ||
            submittedAtMs < Date.UTC(2000, 0, 1) || submittedAtMs > Date.now() + 86400000 ||
            typeof problem.name !== 'string' || !Array.isArray(problem.tags)) {
            throw new HttpError(502, 'Codeforces returned incomplete data. Please try again.', 'CODEFORCES_DATA_UNAVAILABLE');
        }
        const platformProblemId = problem.contestId + '-' + problem.index;
        problemsById.set(platformProblemId, {
            platformProblemId, title: problem.name, problemRating: problem.rating ?? null, tags: problem.tags
        });
        return {
            platformProblemId, platformSubmissionId: String(submission.id),
            verdict: submission.verdict || 'PENDING', submittedAtMs, language: submission.programmingLanguage || null
        };
    });
    return { problems: [...problemsById.values()], submissions };
}
async function collectCodeforcesImportData(codeforcesHandle) {
    const [platformSubmissions, userProfile] = await Promise.all([
        fetchUserSubmissions(codeforcesHandle), fetchUserProfile(codeforcesHandle)
    ]);
    return { contestRating: userProfile.rating ?? null, ...normalizeSubmissionsAndProblems(platformSubmissions) };
}
module.exports = { collectCodeforcesImportData, normalizeSubmissionsAndProblems };

