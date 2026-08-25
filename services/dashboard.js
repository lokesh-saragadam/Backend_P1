/**
 * dashboard/service.js
 **/

const { prisma } = require('../database/db')
const log = require("../utils/logger");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ============================================================
 * 1. REPOSITORY LAYER — raw data access, no business logic
 * ============================================================ */

/**
 * Total number of UNIQUE problems a user has solved.
 */
async function getTotalSolvedCount(userId) {
  const uniqueSubmissions = await prisma.submission.findMany({
    where: { userid: userId },
    distinct: ['problemid'], // Ensures we don't double-count multiple submissions for the same problem
    select: { problemid: true }
  });
  return uniqueSubmissions.length;
}

/**
 * Solved counts grouped by difficulty in a single query.
 */
async function getSolvedCountsByDifficulty(userId) {
  // Fetch unique solved problems and their difficulties
  const solved = await prisma.submission.findMany({
    where: { userid: userId },
    distinct: ['problemid'],
    select: {
      problem: {
        select: { difficulty: true },
      },
    },
  });

  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  for (const { problem } of solved) {
    if (problem?.difficulty && counts[problem.difficulty] !== undefined) {
      counts[problem.difficulty]++;
    }
  }
  return counts;
}

/**
 * Solved counts grouped by rating.
 */
async function getSolvedCountsByRating(userId) {
  const solved = await prisma.submission.findMany({
    where: { userid: userId },
    distinct: ['problemid'],
    select: {
      problem: {
        select: { rating: true },
      },
    },
  });

  const counts = {}; 
  for (const { problem } of solved) {
    const rating = problem?.rating;
    
    if (typeof rating === 'number' && rating >= 800) {
      counts[Number(rating)] = (counts[rating] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Fetch every distinct calendar date on which the user solved a problem.
 */
async function getDistinctSolvedDates(userId) {
  const rows = await prisma.submission.findMany({
    where: {
      userid: userId,
    },
    select: { timestamp: true },
    orderBy: { timestamp: 'desc' },
  });

  const dateSet = new Set();
  for (const row of rows) {
    // Convert BigInt timestamp to Date object
    const dateObj = new Date(Number(row.timestamp));
    dateSet.add(toDateOnlyString(dateObj));
  }

  return Array.from(dateSet).sort((a, b) => (a < b ? 1 : -1)); // desc
}

/**
 * Tags / topics grouped by solved problem.
 */
async function getSolvedCountByTopic(userId){
  const uniqueSubmissions = await prisma.submission.findMany({
    where:{ userid: userId },
    distinct: ['problemid'],
    select: { problemid: true }
  });

  const taggedData = await prisma.problem.groupBy({
    by: ['tags'],
    where: {
      problemid: { in: uniqueSubmissions.map(p => p.problemid) },
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
 * Grouped solved counts by month/year.
 */
async function getSolvedByMonths(userId){
  const rows = await prisma.submission.findMany({
    where: {
      userid: userId,
    },
    select: { timestamp: true },
    orderBy: { timestamp: 'desc' },
  });

  return rows.reduce((acc, row) => {
    // Convert BigInt to standard Date object
    const date = new Date(Number(row.timestamp)); 
    
    const monthYear = date.toLocaleString('default', { 
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
    where: { userid: userId },
  });
}

/**
 * Connected platform names.
 */
async function getConnectedPlatformNames(userId) {
  const handles = await prisma.userHandle.findMany({
    where: { userid: userId },
    select: { platform: { select: { name: true } } },
  });
  return handles.map((h) => h.platform.name);
}

/**
 * Most recent solved-problem timestamp.
 */
async function getLastSolvedTimestamp(userId) {
  const latest = await prisma.submission.findFirst({
    where: { userid: userId, },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  
  // Convert BigInt back to Date for the relative time formatter
  return latest?.timestamp ? new Date(Number(latest.timestamp)) : null;
}

/**
 * Activity Heatmap data.
 */
async function getDailycounts(userId){
  const rows = await prisma.submission.findMany({
    where: {
      userid: userId, 
    },
    orderBy: {
      timestamp: 'desc',
    },
    select: {
      timestamp: true,
    }
  });

  return rows.reduce((accumulator, record) => {
    const dateObj = new Date(Number(record.timestamp));
    const dateStr = dateObj.toISOString().split('T')[0];

    if (!accumulator[dateStr]) {
      accumulator[dateStr] = 0;
    }
    accumulator[dateStr]++;
    return accumulator;
  }, {}); 
}

/**
 * Most recent N solved problems with problem + platform info attached.
 */
async function getRecentActivity(userId, limit = 10) {
  const rows = await prisma.submission.findMany({
    where: { userid: userId },
    orderBy: { timestamp: 'desc' },
    take: limit,
    select: {
      problemid: true,
      timestamp: true,
      statusDisplay: true,
      language: true,
      problem: {
        select: {
          problemtitle: true,
          difficulty: true,
          rating: true,
          platform: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    problemId: row.problemid,
    title: row.problem.problemtitle,
    difficulty: row.problem.difficulty ?? null,
    rating: row.problem.rating ?? null,
    platform: row.problem.platform.name,
    language: row.language,
    status: row.statusDisplay, // Map schema field to expected object property
    solvedAt: new Date(Number(row.timestamp)), // Convert BigInt to Date
  }));
}

/* ------------------------------------------------------------
 * Mutation queries (the "modifications" side of the service)
 * ------------------------------------------------------------ */

/**
 * Mark a problem as solved manually.
 */
async function markProblemSolved({
  userId,
  problemId,
  status = 'Accepted',
  language = null,
  solvedAt = new Date(),
}) {
  log("dashboard.js","markProblemSolved","Request received");
  
  const unixTimestamp = BigInt(new Date(solvedAt).getTime());
  const submissionKey = `${userId}_${problemId}_${unixTimestamp.toString()}`;

  const res = await prisma.submission.upsert({
    where: {
      submissionKey: submissionKey
    },
    update: { 
      statusDisplay: status, 
      language: language 
    },
    create: {
      userid: userId,
      problemid: problemId,
      statusDisplay: status,
      language: language,
      timestamp: unixTimestamp,
      submissionKey: submissionKey
    },
  });
  
  log("dashboard.js","markProblemSolved","Request resolved");
  return res;
}

/**
 * Undo a solved-problem record. Because Submissions allow multiple 
 * records per problem, this deletes ALL submissions for that problem by that user.
 */
async function unmarkProblemSolved(userId, problemId) {
  log("dashboard.js","unmarkProblemSolved","Request received");
  
  const res = await prisma.submission.deleteMany({
    where: { 
        userid: userId, 
        problemid: problemId 
    },
  });
  
  log("dashboard.js","unmarkProblemSolved","Request resolved");
  return res;
}

// ... upsertProblem, addUserHandle, updateUserHandleRating, removeUserHandle 
// and the rest of the utility functions remain exactly the same as your original file ...

// (The remaining code is unchanged, skipped here to keep the response concise.)
/**
 * Create or update a Problem row (e.g. when syncing problems in from a
 * platform's API). Unique on [platformid, problemcode].
 */
async function upsertProblem({
  platformId,
  problemCode,
  problemTitle,
  difficulty = null, // Difficulty enum, LeetCode only
  rating = null, // Codeforces only
  tags = [],
}) {
    log("dashboard.js","upsertProblem","Request recieved");

  return prisma.problem.upsert({
    where: {
      platformid_problemcode: {
        platformid: platformId,
        problemcode: problemCode,
      },
    },
    update: { problemtitle: problemTitle, difficulty, rating, tags },
    create: {
      platformid: platformId,
      problemcode: problemCode,
      problemtitle: problemTitle,
      difficulty,
      rating,
      tags,
    },
  });

}
 
/**
 * Connect a new platform handle for a user (e.g. linking their
 * LeetCode username). Unique on [userid, platformid].
 */
async function addUserHandle({ userId, platformId, handle, rating = null }) {
  return prisma.userHandle.create({
    data: {
      userid: userId,
      platformid: platformId,
      handle,
      rating,
    },
  });
}
 
/**
 * Update the cached rating for an existing handle (e.g. after a
 * periodic sync pulls the user's latest Codeforces rating).
 */
async function updateUserHandleRating(handleId, rating) {
  return prisma.userHandle.update({
    where: { handleid: handleId },
    data: { rating },
  });
}
 
/**
 * Disconnect a platform handle.
 */
async function removeUserHandle(handleId) {
  return prisma.userHandle.delete({
    where: { handleid: handleId },
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
 *   while solved(today): streak++, today -= 1 day
 * If the user hasn't solved anything today, the streak is 0
 * (no grace day — matches the algorithm as given).
 *
 * @param {string[]} solvedDatesDesc - distinct solved dates, "YYYY-MM-DD", descending
 */
function calculateCurrentStreak(solvedDatesDesc) {
  const solvedSet = new Set(solvedDatesDesc);
  let streak = 0;
  let cursor = toDateOnlyString(new Date());
 
  while (solvedSet.has(cursor)) {
    streak++;
    cursor = subtractDays(cursor, 1);
  }
  
  return streak;
}
 
/**
 * Longest streak ever, found by scanning the full solved-date history
 * once and tracking the longest run of consecutive calendar days.
 *
 * @param {string[]} solvedDatesDesc - distinct solved dates, "YYYY-MM-DD", descending
 */
function calculateLongestStreak(solvedDatesDesc) {
  if (solvedDatesDesc.length === 0) return 0;
 
  // Work ascending so we can walk forward day-by-day.
  const datesAsc = [...solvedDatesDesc].reverse();
 
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
 * totals, difficulty breakdown, streaks, platforms, last sync.
 */
async function getDashboardOverview(userId) {
  const [totalSolved, difficultyCounts,ratingCounts, solvedDates, platformsConnected, lastSolvedAt] =
    await Promise.all([
      getTotalSolvedCount(userId),
      getSolvedCountsByDifficulty(userId),
      getSolvedCountsByRating(userId),
      getDistinctSolvedDates(userId),
      getConnectedPlatformsCount(userId),
      getLastSolvedTimestamp(userId),
    ]);
  return {
    totalSolved,
    easy: difficultyCounts.Easy,
    medium: difficultyCounts.Medium,
    hard: difficultyCounts.Hard,
    ratingCounts: ratingCounts,
    currentStreak: calculateCurrentStreak(solvedDates),
    longestStreak: calculateLongestStreak(solvedDates),
    platformsConnected,
    lastSync: formatRelativeTime(lastSolvedAt),
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
    solvedAtRelative: formatRelativeTime(item.solvedAt),
  }));
  const SolvedAtMonths = await getSolvedByMonths(userId);
  const TopicWiseSolved = await getSolvedCountByTopic(userId);
  const DailyCounts = await getDailycounts(userId);
  return { overview, recentActivity ,SolvedAtMonths,TopicWiseSolved,DailyCounts};
}
 
/* ============================================================
 * Exports
 * ============================================================ */
 
module.exports = {
  // Repository layer (pure data access)
  getTotalSolvedCount,
  getSolvedCountsByDifficulty,
  getSolvedCountsByRating,
  getDistinctSolvedDates,
  getSolvedByMonths,
  getDailycounts,
  getConnectedPlatformsCount,
  getConnectedPlatformNames,
  getLastSolvedTimestamp,
  getRecentActivity,
  markProblemSolved,
  unmarkProblemSolved,
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