-- Additive migration: preserve existing IDs, foreign keys and submission keys.
ALTER TABLE "Problem" ADD COLUMN "titleSlug" VARCHAR(255);
ALTER TABLE "Submission" ADD COLUMN "platformSubmissionId" VARCHAR(100);
CREATE UNIQUE INDEX "Problem_platformid_titleSlug_key" ON "Problem"("platformid", "titleSlug");
CREATE UNIQUE INDEX "Submission_userid_problemid_platformSubmissionId_key"
    ON "Submission"("userid", "problemid", "platformSubmissionId");
-- Slugs and native submission IDs are filled from authoritative responses on sync.
