import { Prisma, QuizCoinLedgerType } from "@prisma/client";
import prisma from "../client";

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

type PendingCoinRewardInput = {
  userId: number;
  amount: number;
  sourceType: string;
  sourceId: string;
  title?: string;
  metadata?: Prisma.InputJsonValue;
};

async function createPendingCoinReward(
  input: PendingCoinRewardInput,
  client: PrismaClientLike = prisma,
) {
  if (input.amount <= 0) return null;

  return client.quizPendingCoinReward.upsert({
    where: {
      userId_sourceType_sourceId: {
        userId: input.userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    create: {
      userId: input.userId,
      amount: input.amount,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      metadata: input.metadata,
    },
    update: {},
  });
}

async function listPendingCoinRewards(
  userId: number,
  client: PrismaClientLike = prisma,
) {
  return client.quizPendingCoinReward.findMany({
    where: { userId, claimedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

async function getPendingCoinRewardSummary(
  userId: number,
  client: PrismaClientLike = prisma,
) {
  const rewards = await listPendingCoinRewards(userId, client);
  return {
    totalCoins: rewards.reduce((total, reward) => total + reward.amount, 0),
    count: rewards.length,
    rewards,
  };
}

async function claimPendingCoinRewards(userId: number) {
  return prisma.$transaction(async (tx) => {
    const rewards = await listPendingCoinRewards(userId, tx);
    const claimedCoins = rewards.reduce(
      (total, reward) => total + reward.amount,
      0,
    );

    const existingProfile = await tx.quizGameProfile.upsert({
      where: { userId },
      create: {
        userId,
        coins: 0,
        lifetimeCoinsEarned: 0,
        xp: 0,
        currentLevel: 1,
      },
      update: {},
    });
    if (claimedCoins <= 0) {
      return {
        profile: {
          ...existingProfile,
          pendingCoinRewards: { totalCoins: 0, count: 0, rewards: [] },
        },
        claimedCoins: 0,
        rewards: [],
      };
    }

    const profile = await tx.quizGameProfile.update({
      where: { userId },
      data: {
        coins: { increment: claimedCoins },
        lifetimeCoinsEarned: { increment: claimedCoins },
      },
    });

    const claimedAt = new Date();
    await tx.quizPendingCoinReward.updateMany({
      where: {
        id: { in: rewards.map((reward) => reward.id) },
        claimedAt: null,
      },
      data: { claimedAt },
    });

    await tx.quizCoinLedger.create({
      data: {
        userId,
        amount: claimedCoins,
        balanceAfter: profile.coins,
        type: QuizCoinLedgerType.COMPETITION_REWARD,
        referenceType: "QuizPendingCoinReward",
        referenceId: "claim-all",
        metadata: {
          claimedRewardIds: rewards.map((reward) => reward.id),
          sources: rewards.map((reward) => ({
            sourceType: reward.sourceType,
            sourceId: reward.sourceId,
            amount: reward.amount,
            title: reward.title,
          })),
        },
      },
    });

    return {
      profile: {
        ...profile,
        pendingCoinRewards: { totalCoins: 0, count: 0, rewards: [] },
      },
      claimedCoins,
      rewards,
    };
  });
}

export default {
  createPendingCoinReward,
  listPendingCoinRewards,
  getPendingCoinRewardSummary,
  claimPendingCoinRewards,
};
