import httpStatus from "http-status";
import {
  AutoCaptureSegment,
  Prisma,
  QuizCoinLedgerType,
  QuizCompetition,
  QuizCompetitionEntryStatus,
  QuizCompetitionMode,
  QuizCompetitionStatus,
  QuizCompetitionVisibility,
} from "@prisma/client";
import prisma from "../client";
import ApiError from "../utils/ApiError";
import { decrypt } from "../utils/hash";
import {
  buildCompetitionRoundSystemPrompt,
  buildCompetitionRoundUserPrompt,
} from "./quizPrompts";
import {
  evaluateAndUnlockAchievements,
  getProfileAchievements,
  checkAndRunWeeklyLeaderboardReset,
  getCurrentTopPerformerSummary,
} from "./achievements.service";
import quizMissionsService from "./quizMissions.service";
import quizRewardsService from "./quizRewards.service";

const LEVEL_XP_STEP = 100;
const INITIAL_QUIZ_COINS = 50;
const DEFAULT_DAILY_REWARD_COINS = 10;
const DEFAULT_TOURNAMENT_REWARD_COINS = 30;
const DAILY_QUESTION_COUNT = 6;
const ROUND_PROMPT_VERSION = "competition-round-v6";
const MIN_SEGMENT_CONFIDENCE = 0.3;
const STARTER_WORLD_ID = "bg-1";

const WORLD_SCENES = [
  { id: "bg-1", label: "Red Desert", cost: 0 },
  { id: "bg-2", label: "Green Hills", cost: 200 },
  { id: "bg-3", label: "Pine Ridge", cost: 400 },
  { id: "bg-4", label: "City Park", cost: 700 },
  { id: "bg-5", label: "Downtown", cost: 1200 },
] as const;

type QuizRoundQuestionType =
  | "multiple_choice"
  | "true_false"
  | "odd_one_out"
  | "estimate_slider"
  | "order_sequence"
  | "type_answer"
  | "match_pairs";

type QuizRoundQuestion = {
  id: string;
  prompt: string;
  questionType: QuizRoundQuestionType;
  answerFormat:
    "multiple_choice" | "short_text" | "number" | "sequence" | "pairs";
  options?: string[];
  correctAnswer?: string;
  acceptableAnswers?: string[];
  minValue?: number;
  maxValue?: number;
  step?: number;
  unitLabel?: string;
  correctValue?: number;
  tolerance?: number;
  items?: string[];
  correctOrder?: string[];
  leftItems?: string[];
  rightItems?: string[];
  correctPairs?: Array<{ left: string; right: string }>;
  concept?: string;
  sourceSegmentIds: string[];
};

type QuizRoundPayload = {
  mode: QuizCompetitionMode;
  title: string;
  intro: string;
  reason: string;
  estimatedMinutes: number;
  generatedAt: string;
  promptVersion: string;
  model: string;
  sourceSegmentCount: number;
  sourceSegmentIds: string[];
  questionWindowStartAt: string | null;
  questionWindowEndAt: string | null;
  questions: QuizRoundQuestion[];
};

type AIRoundPayload = {
  title?: string;
  intro?: string;
  estimatedMinutes?: number;
  questions?: Array<{
    questionType?: QuizRoundQuestionType;
    prompt?: string;
    answer?: string;
    options?: string[];
    sourceSegmentIds?: string[];
    concept?: string;
    acceptableAnswers?: string[];
    minValue?: number;
    maxValue?: number;
    step?: number;
    unitLabel?: string;
    correctValue?: number;
    tolerance?: number;
    items?: string[];
    correctOrder?: string[];
    leftItems?: string[];
    rightItems?: string[];
    correctPairs?: Array<{ left?: string; right?: string }>;
  }>;
};

type DecryptedAutoCaptureSegment = Omit<
  AutoCaptureSegment,
  "title" | "summary" | "entities" | "subjects" | "topicHints" | "evidence"
> & {
  title: string;
  summary: string;
  entities: string[];
  subjects: string[];
  topicHints: string[];
  evidence: string[];
};

type QuizLeaderboardMode = QuizCompetitionMode | "GLOBAL_STANDING";

const getProfile = async (userId: number, timezoneOffsetMinutes = 0) => {
  await checkAndRunWeeklyLeaderboardReset();
  await ensureProfile(userId);
  const missionSync = await quizMissionsService.syncMissionClaims(
    userId,
    timezoneOffsetMinutes,
  );
  await applyMissionRewardsIfNeeded(userId, missionSync);
  const profile = await ensureProfile(userId);
  const achievements = await getProfileAchievements(userId, profile);
  const recentEntries = await getRoundHistoryList(userId);
  const pendingCoinRewards =
    await quizRewardsService.getPendingCoinRewardSummary(userId);
  const topPerformer = await getCurrentTopPerformerSummary();

  const autoCaptureSegmentCount = await prisma.autoCaptureSegment.count({
    where: { userId },
  });

  const recentSegmentsRaw = await prisma.autoCaptureSegment.findMany({
    where: { userId },
    orderBy: { windowEndAt: "desc" },
    take: 3,
  });
  const recentSegments = recentSegmentsRaw.map(decryptAutoCaptureSegment);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentDailyEntries = await prisma.quizCompetitionEntry.findMany({
    where: {
      userId,
      status: QuizCompetitionEntryStatus.SCORED,
      submittedAt: { gte: sevenDaysAgo },
      competition: {
        mode: QuizCompetitionMode.DAILY_CHALLENGE,
      },
    },
    select: { submittedAt: true },
  });

  const recentDailyChallengeDates = recentDailyEntries
    .map((e) => e.submittedAt?.toISOString())
    .filter(Boolean) as string[];

  const closedTournaments = await prisma.quizCompetition.findMany({
    where: {
      mode: QuizCompetitionMode.TOURNAMENT,
      status: QuizCompetitionStatus.CLOSED,
      updatedAt: { gte: sevenDaysAgo },
      entries: {
        some: {
          userId,
          status: QuizCompetitionEntryStatus.SCORED,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const resolvedTournaments = await Promise.all(
    closedTournaments.map(async (tournament) => {
      const entries = await prisma.quizCompetitionEntry.findMany({
        where: {
          competitionId: tournament.id,
          status: QuizCompetitionEntryStatus.SCORED,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePictureKey: true,
            },
          },
        },
      });

      entries.sort((left, right) => {
        const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
        const durationDelta =
          getEntryDurationMs(left) - getEntryDurationMs(right);
        if (durationDelta !== 0) return durationDelta;
        return (
          new Date(left.submittedAt ?? left.createdAt).getTime() -
          new Date(right.submittedAt ?? right.createdAt).getTime()
        );
      });

      const userIndex = entries.findIndex((e) => e.userId === userId);
      const userRank = userIndex >= 0 ? userIndex + 1 : null;
      const userEntry = userIndex >= 0 ? entries[userIndex] : null;

      const winnerEntry = entries[0] ?? null;

      return {
        id: tournament.id,
        name: tournament.name,
        rewardCoins: tournament.rewardCoins,
        rewardXp: tournament.rewardXp,
        closedAt: tournament.updatedAt.toISOString(),
        userRank,
        userScore: userEntry?.score ?? null,
        userDurationMs: userEntry?.durationMs ?? null,
        winner: winnerEntry
          ? {
              userId: winnerEntry.userId,
              userName: winnerEntry.user.name?.trim() || winnerEntry.user.email,
              score: winnerEntry.score,
              durationMs: winnerEntry.durationMs,
            }
          : null,
      };
    }),
  );

  return {
    ...profile,
    achievements,
    dailyMissions: missionSync.dailyMissions,
    weeklyMissions: missionSync.weeklyMissions,
    pendingCoinRewards,
    topPerformer,
    recentEntries,
    autoCaptureSegmentCount,
    recentSegments,
    recentDailyChallengeDates,
    resolvedTournaments,
  };
};

const listCompetitions = async (
  userId: number,
  filter: {
    mode?: QuizCompetitionMode;
    status?: QuizCompetitionStatus;
    timezoneOffsetMinutes?: number;
  },
) => {
  const now = new Date();

  // Daily is a stable challenge template. The user's local day is tracked on
  // QuizCompetitionEntry so timezones don't create competing daily rows.
  await ensureDailyChallengeTemplate();

  const competitions = await prisma.quizCompetition.findMany({
    where: {
      visibility: QuizCompetitionVisibility.PUBLIC,
      ...(filter.mode ? { mode: filter.mode } : {}),
      ...(filter.mode === QuizCompetitionMode.DAILY_CHALLENGE
        ? { slug: "daily-challenge" }
        : {}),
      ...(!filter.mode
        ? {
            OR: [
              { mode: { not: QuizCompetitionMode.DAILY_CHALLENGE } },
              { slug: "daily-challenge" },
            ],
          }
        : {}),
      ...(filter.status
        ? { status: filter.status }
        : {
            status: {
              in: [
                QuizCompetitionStatus.SCHEDULED,
                QuizCompetitionStatus.ACTIVE,
              ],
            },
            AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
          }),
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
  });

  return Promise.all(
    competitions.map(async (competition) => ({
      ...competition,
      playerState: await buildPlayerCompetitionState(
        userId,
        competition,
        filter.timezoneOffsetMinutes ?? 0,
      ),
    })),
  );
};

const getCompetitionEligibility = async (
  competitionId: string,
  userId: number,
  timezoneOffsetMinutes = 0,
) => {
  const competition = await getCompetitionOrThrow(competitionId);
  return {
    competition,
    playerState: await buildPlayerCompetitionState(
      userId,
      competition,
      timezoneOffsetMinutes,
    ),
  };
};

const createCompetitionEntry = async (
  competitionId: string,
  userId: number,
  timezoneOffsetMinutes = 0,
) => {
  const competition = await getCompetitionOrThrow(competitionId);
  const playerState = await buildPlayerCompetitionState(
    userId,
    competition,
    timezoneOffsetMinutes,
  );

  if (playerState.eligibility.status !== "ELIGIBLE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      playerState.eligibility.reasonMessage ||
        "You are not eligible for this competition right now.",
    );
  }

  let windowStart: Date;
  let windowEnd: Date | undefined;
  let localDate: string | undefined;
  let periodStartAt: Date | undefined;
  let periodEndAt: Date | undefined;

  if (competition.mode === QuizCompetitionMode.DAILY_CHALLENGE) {
    const dailyWindow = getLocalDayWindow(timezoneOffsetMinutes, new Date());
    windowStart = dailyWindow.start;
    windowEnd = dailyWindow.end;
    localDate = dailyWindow.localDate;
    periodStartAt = dailyWindow.start;
    periodEndAt = dailyWindow.end;
  } else {
    // TOURNAMENT mode rules check
    const rules =
      competition.rulesConfig && typeof competition.rulesConfig === "object"
        ? (competition.rulesConfig as Record<string, any>)
        : {};
    const lookbackHours =
      typeof rules.lookbackHours === "number" ? rules.lookbackHours : 24;
    const minimumSegmentCount =
      typeof rules.minimumSegmentCount === "number"
        ? rules.minimumSegmentCount
        : 6;

    windowStart = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    windowEnd = undefined;

    // Double check segment count at start time to be safe
    const segments = await listSegmentsForRound(userId, windowStart);
    if (segments.length < minimumSegmentCount) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Tournament requires at least ${minimumSegmentCount} active segments from the last ${lookbackHours} hours. You only have ${segments.length} segment(s).`,
      );
    }
  }

  const segments = await listSegmentsForRound(userId, windowStart, windowEnd);
  if (segments.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Not enough activity segments are available for this competition round yet.",
    );
  }

  const round = await generateCompetitionRound({
    competition,
    segments,
    questionCount: DAILY_QUESTION_COUNT,
    questionWindowStartAt: windowStart,
    questionWindowEndAt: windowEnd || new Date(),
  });

  const entry = await prisma.$transaction(async (tx) => {
    const nextAttemptNumber = await getNextAttemptNumber(
      tx,
      competition.id,
      userId,
    );

    if (competition.mode === QuizCompetitionMode.TOURNAMENT) {
      const profile = await tx.quizGameProfile.findUnique({
        where: { userId },
      });
      const coins = profile?.coins ?? 0;
      if (coins < 100) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Insufficient coins to enter the tournament. (100 coins required)",
        );
      }
      const nextCoins = coins - 100;
      await tx.quizGameProfile.update({
        where: { userId },
        data: { coins: nextCoins },
      });
      await tx.quizCoinLedger.create({
        data: {
          userId,
          amount: -100,
          balanceAfter: nextCoins,
          type: QuizCoinLedgerType.SPEND,
          referenceType: "QuizCompetition",
          referenceId: competition.id,
          metadata: {
            reason: "Tournament entry fee",
          },
        },
      });
    }

    return tx.quizCompetitionEntry.create({
      data: {
        competitionId: competition.id,
        userId,
        attemptNumber: nextAttemptNumber,
        status: QuizCompetitionEntryStatus.IN_PROGRESS,
        localDate,
        periodStartAt,
        periodEndAt,
        timezoneOffsetMinutes:
          competition.mode === QuizCompetitionMode.DAILY_CHALLENGE
            ? timezoneOffsetMinutes
            : undefined,
      },
    });
  });

  return { competition, entry, round, playerState };
};

const startDailyChallenge = async (
  userId: number,
  timezoneOffsetMinutes = 0,
) => {
  const competition = await ensureDailyChallengeTemplate();
  const playerState = await buildPlayerCompetitionState(
    userId,
    competition,
    timezoneOffsetMinutes,
  );

  if (playerState.eligibility.status !== "ELIGIBLE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      playerState.eligibility.reasonMessage ||
        "You are not eligible for today’s daily challenge.",
    );
  }

  const dailyWindow = getLocalDayWindow(timezoneOffsetMinutes, new Date());
  const windowStart = dailyWindow.start;
  const windowEnd = dailyWindow.end;
  const segments = await listSegmentsForRound(userId, windowStart, windowEnd);

  if (segments.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Not enough activity segments are available for today’s daily challenge yet.",
    );
  }

  const round = await generateCompetitionRound({
    competition,
    segments,
    questionCount: DAILY_QUESTION_COUNT,
    questionWindowStartAt: windowStart,
    questionWindowEndAt: windowEnd,
  });

  const entry = await prisma.$transaction(async (tx) => {
    const nextAttemptNumber = await getNextAttemptNumber(
      tx,
      competition.id,
      userId,
    );
    return tx.quizCompetitionEntry.create({
      data: {
        competitionId: competition.id,
        userId,
        attemptNumber: nextAttemptNumber,
        status: QuizCompetitionEntryStatus.IN_PROGRESS,
        localDate: dailyWindow.localDate,
        periodStartAt: dailyWindow.start,
        periodEndAt: dailyWindow.end,
        timezoneOffsetMinutes,
      },
    });
  });

  return { competition, entry, round, playerState };
};

const getMyCompetitionEntry = async (competitionId: string, userId: number) => {
  await getCompetitionOrThrow(competitionId);

  return prisma.quizCompetitionEntry.findFirst({
    where: { competitionId, userId },
    orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
  });
};

const completeCompetitionEntry = async ({
  competitionId,
  entryId,
  userId,
  correctAnswers,
  totalQuestions,
  durationMs,
  timezoneOffsetMinutes = 0,
  coinsEarned,
}: {
  competitionId: string;
  entryId: string;
  userId: number;
  correctAnswers: number;
  totalQuestions: number;
  durationMs: number;
  timezoneOffsetMinutes?: number;
  coinsEarned?: number;
}) => {
  const competition = await getCompetitionOrThrow(competitionId);
  const entry = await prisma.quizCompetitionEntry.findFirst({
    where: { id: entryId, competitionId, userId },
  });

  if (!entry) {
    throw new ApiError(httpStatus.NOT_FOUND, "Competition entry not found");
  }

  if (entry.status !== QuizCompetitionEntryStatus.IN_PROGRESS) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Competition entry is already completed.",
    );
  }

  const normalizedScore =
    totalQuestions > 0
      ? Math.max(0, Math.min(100, (correctAnswers / totalQuestions) * 100))
      : 0;
  const now = new Date();
  const effectiveTimezoneOffsetMinutes =
    competition.mode === QuizCompetitionMode.DAILY_CHALLENGE
      ? (entry.timezoneOffsetMinutes ?? timezoneOffsetMinutes)
      : timezoneOffsetMinutes;

  return prisma.$transaction(async (tx) => {
    const scoredEntry = await tx.quizCompetitionEntry.update({
      where: { id: entry.id },
      data: {
        status: QuizCompetitionEntryStatus.SCORED,
        score: normalizedScore,
        correctAnswers,
        totalQuestions,
        durationMs: Math.max(0, Math.round(durationMs)),
        submittedAt: now,
      },
    });

    const progress = await applyCompetitionProgress({
      tx,
      userId,
      competition,
      entryId: scoredEntry.id,
      correctAnswers,
      totalQuestions,
      timezoneOffsetMinutes: effectiveTimezoneOffsetMinutes,
      submittedAt: now,
      coinsEarned,
    });

    // Evaluate wagers/achievements inside the transaction
    const newlyUnlocked = await evaluateAndUnlockAchievements({
      tx,
      userId,
      profile: progress.profile,
      timezoneOffsetMinutes: effectiveTimezoneOffsetMinutes,
    });

    let finalProfile = progress.profile;
    if (newlyUnlocked.length > 0) {
      finalProfile = await tx.quizGameProfile.findUniqueOrThrow({
        where: { userId },
      });
    }

    const missionSync = await quizMissionsService.syncMissionClaims(
      userId,
      effectiveTimezoneOffsetMinutes,
      tx,
    );
    const missionRewardXp =
      missionSync.dailyMissionRewardXp + missionSync.weeklyMissionRewardXp;
    const missionPendingCoins = await createMissionPendingCoinRewards(
      userId,
      missionSync,
      scoredEntry.id,
      tx,
    );

    if (missionRewardXp > 0) {
      const nextXp = finalProfile.xp + missionRewardXp;
      finalProfile = await tx.quizGameProfile.update({
        where: { userId },
        data: {
          xp: nextXp,
          currentLevel: calculateLevel(nextXp),
        },
      });
    }

    // Fetch fully evaluated achievements list to include in the payload
    const achievements = await getProfileAchievements(userId, finalProfile, tx);
    const pendingCoinRewards =
      await quizRewardsService.getPendingCoinRewardSummary(userId, tx);
    const finalLevel = calculateLevel(finalProfile.xp);

    return {
      entry: scoredEntry,
      progress: {
        ...progress,
        coinsEarned: progress.coinsEarned,
        pendingCoinsEarned: progress.pendingCoinsEarned + missionPendingCoins,
        xpEarned: progress.xpEarned + missionRewardXp,
        currentLevel: finalLevel,
        leveledUp: finalLevel > progress.previousLevel,
        xpForCurrentLevel: getLevelStartXp(finalLevel),
        xpForNextLevel: getLevelStartXp(finalLevel + 1),
        profile: {
          ...finalProfile,
          achievements,
          dailyMissions: missionSync.dailyMissions,
          weeklyMissions: missionSync.weeklyMissions,
          pendingCoinRewards,
        },
        newlyUnlockedAchievementIds: newlyUnlocked,
        newlyCompletedDailyMissionIds:
          missionSync.newlyCompletedDailyMissionIds,
        dailyMissionStreakBonusCoinsEarned:
          missionSync.dailyMissionStreakBonusCoinsEarned,
        dailyMissionStreakBonusDays: missionSync.dailyMissionStreakBonusDays,
        newlyCompletedWeeklyMissionIds:
          missionSync.newlyCompletedWeeklyMissionIds,
      },
    };
  });
};

const getLeaderboard = async (
  userId: number,
  mode: QuizLeaderboardMode,
  timezoneOffsetMinutes = 0,
) => {
  if (mode === "GLOBAL_STANDING") {
    return getGlobalStandingLeaderboard(userId);
  }

  if (mode === QuizCompetitionMode.DAILY_CHALLENGE) {
    await ensureDailyChallengeTemplate();
  }

  let competition = await prisma.quizCompetition.findFirst({
    where: {
      mode,
      impactsLeaderboard: true,
      visibility: QuizCompetitionVisibility.PUBLIC,
      status: QuizCompetitionStatus.ACTIVE,
      ...(mode === QuizCompetitionMode.DAILY_CHALLENGE
        ? { slug: "daily-challenge" }
        : {}),
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });

  if (!competition && mode === QuizCompetitionMode.TOURNAMENT) {
    competition = await prisma.quizCompetition.findFirst({
      where: {
        mode,
        impactsLeaderboard: true,
        visibility: QuizCompetitionVisibility.PUBLIC,
        status: QuizCompetitionStatus.CLOSED,
      },
      orderBy: [{ endsAt: "desc" }, { updatedAt: "desc" }],
    });
  }

  if (!competition) {
    return {
      mode,
      competition: null,
      totalEntries: 0,
      entries: [],
      viewerEntry: null,
    };
  }

  const entryWhere: Prisma.QuizCompetitionEntryWhereInput = {
    competitionId: competition.id,
    status: QuizCompetitionEntryStatus.SCORED,
  };

  if (mode === QuizCompetitionMode.DAILY_CHALLENGE) {
    entryWhere.localDate = getLocalDateKey(timezoneOffsetMinutes, new Date());
  }

  const scoredEntries = await prisma.quizCompetitionEntry.findMany({
    where: entryWhere,
    include: {
      user: {
        select: { id: true, name: true, email: true, profilePictureKey: true },
      },
    },
  });

  scoredEntries.sort((left, right) => {
    const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;

    const durationDelta = getEntryDurationMs(left) - getEntryDurationMs(right);
    if (durationDelta !== 0) return durationDelta;

    return (
      new Date(left.submittedAt ?? left.createdAt).getTime() -
      new Date(right.submittedAt ?? right.createdAt).getTime()
    );
  });

  const bestEntryByUser = new Map<number, (typeof scoredEntries)[number]>();
  for (const entry of scoredEntries) {
    if (!bestEntryByUser.has(entry.userId)) {
      bestEntryByUser.set(entry.userId, entry);
    }
  }

  const entries = Array.from(bestEntryByUser.values()).map((entry, index) => ({
    rank: index + 1,
    entryId: entry.id,
    competitionId: entry.competitionId,
    userId: entry.userId,
    userName: entry.user.name?.trim() || entry.user.email,
    profilePictureKey: entry.user.profilePictureKey,
    score: entry.score ?? 0,
    correctAnswers: entry.correctAnswers,
    totalQuestions: entry.totalQuestions,
    durationMs: entry.durationMs,
    submittedAt: entry.submittedAt,
    isCurrentUser: entry.userId === userId,
  }));

  const isTournamentActive =
    mode === QuizCompetitionMode.TOURNAMENT &&
    competition.status === QuizCompetitionStatus.ACTIVE;

  if (isTournamentActive) {
    return {
      mode,
      competition,
      totalEntries: 0,
      entries: [],
      viewerEntry: null,
    };
  }

  const viewerEntry = entries.find((entry) => entry.userId === userId) ?? null;

  return {
    mode,
    competition,
    totalEntries: entries.length,
    entries: entries.slice(0, 20),
    viewerEntry,
  };
};

async function getGlobalStandingLeaderboard(userId: number) {
  await ensureProfile(userId);

  const profiles = await prisma.quizGameProfile.findMany({
    where: {
      OR: [{ totalRoundsPlayed: { gt: 0 } }, { userId }],
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, profilePictureKey: true },
      },
    },
    orderBy: [
      { currentLevel: "desc" },
      { xp: "desc" },
      { totalRoundsPlayed: "desc" },
      { totalCorrectAnswers: "desc" },
      { updatedAt: "asc" },
    ],
  });

  const entries = profiles.map((profile, index) => ({
    rank: index + 1,
    entryId: profile.id,
    competitionId: "global-standing",
    userId: profile.userId,
    userName: profile.user.name?.trim() || profile.user.email,
    profilePictureKey: profile.user.profilePictureKey,
    score: profile.currentLevel,
    correctAnswers: profile.totalCorrectAnswers,
    totalQuestions: profile.totalQuestionsAnswered,
    durationMs: 0,
    submittedAt: profile.lastPlayedAt,
    isCurrentUser: profile.userId === userId,
    level: profile.currentLevel,
    xp: profile.xp,
    totalRoundsPlayed: profile.totalRoundsPlayed,
  }));

  return {
    mode: "GLOBAL_STANDING" as const,
    competition: null,
    totalEntries: entries.length,
    entries: entries.slice(0, 20),
    viewerEntry: entries.find((entry) => entry.userId === userId) ?? null,
  };
}

function getWorldSceneOrThrow(worldId: string) {
  const world = WORLD_SCENES.find((scene) => scene.id === worldId);
  if (!world) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Unknown world.");
  }
  return world;
}

function normalizeOwnedWorldIds(value: string[] | null | undefined) {
  const validWorldIds = new Set<string>(WORLD_SCENES.map((scene) => scene.id));
  return Array.from(
    new Set([
      STARTER_WORLD_ID,
      ...(value ?? []).filter((id) => validWorldIds.has(id)),
    ]),
  );
}

const unlockWorld = async (userId: number, worldId: string) => {
  const world = getWorldSceneOrThrow(worldId);

  return prisma.$transaction(async (tx) => {
    const profile = await ensureProfile(userId, tx);
    const ownedWorldIds = normalizeOwnedWorldIds(profile.ownedWorldIds);

    if (ownedWorldIds.includes(world.id)) {
      const equippedProfile = await tx.quizGameProfile.update({
        where: { userId },
        data: { ownedWorldIds, equippedWorldId: world.id },
      });
      return { profile: equippedProfile, world, alreadyOwned: true };
    }

    if (profile.coins < world.cost) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Need ${world.cost - profile.coins} more coins to unlock ${world.label}.`,
      );
    }

    const nextCoins = profile.coins - world.cost;
    const nextOwnedWorldIds = [...ownedWorldIds, world.id];
    const updatedProfile = await tx.quizGameProfile.update({
      where: { userId },
      data: {
        coins: nextCoins,
        ownedWorldIds: nextOwnedWorldIds,
        equippedWorldId: world.id,
      },
    });

    if (world.cost > 0) {
      await tx.quizCoinLedger.create({
        data: {
          userId,
          amount: -world.cost,
          balanceAfter: nextCoins,
          type: QuizCoinLedgerType.SPEND,
          referenceType: "QuizWorld",
          referenceId: world.id,
          metadata: {
            worldId: world.id,
            worldLabel: world.label,
            reason: "World unlock",
          },
        },
      });
    }

    return { profile: updatedProfile, world, alreadyOwned: false };
  });
};

const equipWorld = async (userId: number, worldId: string) => {
  const world = getWorldSceneOrThrow(worldId);
  const profile = await ensureProfile(userId);
  const ownedWorldIds = normalizeOwnedWorldIds(profile.ownedWorldIds);

  if (!ownedWorldIds.includes(world.id)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Unlock this world before equipping it.",
    );
  }

  const updatedProfile = await prisma.quizGameProfile.update({
    where: { userId },
    data: { ownedWorldIds, equippedWorldId: world.id },
  });

  return { profile: updatedProfile, world };
};

async function ensureProfile(
  userId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const existing = await client.quizGameProfile.findUnique({
    where: { userId },
  });
  if (existing) {
    const ownedWorldIds = normalizeOwnedWorldIds(existing.ownedWorldIds);
    const equippedWorldId = ownedWorldIds.includes(existing.equippedWorldId)
      ? existing.equippedWorldId
      : STARTER_WORLD_ID;
    if (
      ownedWorldIds.length !== existing.ownedWorldIds.length ||
      equippedWorldId !== existing.equippedWorldId
    ) {
      return client.quizGameProfile.update({
        where: { userId },
        data: { ownedWorldIds, equippedWorldId },
      });
    }
    return existing;
  }

  const profile = await client.quizGameProfile.create({
    data: {
      userId,
      coins: INITIAL_QUIZ_COINS,
      lifetimeCoinsEarned: INITIAL_QUIZ_COINS,
      ownedWorldIds: [STARTER_WORLD_ID],
      equippedWorldId: STARTER_WORLD_ID,
    },
  });

  await client.quizCoinLedger.create({
    data: {
      userId,
      amount: INITIAL_QUIZ_COINS,
      balanceAfter: INITIAL_QUIZ_COINS,
      type: QuizCoinLedgerType.INITIAL_GRANT,
      referenceType: "QuizGameProfile",
      referenceId: profile.id,
    },
  });

  return profile;
}

