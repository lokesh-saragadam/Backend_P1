const appLog = require('../utils/logger');
// problemService.js
const database = require('../database/client');
const cheerio = require('cheerio'); // Required for Codeforces scraping

const { prisma } = database;

// Map your platform IDs (adjust these to match your database)
const PLATFORM_LEETCODE = 1;
const PLATFORM_CODEFORCES = 2;

/**
 * FUNCTION 1: Save or update a problem in the database
 */
async function upsertProblem(problemData) {
  try {
    const problem = await prisma.problem.upsert({
      where: {
        platformId_platformProblemId: {
          platformId: problemData.platformId,
          platformProblemId: problemData.platformProblemId,
        },
      },
      update: {
        title: problemData.title,
        titleSlug: problemData.titleSlug,
        description: problemData.description,
        difficulty: problemData.difficulty,
        problemRating: problemData.problemRating,
        tags: problemData.tags,
      },
      create: {
        platformId: problemData.platformId,
        platformProblemId: problemData.platformProblemId,
        title: problemData.title,
        titleSlug: problemData.titleSlug,
        description: problemData.description,
        difficulty: problemData.difficulty,
        problemRating: problemData.problemRating,
        tags: problemData.tags || [],
      },
    });
    return problem;
  } catch (error) {
    appLog.error('operation_failed', { route: 'BackendAPI/services/problemdescription.js' });
    throw error;
  }
}

/**
 * FUNCTION 2: Retrieve all existing problem titles and their platform IDs
 */
async function getExistingProblemTitles() {
  try {
    const problems = await prisma.problem.findMany({
      select: {
        platformId: true,
        platformProblemId: true,
        title: true,
        titleSlug: true
      },
    });
    return problems;
  } catch (error) {
    appLog.error('operation_failed', { route: 'BackendAPI/services/problemdescription.js' });
    throw error;
  }
}

/**
 * FUNCTION 3: Fetch problem description from LeetCode or Codeforces
 */
async function fetchProblemDescription(platformId, problemCode, titleSlug) {
  try {
    if (platformId === PLATFORM_LEETCODE) {
      if (!titleSlug) throw new Error("titleSlug is required for LeetCode API");
      
      // LeetCode uses a GraphQL API
      const query = `
        query questionData($titleSlug: String!) {
          question(titleSlug: $titleSlug) {
            content
          }
        }
      `;
      
      const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { titleSlug }
        })
      });

      const data = await response.json();
      return data.data?.question?.content || null;

    } else if (platformId === PLATFORM_CODEFORCES) {
      // Codeforces API does not return descriptions. We must scrape the HTML.
      // problemCode is usually formatted as "158A" (Contest 158, Problem A)
      const match = problemCode.match(/^(\d+)([A-Za-z]+)$/);
      if (!match) throw new Error("Invalid Codeforces problemCode format. Expected something like '158A'");
      
      const contestId = match[1];
      const index = match[2];
      const url = `https://codeforces.com/problemset/problem/${contestId}/${index}`;

      const response = await fetch(url);
      const html = await response.text();
      
      // Load HTML into Cheerio to extract just the problem statement div
      const $ = cheerio.load(html);
      const problemStatementHtml = $('.problem-statement').html();
      
      if (!problemStatementHtml) {
        throw new Error("Could not parse problem description from Codeforces HTML");
      }
      return problemStatementHtml;
      
    } else {
      throw new Error(`Unsupported platform ID: ${platformId}`);
    }
  } catch (error) {
    appLog.error('operation_failed', { route: 'BackendAPI/services/problemdescription.js' });
    return null;
  }
}
module.exports = { upsertProblem, getExistingProblemTitles, fetchProblemDescription };
