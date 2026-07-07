import httpStatus from "http-status";
import {
  Prisma,
  QuizCoinLedgerType,
  QuizCompetitionMode,
  QuizDuelRoundStatus,
  QuizDuelStatus,
} from "@prisma/client";
import prisma from "../client";
import ApiError from "../utils/ApiError";
import { buildQuizRoundFromActivityWindow } from "./quiz.service";

const DUEL_OPTION_COUNT = 3;
const MIN_DUEL_LEAD_TIME_MS = 5 * 60 * 1000;
const STAKE_LOCK_WINDOW_MS = 30 * 60 * 1000;
const DUEL_JOIN_WINDOW_MS = 60 * 60 * 1000;
const DUEL_LOOKBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUEL_QUESTION_COUNT = 6;
const DUEL_WINNER_PAYOUT_RATE = 0.9;

type DuelClient = Prisma.TransactionClient | typeof prisma;

const duelInclude = {
  inviter: {
    select: {
      id: true,
      name: true,
      email: true,
      profilePictureKey: true,
    },
  },
  opponent: {
    select: {
      id: true,
      name: true,
      email: true,
      profilePictureKey: true,
    },
  },
  winner: {
    select: {
      id: true,
      name: true,
      email: true,
      profilePictureKey: true,
    },
  },
  timeOptions: {
    orderBy: { proposedStartAt: "asc" as const },
  },
  stakeOptions: {
    orderBy: { coinAmount: "asc" as const },
  },
  stakeLocks: {
    orderBy: [{ lockedAt: "asc" as const }],
  },
  rounds: {
    orderBy: [{ startedAt: "asc" as const }],
  },
  selectedTimeOption: true,
  selectedStakeOption: true,
} satisfies Prisma.QuizDuelInclude;

type DuelWithInclude = Prisma.QuizDuelGetPayload<{
  include: typeof duelInclude;
}>;

function mapDuel(duel: DuelWithInclude) {
  const revealResults = duel.status === QuizDuelStatus.COMPLETED;
  const lockedStakeTotal = duel.stakeLocks
    .filter((stakeLock) => !stakeLock.refundedAt)
    .reduce((total, stakeLock) => total + stakeLock.coinAmount, 0);

  return {
    id: duel.id,
    status: duel.status,
    acceptedAt: duel.acceptedAt,
    declinedAt: duel.declinedAt,
    stakeLockDeadlineAt: duel.stakeLockDeadlineAt,
    scheduledStartAt: duel.scheduledStartAt,
    joinWindowClosesAt: duel.joinWindowClosesAt,
    completedAt: duel.completedAt,
    expiresAt: duel.expiresAt,
    createdAt: duel.createdAt,
    updatedAt: duel.updatedAt,
    inviter: {
      id: duel.inviter.id,
      name: duel.inviter.name?.trim() || duel.inviter.email,
      profilePictureKey: duel.inviter.profilePictureKey,
    },
    opponent: {
      id: duel.opponent.id,
      name: duel.opponent.name?.trim() || duel.opponent.email,
      profilePictureKey: duel.opponent.profilePictureKey,
    },
    winner: duel.winner
      ? {
          id: duel.winner.id,
          name: duel.winner.name?.trim() || duel.winner.email,
          profilePictureKey: duel.winner.profilePictureKey,
        }
      : null,
    timeOptions: duel.timeOptions.map((option) => ({
      id: option.id,
      proposedStartAt: option.proposedStartAt,
    })),
    stakeOptions: duel.stakeOptions.map((option) => ({
      id: option.id,
      coinAmount: option.coinAmount,
    })),
    selectedTimeOption: duel.selectedTimeOption
      ? {
          id: duel.selectedTimeOption.id,
          proposedStartAt: duel.selectedTimeOption.proposedStartAt,
        }
      : null,
    selectedStakeOption: duel.selectedStakeOption
      ? {
          id: duel.selectedStakeOption.id,
          coinAmount: duel.selectedStakeOption.coinAmount,
        }
      : null,
    lockedStakeTotal,
    stakeLocks: duel.stakeLocks.map((stakeLock) => ({
      id: stakeLock.id,
      userId: stakeLock.userId,
      coinAmount: stakeLock.coinAmount,
      lockedAt: stakeLock.lockedAt,
      refundedAt: stakeLock.refundedAt,
    })),
    rounds: duel.rounds.map((round) => ({
      id: round.id,
      userId: round.userId,
      status: round.status,
      score: revealResults ? round.score : null,
      correctAnswers: revealResults ? round.correctAnswers : null,
      totalQuestions: revealResults ? round.totalQuestions : null,
      durationMs: revealResults ? round.durationMs : null,
      startedAt: round.startedAt,
      submittedAt: revealResults ? round.submittedAt : null,
    })),
  };
}