async function applyMissionRewardsIfNeeded(
  userId: number,
  missionSync: Awaited<
    ReturnType<typeof quizMissionsService.syncMissionClaims>
  >,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const missionRewardXp =
    missionSync.dailyMissionRewardXp + missionSync.weeklyMissionRewardXp;
  const missionRewardCoins = await createMissionPendingCoinRewards(
    userId,
    missionSync,
    "profile-sync",
    client,
  );

  if (missionRewardXp === 0 && missionRewardCoins === 0) return null;

  const existing = await client.quizGameProfile.findUniqueOrThrow({
    where: { userId },
  });
  const nextXp = existing.xp + missionRewardXp;
  const updated = await client.quizGameProfile.update({
    where: { userId },
    data: {
      xp: nextXp,
      currentLevel: calculateLevel(nextXp),
    },
  });

  return updated;
}

async function createMissionPendingCoinRewards(
  userId: number,
  missionSync: Awaited<
    ReturnType<typeof quizMissionsService.syncMissionClaims>
  >,
  referenceId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const rewardInputs = [
    ...missionSync.newlyCompletedDailyMissionRewards.map((reward) => ({
      sourceType: "QuizDailyMissionClaim",
      sourceId: reward.sourceId,
      amount: reward.rewardCoins,
      title: reward.title,
      metadata: { missionId: reward.id, referenceId },
    })),
    ...missionSync.newlyCompletedWeeklyMissionRewards.map((reward) => ({
      sourceType: "QuizWeeklyMissionClaim",
      sourceId: reward.sourceId,
      amount: reward.rewardCoins,
      title: reward.title,
      metadata: { missionId: reward.id, referenceId },
    })),
    ...(missionSync.dailyMissionStreakBonusReward
      ? [
          {
            sourceType: "QuizDailyMissionStreakBonusClaim",
            sourceId: missionSync.dailyMissionStreakBonusReward.sourceId,
            amount: missionSync.dailyMissionStreakBonusReward.rewardCoins,
            title: missionSync.dailyMissionStreakBonusReward.title,
            metadata: {
              streakLength:
                missionSync.dailyMissionStreakBonusReward.streakLength,
              referenceId,
            },
          },
        ]
      : []),
  ];

  for (const reward of rewardInputs) {
    await quizRewardsService.createPendingCoinReward(
      { userId, ...reward },
      client,
    );
  }

  return rewardInputs.reduce((total, reward) => total + reward.amount, 0);
}

