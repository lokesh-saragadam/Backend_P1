const { prisma } = require('../database/client');
const { buildCanonicalProblemUrl } = require('../utils/canonicalProblemUrl');

async function main() {
    const problems = await prisma.problem.findMany({
        where: { canonicalUrl: null },
        select: { problemId: true, platformProblemId: true, title : true , platform: { select: { name: true } } }
    });
    let updated = 0;
    for (const problem of problems) {
        // Existing LeetCode rows retain only their numeric ID, not titleSlug.
        // They will receive canonical URLs during the next trusted metadata sync.
        const canonicalUrl = buildCanonicalProblemUrl(problem.platform.name, problem);
        if (!canonicalUrl) continue;
        await prisma.problem.update({ where: { problemId: problem.problemId }, data: {
            canonicalUrl, metadataSource: 'derived_platform_url', metadataUpdatedAt: new Date()
        } });
        updated++;
        if(updated % 100 === 0) console.log(`Updated ${updated} canonical problem URLs.`);
    }
    console.log(`Updated ${updated} canonical problem URLs.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
