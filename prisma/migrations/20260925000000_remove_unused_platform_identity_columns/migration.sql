-- Native IDs remain part of Submission.deduplicationKey; neither value is stored separately.
DROP INDEX IF EXISTS "Problem_platformid_titleSlug_key";
DROP INDEX IF EXISTS "Submission_userid_problemid_platformSubmissionId_key";
ALTER TABLE "Problem" DROP COLUMN IF EXISTS "titleSlug";
ALTER TABLE "Submission" DROP COLUMN IF EXISTS "platformSubmissionId";