async function getCompetitionOrThrow(competitionId: string) {
  const competition = await prisma.quizCompetition.findUnique({
    where: { id: competitionId },
  });
  if (!competition)
    throw new ApiError(httpStatus.NOT_FOUND, "Quiz competition not found");
  return competition;
}

async function getNextAttemptNumber(
  client: Prisma.TransactionClient | typeof prisma,
  competitionId: string,
  userId: number,
) {
  const latestEntry = await client.quizCompetitionEntry.findFirst({
    where: { competitionId, userId },
    orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
  });
  return (latestEntry?.attemptNumber ?? 0) + 1;
}

async function ensureDailyChallengeTemplate() {
  const slug = "daily-challenge";
  return prisma.quizCompetition.upsert({
    where: { slug },
    create: {
      slug,
      name: "Daily Challenge",
      shortLabel: "Daily",
      mode: QuizCompetitionMode.DAILY_CHALLENGE,
      status: QuizCompetitionStatus.ACTIVE,
      visibility: QuizCompetitionVisibility.PUBLIC,
      description:
        "A daily quiz generated from your recent Boom Auto Capture activity.",
      impactsLeaderboard: true,
      maxEntriesPerUser: null,
      rewardCoins: DEFAULT_DAILY_REWARD_COINS,
      rewardXp: calculateMaxXpAward(QuizCompetitionMode.DAILY_CHALLENGE),
      rulesConfig: {
        questionCount: DAILY_QUESTION_COUNT,
        promptVersion: ROUND_PROMPT_VERSION,
      },
    },
    update: {
      status: QuizCompetitionStatus.ACTIVE,
      visibility: QuizCompetitionVisibility.PUBLIC,
      impactsLeaderboard: true,
      maxEntriesPerUser: null,
      rewardCoins: DEFAULT_DAILY_REWARD_COINS,
      rewardXp: calculateMaxXpAward(QuizCompetitionMode.DAILY_CHALLENGE),
      rulesConfig: {
        questionCount: DAILY_QUESTION_COUNT,
        promptVersion: ROUND_PROMPT_VERSION,
      },
    },
  });
}

async function listSegmentsForRound(
  userId: number,
  windowStart: Date,
  windowEnd?: Date,
) {
  const segments = await prisma.autoCaptureSegment.findMany({
    where: {
      userId,
      confidence: { gte: MIN_SEGMENT_CONFIDENCE },
      windowStartAt: { gte: windowStart },
      ...(windowEnd ? { windowEndAt: { lte: windowEnd } } : {}),
    },
    orderBy: [{ windowStartAt: "asc" }],
  });

  const readableSegments = segments
    .map(decryptAutoCaptureSegment)
    .filter(hasReadableSegmentText);

  if (segments.length > 0 && readableSegments.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Activity segments exist, but their text could not be decrypted for quiz generation.",
    );
  }

  return readableSegments;
}

async function generateCompetitionRound({
  competition,
  segments,
  questionCount,
  questionWindowStartAt,
  questionWindowEndAt,
}: {
  competition: QuizCompetition;
  segments: DecryptedAutoCaptureSegment[];
  questionCount: number;
  questionWindowStartAt: Date;
  questionWindowEndAt: Date;
}): Promise<QuizRoundPayload> {
  const model =
    process.env.BOOM_QUIZ_GEMINI_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-1.5-flash";
  const apiKey =
    process.env.BOOM_QUIZ_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Gemini API key is not configured for quiz generation.",
    );
  }

  const aiPayload = await requestGeminiJson<AIRoundPayload>({
    apiKey,
    model,
    systemPrompt: buildCompetitionRoundSystemPrompt(questionCount),
    userPrompt: buildCompetitionRoundUserPrompt({
      competitionMode: competition.mode,
      competitionName: competition.name,
      questionCount,
      questionWindowStartAt: questionWindowStartAt.toISOString(),
      questionWindowEndAt: questionWindowEndAt.toISOString(),
      segmentsJson: JSON.stringify(buildRoundSegmentPayload(segments), null, 2),
    }),
  });

  return normalizeRoundPayload({
    payload: aiPayload,
    competition,
    model,
    questionCount,
    segments,
    questionWindowStartAt,
    questionWindowEndAt,
  });
}

async function buildQuizRoundFromActivityWindow({
  userId,
  mode,
  roundName,
  questionCount,
  questionWindowStartAt,
  questionWindowEndAt,
}: {
  userId: number;
  mode: QuizCompetitionMode;
  roundName: string;
  questionCount: number;
  questionWindowStartAt: Date;
  questionWindowEndAt: Date;
}) {
  const segments = await listSegmentsForRound(
    userId,
    questionWindowStartAt,
    questionWindowEndAt,
  );

  if (segments.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Not enough activity segments are available for this round yet.",
    );
  }

  const round = await generateCompetitionRound({
    competition: {
      mode,
      name: roundName,
    } as QuizCompetition,
    segments,
    questionCount,
    questionWindowStartAt,
    questionWindowEndAt,
  });

  return {
    round,
    sourceSegmentCount: segments.length,
  };
}

async function requestGeminiJson<T>({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 5000,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      `Gemini quiz generation failed (${response.status}).`,
    );
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join("");

  if (!text || typeof text !== "string") {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Gemini returned an empty quiz generation response.",
    );
  }

  return parseJsonFromModelText<T>(text);
}

function parseJsonFromModelText<T>(text: string): T {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as T;
  } catch {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Gemini returned invalid quiz JSON.",
    );
  }
}

function decryptAutoCaptureSegment(
  segment: AutoCaptureSegment,
): DecryptedAutoCaptureSegment {
  return {
    ...segment,
    title: decryptSegmentText(segment.title),
    summary: decryptSegmentText(segment.summary),
    entities: decryptSegmentArray(segment.entities),
    subjects: decryptSegmentArray(segment.subjects),
    topicHints: decryptSegmentArray(segment.topicHints),
    evidence: decryptSegmentArray(segment.evidence),
  };
}

function decryptSegmentText(value: string) {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

function decryptSegmentArray(value: any) {
  return normalizeStringArray(value).map(decryptSegmentText);
}

function hasReadableSegmentText(segment: DecryptedAutoCaptureSegment) {
  return [
    segment.title,
    segment.summary,
    ...segment.entities,
    ...segment.subjects,
    ...segment.topicHints,
    ...segment.evidence,
  ].some((value) => value && !looksEncrypted(value));
}

function looksEncrypted(value: string) {
  return (
    /^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$/.test(value) ||
    /^[0-9a-f]{24,32}:[0-9a-f]+:[0-9a-f]{32}$/i.test(value)
  );
}

function buildRoundSegmentPayload(segments: DecryptedAutoCaptureSegment[]) {
  return segments.map((segment) => ({
    id: segment.id,
    windowStartAt: segment.windowStartAt.toISOString(),
    windowEndAt: segment.windowEndAt.toISOString(),
    title: segment.title,
    surfaceType: segment.surfaceType,
    activityKind: segment.activityKind,
    summary: segment.summary,
    entities: segment.entities,
    subjects: segment.subjects,
    topicHints: segment.topicHints,
    evidence: segment.evidence,
    confidence: segment.confidence,
  }));
}

function normalizeRoundPayload({
  payload,
  competition,
  model,
  questionCount,
  segments,
  questionWindowStartAt,
  questionWindowEndAt,
}: {
  payload: AIRoundPayload;
  competition: QuizCompetition;
  model: string;
  questionCount: number;
  segments: DecryptedAutoCaptureSegment[];
  questionWindowStartAt: Date;
  questionWindowEndAt: Date;
}): QuizRoundPayload {
  const bySegmentId = new Set(segments.map((segment) => segment.id));
  const questions = (Array.isArray(payload.questions) ? payload.questions : [])
    .reduce<QuizRoundQuestion[]>((acc, question) => {
      const normalized = normalizeRoundQuestion(question, bySegmentId);
      if (normalized && !isOverlyWindowSpecificPrompt(normalized.prompt)) {
        acc.push(normalized);
      }
      return acc;
    }, [])
    .slice(0, questionCount);

  if (questions.length < questionCount) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      `Gemini returned ${questions.length} usable quiz questions; expected ${questionCount}.`,
    );
  }

  const orderedQuestions = reorderToAvoidAdjacentDuplicateTypes(
    questions,
  ).slice(0, questionCount);

  return {
    mode: competition.mode,
    title:
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : `${competition.name} Round`,
    intro:
      typeof payload.intro === "string" && payload.intro.trim()
        ? payload.intro.trim()
        : `A ${competition.name.toLowerCase()} built from your recent activity context.`,
    reason: `Built a ${orderedQuestions.length}-question round from ${segments.length} activity segments.`,
    estimatedMinutes:
      typeof payload.estimatedMinutes === "number" &&
      payload.estimatedMinutes > 0
        ? Math.round(payload.estimatedMinutes)
        : Math.max(2, Math.ceil(questionCount / 2)),
    generatedAt: new Date().toISOString(),
    promptVersion: ROUND_PROMPT_VERSION,
    model,
    sourceSegmentCount: segments.length,
    sourceSegmentIds: segments.map((segment) => segment.id),
    questionWindowStartAt: questionWindowStartAt.toISOString(),
    questionWindowEndAt: questionWindowEndAt.toISOString(),
    questions: orderedQuestions,
  };
}