async function getAnyDuelOrThrow(duelId: string, client: DuelClient = prisma) {
  const duel = await client.quizDuel.findUnique({
    where: { id: duelId },
    include: duelInclude,
  });

  if (!duel) {
    throw new ApiError(httpStatus.NOT_FOUND, "Duel not found.");
  }

  return duel;
}

async function getDuelOrThrow(
  duelId: string,
  userId: number,
  client: DuelClient = prisma,
) {
  const duel = await getAnyDuelOrThrow(duelId, client);

  if (duel.inviterUserId !== userId && duel.opponentUserId !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You do not have access to this duel.",
    );
  }

  return duel;
}

function normalizeProposedStartAts(proposedStartAts: string[]) {
  if (proposedStartAts.length !== DUEL_OPTION_COUNT) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A duel must include exactly ${DUEL_OPTION_COUNT} proposed time slots.`,
    );
  }

  const normalized = proposedStartAts.map((value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "One or more proposed duel times are invalid.",
      );
    }
    return parsed;
  });

  const uniqueTimes = new Set(normalized.map((value) => value.toISOString()));
  if (uniqueTimes.size !== normalized.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Proposed duel times must be different.",
    );
  }

  const now = Date.now();
  if (
    normalized.some((value) => value.getTime() - now < MIN_DUEL_LEAD_TIME_MS)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "All proposed duel times must be at least 5 minutes in the future.",
    );
  }

  return normalized.sort((left, right) => left.getTime() - right.getTime());
}

function normalizeStakeOptions(coinAmounts: number[]) {
  if (coinAmounts.length !== DUEL_OPTION_COUNT) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A duel must include exactly ${DUEL_OPTION_COUNT} stake options.`,
    );
  }

  const normalized = coinAmounts.map((value) => Math.round(value));
  if (normalized.some((value) => value <= 0)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "All stake options must be positive coin amounts.",
    );
  }

  const uniqueAmounts = new Set(normalized);
  if (uniqueAmounts.size !== normalized.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Stake options must be different.",
    );
  }

  return normalized.sort((left, right) => left - right);
}

async function ensureProfile(userId: number, client: DuelClient = prisma) {
  const existing = await client.quizGameProfile.findUnique({
    where: { userId },
  });
  if (existing) {
    return existing;
  }

  return client.quizGameProfile.create({
    data: {
      userId,
      coins: 50,
      lifetimeCoinsEarned: 50,
      ownedWorldIds: ["bg-1"],
      equippedWorldId: "bg-1",
    },
  });
}

async function incrementProfileCoins(
  userId: number,
  coinAmount: number,
  client: DuelClient,
) {
  await ensureProfile(userId, client);
  return client.quizGameProfile.update({
    where: { userId },
    data: {
      coins: { increment: coinAmount },
    },
  });
}

