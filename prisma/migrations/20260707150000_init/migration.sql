-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "QuizCompetitionMode" AS ENUM ('DAILY_CHALLENGE', 'TOURNAMENT');

-- CreateEnum
CREATE TYPE "QuizDuelStatus" AS ENUM ('PROPOSED', 'AWAITING_STAKES', 'SCHEDULED', 'LIVE', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuizDuelRoundStatus" AS ENUM ('IN_PROGRESS', 'SCORED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuizCompetitionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuizCompetitionVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "QuizCompetitionEntryStatus" AS ENUM ('IN_PROGRESS', 'SCORED', 'DISQUALIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuizCoinLedgerType" AS ENUM ('INITIAL_GRANT', 'COMPETITION_REWARD', 'DUEL_PAYOUT', 'ADMIN_ADJUSTMENT', 'PURCHASE', 'SPEND', 'REFUND');

-- CreateEnum
CREATE TYPE "QuizDailyMissionObjectiveType" AS ENUM ('DAILY_ROUNDS_COMPLETED', 'TOURNAMENT_ROUNDS_COMPLETED', 'SCORED_ROUNDS_AT_OR_ABOVE_PERCENT');

-- CreateEnum
CREATE TYPE "QuizWeeklyMissionObjectiveType" AS ENUM ('DAILY_ROUNDS_COMPLETED', 'TOURNAMENT_ROUNDS_COMPLETED', 'SCORED_ROUNDS_AT_OR_ABOVE_PERCENT');

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT true,
    "profilePictureKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_capture_segments" (
    "id" TEXT NOT NULL,
    "local_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "user_email" TEXT,
    "window_start_at" TIMESTAMP(3) NOT NULL,
    "window_end_at" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "surface_type" TEXT NOT NULL,
    "activity_kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "entities" JSONB NOT NULL DEFAULT '[]',
    "subjects" JSONB NOT NULL DEFAULT '[]',
    "topic_hints" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_event_count" INTEGER NOT NULL DEFAULT 0,
    "generation" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_capture_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizGameProfile" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "lifetimeCoinsEarned" INTEGER NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "dailyRoundsPlayed" INTEGER NOT NULL DEFAULT 0,
    "tournamentRoundsPlayed" INTEGER NOT NULL DEFAULT 0,
    "totalRoundsPlayed" INTEGER NOT NULL DEFAULT 0,
    "totalQuestionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "totalCorrectAnswers" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "lastDailyCompletedAt" TIMESTAMP(3),
    "ownedWorldIds" TEXT[] DEFAULT ARRAY['bg-1']::TEXT[],
    "equippedWorldId" TEXT NOT NULL DEFAULT 'bg-1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizGameProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizCoinLedger" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "QuizCoinLedgerType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizCoinLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizPendingCoinReward" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT,
    "metadata" JSONB,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizPendingCoinReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizCompetition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mode" "QuizCompetitionMode" NOT NULL,
    "status" "QuizCompetitionStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "QuizCompetitionVisibility" NOT NULL DEFAULT 'PUBLIC',
    "description" TEXT,
    "shortLabel" TEXT,
    "impactsLeaderboard" BOOLEAN NOT NULL DEFAULT true,
    "maxEntriesPerUser" INTEGER,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "rulesConfig" JSONB,
    "rewardConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizCompetition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizCompetitionEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "QuizCompetitionEntryStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "localDate" TEXT,
    "periodStartAt" TIMESTAMP(3),
    "periodEndAt" TIMESTAMP(3),
    "timezoneOffsetMinutes" INTEGER,
    "score" DOUBLE PRECISION,
    "correctAnswers" INTEGER,
    "totalQuestions" INTEGER,
    "durationMs" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizCompetitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDuel" (
    "id" TEXT NOT NULL,
    "inviterUserId" INTEGER NOT NULL,
    "opponentUserId" INTEGER NOT NULL,
    "status" "QuizDuelStatus" NOT NULL DEFAULT 'PROPOSED',
    "selectedTimeOptionId" TEXT,
    "selectedStakeOptionId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "stakeLockDeadlineAt" TIMESTAMP(3),
    "scheduledStartAt" TIMESTAMP(3),
    "joinWindowClosesAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "winnerUserId" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizDuel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDuelTimeOption" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "proposedStartAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizDuelTimeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDuelStakeOption" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "coinAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizDuelStakeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDuelStakeLock" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "coinAmount" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "QuizDuelStakeLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDuelRound" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "QuizDuelRoundStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "roundPayload" JSONB NOT NULL,
    "questionWindowStartAt" TIMESTAMP(3) NOT NULL,
    "questionWindowEndAt" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION,
    "correctAnswers" INTEGER,
    "totalQuestions" INTEGER,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizDuelRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizUserAchievement" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizUserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizSystemState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizSystemState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "QuizRoundHistory" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "craft" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "puzzles" JSONB NOT NULL,
    "totalMs" INTEGER NOT NULL,
    "expectedMs" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "benchmarkDelta" DOUBLE PRECISION NOT NULL,
    "insight" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizRoundHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDailyMissionTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objectiveType" "QuizDailyMissionObjectiveType" NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "minimumScorePercent" INTEGER,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "rulesConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizDailyMissionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDailyMissionClaim" (
    "id" TEXT NOT NULL,
    "dayStartAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "missionTemplateId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "QuizDailyMissionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizDailyMissionStreakBonusClaim" (
    "id" TEXT NOT NULL,
    "dayStartAt" TIMESTAMP(3) NOT NULL,
    "streakLength" INTEGER NOT NULL,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "QuizDailyMissionStreakBonusClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizWeeklyMissionTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objectiveType" "QuizWeeklyMissionObjectiveType" NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "minimumScorePercent" INTEGER,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "rulesConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizWeeklyMissionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizWeeklyMissionClaim" (
    "id" TEXT NOT NULL,
    "weekStartAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "missionTemplateId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "QuizWeeklyMissionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "auto_capture_segments_user_id_window_start_at_idx" ON "auto_capture_segments"("user_id", "window_start_at");

-- CreateIndex
CREATE INDEX "auto_capture_segments_user_id_window_end_at_idx" ON "auto_capture_segments"("user_id", "window_end_at");

-- CreateIndex
CREATE INDEX "auto_capture_segments_user_id_surface_type_idx" ON "auto_capture_segments"("user_id", "surface_type");

-- CreateIndex
CREATE INDEX "auto_capture_segments_user_id_activity_kind_idx" ON "auto_capture_segments"("user_id", "activity_kind");

-- CreateIndex
CREATE UNIQUE INDEX "auto_capture_segments_user_id_local_id_key" ON "auto_capture_segments"("user_id", "local_id");

-- CreateIndex
CREATE UNIQUE INDEX "QuizGameProfile_userId_key" ON "QuizGameProfile"("userId");

-- CreateIndex
CREATE INDEX "QuizCoinLedger_userId_createdAt_idx" ON "QuizCoinLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QuizCoinLedger_type_idx" ON "QuizCoinLedger"("type");

-- CreateIndex
CREATE INDEX "QuizCoinLedger_referenceType_referenceId_idx" ON "QuizCoinLedger"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "QuizPendingCoinReward_userId_claimedAt_idx" ON "QuizPendingCoinReward"("userId", "claimedAt");

-- CreateIndex
CREATE INDEX "QuizPendingCoinReward_sourceType_sourceId_idx" ON "QuizPendingCoinReward"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizPendingCoinReward_userId_sourceType_sourceId_key" ON "QuizPendingCoinReward"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizCompetition_slug_key" ON "QuizCompetition"("slug");

-- CreateIndex
CREATE INDEX "QuizCompetition_mode_status_idx" ON "QuizCompetition"("mode", "status");

-- CreateIndex
CREATE INDEX "QuizCompetition_startsAt_endsAt_idx" ON "QuizCompetition"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "QuizCompetitionEntry_competitionId_status_idx" ON "QuizCompetitionEntry"("competitionId", "status");

-- CreateIndex
CREATE INDEX "QuizCompetitionEntry_competitionId_localDate_status_idx" ON "QuizCompetitionEntry"("competitionId", "localDate", "status");

-- CreateIndex
CREATE INDEX "QuizCompetitionEntry_userId_createdAt_idx" ON "QuizCompetitionEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QuizCompetitionEntry_submittedAt_idx" ON "QuizCompetitionEntry"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizCompetitionEntry_competitionId_userId_attemptNumber_key" ON "QuizCompetitionEntry"("competitionId", "userId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QuizCompetitionEntry_competitionId_userId_localDate_key" ON "QuizCompetitionEntry"("competitionId", "userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDuel_selectedTimeOptionId_key" ON "QuizDuel"("selectedTimeOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDuel_selectedStakeOptionId_key" ON "QuizDuel"("selectedStakeOptionId");

-- CreateIndex
CREATE INDEX "QuizDuel_inviterUserId_status_createdAt_idx" ON "QuizDuel"("inviterUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QuizDuel_opponentUserId_status_createdAt_idx" ON "QuizDuel"("opponentUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QuizDuel_status_createdAt_idx" ON "QuizDuel"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QuizDuel_status_scheduledStartAt_idx" ON "QuizDuel"("status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "QuizDuelTimeOption_duelId_proposedStartAt_idx" ON "QuizDuelTimeOption"("duelId", "proposedStartAt");

-- CreateIndex
CREATE INDEX "QuizDuelStakeOption_duelId_coinAmount_idx" ON "QuizDuelStakeOption"("duelId", "coinAmount");

-- CreateIndex
CREATE INDEX "QuizDuelStakeLock_duelId_lockedAt_idx" ON "QuizDuelStakeLock"("duelId", "lockedAt");

-- CreateIndex
CREATE INDEX "QuizDuelStakeLock_userId_lockedAt_idx" ON "QuizDuelStakeLock"("userId", "lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDuelStakeLock_duelId_userId_key" ON "QuizDuelStakeLock"("duelId", "userId");

-- CreateIndex
CREATE INDEX "QuizDuelRound_duelId_status_idx" ON "QuizDuelRound"("duelId", "status");

-- CreateIndex
CREATE INDEX "QuizDuelRound_userId_startedAt_idx" ON "QuizDuelRound"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDuelRound_duelId_userId_key" ON "QuizDuelRound"("duelId", "userId");

-- CreateIndex
CREATE INDEX "QuizUserAchievement_userId_idx" ON "QuizUserAchievement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizUserAchievement_userId_achievementId_key" ON "QuizUserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizRoundHistory_matchId_key" ON "QuizRoundHistory"("matchId");

-- CreateIndex
CREATE INDEX "QuizRoundHistory_userId_idx" ON "QuizRoundHistory"("userId");

-- CreateIndex
CREATE INDEX "QuizRoundHistory_completedAt_idx" ON "QuizRoundHistory"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDailyMissionTemplate_slug_key" ON "QuizDailyMissionTemplate"("slug");

-- CreateIndex
CREATE INDEX "QuizDailyMissionTemplate_isActive_sortOrder_idx" ON "QuizDailyMissionTemplate"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "QuizDailyMissionTemplate_startsAt_endsAt_idx" ON "QuizDailyMissionTemplate"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "QuizDailyMissionClaim_userId_dayStartAt_idx" ON "QuizDailyMissionClaim"("userId", "dayStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDailyMissionClaim_userId_missionTemplateId_dayStartAt_key" ON "QuizDailyMissionClaim"("userId", "missionTemplateId", "dayStartAt");

-- CreateIndex
CREATE INDEX "QuizDailyMissionStreakBonusClaim_userId_claimedAt_idx" ON "QuizDailyMissionStreakBonusClaim"("userId", "claimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizDailyMissionStreakBonusClaim_userId_dayStartAt_key" ON "QuizDailyMissionStreakBonusClaim"("userId", "dayStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizWeeklyMissionTemplate_slug_key" ON "QuizWeeklyMissionTemplate"("slug");

-- CreateIndex
CREATE INDEX "QuizWeeklyMissionTemplate_isActive_sortOrder_idx" ON "QuizWeeklyMissionTemplate"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "QuizWeeklyMissionTemplate_startsAt_endsAt_idx" ON "QuizWeeklyMissionTemplate"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "QuizWeeklyMissionClaim_userId_weekStartAt_idx" ON "QuizWeeklyMissionClaim"("userId", "weekStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizWeeklyMissionClaim_userId_missionTemplateId_weekStartAt_key" ON "QuizWeeklyMissionClaim"("userId", "missionTemplateId", "weekStartAt");

-- AddForeignKey
ALTER TABLE "auto_capture_segments" ADD CONSTRAINT "auto_capture_segments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizGameProfile" ADD CONSTRAINT "QuizGameProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizCoinLedger" ADD CONSTRAINT "QuizCoinLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizPendingCoinReward" ADD CONSTRAINT "QuizPendingCoinReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizCompetitionEntry" ADD CONSTRAINT "QuizCompetitionEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "QuizCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizCompetitionEntry" ADD CONSTRAINT "QuizCompetitionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuel" ADD CONSTRAINT "QuizDuel_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuel" ADD CONSTRAINT "QuizDuel_opponentUserId_fkey" FOREIGN KEY ("opponentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuel" ADD CONSTRAINT "QuizDuel_winnerUserId_fkey" FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuel" ADD CONSTRAINT "QuizDuel_selectedTimeOptionId_fkey" FOREIGN KEY ("selectedTimeOptionId") REFERENCES "QuizDuelTimeOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuel" ADD CONSTRAINT "QuizDuel_selectedStakeOptionId_fkey" FOREIGN KEY ("selectedStakeOptionId") REFERENCES "QuizDuelStakeOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuelTimeOption" ADD CONSTRAINT "QuizDuelTimeOption_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "QuizDuel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuelStakeOption" ADD CONSTRAINT "QuizDuelStakeOption_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "QuizDuel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuelStakeLock" ADD CONSTRAINT "QuizDuelStakeLock_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "QuizDuel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuelStakeLock" ADD CONSTRAINT "QuizDuelStakeLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuelRound" ADD CONSTRAINT "QuizDuelRound_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "QuizDuel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDuelRound" ADD CONSTRAINT "QuizDuelRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizUserAchievement" ADD CONSTRAINT "QuizUserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizRoundHistory" ADD CONSTRAINT "QuizRoundHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDailyMissionClaim" ADD CONSTRAINT "QuizDailyMissionClaim_missionTemplateId_fkey" FOREIGN KEY ("missionTemplateId") REFERENCES "QuizDailyMissionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDailyMissionClaim" ADD CONSTRAINT "QuizDailyMissionClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizDailyMissionStreakBonusClaim" ADD CONSTRAINT "QuizDailyMissionStreakBonusClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizWeeklyMissionClaim" ADD CONSTRAINT "QuizWeeklyMissionClaim_missionTemplateId_fkey" FOREIGN KEY ("missionTemplateId") REFERENCES "QuizWeeklyMissionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizWeeklyMissionClaim" ADD CONSTRAINT "QuizWeeklyMissionClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prevent duplicate winner payouts if duel resolution is retried.
CREATE UNIQUE INDEX "QuizCoinLedger_one_duel_payout_per_duel"
ON "QuizCoinLedger" ("referenceId")
WHERE "type" = 'DUEL_PAYOUT'
  AND "referenceType" = 'QuizDuel'
  AND "referenceId" IS NOT NULL;