function normalizeRoundQuestion(
  question: NonNullable<AIRoundPayload["questions"]>[number],
  bySegmentId: Set<string>,
): QuizRoundQuestion | null {
  const questionType = normalizeQuestionType(question.questionType);
  const prompt =
    typeof question.prompt === "string" ? question.prompt.trim() : "";
  if (!prompt) return null;

  const sourceSegmentIds = Array.isArray(question.sourceSegmentIds)
    ? question.sourceSegmentIds.filter(
        (id): id is string => typeof id === "string" && bySegmentId.has(id),
      )
    : [];
  const concept =
    typeof question.concept === "string" ? question.concept : undefined;
  const base = {
    id: cryptoRandomId(),
    prompt,
    questionType,
    concept,
    sourceSegmentIds,
  };
  const answer =
    typeof question.answer === "string" ? question.answer.trim() : "";

  if (questionType === "match_pairs") {
    const leftItems = normalizeStringArray(question.leftItems);
    const rightItems = normalizeStringArray(question.rightItems);
    const correctPairs = Array.isArray(question.correctPairs)
      ? question.correctPairs
          .map((pair) => ({
            left: String(pair?.left ?? "").trim(),
            right: String(pair?.right ?? "").trim(),
          }))
          .filter((pair) => pair.left && pair.right)
      : [];
    if (
      leftItems.length < 3 ||
      rightItems.length !== leftItems.length ||
      correctPairs.length !== leftItems.length
    )
      return null;
    return {
      ...base,
      answerFormat: "pairs",
      leftItems,
      rightItems,
      correctPairs,
    };
  }

  if (questionType === "estimate_slider") {
    const minValue =
      typeof question.minValue === "number" ? question.minValue : 0;
    const maxValue =
      typeof question.maxValue === "number" && question.maxValue > minValue
        ? question.maxValue
        : minValue + 10;
    const correctValue =
      typeof question.correctValue === "number"
        ? question.correctValue
        : Math.round((minValue + maxValue) / 2);
    return {
      ...base,
      answerFormat: "number",
      minValue,
      maxValue,
      step:
        typeof question.step === "number" && question.step > 0
          ? question.step
          : 1,
      unitLabel:
        typeof question.unitLabel === "string" ? question.unitLabel : undefined,
      correctValue,
      tolerance:
        typeof question.tolerance === "number" && question.tolerance >= 0
          ? question.tolerance
          : 2,
    };
  }

  if (questionType === "order_sequence") {
    const items = normalizeStringArray(question.items);
    const correctOrder = normalizeStringArray(question.correctOrder);
    if (items.length < 3 || items.length !== correctOrder.length) return null;
    return { ...base, answerFormat: "sequence", items, correctOrder };
  }

  if (questionType === "type_answer") {
    if (!answer) return null;
    const acceptableAnswers = Array.from(
      new Set([answer, ...normalizeStringArray(question.acceptableAnswers)]),
    );
    return {
      ...base,
      answerFormat: "short_text",
      correctAnswer: answer,
      acceptableAnswers,
    };
  }

  if (questionType === "true_false") {
    const normalizedAnswer =
      answer.toLowerCase() === "true"
        ? "True"
        : answer.toLowerCase() === "false"
          ? "False"
          : null;
    if (!normalizedAnswer) return null;
    return {
      ...base,
      answerFormat: "multiple_choice",
      options: ["True", "False"],
      correctAnswer: normalizedAnswer,
    };
  }

  if (!answer) return null;
  let options = normalizeStringArray(question.options);
  if (!options.includes(answer)) options.push(answer);
  options = Array.from(new Set(options));
  while (options.length < 4)
    options.push(`Related option ${options.length + 1}`);

  return {
    ...base,
    answerFormat: "multiple_choice",
    options: options.slice(0, 4),
    correctAnswer: answer,
  };
}

function normalizeQuestionType(value: unknown): QuizRoundQuestionType {
  const supported: QuizRoundQuestionType[] = [
    "multiple_choice",
    "true_false",
    "odd_one_out",
    "estimate_slider",
    "order_sequence",
    "type_answer",
    "match_pairs",
  ];
  return supported.includes(value as QuizRoundQuestionType)
    ? (value as QuizRoundQuestionType)
    : "multiple_choice";
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function reorderToAvoidAdjacentDuplicateTypes(questions: QuizRoundQuestion[]) {
  const remaining = [...questions];
  const ordered: QuizRoundQuestion[] = [];
  while (remaining.length > 0) {
    const lastType = ordered[ordered.length - 1]?.questionType;
    const nextIndex = remaining.findIndex(
      (question) => question.questionType !== lastType,
    );
    ordered.push(remaining.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0]);
  }
  return ordered;
}

function isOverlyWindowSpecificPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  return [
    "which segment",
    "this session",
    "the session",
    "this window",
    "active window",
    "observed activity",
    "provided segment",
    "what you did",
    "you edited",
    "you opened",
    "you visited",
    "how many files",
    "how many apps",
    "how many windows",
    "how many minutes",
    "how much time",
    "timestamp",
  ].some((phrase) => normalized.includes(phrase));
}