async function spendProfileCoinsOrThrow(
  userId: number,
  coinAmount: number,
  client: DuelClient,
  getErrorMessage: (missingCoins: number) => string,
) {
  await ensureProfile(userId, client);

  const result = await client.quizGameProfile.updateMany({
    where: {
      userId,
      coins: { gte: coinAmount },
    },
    data: {
      coins: { decrement: coinAmount },
    },
  });

  const profile = await client.quizGameProfile.findUniqueOrThrow({
    where: { userId },
  });

  if (result.count === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      getErrorMessage(coinAmount - profile.coins),
    );
  }

  return profile;
}

async function refundOutstandingStakeLocks(duelId: string, client: DuelClient) {
  const stakeLocks = await client.quizDuelStakeLock.findMany({
    where: {
      duelId,
      refundedAt: null,
    },
  });

  for (const stakeLock of stakeLocks) {
    const profile = await incrementProfileCoins(
      stakeLock.userId,
      stakeLock.coinAmount,
      client,
    );

    await client.quizCoinLedger.create({
      data: {
        userId: stakeLock.userId,
        amount: stakeLock.coinAmount,
        balanceAfter: profile.coins,
        type: QuizCoinLedgerType.REFUND,
        referenceType: "QuizDuel",
        referenceId: duelId,
        metadata: {
          reason: "Duel stake refund",
        },
      },
    });

    await client.quizDuelStakeLock.update({
      where: { id: stakeLock.id },
      data: { refundedAt: new Date() },
    });
  }
}

function hasExpired(date: Date | null | undefined, now: Date) {
  return !!date && date.getTime() <= now.getTime();
}

function getExpiredStakeMessage(duel: DuelWithInclude, now: Date) {
  if (hasExpired(duel.selectedTimeOption?.proposedStartAt, now)) {
    return "The selected duel time has already passed.";
  }

  return "The stake lock window for this duel has expired.";
}

async function expireDuel(
  duel: DuelWithInclude,
  now: Date,
  client: DuelClient,
) {
  return client.quizDuel.update({
    where: { id: duel.id },
    data: {
      status: QuizDuelStatus.EXPIRED,
      completedAt: duel.completedAt ?? now,
    },
    include: duelInclude,
  });
}

function getJoinWindowOrThrow(duel: DuelWithInclude) {
  if (!duel.scheduledStartAt || !duel.joinWindowClosesAt) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This duel does not have a scheduled play window yet.",
    );
  }

  return {
    scheduledStartAt: duel.scheduledStartAt,
    joinWindowClosesAt: duel.joinWindowClosesAt,
  };
}

function stakeLockDeadlineFor(selectedStartAt: Date, now: Date) {
  return new Date(
    Math.min(now.getTime() + STAKE_LOCK_WINDOW_MS, selectedStartAt.getTime()),
  );
}

async function ensureScheduledWindow(
  duel: DuelWithInclude,
  client: DuelClient,
): Promise<DuelWithInclude> {
  if (duel.scheduledStartAt && duel.joinWindowClosesAt) {
    return duel;
  }

  if (!duel.selectedTimeOption) {
    return duel;
  }

  return client.quizDuel.update({
    where: { id: duel.id },
    data: {
      scheduledStartAt: duel.selectedTimeOption.proposedStartAt,
      joinWindowClosesAt: new Date(
        duel.selectedTimeOption.proposedStartAt.getTime() + DUEL_JOIN_WINDOW_MS,
      ),
    },
    include: duelInclude,
  });
}

