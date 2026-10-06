const { PrismaClient } = require('@prisma/client');
const normalizeVerdict = require('../utils/normalizeVerdict');

const prisma = new PrismaClient();

async function main() {
  const submissions = await prisma.submission.findMany({
    where: {
        OR: [
        { normalizedVerdict: null },
        { normalizedVerdict: 'OTHER' }
        ]
    },
    select: {
      submissionId: true,
      verdict: true,
    },
  });

  console.log(`Found ${submissions.length} submissions to backfill.`);

  for (const submission of submissions) {
    await prisma.submission.update({
      where: {
        submissionId: submission.submissionId,
      },
      data: {
        normalizedVerdict: normalizeVerdict(submission.verdict),
      },
    });
  }

  console.log('Backfill completed.');
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });