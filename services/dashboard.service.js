/**
 * dashboard/service.js
 **/

const { prisma } = require('../database/client')
const log = require("../utils/logger");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ============================================================
 * 1. REPOSITORY LAYER — raw data access, no business logic
 * ============================================================ */

/**
 * Total number of UNIQUE problems a user has attempted.
 */
async function getUniqueAttemptedProblemCount(userId) {
  const attemptedProblems = await prisma.submission.findMany({
    where: { userId: userId },
    distinct: ['problemId'], // Ensures we don't double-count multiple submissions for the same problem
    select: { problemId: true }
  });
  return attemptedProblems.length;
}

/**
 * Attempted counts grouped by difficulty in a single query.
 */
async function getAttemptedProblemCountsByDifficulty(userId) {
  // Fetch unique attempted problems and their difficulties
  const attemptedProblems = await prisma.submission.findMany({
    where: { userId: userId },
    distinct: ['problemId'],
    select: {
      problem: {
        select: { difficulty: true },
      },
    },
  });

  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  for (const { problem } of attemptedProblems) {
    if (problem?.difficulty && counts[problem.difficulty] !== undefined) {
      counts[problem.difficulty]++;
    }
  }
  return counts;
}

/**
 * Attempted counts grouped by problemRating.
 */
async function getAttemptedProblemCountsByRating(userId) {
  const attemptedProblems = await prisma.submission.findMany({
    where: { userId: userId },
    distinct: ['problemId'],
    select: {
      problem: {
        select: { problemRating: true },
      },
    },
  });

  const counts = {}; 
  for (const { problem } of attemptedProblems) {
    const problemRating = problem?.problemRating;
    
    if (typeof problemRating === 'number' && problemRating >= 800) {
      counts[Number(problemRating)] = (counts[problemRating] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Fetch every distinct calendar date on which the user attempted a problem.
 */
async function getActivityDates(userId) {
  const rows = await prisma.submission.findMany({
    where: {
      userId: userId,
    },
    select: { submittedAtMs: true },
    orderBy: { submittedAtMs: 'desc' },
  });

  const dateSet = new Set();
  for (const row of rows) {
    // Convert BigInt submittedAtMs to Date object
    const dateObj = new Date(Number(row.submittedAtMs));
    dateSet.add(toDateOnlyString(dateObj));
  }

  return Array.from(dateSet).sort((a, b) => (a < b ? 1 : -1)); // desc
}

/**
 * Tags / topics grouped by attempted problem.
 */
async function getAttemptedProblemCountsByTopic(userId){
  const attemptedProblems = await prisma.submission.findMany({
    where:{ userId: userId },
    distinct: ['problemId'],
    select: { problemId: true }
  });

  const taggedData = await prisma.problem.findMany({
    select: { tags: true },
    where: {
      problemId: { in: attemptedProblems.map(p => p.problemId) },
    }
  });

  return taggedData.reduce((acc, currentItem) => {
    currentItem.tags.forEach(tag => {
      acc[tag] = (acc[tag] || 0) + 1;
    });
    return acc;
  }, {});
}

/**
 * Grouped attempted counts by month/year.
 */
async function getSubmissionCountsByMonth(userId){
  const rows = await prisma.submission.findMany({
    where: {
      userId: userId,
    },
    select: { submittedAtMs: true },
    orderBy: { submittedAtMs: 'desc' },
  });

  return rows.reduce((acc, row) => {
    // Convert BigInt to standard Date object
    const date = new Date(Number(row.submittedAtMs)); 
    
    const monthYear = date.toLocaleString('en-US', { timeZone: 'UTC', 
      month: 'long', 
      year: 'numeric' 
    });

    if (!acc[monthYear]) {
      acc[monthYear] = 0; 
    }
    acc[monthYear]++;
    return acc;
  }, {});
}

/**
 * Connected platform count.
 */
async function getConnectedPlatformsCount(userId) {
  return prisma.userHandle.count({
    where: { userId: userId },
  });
}

/**
 * Connected platform names.
 */
async function getConnectedPlatformNames(userId) {
  const handles = await prisma.userHandle.findMany({
    where: { userId: userId },
    select: { platform: { select: { name: true } } },
  });
  return handles.map((h) => h.platform.name);
}

/**
 * Most recent attempted-problem submittedAtMs.
 */
async function getLastSubmissionTimestamp(userId) {
  const latest = await prisma.submission.findFirst({
    where: { userId: userId, },
    orderBy: { submittedAtMs: 'desc' },
    select: { submittedAtMs: true },
  });
  
  // Convert BigInt back to Date for the relative time formatter
  return latest?.submittedAtMs ? new Date(Number(latest.submittedAtMs)) : null;
}

/**
 * Activity Heatmap data.
 */
async function getSubmissionCountsByDate(userId){
  const rows = await prisma.submission.findMany({
    where: {
      userId: userId, 
    },
    orderBy: {
      submittedAtMs: 'desc',
    },
    select: {
      submittedAtMs: true,
    }
  });

  return rows.reduce((accumulator, record) => {
    const dateObj = new Date(Number(record.submittedAtMs));
    const dateStr = dateObj.toISOString().split('T')[0];

    if (!accumulator[dateStr]) {
      accumulator[dateStr] = 0;
    }
    accumulator[dateStr]++;
    return accumulator;
  }, {}); 
}

/**
 * Most recent N attempted problems with problem + platform info attached.
 */
async function getRecentActivity(userId, limit = 10) {
  const rows = await prisma.submission.findMany({
    where: { userId: userId },
    orderBy: { submittedAtMs: 'desc' },
    take: limit,
    select: {
      submissionId: true,
      problemId: true,
      submittedAtMs: true,
      verdict: true,
      language: true,
      problem: {
        select: {
          title: true,
          difficulty: true,
          problemRating: true,
          platform: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    submissionId: row.submissionId,
    problemId: row.problemId,
    title: row.problem.title,
    difficulty: row.problem.difficulty ?? null,
    problemRating: row.problem.problemRating ?? null,
    platform: row.problem.platform.name,
    language: row.language,
    verdict: row.verdict,
    submittedAt: new Date(Number(row.submittedAtMs)), // Convert BigInt to Date
  }));
}

/* ------------------------------------------------------------
 * Mutation queries (the "modifications" side of the service)
 * ------------------------------------------------------------ */

/**
 * Mark a problem as attempted manually.
 */
async function recordManualSubmission({
  userId,
  problemId,
  status = 'Accepted',
  language = null,
  submittedAt = new Date(),
}) {
  log("dashboard.service.js","recordManualSubmission","Request received");
  
  const unixTimestamp = BigInt(new Date(submittedAt).getTime());
  const deduplicationKey = `${userId}_${problemId}_${unixTimestamp.toString()}`;

  const res = await prisma.submission.upsert({
    where: {
      deduplicationKey: deduplicationKey
    },
    update: { 
      verdict: status, 
      language: language 
    },
    create: {
      userId: userId,
      problemId: problemId,
      verdict: status,
      language: language,
      submittedAtMs: unixTimestamp,
      deduplicationKey: deduplicationKey
    },
  });
  
  log("dashboard.js","recordManualSubmission","Request resolved");
  return res;
}

/**
 * Undo a attempted-problem record. Because Submissions allow multiple 
 * records per problem, this deletes ALL submissions for that problem by that user.
 */
async function deleteProblemSubmissions(userId, problemId) {
  log("dashboard.js","deleteProblemSubmissions","Request received");
  
  const res = await prisma.submission.deleteMany({
    where: { 
        userId: userId, 
        problemId: problemId 
    },
  });
  
  log("dashboard.js","deleteProblemSubmissions","Request resolved");
  return res;
}

/**
 * Create or update a Problem row (e.g. when syncing problems in from a
 * platform's API). Unique on [platformId, platformProblemId].
 */
async function upsertProblem({
  platformId,
  platformProblemId,
  title,
  difficulty = null, // Difficulty enum, LeetCode only
  problemRating = null, // Codeforces only
  tags = [],
}) {
    log("dashboard.js","upsertProblem","Request recieved");

  return prisma.problem.upsert({
    where: {
      platformId_platformProblemId: {
        platformId: platformId,
        platformProblemId: platformProblemId,
      },
    },
    update: { title: title, difficulty, problemRating, tags },
    create: {
      platformId: platformId,
      platformProblemId: platformProblemId,
      title: title,
      difficulty,
      problemRating,
      tags,
    },
  });

}
 
/**
 * Connect a new platform handle for a user (e.g. linking their
 * LeetCode username). Unique on [userId, platformId].
 */
async function addUserHandle({ userId, platformId, handle, contestRating = null }) {
  return prisma.userHandle.create({
    data: {
      userId: userId,
      platformId: platformId,
      handle,
      contestRating,
    },
  });
}
 
/**
 * Update the cached contestRating for an existing handle (e.g. after a
 * periodic sync pulls the user's latest Codeforces contestRating).
 */
async function updateUserHandleRating(userHandleId, contestRating) {
  return prisma.userHandle.update({
    where: { userHandleId: userHandleId },
    data: { contestRating },
  });
}
 
/**
 * Disconnect a platform handle.
 */
async function removeUserHandle(userHandleId) {
  return prisma.userHandle.delete({
    where: { userHandleId: userHandleId },
  });
}
 
/* ============================================================
 * 2. SERVICE LAYER — business logic, calculations, composition
 * ============================================================ */
 
/**
 * Convert a Date to a "YYYY-MM-DD" string (day granularity only).
 */
function toDateOnlyString(date) {
  return new Date(date).toISOString().split('T')[0];
}
 
/**
 * Subtract `days` days from a "YYYY-MM-DD" string, returning a new
 * "YYYY-MM-DD" string.
 */
function subtractDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return toDateOnlyString(d);
}
 
/**
 * Current streak, per the spec:
 *   today = today's date
 *   while attempted(today): streak++, today -= 1 day
 * If the user hasn't submitted anything today, the streak is 0
 * (no grace day — matches the algorithm as given).
 *
 * @param {string[]} activityDatesDesc - distinct attempted dates, "YYYY-MM-DD", descending
 */
function calculateCurrentStreak(activityDatesDesc) {
  const activityDateSet = new Set(activityDatesDesc);
  let streak = 0;
  let cursor = toDateOnlyString(new Date());
 
  while (activityDateSet.has(cursor)) {
    streak++;
    cursor = subtractDays(cursor, 1);
  }
  
  return streak;
}
 
/**
 * Longest streak ever, found by scanning the full attempted-date history
 * once and tracking the longest run of consecutive calendar days.
 *
 * @param {string[]} activityDatesDesc - distinct attempted dates, "YYYY-MM-DD", descending
 */
function calculateLongestStreak(activityDatesDesc) {
  if (activityDatesDesc.length === 0) return 0;
 
  // Work ascending so we can walk forward day-by-day.
  const datesAsc = [...activityDatesDesc].reverse();
 
  let longest = 1;
  let current = 1;
 
  for (let i = 1; i < datesAsc.length; i++) {
    const prevMs = Date.parse(`${datesAsc[i - 1]}T00:00:00.000Z`);
    const currMs = Date.parse(`${datesAsc[i]}T00:00:00.000Z`);
    const dayDiff = Math.round((currMs - prevMs) / MS_PER_DAY);
 
    if (dayDiff === 1) {
      current++;
    } else if (dayDiff > 1) {
      current = 1; // streak broken, reset
    }
    // dayDiff === 0 shouldn't happen since dates are deduped, but if it
    // did we'd just ignore it (same day, no change to streak).
 
    longest = Math.max(longest, current);
  }
 
  return longest;
}
 
/**
 * Human-friendly relative time, e.g. "3 minutes ago", "Yesterday", "5 days ago".
 */
function formatRelativeTime(date) {
  if (!date) return null;
 
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
 
  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / MS_PER_DAY);
 
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
 
/**
 * Builds the "overview" section of the dashboard response:
 * totals, difficulty breakdown, streaks, platforms, last submission.
 */
async function getDashboardOverview(userId) {
  const [uniqueAttemptedProblems, difficultyCounts,problemCountsByRating, activityDates, platformsConnected, lastSubmissionAt] =
    await Promise.all([
      getUniqueAttemptedProblemCount(userId),
      getAttemptedProblemCountsByDifficulty(userId),
      getAttemptedProblemCountsByRating(userId),
      getActivityDates(userId),
      getConnectedPlatformsCount(userId),
      getLastSubmissionTimestamp(userId),
    ]);
  return {
    uniqueAttemptedProblems,
    easy: difficultyCounts.Easy,
    medium: difficultyCounts.Medium,
    hard: difficultyCounts.Hard,
    problemCountsByRating: problemCountsByRating,
    currentStreak: calculateCurrentStreak(activityDates),
    longestStreak: calculateLongestStreak(activityDates),
    platformsConnected,
    lastSubmissionAtRelative: formatRelativeTime(lastSubmissionAt),
  };
}
 
/**
 * Builds the full single-call dashboard payload:
 *   { overview: {...}, recentActivity: [...] }
 *
 * This is what the /dashboard endpoint's controller should call.
 */
async function getDashboardData(userId, { recentActivityLimit = 10 } = {}) {
  const [overview, recentActivityRaw] = await Promise.all([
    getDashboardOverview(userId),
    getRecentActivity(userId, recentActivityLimit),
  ]);
 
  const recentActivity = recentActivityRaw.map((item) => ({
    ...item,
    submittedAtRelative: formatRelativeTime(item.submittedAt),
  }));
  const submissionCountsByMonth = await getSubmissionCountsByMonth(userId);
  const attemptedProblemCountsByTopic = await getAttemptedProblemCountsByTopic(userId);
  const submissionCountsByDate = await getSubmissionCountsByDate(userId);
  return { overview, recentActivity ,submissionCountsByMonth,attemptedProblemCountsByTopic,submissionCountsByDate};
}
 
/* ============================================================
 * Exports
 * ============================================================ */
 
module.exports = {
  // Repository layer (pure data access)
  getUniqueAttemptedProblemCount,
  getAttemptedProblemCountsByDifficulty,
  getAttemptedProblemCountsByTopic,
  getAttemptedProblemCountsByRating,
  getActivityDates,
  getSubmissionCountsByMonth,
  getSubmissionCountsByDate,
  getConnectedPlatformsCount,
  getConnectedPlatformNames,
  getLastSubmissionTimestamp,
  getRecentActivity,
  recordManualSubmission,
  deleteProblemSubmissions,
  upsertProblem,
  addUserHandle,
  updateUserHandleRating,
  removeUserHandle,
  
  // Service layer (business logic / composition)
  calculateCurrentStreak,
  calculateLongestStreak,
  formatRelativeTime,
  getDashboardOverview,
  getDashboardData,
};