function cryptoRandomId() {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

async function buildPlayerCompetitionState(
  userId: number,
  competition: QuizCompetition,
  timezoneOffsetMinutes: number,
) {
  await ensureProfile(userId);
  const localDate =
    competition.mode === QuizCompetitionMode.DAILY_CHALLENGE
      ? getLocalDateKey(timezoneOffsetMinutes, new Date())
      : undefined;
  const latestEntryWhere: Prisma.QuizCompetitionEntryWhereInput = {
    competitionId: competition.id,
    userId,
    ...(localDate ? { localDate } : {}),
  };
  const entryCountWhere: Prisma.QuizCompetitionEntryWhereInput = localDate
    ? latestEntryWhere
    : { competitionId: competition.id, userId };

  const [latestEntry, entryCount, dailyEntryCount] = await Promise.all([
    prisma.quizCompetitionEntry.findFirst({
      where: latestEntryWhere,
      orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
    }),
    prisma.quizCompetitionEntry.count({ where: entryCountWhere }),
    competition.mode === QuizCompetitionMode.DAILY_CHALLENGE
      ? prisma.quizCompetitionEntry.count({
          where: {
            competitionId: competition.id,
            userId,
            localDate,
          },
        })
      : Promise.resolve(null),
  ]);

  const baseEligibility = evaluateEligibility({
    competition,
    entryCount,
    dailyEntryCount,
  });

  if (baseEligibility.status === "ELIGIBLE") {
    if (competition.mode === QuizCompetitionMode.DAILY_CHALLENGE) {
      const dailyWindow = getLocalDayWindow(timezoneOffsetMinutes, new Date());
      const segments = await listSegmentsForRound(
        userId,
        dailyWindow.start,
        dailyWindow.end,
      );
      if (segments.length === 0) {
        return {
          latestEntry,
          entryCount,
          eligibility: {
            status: "INSUFFICIENT_SEGMENTS",
            reasonCode: "insufficient_segments",
            reasonMessage:
              "No activity segments available for today yet. Work for a bit first!",
          },
        };
      }
    } else if (competition.mode === QuizCompetitionMode.TOURNAMENT) {
      const profile = await prisma.quizGameProfile.findUnique({
        where: { userId },
      });
      const coins = profile?.coins ?? 0;
      if (coins < 100) {
        return {
          latestEntry,
          entryCount,
          eligibility: {
            status: "INSUFFICIENT_COINS",
            reasonCode: "insufficient_coins",
            reasonMessage: "100 coins required to participate.",
          },
        };
      }

      const rules =
        competition.rulesConfig && typeof competition.rulesConfig === "object"
          ? (competition.rulesConfig as Record<string, any>)
          : {};
      const lookbackHours =
        typeof rules.lookbackHours === "number" ? rules.lookbackHours : 24;
      const minimumSegmentCount =
        typeof rules.minimumSegmentCount === "number"
          ? rules.minimumSegmentCount
          : 6;
      const windowStart = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

      const segments = await listSegmentsForRound(userId, windowStart);
      if (segments.length < minimumSegmentCount) {
        return {
          latestEntry,
          entryCount,
          eligibility: {
            status: "INSUFFICIENT_SEGMENTS",
            reasonCode: "insufficient_segments",
            reasonMessage: `Requires at least ${minimumSegmentCount} active segments from the last ${lookbackHours} hours. You have ${segments.length}.`,
          },
        };
      }
    }
  }

  return {
    latestEntry,
    entryCount,
    eligibility: baseEligibility,
  };
}

function evaluateEligibility({
  competition,
  entryCount,
  dailyEntryCount,
}: {
  competition: QuizCompetition;
  entryCount: number;
  dailyEntryCount: number | null;
}) {
  const now = new Date();

  if (competition.visibility !== QuizCompetitionVisibility.PUBLIC) {
    return {
      status: "INACTIVE",
      reasonCode: "private_competition",
      reasonMessage: "This competition is not available yet.",
    };
  }

  if (competition.status !== QuizCompetitionStatus.ACTIVE) {
    return {
      status: "INACTIVE",
      reasonCode: "inactive_competition",
      reasonMessage: "This competition is not active right now.",
    };
  }

  if (competition.startsAt && competition.startsAt > now) {
    return {
      status: "INACTIVE",
      reasonCode: "not_started",
      reasonMessage: "This competition has not started yet.",
    };
  }

  if (competition.endsAt && competition.endsAt <= now) {
    return {
      status: "INACTIVE",
      reasonCode: "ended",
      reasonMessage: "This competition has already ended.",
    };
  }

  if (
    competition.mode === QuizCompetitionMode.DAILY_CHALLENGE &&
    (dailyEntryCount ?? 0) >= 1
  ) {
    return {
      status: "ALREADY_PLAYED",
      reasonCode: "daily_entry_used",
      reasonMessage: "You have already used today’s daily challenge.",
    };
  }

  if (competition.mode === QuizCompetitionMode.DAILY_CHALLENGE) {
    return {
      status: "ELIGIBLE",
      reasonCode: "eligible",
      reasonMessage: "You are eligible to join this competition now.",
    };
  }

  const maxEntriesPerUser =
    competition.maxEntriesPerUser ?? defaultMaxEntriesForMode(competition.mode);
  if (maxEntriesPerUser !== null && entryCount >= maxEntriesPerUser) {
    return {
      status: "ALREADY_PLAYED",
      reasonCode: "entry_limit_reached",
      reasonMessage:
        "You have already used your available entries for this competition.",
    };
  }

  return {
    status: "ELIGIBLE",
    reasonCode: "eligible",
    reasonMessage: "You are eligible to join this competition now.",
  };
}

async function applyCompetitionProgress({
  tx,
  userId,
  competition,
  entryId,
  correctAnswers,
  totalQuestions,
  timezoneOffsetMinutes,
  submittedAt,
  coinsEarned: _coinsEarned,
}: {
  tx: Prisma.TransactionClient;
  userId: number;
  competition: QuizCompetition;
  entryId: string;
  correctAnswers: number;
  totalQuestions: number;
  timezoneOffsetMinutes: number;
  submittedAt: Date;
  coinsEarned?: number;
}) {
  const existing = await ensureProfile(userId, tx);
  const normalizedScore =
    totalQuestions > 0
      ? Math.max(0, Math.min(100, (correctAnswers / totalQuestions) * 100))
      : 0;
  const baseCoins = calculateCoinAward(competition.mode);
  const rewardCoins = baseCoins + correctAnswers * 2;
  const rewardXp = calculateXpAward({
    mode: competition.mode,
    normalizedScore,
    totalQuestions,
  });
  const nextXp = existing.xp + rewardXp;
  const previousLevel = calculateLevel(existing.xp);
  const nextLevel = calculateLevel(nextXp);
  const isDaily = competition.mode === QuizCompetitionMode.DAILY_CHALLENGE;
  const streak = isDaily
    ? await calculateDailyStreaksFromEntries(userId, timezoneOffsetMinutes, tx)
    : {
        currentStreak: existing.currentStreak,
        bestStreak: existing.bestStreak,
        lastDailyCompletedAt: existing.lastDailyCompletedAt,
      };

  const profile = await tx.quizGameProfile.update({
    where: { userId },
    data: {
      xp: nextXp,
      currentLevel: nextLevel,
      dailyRoundsPlayed: isDaily ? { increment: 1 } : undefined,
      tournamentRoundsPlayed:
        competition.mode === QuizCompetitionMode.TOURNAMENT
          ? { increment: 1 }
          : undefined,
      totalRoundsPlayed: { increment: 1 },
      totalQuestionsAnswered: { increment: totalQuestions },
      totalCorrectAnswers: { increment: correctAnswers },
      currentStreak: streak.currentStreak,
      bestStreak: streak.bestStreak,
      lastPlayedAt: submittedAt,
      lastDailyCompletedAt: isDaily ? streak.lastDailyCompletedAt : undefined,
    },
  });

  if (rewardCoins > 0) {
    await quizRewardsService.createPendingCoinReward(
      {
        userId,
        amount: rewardCoins,
        sourceType: "QuizCompetitionEntry",
        sourceId: entryId,
        title:
          competition.mode === QuizCompetitionMode.TOURNAMENT
            ? "Tournament round reward"
            : "Daily challenge reward",
        metadata: {
          competitionId: competition.id,
          mode: competition.mode,
          rewardXp,
          correctAnswers,
          totalQuestions,
          normalizedScore,
        },
      },
      tx,
    );
  }

  return {
    profile,
    coinsEarned: 0,
    pendingCoinsEarned: rewardCoins,
    xpEarned: rewardXp,
    previousLevel,
    currentLevel: nextLevel,
    leveledUp: nextLevel > previousLevel,
    xpForCurrentLevel: getLevelStartXp(nextLevel),
    xpForNextLevel: getLevelStartXp(nextLevel + 1),
  };
}

function calculateCoinAward(mode: QuizCompetitionMode) {
  switch (mode) {
    case QuizCompetitionMode.TOURNAMENT:
      return DEFAULT_TOURNAMENT_REWARD_COINS;
    case QuizCompetitionMode.DAILY_CHALLENGE:
    default:
      return DEFAULT_DAILY_REWARD_COINS;
  }
}

function calculateXpAward({
  mode,
  normalizedScore,
  totalQuestions,
}: {
  mode: QuizCompetitionMode;
  normalizedScore: number;
  totalQuestions: number;
}) {
  const baseByMode: Record<QuizCompetitionMode, number> = {
    DAILY_CHALLENGE: 35,
    TOURNAMENT: 45,
  };

  const accuracyBonus = Math.round(
    (Math.max(0, Math.min(normalizedScore, 100)) / 100) * 20,
  );
  const completionBonus = totalQuestions >= DAILY_QUESTION_COUNT ? 5 : 0;
  const perfectBonus = normalizedScore >= 100 ? 10 : 0;

  return baseByMode[mode] + accuracyBonus + completionBonus + perfectBonus;
}

function calculateMaxXpAward(mode: QuizCompetitionMode) {
  return calculateXpAward({
    mode,
    normalizedScore: 100,
    totalQuestions: DAILY_QUESTION_COUNT,
  });
}

function calculateLevel(xp: number) {
  return Math.max(1, Math.floor(Math.max(0, xp) / LEVEL_XP_STEP) + 1);
}

function getLevelStartXp(level: number) {
  return Math.max(0, level - 1) * LEVEL_XP_STEP;
}

async function calculateDailyStreaksFromEntries(
  userId: number,
  timezoneOffsetMinutes: number,
  client: Prisma.TransactionClient,
) {
  const entries = await client.quizCompetitionEntry.findMany({
    where: {
      userId,
      status: QuizCompetitionEntryStatus.SCORED,
      submittedAt: { not: null },
      competition: {
        mode: QuizCompetitionMode.DAILY_CHALLENGE,
      },
    },
    select: { submittedAt: true },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
  });

  return calculateDailyStreaks(
    entries.flatMap((entry) => (entry.submittedAt ? [entry.submittedAt] : [])),
    timezoneOffsetMinutes,
  );
}

function calculateDailyStreaks(dates: Date[], timezoneOffsetMinutes: number) {
  if (dates.length === 0) {
    return {
      currentStreak: 0,
      bestStreak: 0,
      lastDailyCompletedAt: null as Date | null,
    };
  }

  const uniqueDaysAscending = Array.from(
    new Map(
      dates
        .sort((left, right) => left.getTime() - right.getTime())
        .map(
          (date) =>
            [
              getLocalDayStart(timezoneOffsetMinutes, date).toISOString(),
              date,
            ] as const,
        ),
    ).values(),
  );

  let bestStreak = 1;
  let runningStreak = 1;

  for (let index = 1; index < uniqueDaysAscending.length; index += 1) {
    const previousDay = getLocalDayStart(
      timezoneOffsetMinutes,
      uniqueDaysAscending[index - 1],
    );
    const currentDay = getLocalDayStart(
      timezoneOffsetMinutes,
      uniqueDaysAscending[index],
    );
    const expectedNextDay = new Date(
      previousDay.getTime() + 24 * 60 * 60 * 1000,
    );
    if (currentDay.getTime() === expectedNextDay.getTime()) {
      runningStreak += 1;
      bestStreak = Math.max(bestStreak, runningStreak);
    } else {
      runningStreak = 1;
    }
  }

  let currentStreak = 1;
  for (let index = uniqueDaysAscending.length - 1; index > 0; index -= 1) {
    const currentDay = getLocalDayStart(
      timezoneOffsetMinutes,
      uniqueDaysAscending[index],
    );
    const previousDay = getLocalDayStart(
      timezoneOffsetMinutes,
      uniqueDaysAscending[index - 1],
    );
    const expectedPreviousDay = new Date(
      currentDay.getTime() - 24 * 60 * 60 * 1000,
    );
    if (previousDay.getTime() === expectedPreviousDay.getTime()) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  return {
    currentStreak,
    bestStreak,
    lastDailyCompletedAt:
      uniqueDaysAscending[uniqueDaysAscending.length - 1] ?? null,
  };
}

function defaultMaxEntriesForMode(mode: QuizCompetitionMode) {
  switch (mode) {
    case QuizCompetitionMode.DAILY_CHALLENGE:
    case QuizCompetitionMode.TOURNAMENT:
      return 1;
    default:
      return null;
  }
}

function getLocalDayStart(offsetMinutes: number, now: Date) {
  const shiftedNow = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  return new Date(
    Date.UTC(
      shiftedNow.getUTCFullYear(),
      shiftedNow.getUTCMonth(),
      shiftedNow.getUTCDate(),
    ) -
      offsetMinutes * 60 * 1000,
  );
}

function getLocalDayEnd(offsetMinutes: number, now: Date) {
  return new Date(
    getLocalDayStart(offsetMinutes, now).getTime() + 24 * 60 * 60 * 1000,
  );
}

function getLocalDateKey(offsetMinutes: number, now: Date) {
  const shiftedNow = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  return [
    shiftedNow.getUTCFullYear(),
    String(shiftedNow.getUTCMonth() + 1).padStart(2, "0"),
    String(shiftedNow.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getLocalDayWindow(offsetMinutes: number, now: Date) {
  const start = getLocalDayStart(offsetMinutes, now);
  const end = getLocalDayEnd(offsetMinutes, now);
  return {
    start,
    end,
    localDate: getLocalDateKey(offsetMinutes, now),
  };
}

function getEntryDurationMs(entry: {
  durationMs: number | null;
  createdAt: Date;
  submittedAt: Date | null;
}) {
  if (
    typeof entry.durationMs === "number" &&
    Number.isFinite(entry.durationMs)
  ) {
    return Math.max(entry.durationMs, 0);
  }
  return Math.max(
    (entry.submittedAt ?? entry.createdAt).getTime() -
      entry.createdAt.getTime(),
    0,
  );
}

const saveRoundHistory = async (
  userId: number,
  data: {
    matchId: string;
    source: any;
    craft: string;
    answers: any;
    puzzles: any;
    totalMs: number;
    expectedMs: number;
    accuracy: number;
    benchmarkDelta: number;
    insight: string;
    completedAt: number;
  },
) => {
  const existing = await prisma.quizRoundHistory.findUnique({
    where: { matchId: data.matchId },
  });
  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const doubleCheck = await tx.quizRoundHistory.findUnique({
      where: { matchId: data.matchId },
    });
    if (doubleCheck) {
      return doubleCheck;
    }

    const newRound = await tx.quizRoundHistory.create({
      data: {
        userId,
        matchId: data.matchId,
        source: data.source,
        craft: data.craft,
        answers: data.answers as any,
        puzzles: data.puzzles as any,
        totalMs: Math.round(data.totalMs),
        expectedMs: Math.round(data.expectedMs),
        accuracy: data.accuracy,
        benchmarkDelta: data.benchmarkDelta,
        insight: data.insight,
        completedAt: new Date(data.completedAt),
      },
    });

    const count = await tx.quizRoundHistory.count({
      where: { userId },
    });
    if (count > 10) {
      const oldest = await tx.quizRoundHistory.findMany({
        where: { userId },
        orderBy: { completedAt: "asc" },
        take: count - 10,
      });
      await tx.quizRoundHistory.deleteMany({
        where: { id: { in: oldest.map((o) => o.id) } },
      });
    }

    return newRound;
  });
};

const getRoundHistoryList = async (userId: number) => {
  return prisma.quizRoundHistory.findMany({
    where: { userId },
    orderBy: { completedAt: "desc" },
    take: 10,
  });
};

const getRoundHistory = async (matchId: string) => {
  return prisma.quizRoundHistory.findUnique({
    where: { matchId },
  });
};

export default {
  getProfile,
  listCompetitions,
  getCompetitionEligibility,
  createCompetitionEntry,
  startDailyChallenge,
  getMyCompetitionEntry,
  completeCompetitionEntry,
  getLeaderboard,
  unlockWorld,
  equipWorld,
  saveRoundHistory,
  getRoundHistoryList,
  getRoundHistory,
};

export { buildQuizRoundFromActivityWindow, getEntryDurationMs };
