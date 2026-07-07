import {
  Prisma,
  QuizCompetitionMode,
  QuizDailyMissionObjectiveType,
  QuizWeeklyMissionObjectiveType,
  type QuizDailyMissionTemplate,
  type QuizWeeklyMissionTemplate,
} from "@prisma/client";
import prisma from "../client";

const DAILY_MISSION_STREAK_BONUS_DAYS = 3;
const DAILY_MISSION_STREAK_BONUS_COINS = 20;

type MissionView = {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  progressLabel: string;
  rewardXp: number;
  rewardCoins: number;
  isCompleted: boolean;
};

type ActiveDailyMissionTemplate = Pick<
  QuizDailyMissionTemplate,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "objectiveType"
  | "targetValue"
  | "minimumScorePercent"
  | "rewardXp"
  | "rewardCoins"
  | "sortOrder"
>;

type ActiveWeeklyMissionTemplate = Pick<
  QuizWeeklyMissionTemplate,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "objectiveType"
  | "targetValue"
  | "minimumScorePercent"
  | "rewardXp"
  | "rewardCoins"
  | "sortOrder"
>;

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

async function getMissionSnapshot(
  userId: number,
  timezoneOffsetMinutes = 0,
  client: PrismaClientLike = prisma,
) {
  const [dailyMissionTemplates, weeklyMissionTemplates] = await Promise.all([
    listActiveDailyMissionTemplates(timezoneOffsetMinutes, new Date(), client),
    listActiveWeeklyMissionTemplates(timezoneOffsetMinutes, new Date(), client),
  ]);

  const [dailyMissions, weeklyMissions] = await Promise.all([
    getDailyMissions(
      userId,
      timezoneOffsetMinutes,
      dailyMissionTemplates,
      client,
    ),
    getWeeklyMissions(
      userId,
      timezoneOffsetMinutes,
      weeklyMissionTemplates,
      client,
    ),
  ]);

  return { dailyMissions, weeklyMissions };
}

async function syncMissionClaims(
  userId: number,
  timezoneOffsetMinutes = 0,
  client: PrismaClientLike = prisma,
) {
  const [dailyMissionTemplates, weeklyMissionTemplates] = await Promise.all([
    listActiveDailyMissionTemplates(timezoneOffsetMinutes, new Date(), client),
    listActiveWeeklyMissionTemplates(timezoneOffsetMinutes, new Date(), client),
  ]);

  const {
    newlyCompletedDailyMissionIds,
    newlyCompletedDailyMissionRewards,
    dailyMissionStreakBonusCoinsEarned,
    dailyMissionStreakBonusDays,
    dailyMissionStreakBonusReward,
  } = await syncDailyMissionClaims(
    userId,
    timezoneOffsetMinutes,
    dailyMissionTemplates,
    client,
  );
  const { newlyCompletedWeeklyMissionIds, newlyCompletedWeeklyMissionRewards } =
    await syncWeeklyMissionClaims(
      userId,
      timezoneOffsetMinutes,
      weeklyMissionTemplates,
      client,
    );

  const [dailyMissions, weeklyMissions] = await Promise.all([
    getDailyMissions(
      userId,
      timezoneOffsetMinutes,
      dailyMissionTemplates,
      client,
    ),
    getWeeklyMissions(
      userId,
      timezoneOffsetMinutes,
      weeklyMissionTemplates,
      client,
    ),
  ]);

  return {
    newlyCompletedDailyMissionIds,
    newlyCompletedDailyMissionRewards,
    dailyMissionRewardXp: dailyMissions
      .filter((mission) => newlyCompletedDailyMissionIds.includes(mission.id))
      .reduce((total, mission) => total + mission.rewardXp, 0),
    dailyMissionRewardCoins: dailyMissions
      .filter((mission) => newlyCompletedDailyMissionIds.includes(mission.id))
      .reduce((total, mission) => total + mission.rewardCoins, 0),
    dailyMissionStreakBonusCoinsEarned,
    dailyMissionStreakBonusDays,
    dailyMissionStreakBonusReward,
    newlyCompletedWeeklyMissionIds,
    newlyCompletedWeeklyMissionRewards,
    weeklyMissionRewardXp: weeklyMissions
      .filter((mission) => newlyCompletedWeeklyMissionIds.includes(mission.id))
      .reduce((total, mission) => total + mission.rewardXp, 0),
    weeklyMissionRewardCoins: weeklyMissions
      .filter((mission) => newlyCompletedWeeklyMissionIds.includes(mission.id))
      .reduce((total, mission) => total + mission.rewardCoins, 0),
    dailyMissions,
    weeklyMissions,
  };
}

async function calculateClaimedMissionRewards(
  userId: number,
  client: PrismaClientLike = prisma,
) {
  const [dailyClaims, weeklyClaims, streakBonusClaims] = await Promise.all([
    client.quizDailyMissionClaim.findMany({
      where: { userId },
      select: { rewardXp: true, rewardCoins: true },
    }),
    client.quizWeeklyMissionClaim.findMany({
      where: { userId },
      select: { rewardXp: true, rewardCoins: true },
    }),
    client.quizDailyMissionStreakBonusClaim.findMany({
      where: { userId },
      select: { rewardCoins: true },
    }),
  ]);

  const daily = dailyClaims.reduce(
    (totals, claim) => ({
      xp: totals.xp + claim.rewardXp,
      coins: totals.coins + claim.rewardCoins,
    }),
    { xp: 0, coins: 0 },
  );
  const weekly = weeklyClaims.reduce(
    (totals, claim) => ({
      xp: totals.xp + claim.rewardXp,
      coins: totals.coins + claim.rewardCoins,
    }),
    { xp: 0, coins: 0 },
  );
  const streakBonusCoins = streakBonusClaims.reduce(
    (total, claim) => total + claim.rewardCoins,
    0,
  );

  return {
    xp: daily.xp + weekly.xp,
    coins: daily.coins + weekly.coins + streakBonusCoins,
  };
}

async function syncWeeklyMissionClaims(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveWeeklyMissionTemplate[],
  client: PrismaClientLike,
) {
  if (missionTemplates.length === 0) {
    return {
      newlyCompletedWeeklyMissionIds: [],
      newlyCompletedWeeklyMissionRewards: [],
    };
  }

  const weekStart = getLocalWeekStart(timezoneOffsetMinutes, new Date());
  const existingClaims = await client.quizWeeklyMissionClaim.findMany({
    where: {
      userId,
      weekStartAt: weekStart,
      missionTemplateId: { in: missionTemplates.map((mission) => mission.id) },
    },
    select: { missionTemplateId: true },
  });

  const claimedTemplateIds = new Set(
    existingClaims.map((claim) => claim.missionTemplateId),
  );
  const progress = await calculateWeeklyMissionProgress(
    userId,
    timezoneOffsetMinutes,
    missionTemplates,
    client,
  );
  const newlyCompletedMissions = missionTemplates.filter(
    (mission) =>
      progress[mission.id] >= mission.targetValue &&
      !claimedTemplateIds.has(mission.id),
  );

  if (newlyCompletedMissions.length > 0) {
    await client.quizWeeklyMissionClaim.createMany({
      data: newlyCompletedMissions.map((mission) => ({
        userId,
        missionTemplateId: mission.id,
        weekStartAt: weekStart,
        rewardXp: mission.rewardXp,
        rewardCoins: mission.rewardCoins,
      })),
      skipDuplicates: true,
    });
  }

  return {
    newlyCompletedWeeklyMissionIds: newlyCompletedMissions.map(
      (mission) => mission.slug,
    ),
    newlyCompletedWeeklyMissionRewards: newlyCompletedMissions.map(
      (mission) => ({
        id: mission.slug,
        sourceId: `${mission.slug}:${weekStart.toISOString()}`,
        title: `Weekly mission: ${mission.title}`,
        rewardXp: mission.rewardXp,
        rewardCoins: mission.rewardCoins,
      }),
    ),
  };
}

async function syncDailyMissionClaims(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveDailyMissionTemplate[],
  client: PrismaClientLike,
) {
  if (missionTemplates.length === 0) {
    return {
      newlyCompletedDailyMissionIds: [],
      newlyCompletedDailyMissionRewards: [],
      dailyMissionStreakBonusCoinsEarned: 0,
      dailyMissionStreakBonusDays: 0,
      dailyMissionStreakBonusReward: null,
    };
  }

  const dayStart = getLocalDayStart(timezoneOffsetMinutes, new Date());
  const existingClaims = await client.quizDailyMissionClaim.findMany({
    where: {
      userId,
      dayStartAt: dayStart,
      missionTemplateId: { in: missionTemplates.map((mission) => mission.id) },
    },
    select: { missionTemplateId: true },
  });

  const claimedTemplateIds = new Set(
    existingClaims.map((claim) => claim.missionTemplateId),
  );
  const progress = await calculateDailyMissionProgress(
    userId,
    timezoneOffsetMinutes,
    missionTemplates,
    client,
  );
  const newlyCompletedMissions = missionTemplates.filter(
    (mission) =>
      progress[mission.id] >= mission.targetValue &&
      !claimedTemplateIds.has(mission.id),
  );

  if (newlyCompletedMissions.length > 0) {
    await client.quizDailyMissionClaim.createMany({
      data: newlyCompletedMissions.map((mission) => ({
        userId,
        missionTemplateId: mission.id,
        dayStartAt: dayStart,
        rewardXp: mission.rewardXp,
        rewardCoins: mission.rewardCoins,
      })),
      skipDuplicates: true,
    });
  }

  const streakBonus = await syncDailyMissionStreakBonusClaim(
    userId,
    timezoneOffsetMinutes,
    missionTemplates,
    client,
  );

  return {
    newlyCompletedDailyMissionIds: newlyCompletedMissions.map(
      (mission) => mission.slug,
    ),
    newlyCompletedDailyMissionRewards: newlyCompletedMissions.map(
      (mission) => ({
        id: mission.slug,
        sourceId: `${mission.slug}:${dayStart.toISOString()}`,
        title: `Daily mission: ${mission.title}`,
        rewardXp: mission.rewardXp,
        rewardCoins: mission.rewardCoins,
      }),
    ),
    dailyMissionStreakBonusCoinsEarned: streakBonus.rewardCoins,
    dailyMissionStreakBonusDays: streakBonus.streakLength,
    dailyMissionStreakBonusReward: streakBonus.reward,
  };
}

async function getDailyMissions(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveDailyMissionTemplate[],
  client: PrismaClientLike,
): Promise<MissionView[]> {
  if (missionTemplates.length === 0) return [];

  const dayStart = getLocalDayStart(timezoneOffsetMinutes, new Date());
  const [progress, existingClaims] = await Promise.all([
    calculateDailyMissionProgress(
      userId,
      timezoneOffsetMinutes,
      missionTemplates,
      client,
    ),
    client.quizDailyMissionClaim.findMany({
      where: {
        userId,
        dayStartAt: dayStart,
        missionTemplateId: {
          in: missionTemplates.map((mission) => mission.id),
        },
      },
      select: { missionTemplateId: true },
    }),
  ]);
  const claimedTemplateIds = new Set(
    existingClaims.map((claim) => claim.missionTemplateId),
  );

  return missionTemplates.map((mission) => {
    const currentProgress = Math.min(
      progress[mission.id] ?? 0,
      mission.targetValue,
    );
    const isCompleted =
      claimedTemplateIds.has(mission.id) ||
      currentProgress >= mission.targetValue;
    return {
      id: mission.slug,
      title: mission.title,
      description: mission.description,
      target: mission.targetValue,
      progress: currentProgress,
      progressLabel: `${currentProgress}/${mission.targetValue}`,
      rewardXp: mission.rewardXp,
      rewardCoins: mission.rewardCoins,
      isCompleted,
    };
  });
}

async function getWeeklyMissions(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveWeeklyMissionTemplate[],
  client: PrismaClientLike,
): Promise<MissionView[]> {
  if (missionTemplates.length === 0) return [];

  const weekStart = getLocalWeekStart(timezoneOffsetMinutes, new Date());
  const [progress, existingClaims] = await Promise.all([
    calculateWeeklyMissionProgress(
      userId,
      timezoneOffsetMinutes,
      missionTemplates,
      client,
    ),
    client.quizWeeklyMissionClaim.findMany({
      where: {
        userId,
        weekStartAt: weekStart,
        missionTemplateId: {
          in: missionTemplates.map((mission) => mission.id),
        },
      },
      select: { missionTemplateId: true },
    }),
  ]);
  const claimedTemplateIds = new Set(
    existingClaims.map((claim) => claim.missionTemplateId),
  );

  return missionTemplates.map((mission) => {
    const currentProgress = Math.min(
      progress[mission.id] ?? 0,
      mission.targetValue,
    );
    const isCompleted =
      claimedTemplateIds.has(mission.id) ||
      currentProgress >= mission.targetValue;
    return {
      id: mission.slug,
      title: mission.title,
      description: mission.description,
      target: mission.targetValue,
      progress: currentProgress,
      progressLabel: `${currentProgress}/${mission.targetValue}`,
      rewardXp: mission.rewardXp,
      rewardCoins: mission.rewardCoins,
      isCompleted,
    };
  });
}

async function syncDailyMissionStreakBonusClaim(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveDailyMissionTemplate[],
  client: PrismaClientLike,
) {
  const dayStart = getLocalDayStart(timezoneOffsetMinutes, new Date());
  const streakLength = await calculateCompletedDailyMissionStreakLength(
    userId,
    timezoneOffsetMinutes,
    dayStart,
    missionTemplates,
    client,
  );

  if (
    streakLength === 0 ||
    streakLength % DAILY_MISSION_STREAK_BONUS_DAYS !== 0
  ) {
    return { rewardCoins: 0, streakLength, reward: null };
  }

  const existingBonus = await client.quizDailyMissionStreakBonusClaim.findFirst(
    {
      where: { userId, dayStartAt: dayStart },
      select: { id: true },
    },
  );
  if (existingBonus) {
    return { rewardCoins: 0, streakLength, reward: null };
  }

  await client.quizDailyMissionStreakBonusClaim.create({
    data: {
      userId,
      dayStartAt: dayStart,
      streakLength,
      rewardCoins: DAILY_MISSION_STREAK_BONUS_COINS,
    },
  });

  return {
    rewardCoins: DAILY_MISSION_STREAK_BONUS_COINS,
    streakLength,
    reward: {
      sourceId: `daily-mission-streak:${dayStart.toISOString()}`,
      title: `${streakLength}-day daily mission streak`,
      rewardCoins: DAILY_MISSION_STREAK_BONUS_COINS,
      streakLength,
    },
  };
}

async function calculateCompletedDailyMissionStreakLength(
  userId: number,
  timezoneOffsetMinutes: number,
  currentDayStart: Date,
  missionTemplates: ActiveDailyMissionTemplate[],
  client: PrismaClientLike,
) {
  if (missionTemplates.length === 0) return 0;

  const requiredMissionTemplateIds = new Set(
    missionTemplates.map((mission) => mission.id),
  );
  const lookbackStart = new Date(
    currentDayStart.getTime() - 90 * 24 * 60 * 60 * 1000,
  );
  const claims = await client.quizDailyMissionClaim.findMany({
    where: {
      userId,
      dayStartAt: {
        gte: lookbackStart,
        lte: currentDayStart,
      },
      missionTemplateId: { in: Array.from(requiredMissionTemplateIds) },
    },
    select: {
      dayStartAt: true,
      missionTemplateId: true,
    },
  });

  const missionTemplateIdsByDay = new Map<string, Set<string>>();
  for (const claim of claims) {
    const dayKey = claim.dayStartAt.toISOString();
    const missionIdsForDay =
      missionTemplateIdsByDay.get(dayKey) ?? new Set<string>();
    missionIdsForDay.add(claim.missionTemplateId);
    missionTemplateIdsByDay.set(dayKey, missionIdsForDay);
  }

  let streakLength = 0;
  let cursor = currentDayStart;
  while (streakLength < 90) {
    const missionIdsForDay = missionTemplateIdsByDay.get(cursor.toISOString());
    const completedAllDailyMissions = missionIdsForDay
      ? Array.from(requiredMissionTemplateIds).every((missionId) =>
          missionIdsForDay.has(missionId),
        )
      : false;

    if (!completedAllDailyMissions) break;

    streakLength += 1;
    cursor = getLocalDayStart(
      timezoneOffsetMinutes,
      new Date(cursor.getTime() - 24 * 60 * 60 * 1000),
    );
  }

  return streakLength;
}

async function listActiveDailyMissionTemplates(
  timezoneOffsetMinutes: number,
  now = new Date(),
  client: PrismaClientLike = prisma,
): Promise<ActiveDailyMissionTemplate[]> {
  const localDayStart = getLocalDayStart(timezoneOffsetMinutes, now);
  return client.quizDailyMissionTemplate.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: localDayStart } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: localDayStart } }] }],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      objectiveType: true,
      targetValue: true,
      minimumScorePercent: true,
      rewardXp: true,
      rewardCoins: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

async function listActiveWeeklyMissionTemplates(
  timezoneOffsetMinutes: number,
  now = new Date(),
  client: PrismaClientLike = prisma,
): Promise<ActiveWeeklyMissionTemplate[]> {
  const localWeekStart = getLocalWeekStart(timezoneOffsetMinutes, now);
  return client.quizWeeklyMissionTemplate.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: localWeekStart } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: localWeekStart } }] }],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      objectiveType: true,
      targetValue: true,
      minimumScorePercent: true,
      rewardXp: true,
      rewardCoins: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

async function calculateDailyMissionProgress(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveDailyMissionTemplate[],
  client: PrismaClientLike,
) {
  if (missionTemplates.length === 0) return {};

  const dayStart = getLocalDayStart(timezoneOffsetMinutes, new Date());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dailyEntries = await client.quizCompetitionEntry.findMany({
    where: {
      userId,
      status: "SCORED",
      score: { not: null },
      submittedAt: {
        gte: dayStart,
        lt: dayEnd,
      },
    },
    include: { competition: { select: { mode: true } } },
  });
  const progress = Object.fromEntries(
    missionTemplates.map((mission) => [mission.id, 0]),
  ) as Record<string, number>;

  for (const entry of dailyEntries) {
    const normalizedScore = Math.max(0, Math.min(entry.score ?? 0, 100));
    for (const mission of missionTemplates) {
      if (
        didEntryAdvanceDailyMission(
          entry.competition.mode,
          normalizedScore,
          mission,
        )
      ) {
        progress[mission.id] += 1;
      }
    }
  }

  return progress;
}

async function calculateWeeklyMissionProgress(
  userId: number,
  timezoneOffsetMinutes: number,
  missionTemplates: ActiveWeeklyMissionTemplate[],
  client: PrismaClientLike,
) {
  if (missionTemplates.length === 0) return {};

  const weekStart = getLocalWeekStart(timezoneOffsetMinutes, new Date());
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weeklyEntries = await client.quizCompetitionEntry.findMany({
    where: {
      userId,
      status: "SCORED",
      score: { not: null },
      submittedAt: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
    include: { competition: { select: { mode: true } } },
  });
  const progress = Object.fromEntries(
    missionTemplates.map((mission) => [mission.id, 0]),
  ) as Record<string, number>;

  for (const entry of weeklyEntries) {
    const normalizedScore = Math.max(0, Math.min(entry.score ?? 0, 100));
    for (const mission of missionTemplates) {
      if (
        didEntryAdvanceWeeklyMission(
          entry.competition.mode,
          normalizedScore,
          mission,
        )
      ) {
        progress[mission.id] += 1;
      }
    }
  }

  return progress;
}

function didEntryAdvanceDailyMission(
  mode: QuizCompetitionMode,
  normalizedScore: number,
  mission: ActiveDailyMissionTemplate,
) {
  switch (mission.objectiveType) {
    case QuizDailyMissionObjectiveType.DAILY_ROUNDS_COMPLETED:
      return mode === QuizCompetitionMode.DAILY_CHALLENGE;
    case QuizDailyMissionObjectiveType.TOURNAMENT_ROUNDS_COMPLETED:
      return mode === QuizCompetitionMode.TOURNAMENT;
    case QuizDailyMissionObjectiveType.SCORED_ROUNDS_AT_OR_ABOVE_PERCENT:
      return normalizedScore >= (mission.minimumScorePercent ?? 0);
    default:
      return false;
  }
}

function didEntryAdvanceWeeklyMission(
  mode: QuizCompetitionMode,
  normalizedScore: number,
  mission: ActiveWeeklyMissionTemplate,
) {
  switch (mission.objectiveType) {
    case QuizWeeklyMissionObjectiveType.DAILY_ROUNDS_COMPLETED:
      return mode === QuizCompetitionMode.DAILY_CHALLENGE;
    case QuizWeeklyMissionObjectiveType.TOURNAMENT_ROUNDS_COMPLETED:
      return mode === QuizCompetitionMode.TOURNAMENT;
    case QuizWeeklyMissionObjectiveType.SCORED_ROUNDS_AT_OR_ABOVE_PERCENT:
      return normalizedScore >= (mission.minimumScorePercent ?? 0);
    default:
      return false;
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

function getLocalWeekStart(offsetMinutes: number, now: Date) {
  const localDayStart = getLocalDayStart(offsetMinutes, now);
  const shiftedLocalDayStart = new Date(
    localDayStart.getTime() + offsetMinutes * 60 * 1000,
  );
  const dayOfWeek = shiftedLocalDayStart.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7;
  return new Date(localDayStart.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
}

export default {
  getMissionSnapshot,
  syncMissionClaims,
  calculateClaimedMissionRewards,
};