async function payoutDuelWinner(
  duel: DuelWithInclude,
  winnerUserId: number,
  client: DuelClient,
) {
  const existingPayout = await client.quizCoinLedger.findFirst({
    where: {
      type: QuizCoinLedgerType.DUEL_PAYOUT,
      referenceType: "QuizDuel",
      referenceId: duel.id,
    },
  });

  if (existingPayout) {
    return;
  }

  const outstandingStakeLocks = duel.stakeLocks.filter(
    (stakeLock) => !stakeLock.refundedAt,
  );
  const totalLockedCoins = outstandingStakeLocks.reduce(
    (total, stakeLock) => total + stakeLock.coinAmount,
    0,
  );

  if (totalLockedCoins <= 0) {
    return;
  }

  const winnerProfile = await ensureProfile(winnerUserId, client);
  const payoutCoins = Math.round(totalLockedCoins * DUEL_WINNER_PAYOUT_RATE);

  const payoutLedger = await client.quizCoinLedger.createMany({
    data: {
      userId: winnerUserId,
      amount: payoutCoins,
      balanceAfter: winnerProfile.coins + payoutCoins,
      type: QuizCoinLedgerType.DUEL_PAYOUT,
      referenceType: "QuizDuel",
      referenceId: duel.id,
      metadata: {
        duelId: duel.id,
        totalLockedCoins,
        payoutCoins,
        platformCommissionCoins: totalLockedCoins - payoutCoins,
        reason: "Duel winner payout",
      },
    },
    skipDuplicates: true,
  });

  if (payoutLedger.count === 0) {
    return;
  }

  await incrementProfileCoins(winnerUserId, payoutCoins, client);
}

function rankScoredDuelRounds(rounds: DuelWithInclude["rounds"]) {
  return [...rounds].sort((left, right) => {
    const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;

    const durationDelta = (left.durationMs ?? 0) - (right.durationMs ?? 0);
    if (durationDelta !== 0) return durationDelta;

    return (
      new Date(left.submittedAt ?? left.createdAt).getTime() -
      new Date(right.submittedAt ?? right.createdAt).getTime()
    );
  });
}

async function syncDuelLifecycle(
  duelId: string,
  client: DuelClient = prisma,
): Promise<DuelWithInclude> {
  await client.$queryRaw(
    Prisma.sql`SELECT id FROM "QuizDuel" WHERE id = ${duelId} FOR UPDATE`,
  );

  const duel = await getAnyDuelOrThrow(duelId, client);
  const now = new Date();

  if (
    duel.status === QuizDuelStatus.PROPOSED &&
    hasExpired(duel.expiresAt, now)
  ) {
    return expireDuel(duel, now, client);
  }

  const stakeLockExpired =
    duel.status === QuizDuelStatus.AWAITING_STAKES &&
    (hasExpired(duel.selectedTimeOption?.proposedStartAt, now) ||
      hasExpired(duel.stakeLockDeadlineAt, now));
  if (stakeLockExpired) {
    await refundOutstandingStakeLocks(duel.id, client);
    return expireDuel(duel, now, client);
  }

  if (
    duel.status !== QuizDuelStatus.SCHEDULED &&
    duel.status !== QuizDuelStatus.LIVE
  ) {
    return duel;
  }

  const scoredRounds = duel.rounds.filter(
    (round) => round.status === QuizDuelRoundStatus.SCORED,
  );
  const duelWithWindow = await ensureScheduledWindow(duel, client);

  if (!duelWithWindow.scheduledStartAt || !duelWithWindow.joinWindowClosesAt) {
    return duelWithWindow;
  }

  const { scheduledStartAt, joinWindowClosesAt } =
    getJoinWindowOrThrow(duelWithWindow);

  if (
    duelWithWindow.status === QuizDuelStatus.SCHEDULED &&
    scheduledStartAt.getTime() <= now.getTime() &&
    joinWindowClosesAt.getTime() > now.getTime()
  ) {
    return client.quizDuel.update({
      where: { id: duelWithWindow.id },
      data: { status: QuizDuelStatus.LIVE },
      include: duelInclude,
    });
  }

  if (joinWindowClosesAt.getTime() > now.getTime()) {
    return duelWithWindow;
  }

  if (scoredRounds.length === 0) {
    await refundOutstandingStakeLocks(duelWithWindow.id, client);
    return client.quizDuel.update({
      where: { id: duelWithWindow.id },
      data: {
        status: QuizDuelStatus.EXPIRED,
        completedAt: duelWithWindow.completedAt ?? now,
      },
      include: duelInclude,
    });
  }

  if (scoredRounds.length === 1) {
    const winnerUserId = scoredRounds[0].userId;
    await payoutDuelWinner(duelWithWindow, winnerUserId, client);
    return client.quizDuel.update({
      where: { id: duelWithWindow.id },
      data: {
        status: QuizDuelStatus.COMPLETED,
        winnerUserId,
        completedAt: duelWithWindow.completedAt ?? now,
      },
      include: duelInclude,
    });
  }

  const winnerUserId = rankScoredDuelRounds(scoredRounds)[0].userId;
  await payoutDuelWinner(duelWithWindow, winnerUserId, client);
  return client.quizDuel.update({
    where: { id: duelWithWindow.id },
    data: {
      status: QuizDuelStatus.COMPLETED,
      winnerUserId,
      completedAt: duelWithWindow.completedAt ?? now,
    },
    include: duelInclude,
  });
}

function syncDuelLifecycleInTransaction(duelId: string) {
  return prisma.$transaction((tx) => syncDuelLifecycle(duelId, tx));
}

const createDuel = async ({
  inviterUserId,
  opponentEmail,
  proposedStartAts,
  coinAmounts,
}: {
  inviterUserId: number;
  opponentEmail: string;
  proposedStartAts: string[];
  coinAmounts: number[];
}) => {
  const normalizedTimes = normalizeProposedStartAts(proposedStartAts);
  const normalizedStakes = normalizeStakeOptions(coinAmounts);

  const opponent = await prisma.user.findUnique({
    where: { email: opponentEmail.trim().toLowerCase() },
    select: { id: true },
  });

  if (!opponent) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "No registered user was found for that email.",
    );
  }

  if (inviterUserId === opponent.id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "You cannot invite yourself to a duel.",
    );
  }

  const inviterProfile = await ensureProfile(inviterUserId);
  const maxStake = Math.max(...normalizedStakes);
  if (maxStake > inviterProfile.coins) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Your highest proposed stake is ${maxStake} coins, but you only have ${inviterProfile.coins}.`,
    );
  }

  const expiresAt = normalizedTimes[normalizedTimes.length - 1];

  const duel = await prisma.quizDuel.create({
    data: {
      inviterUserId,
      opponentUserId: opponent.id,
      expiresAt,
      timeOptions: {
        create: normalizedTimes.map((proposedStartAt) => ({ proposedStartAt })),
      },
      stakeOptions: {
        create: normalizedStakes.map((coinAmount) => ({ coinAmount })),
      },
    },
    include: duelInclude,
  });

  return mapDuel(duel);
};

const cancelDuel = async ({
  duelId,
  userId,
}: {
  duelId: string;
  userId: number;
}) => {
  await getDuelOrThrow(duelId, userId);
  await syncDuelLifecycleInTransaction(duelId);

  return prisma.$transaction(async (tx) => {
    const duel = await getDuelOrThrow(duelId, userId, tx);
    const now = new Date();

    if (duel.inviterUserId !== userId) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Only the inviter can cancel this duel.",
      );
    }

    if (
      duel.status !== QuizDuelStatus.PROPOSED &&
      duel.status !== QuizDuelStatus.AWAITING_STAKES
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel can only be cancelled before stakes are locked.",
      );
    }

    if (duel.stakeLocks.length > 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel cannot be cancelled after a player locks coins.",
      );
    }

    const cancelled = await tx.quizDuel.update({
      where: { id: duel.id },
      data: {
        status: QuizDuelStatus.CANCELLED,
        completedAt: duel.completedAt ?? now,
      },
      include: duelInclude,
    });

    return mapDuel(cancelled);
  });
};

const listDuels = async (
  userId: number,
  filters: {
    status?: QuizDuelStatus;
  },
) => {
  const duelIds = await prisma.quizDuel.findMany({
    where: {
      OR: [{ inviterUserId: userId }, { opponentUserId: userId }],
      ...(filters.status ? { status: filters.status } : {}),
    },
    select: { id: true },
    orderBy: [{ createdAt: "desc" }],
  });

  const duels = await Promise.all(
    duelIds.map((duel) => syncDuelLifecycleInTransaction(duel.id)),
  );
  return duels
    .filter((duel) => !filters.status || duel.status === filters.status)
    .map(mapDuel);
};

const getDuel = async (duelId: string, userId: number) => {
  const duel = await getDuelOrThrow(duelId, userId);
  const synced = await syncDuelLifecycleInTransaction(duel.id);
  return mapDuel(synced);
};

const respondToDuel = async ({
  duelId,
  userId,
  action,
  timeOptionId,
  stakeOptionId,
}: {
  duelId: string;
  userId: number;
  action: "ACCEPT" | "DECLINE";
  timeOptionId?: string;
  stakeOptionId?: string;
}) => {
  await getDuelOrThrow(duelId, userId);
  const syncedDuel = await syncDuelLifecycleInTransaction(duelId);

  if (syncedDuel.status === QuizDuelStatus.EXPIRED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This duel invite expired at ${syncedDuel.expiresAt}.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const duel = await getDuelOrThrow(duelId, userId, tx);

    if (duel.opponentUserId !== userId) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Only the invited user can respond to this duel.",
      );
    }

    if (duel.status !== QuizDuelStatus.PROPOSED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel is no longer awaiting a response.",
      );
    }

    const now = new Date();

    if (action === "DECLINE") {
      const declined = await tx.quizDuel.update({
        where: { id: duel.id },
        data: {
          status: QuizDuelStatus.DECLINED,
          declinedAt: now,
          completedAt: duel.completedAt ?? now,
        },
        include: duelInclude,
      });

      return mapDuel(declined);
    }

    if (!timeOptionId || !stakeOptionId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Accepting a duel requires one selected time option and one selected stake option.",
      );
    }

    const chosenTime = duel.timeOptions.find(
      (option) => option.id === timeOptionId,
    );
    if (!chosenTime) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected duel time option is invalid.",
      );
    }

    if (chosenTime.proposedStartAt.getTime() <= now.getTime()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected duel time has already passed.",
      );
    }

    const chosenStake = duel.stakeOptions.find(
      (option) => option.id === stakeOptionId,
    );
    if (!chosenStake) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected duel stake option is invalid.",
      );
    }

    const accepted = await tx.quizDuel.update({
      where: { id: duel.id },
      data: {
        status: QuizDuelStatus.AWAITING_STAKES,
        acceptedAt: now,
        stakeLockDeadlineAt: stakeLockDeadlineFor(
          chosenTime.proposedStartAt,
          now,
        ),
        selectedTimeOptionId: chosenTime.id,
        selectedStakeOptionId: chosenStake.id,
      },
      include: duelInclude,
    });

    return mapDuel(accepted);
  });
};

const updateDuelSelection = async ({
  duelId,
  userId,
  timeOptionId,
  stakeOptionId,
}: {
  duelId: string;
  userId: number;
  timeOptionId: string;
  stakeOptionId: string;
}) => {
  await getDuelOrThrow(duelId, userId);
  const syncedDuel = await syncDuelLifecycleInTransaction(duelId);

  if (syncedDuel.status === QuizDuelStatus.EXPIRED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The stake lock window has expired.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const duel = await getDuelOrThrow(duelId, userId, tx);
    const now = new Date();

    if (duel.opponentUserId !== userId) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Only the invited user can change the selected duel options.",
      );
    }

    if (duel.status !== QuizDuelStatus.AWAITING_STAKES) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Duel selection can only be changed before stakes are locked.",
      );
    }

    if (duel.stakeLocks.length > 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Duel selection cannot be changed after a player locks coins.",
      );
    }

    const chosenTime = duel.timeOptions.find(
      (option) => option.id === timeOptionId,
    );
    if (!chosenTime) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected duel time option is invalid.",
      );
    }

    if (chosenTime.proposedStartAt.getTime() <= now.getTime()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected duel time has already passed.",
      );
    }

    const chosenStake = duel.stakeOptions.find(
      (option) => option.id === stakeOptionId,
    );
    if (!chosenStake) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected duel stake option is invalid.",
      );
    }

    const updated = await tx.quizDuel.update({
      where: { id: duel.id },
      data: {
        selectedTimeOptionId: chosenTime.id,
        selectedStakeOptionId: chosenStake.id,
        stakeLockDeadlineAt: stakeLockDeadlineFor(
          chosenTime.proposedStartAt,
          now,
        ),
      },
      include: duelInclude,
    });

    return mapDuel(updated);
  });
};

const lockStake = async ({
  duelId,
  userId,
}: {
  duelId: string;
  userId: number;
}) => {
  await getDuelOrThrow(duelId, userId);
  const syncedDuel = await syncDuelLifecycleInTransaction(duelId);

  if (syncedDuel.status === QuizDuelStatus.EXPIRED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      getExpiredStakeMessage(syncedDuel, new Date()),
    );
  }

  return prisma.$transaction(async (tx) => {
    const duel = await getDuelOrThrow(duelId, userId, tx);

    if (duel.status !== QuizDuelStatus.AWAITING_STAKES) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel is not waiting for stake locks.",
      );
    }

    if (!duel.selectedStakeOption || !duel.selectedTimeOption) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel is missing its selected options.",
      );
    }

    const existingStakeLock = duel.stakeLocks.find(
      (stakeLock) => stakeLock.userId === userId,
    );
    if (existingStakeLock) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "You have already locked your stake for this duel.",
      );
    }

    const profile = await spendProfileCoinsOrThrow(
      userId,
      duel.selectedStakeOption.coinAmount,
      tx,
      (missingCoins) =>
        `Need ${missingCoins} more coins to lock this duel stake.`,
    );

    await tx.quizCoinLedger.create({
      data: {
        userId,
        amount: -duel.selectedStakeOption.coinAmount,
        balanceAfter: profile.coins,
        type: QuizCoinLedgerType.SPEND,
        referenceType: "QuizDuel",
        referenceId: duel.id,
        metadata: {
          reason: "Duel stake lock",
          duelId: duel.id,
        },
      },
    });

    await tx.quizDuelStakeLock.create({
      data: {
        duelId: duel.id,
        userId,
        coinAmount: duel.selectedStakeOption.coinAmount,
      },
    });

    const lockedStakeCount = await tx.quizDuelStakeLock.count({
      where: { duelId: duel.id, refundedAt: null },
    });

    const updatedDuel = await tx.quizDuel.update({
      where: { id: duel.id },
      data:
        lockedStakeCount >= 2
          ? {
              status: QuizDuelStatus.SCHEDULED,
              scheduledStartAt: duel.selectedTimeOption.proposedStartAt,
              joinWindowClosesAt: new Date(
                duel.selectedTimeOption.proposedStartAt.getTime() +
                  DUEL_JOIN_WINDOW_MS,
              ),
            }
          : {},
      include: duelInclude,
    });

    return mapDuel(updatedDuel);
  });
};

const joinDuel = async ({
  duelId,
  userId,
}: {
  duelId: string;
  userId: number;
}) => {
  await getDuelOrThrow(duelId, userId);
  await syncDuelLifecycleInTransaction(duelId);

  return prisma.$transaction(async (tx) => {
    const duel = await getDuelOrThrow(duelId, userId, tx);

    if (
      duel.status !== QuizDuelStatus.SCHEDULED &&
      duel.status !== QuizDuelStatus.LIVE
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel is not available to join right now.",
      );
    }

    const { scheduledStartAt, joinWindowClosesAt } = getJoinWindowOrThrow(duel);
    const now = new Date();

    if (scheduledStartAt.getTime() > now.getTime()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `This duel opens at ${scheduledStartAt.toISOString()}.`,
      );
    }

    if (joinWindowClosesAt.getTime() <= now.getTime()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "The join window for this duel has closed.",
      );
    }

    const existingRound = await tx.quizDuelRound.findUnique({
      where: {
        duelId_userId: {
          duelId: duel.id,
          userId,
        },
      },
    });

    if (existingRound) {
      return {
        duel: mapDuel(duel),
        round: existingRound,
      };
    }

    const questionWindowEndAt = scheduledStartAt;
    const questionWindowStartAt = new Date(
      scheduledStartAt.getTime() - DUEL_LOOKBACK_WINDOW_MS,
    );
    const roundName = `${duel.inviter.name?.trim() || "Player"} vs ${
      duel.opponent.name?.trim() || "Player"
    } Duel`;
    const generated = await buildQuizRoundFromActivityWindow({
      userId,
      mode: QuizCompetitionMode.TOURNAMENT,
      roundName,
      questionCount: DUEL_QUESTION_COUNT,
      questionWindowStartAt,
      questionWindowEndAt,
    });

    const createdRound = await tx.quizDuelRound.create({
      data: {
        duelId: duel.id,
        userId,
        roundPayload: generated.round as Prisma.InputJsonValue,
        questionWindowStartAt,
        questionWindowEndAt,
      },
    });

    return {
      duel: mapDuel(duel),
      round: createdRound,
    };
  });
};

const completeDuelRound = async ({
  duelId,
  userId,
  correctAnswers,
  totalQuestions,
  durationMs,
}: {
  duelId: string;
  userId: number;
  correctAnswers: number;
  totalQuestions: number;
  durationMs: number;
}) => {
  await getDuelOrThrow(duelId, userId);
  await syncDuelLifecycleInTransaction(duelId);

  return prisma.$transaction(async (tx) => {
    const duel = await getDuelOrThrow(duelId, userId, tx);

    if (
      duel.status !== QuizDuelStatus.SCHEDULED &&
      duel.status !== QuizDuelStatus.LIVE
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel round can no longer be submitted.",
      );
    }

    const { scheduledStartAt, joinWindowClosesAt } = getJoinWindowOrThrow(duel);
    const now = new Date();

    if (scheduledStartAt.getTime() > now.getTime()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `This duel opens at ${scheduledStartAt.toISOString()}.`,
      );
    }

    if (joinWindowClosesAt.getTime() <= now.getTime()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "The submission window for this duel has closed.",
      );
    }

    const round = await tx.quizDuelRound.findUnique({
      where: {
        duelId_userId: {
          duelId: duel.id,
          userId,
        },
      },
    });

    if (!round) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Join the duel first before submitting your score.",
      );
    }

    if (round.status !== QuizDuelRoundStatus.IN_PROGRESS) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This duel round has already been submitted.",
      );
    }

    const normalizedScore =
      totalQuestions > 0
        ? Math.max(0, Math.min(100, (correctAnswers / totalQuestions) * 100))
        : 0;

    const scoredRound = await tx.quizDuelRound.update({
      where: { id: round.id },
      data: {
        status: QuizDuelRoundStatus.SCORED,
        score: normalizedScore,
        correctAnswers,
        totalQuestions,
        durationMs: Math.max(0, Math.round(durationMs)),
        submittedAt: now,
      },
    });

    const syncedDuel = await syncDuelLifecycle(duel.id, tx);

    return {
      duel: mapDuel(syncedDuel),
      round: scoredRound,
    };
  });
};

export default {
  createDuel,
  listDuels,
  getDuel,
  respondToDuel,
  cancelDuel,
  updateDuelSelection,
  lockStake,
  joinDuel,
  completeDuelRound,
};
