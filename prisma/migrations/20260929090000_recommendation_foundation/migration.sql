-- Phase 1 repair: preserve the raw platform verdict, but make its normalized
-- learning category reliable for both existing and future rows.
UPDATE "Submission"
SET "normalizedVerdict" = CASE
  WHEN upper(trim("statusDisplay")) IN ('ACCEPTED', 'OK') THEN 'ACCEPTED'
  WHEN upper(regexp_replace(trim("statusDisplay"), '\\s+', '_', 'g')) IN
    ('WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED',
     'RUNTIME_ERROR', 'COMPILATION_ERROR', 'COMPILE_ERROR') THEN 'FAILED'
  ELSE 'OTHER'
END
WHERE "normalizedVerdict" IS NULL;

ALTER TABLE "Submission"
  RENAME COLUMN "normalizedVerdict" TO "normalized_verdict";

ALTER TABLE "Submission"
  ALTER COLUMN "normalized_verdict" SET NOT NULL,
  ALTER COLUMN "normalized_verdict" SET DEFAULT 'OTHER',
  ADD COLUMN "platform_submission_id" VARCHAR(100),
  ADD COLUMN "source" VARCHAR(50);

ALTER TABLE "Problem"
  ADD COLUMN "canonical_url" VARCHAR(500),
  ADD COLUMN "metadata_source" VARCHAR(100),
  ADD COLUMN "metadata_updated_at" TIMESTAMP(3);

CREATE INDEX "Submission_userid_normalized_verdict_problemid_idx"
  ON "Submission"("userid", "normalized_verdict", "problemid");

CREATE TABLE "ProblemMetadata" (
  "problem_metadata_id" SERIAL NOT NULL,
  "problemid" INTEGER NOT NULL,
  "patterns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "concepts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "prerequisites" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "learning_objectives" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "provenance" VARCHAR(50) NOT NULL DEFAULT 'unreviewed',
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemMetadata_pkey" PRIMARY KEY ("problem_metadata_id"),
  CONSTRAINT "ProblemMetadata_problemid_key" UNIQUE ("problemid"),
  CONSTRAINT "ProblemMetadata_problemid_fkey" FOREIGN KEY ("problemid") REFERENCES "Problem"("problemid") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TYPE "RecommendationOutcome" AS ENUM ('NOT_YET_KNOWN', 'ACCEPTED', 'ATTEMPTED_NOT_SOLVED', 'DISMISSED', 'EXPIRED');

CREATE TABLE "Recommendation" (
  "recommendation_id" SERIAL NOT NULL,
  "userid" INTEGER NOT NULL,
  "problemid" INTEGER NOT NULL,
  "score" DOUBLE PRECISION,
  "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "component_scores" JSONB,
  "model_version" VARCHAR(100) NOT NULL DEFAULT 'rule-based-v1',
  "recommended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shown_at" TIMESTAMP(3), "opened_at" TIMESTAMP(3), "dismissed_at" TIMESTAMP(3), "started_at" TIMESTAMP(3),
  "outcome" "RecommendationOutcome" NOT NULL DEFAULT 'NOT_YET_KNOWN',
  CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("recommendation_id"),
  CONSTRAINT "Recommendation_userid_fkey" FOREIGN KEY ("userid") REFERENCES "User"("userid") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Recommendation_problemid_fkey" FOREIGN KEY ("problemid") REFERENCES "Problem"("problemid") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Recommendation_userid_outcome_recommended_at_idx" ON "Recommendation"("userid", "outcome", "recommended_at");
CREATE INDEX "Recommendation_userid_problemid_idx" ON "Recommendation"("userid", "problemid");

CREATE TABLE "UserProblemContext" (
  "user_problem_context_id" SERIAL NOT NULL,
  "userid" INTEGER NOT NULL,
  "problemid" INTEGER NOT NULL,
  "confidence" INTEGER, "time_spent_seconds" INTEGER, "hints_used" BOOLEAN,
  "perceived_difficulty" INTEGER, "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProblemContext_pkey" PRIMARY KEY ("user_problem_context_id"),
  CONSTRAINT "UserProblemContext_userid_problemid_key" UNIQUE ("userid", "problemid"),
  CONSTRAINT "UserProblemContext_userid_fkey" FOREIGN KEY ("userid") REFERENCES "User"("userid") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserProblemContext_problemid_fkey" FOREIGN KEY ("problemid") REFERENCES "Problem"("problemid") ON DELETE CASCADE ON UPDATE CASCADE
);
