const { PrismaClient } = require('@prisma/client');
const normalizeVerdict = require('../utils/normalizeVerdict');

const prisma = new PrismaClient();

async function main() {
  const testSubmission = {
    submissionId: 999999999,
    verdict: 'OK',
    language: 'TEST',
    submittedAtMs: BigInt(Date.now()),
  };

  const normalizedVerdict = normalizeVerdict(testSubmission.verdict);

  console.log('Raw verdict:', testSubmission.verdict);
  console.log('Normalized verdict:', normalizedVerdict);

  const submission = await prisma.submission.create({
    data: {
      submissionId: testSubmission.submissionId,
      verdict: testSubmission.verdict,
      normalizedVerdict,
      language: testSubmission.language,
      submittedAtMs: testSubmission.submittedAtMs,
      deduplicationKey: `test:${testSubmission.submissionId}`,

      userId: 1, // Replace with a valid userId from your database
      problemId: 1, // Replace with a valid problemId from your database
      // IMPORTANT:
      // Your Submission model probably requires userId/problemId/etc.
      // Add those required fields from your actual schema here.
    },
  });

  console.log('\nInserted submission:');
  console.log({
    submissionId: submission.submissionId,
    verdict: submission.verdict,
    normalizedVerdict: submission.normalizedVerdict,
  });
}

main()
  .catch((error) => {
    console.error('Import test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });