import {
  Prisma,
  QuizCompetitionMode,
  QuizCompetitionEntryStatus,
  QuizGameProfile,
  QuizCompetitionStatus,
} from "@prisma/client";
import prisma from "../client";
import { ACHIEVEMENTS_CONFIG } from "../config/achievements.config";
import quizRewardsService from "./quizRewards.service";

const TOP_PERFORMER_RESET_KEY_PREFIX = "top_performer_reset_";
const TOP_PERFORMER_PERIOD_HOURS = 24 * 7;

export async function checkAndRunTournamentResolutions(): Promise<void> {
  const now = new Date();

  const endedTournaments = await prisma.quizCompetition.findMany({
    where: {
      mode: QuizCompetitionMode.TOURNAMENT,
      status: QuizCompetitionStatus.ACTIVE,
      endsAt: {
        lte: now,
      },
    },
  });

  for (const tournament of endedTournaments) {
    await resolveTournament(tournament.id, { resolvedAt: now });
  }
}

export async function resolveTournament(
  competitionId: string,
  options: { resolvedAt?: Date; force?: boolean } = {},
) {
  const now = options.resolvedAt ?? new Date();
  const resetStateKey = `tournament_resolved_${competitionId}`;

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.quizCompetition.findUnique({
      where: { id: competitionId },
    });

    if (!tournament || tournament.mode !== QuizCompetitionMode.TOURNAMENT) {
      throw new Error("Tournament not found.");
    }

    const existingResolution = await tx.quizSystemState.findUnique({
      where: { key: resetStateKey },
    });

    if (existingResolution && !options.force) {
      return {
        tournament,
        alreadyResolved: true,
        entryCount: 0,
        winnerEntry: null,
      };
    }

    const entries = await tx.quizCompetitionEntry.findMany({
      where: {
        competitionId: tournament.id,
        status: QuizCompetitionEntryStatus.SCORED,
      },
    });

    entries.sort((left, right) => {
      const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      const durationDelta = (left.durationMs ?? 0) - (right.durationMs ?? 0);
      if (durationDelta !== 0) return durationDelta;
      return (
        new Date(left.submittedAt ?? left.createdAt).getTime() -
        new Date(right.submittedAt ?? right.createdAt).getTime()
      );
    });

    const winnerEntry = entries[0] ?? null;
    if (winnerEntry) {
      await quizRewardsService.createPendingCoinReward(
        {
          userId: winnerEntry.userId,
          amount: tournament.rewardCoins || 200,
          sourceType: "QuizTournamentWinner",
          sourceId: tournament.id,
          title: `Won tournament: ${tournament.name}`,
          metadata: {
            score: winnerEntry.score,
            durationMs: winnerEntry.durationMs,
          },
        },
        tx,
      );
    }

    const closedTournament = await tx.quizCompetition.update({
      where: { id: tournament.id },
      data: { status: QuizCompetitionStatus.CLOSED },
    });

    await tx.quizSystemState.upsert({
      where: { key: resetStateKey },
      create: {
        key: resetStateKey,
        value: JSON.stringify({
          resolvedAt: now.toISOString(),
          winnerUserId: winnerEntry?.userId ?? null,
          winnerScore: winnerEntry?.score ?? null,
          entryCount: entries.length,
        }),
      },
      update: {
        value: JSON.stringify({
          resolvedAt: now.toISOString(),
          winnerUserId: winnerEntry?.userId ?? null,
          winnerScore: winnerEntry?.score ?? null,
          entryCount: entries.length,
        }),
      },
    });

    return {
      tournament: closedTournament,
      alreadyResolved: false,
      entryCount: entries.length,
      winnerEntry,
    };
  });
}

export interface AchievementProgress {
  current: number;
  target: number;
}

export interface BackendAchievementView {
  id: string;
  title: string;
  hint: string;
  icon: string;
  reward: number;
  unlocked: boolean;
  current: number;
  target: number;
}

export interface TopPerformerSummary {
  userId: number;
  userName: string;
  profilePictureKey: string | null;
  xpEarned: number;
  periodStartAt: string;
  periodEndAt: string;
  periodHours: number;
}

/**
 * Calculates progress for a specific achievement.
 */
export function getAchievementProgress(
  id: string,
  entries: any[],
  profile: QuizGameProfile,
): AchievementProgress {
  switch (id) {
    case "first-solve":
      return { current: Math.min(entries.length, 1), target: 1 };
    case "sharp-week": {
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const n = entries.filter(
        (e) => e.submittedAt && e.submittedAt >= weekStart,
      ).length;
      return { current: Math.min(n, 5), target: 5 };
    }
    case "daily_discipline":
      return { current: Math.min(profile.bestStreak, 7), target: 7 };
    case "clutch_finish": {
      const clutchCount = entries.filter((e) => {
        const isComp =
          e.competition.mode === QuizCompetitionMode.DAILY_CHALLENGE ||
          e.competition.mode === QuizCompetitionMode.TOURNAMENT;
        const durationMs =
          e.durationMs ??
          (e.submittedAt ? e.submittedAt.getTime() - e.createdAt.getTime() : 0);
        return isComp && durationMs < 30000;
      }).length;
      return { current: Math.min(clutchCount, 20), target: 20 };
    }
    case "perfect_run": {
      const perfectDates = entries
        .filter(
          (e) =>
            e.score !== null && Math.round(e.score) >= 100 && e.submittedAt,
        )
        .map((e) => e.submittedAt as Date);
      const count = getMaxPerfectRunWithinThirtyDays(perfectDates);
      return { current: Math.min(count, 21), target: 21 };
    }
    case "top_performer_this_week": {
      // This mark is intentionally NOT progress-unlocked from in-week play.
      // It is awarded only by the weekly reset after the calendar week closes
      // and the winner is resolved in `checkAndRunWeeklyLeaderboardReset`.
      return { current: 0, target: 1 };
    }
    default:
      return { current: 0, target: 1 };
  }
}

/**
 * Returns the fully evaluated achievements list for a user.
 */
