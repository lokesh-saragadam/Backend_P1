/*
  Warnings:

  - You are about to alter the column `normalized_verdict` on the `Submission` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - A unique constraint covering the columns `[userid,problemid]` on the table `Recommendation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Submission" ALTER COLUMN "normalized_verdict" SET DATA TYPE VARCHAR(20);

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_userid_problemid_key" ON "Recommendation"("userid", "problemid");
