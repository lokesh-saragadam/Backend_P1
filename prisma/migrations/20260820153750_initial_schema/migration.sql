-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('Easy', 'Medium', 'Hard');

-- CreateTable
CREATE TABLE "User" (
    "userid" SERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password" VARCHAR(100) NOT NULL,
    "email" VARCHAR(225) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("userid")
);

-- CreateTable
CREATE TABLE "Platform" (
    "platformid" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("platformid")
);

-- CreateTable
CREATE TABLE "UserHandle" (
    "handleid" SERIAL NOT NULL,
    "userid" INTEGER NOT NULL,
    "platformid" INTEGER NOT NULL,
    "handle" VARCHAR(100) NOT NULL,
    "rating" INTEGER,

    CONSTRAINT "UserHandle_pkey" PRIMARY KEY ("handleid")
);

-- CreateTable
CREATE TABLE "Problem" (
    "problemid" SERIAL NOT NULL,
    "platformid" INTEGER NOT NULL,
    "problemcode" VARCHAR(100) NOT NULL,
    "problemtitle" VARCHAR(255) NOT NULL,
    "titleSlug" VARCHAR(255),
    "difficulty" "Difficulty",
    "rating" INTEGER,
    "tags" TEXT[],

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("problemid")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" SERIAL NOT NULL,
    "userid" INTEGER NOT NULL,
    "problemid" INTEGER NOT NULL,
    "statusDisplay" VARCHAR(50) NOT NULL,
    "language" VARCHAR(50),
    "timestamp" BIGINT NOT NULL,
    "submissionKey" VARCHAR(255) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Platform_name_key" ON "Platform"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserHandle_userid_platformid_key" ON "UserHandle"("userid", "platformid");

-- CreateIndex
CREATE UNIQUE INDEX "UserHandle_platformid_handle_key" ON "UserHandle"("platformid", "handle");

-- CreateIndex
CREATE INDEX "Problem_platformid_idx" ON "Problem"("platformid");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_platformid_problemcode_key" ON "Problem"("platformid", "problemcode");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_submissionKey_key" ON "Submission"("submissionKey");

-- CreateIndex
CREATE INDEX "Submission_userid_idx" ON "Submission"("userid");

-- CreateIndex
CREATE INDEX "Submission_problemid_idx" ON "Submission"("problemid");

-- CreateIndex
CREATE INDEX "Submission_userid_timestamp_idx" ON "Submission"("userid", "timestamp");

-- CreateIndex
CREATE INDEX "Submission_problemid_statusDisplay_idx" ON "Submission"("problemid", "statusDisplay");

-- AddForeignKey
ALTER TABLE "UserHandle" ADD CONSTRAINT "UserHandle_userid_fkey" FOREIGN KEY ("userid") REFERENCES "User"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHandle" ADD CONSTRAINT "UserHandle_platformid_fkey" FOREIGN KEY ("platformid") REFERENCES "Platform"("platformid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_platformid_fkey" FOREIGN KEY ("platformid") REFERENCES "Platform"("platformid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userid_fkey" FOREIGN KEY ("userid") REFERENCES "User"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemid_fkey" FOREIGN KEY ("problemid") REFERENCES "Problem"("problemid") ON DELETE CASCADE ON UPDATE CASCADE;