export async function getProfileAchievements(
  userId: number,
  profile: QuizGameProfile,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BackendAchievementView[]> {
  const unlockedRecords = await tx.quizUserAchievement.findMany({
    where: { userId },
    select: { achievementId: true },
  });
  const unlockedIds = new Set(unlockedRecords.map((r) => r.achievementId));

  const entries = await tx.quizCompetitionEntry.findMany({
    where: { userId, status: QuizCompetitionEntryStatus.SCORED },
    include: { competition: { select: { mode: true } } },
  });

  return ACHIEVEMENTS_CONFIG.map((config) => {
    const { current, target } = getAchievementProgress(
      config.id,
      entries,
      profile,
    );
    const unlocked = unlockedIds.has(config.id) || current >= target; // fallback to progress check
    return {
      id: config.id,
      title: config.title,
      hint: config.hint,
      icon: config.icon,
      reward: config.rewardCoins,
      unlocked,
      current,
      target,
    };
  });
}

/**
 * Decoupled service to evaluate, unlock, and pay out rewards for achievements.
 * Runs inside the complete entry database transaction to ensure coin-safety.
 */
export async function evaluateAndUnlockAchievements({
  tx,
  userId,
  profile,
  timezoneOffsetMinutes: _timezoneOffsetMinutes,
}: {
  tx: Prisma.TransactionClient;
  userId: number;
  profile: QuizGameProfile;
  timezoneOffsetMinutes: number;
}): Promise<string[]> {
  const unlockedRecords = await tx.quizUserAchievement.findMany({
    where: { userId },
    select: { achievementId: true },
  });
  const alreadyUnlocked = new Set(unlockedRecords.map((r) => r.achievementId));

  const entries = await tx.quizCompetitionEntry.findMany({
    where: {
      userId,
      status: QuizCompetitionEntryStatus.SCORED,
    },
    include: {
      competition: {
        select: { mode: true },
      },
    },
  });

  const newlyUnlocked: string[] = [];
  for (const config of ACHIEVEMENTS_CONFIG) {
    if (config.id === "top_performer_this_week") {
      // This achievement is exclusively awarded during the weekly reset.
      continue;
    }

    if (alreadyUnlocked.has(config.id)) {
      continue;
    }

    const { current, target } = getAchievementProgress(
      config.id,
      entries,
      profile,
    );
    const isMet = current >= target;

    if (isMet) {
      newlyUnlocked.push(config.id);

      await tx.quizUserAchievement.create({
        data: {
          userId,
          achievementId: config.id,
        },
      });

      await quizRewardsService.createPendingCoinReward(
        {
          userId,
          amount: config.rewardCoins,
          sourceType: "QuizUserAchievement",
          sourceId: config.id,
          title: `Achievement: ${config.title}`,
          metadata: {
            achievementId: config.id,
            achievementTitle: config.title,
          },
        },
        tx,
      );
    }
  }

  return newlyUnlocked;
}

function getMaxPerfectRunWithinThirtyDays(dates: Date[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let maxCount = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (
      start <= end &&
      sorted[end].getTime() - sorted[start].getTime() > 30 * 24 * 60 * 60 * 1000
    ) {
      start++;
    }
    maxCount = Math.max(maxCount, end - start + 1);
  }
  return maxCount;
}

/**
 * Lazy weekly reset evaluator.
 * Runs on profile load to evaluate the top performer of the previous completed
 * calendar week (Monday 00:00 UTC -> next Monday 00:00 UTC).
 * Resolves the current top performer, credits prize coins, and writes state tracking.
 */
export async function checkAndRunWeeklyLeaderboardReset(): Promise<void> {
  const now = new Date();
  const currentWeekStartAt = getUtcWeekStart(now);
  const previousWeek = getPreviousTopPerformerWeek(currentWeekStartAt);
  const resetStateKey = `${TOP_PERFORMER_RESET_KEY_PREFIX}${previousWeek.startAt.toISOString()}`;

  // 1. Check if reset has already run for the previous completed week.
  const resetExists = await prisma.quizSystemState.findUnique({
    where: { key: resetStateKey },
  });

  if (resetExists) {
    return;
  }

  // 2. Run reset inside a transaction to prevent race conditions
  await prisma.$transaction(async (tx) => {
    // Re-verify under transaction lock
    const doubleCheck = await tx.quizSystemState.findUnique({
      where: { key: resetStateKey },
    });
    if (doubleCheck) {
      return;
    }

    // Fetch all scored competitive rounds from the previous completed week.
    const entries = await tx.quizCompetitionEntry.findMany({
      where: {
        status: QuizCompetitionEntryStatus.SCORED,
        submittedAt: {
          gte: previousWeek.startAt,
          lt: previousWeek.endAt,
        },
        competition: {
          mode: {
            in: [
              QuizCompetitionMode.DAILY_CHALLENGE,
              QuizCompetitionMode.TOURNAMENT,
            ],
          },
        },
      },
      include: {
        competition: {
          select: { mode: true },
        },
      },
    });

    const ranked = rankTopPerformerPeriod(entries);

    const winner = ranked[0] ?? null;
    const winnerId = winner?.userId ?? null;

    if (winnerId) {
      // 3. Queue the +200 coins prize for the resolved top performer.
      await quizRewardsService.createPendingCoinReward(
        {
          userId: winnerId,
          amount: 200,
          sourceType: "QuizWeeklyLeaderboardWinner",
          sourceId: resetStateKey,
          title: "Top performer winner",
          metadata: {
            periodStartAt: previousWeek.startAt.toISOString(),
            periodEndAt: previousWeek.endAt.toISOString(),
            periodHours: TOP_PERFORMER_PERIOD_HOURS,
            xpEarned: winner?.xpEarned ?? 0,
          },
        },
        tx,
      );

      // 4. Unlock the permanent "Top Performer" milestone Mark if first time winning.
      const alreadyUnlocked = await tx.quizUserAchievement.findUnique({
        where: {
          userId_achievementId: {
            userId: winnerId,
            achievementId: "top_performer_this_week",
          },
        },
      });

      if (!alreadyUnlocked) {
        await tx.quizUserAchievement.create({
          data: {
            userId: winnerId,
            achievementId: "top_performer_this_week",
          },
        });

        await quizRewardsService.createPendingCoinReward(
          {
            userId: winnerId,
            amount: 200,
            sourceType: "QuizUserAchievement",
            sourceId: "top_performer_this_week",
            title: "Achievement: Top Performer",
            metadata: {
              achievementId: "top_performer_this_week",
              achievementTitle: "Top Performer",
            },
          },
          tx,
        );
      }
    }

    // 5. Write reset log to system state to prevent double execution.
    await tx.quizSystemState.create({
      data: {
        key: resetStateKey,
        value: JSON.stringify(
          winnerId
            ? {
                winnerUserId: winnerId,
                periodStartAt: previousWeek.startAt.toISOString(),
                periodEndAt: previousWeek.endAt.toISOString(),
                periodHours: TOP_PERFORMER_PERIOD_HOURS,
                xpEarned: winner?.xpEarned ?? 0,
              }
            : {
                periodStartAt: previousWeek.startAt.toISOString(),
                periodEndAt: previousWeek.endAt.toISOString(),
                periodHours: TOP_PERFORMER_PERIOD_HOURS,
                result: "no_entries",
              },
        ),
      },
    });
  });
}

export async function getCurrentTopPerformerSummary(
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TopPerformerSummary | null> {
  const state = await tx.quizSystemState.findFirst({
    where: {
      key: {
        startsWith: TOP_PERFORMER_RESET_KEY_PREFIX,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const fallbackPeriod = getPreviousTopPerformerWeek(
    getUtcWeekStart(new Date()),
  );

  let xpEarned = 0;
  let periodStartAt = fallbackPeriod.startAt.toISOString();
  let periodEndAt = fallbackPeriod.endAt.toISOString();
  let periodHours = TOP_PERFORMER_PERIOD_HOURS;

  if (state) {
    try {
      const parsed = JSON.parse(state.value);
      const winnerUserId = Number(parsed?.winnerUserId ?? 0);

      if (!winnerUserId) {
        return null;
      }

      const winnerUser = await tx.user.findUnique({
        where: { id: winnerUserId },
        select: {
          id: true,
          name: true,
          email: true,
          profilePictureKey: true,
        },
      });

      if (!winnerUser) {
        return null;
      }

      xpEarned = Number(parsed?.xpEarned ?? 0);
      periodStartAt = String(parsed?.periodStartAt ?? periodStartAt);
      periodEndAt = String(parsed?.periodEndAt ?? periodEndAt);
      periodHours = Number(parsed?.periodHours ?? periodHours);

      return {
        userId: winnerUser.id,
        userName: winnerUser.name?.trim() || winnerUser.email,
        profilePictureKey: winnerUser.profilePictureKey,
        xpEarned,
        periodStartAt,
        periodEndAt,
        periodHours,
      };
    } catch {
      // fall back to current configured period metadata
    }
  }

  return null;
}

function calculateTopPerformerRoundXp(entry: {
  competition: { mode: QuizCompetitionMode };
  score: number | null;
  totalQuestions: number | null;
}) {
  const normalizedScore = Math.max(0, Math.min(entry.score ?? 0, 100));
  const totalQuestions = entry.totalQuestions ?? 0;

  const baseXp =
    entry.competition.mode === QuizCompetitionMode.TOURNAMENT ? 45 : 35;
  const accuracyBonus = Math.round((normalizedScore / 100) * 20);
  const completionBonus = totalQuestions >= 6 ? 5 : 0;
  const perfectBonus = normalizedScore >= 100 ? 10 : 0;

  return baseXp + accuracyBonus + completionBonus + perfectBonus;
}

type WeeklyResolvedEntry = {
  userId: number;
  score: number | null;
  durationMs: number | null;
  createdAt: Date;
  submittedAt: Date | null;
  totalQuestions: number | null;
  competition: { mode: QuizCompetitionMode };
};

type WeeklyUserPerformance = {
  userId: number;
  xpEarned: number;
  averageScore: number;
  averageDurationMs: number;
};

function rankTopPerformerPeriod(entries: WeeklyResolvedEntry[]) {
  const performanceByUser = new Map<
    number,
    {
      userId: number;
      xpEarned: number;
      scoreSum: number;
      scoreCount: number;
      durationSum: number;
      durationCount: number;
    }
  >();

  for (const entry of entries) {
    const current = performanceByUser.get(entry.userId) ?? {
      userId: entry.userId,
      xpEarned: 0,
      scoreSum: 0,
      scoreCount: 0,
      durationSum: 0,
      durationCount: 0,
    };

    current.xpEarned += calculateTopPerformerRoundXp(entry);
    current.scoreSum += Math.max(0, Math.min(entry.score ?? 0, 100));
    current.scoreCount += 1;

    const durationMs = getResolvedEntryDurationMs(entry);
    current.durationSum += durationMs;
    current.durationCount += 1;

    performanceByUser.set(entry.userId, current);
  }

  return Array.from(performanceByUser.values())
    .map<WeeklyUserPerformance>((performance) => ({
      userId: performance.userId,
      xpEarned: performance.xpEarned,
      averageScore:
        performance.scoreCount > 0
          ? performance.scoreSum / performance.scoreCount
          : 0,
      averageDurationMs:
        performance.durationCount > 0
          ? performance.durationSum / performance.durationCount
          : 0,
    }))
    .sort((left, right) => {
      const xpDelta = right.xpEarned - left.xpEarned;
      if (xpDelta !== 0) return xpDelta;

      const scoreDelta = right.averageScore - left.averageScore;
      if (scoreDelta !== 0) return scoreDelta;

      return left.averageDurationMs - right.averageDurationMs;
    });
}

function getResolvedEntryDurationMs(entry: {
  durationMs: number | null;
  createdAt: Date;
  submittedAt: Date | null;
}) {
  if (
    typeof entry.durationMs === "number" &&
    Number.isFinite(entry.durationMs)
  ) {
    return Math.max(0, entry.durationMs);
  }

  return Math.max(
    (entry.submittedAt ?? entry.createdAt).getTime() -
      entry.createdAt.getTime(),
    0,
  );
}

function getUtcWeekStart(date: Date) {
  const startAt = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = startAt.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  startAt.setUTCDate(startAt.getUTCDate() - daysSinceMonday);
  return startAt;
}

function getPreviousTopPerformerWeek(currentWeekStartAt: Date) {
  const previousStartAt = new Date(
    currentWeekStartAt.getTime() - 7 * 24 * 60 * 60 * 1000,
  );
  return {
    startAt: previousStartAt,
    endAt: new Date(currentWeekStartAt),
  };
}
