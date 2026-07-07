import { Prisma, QuizDailyMissionObjectiveType } from "@prisma/client";
import prisma from "../client";
import logger from "../config/logger";

const DEFAULT_QUIZ_DAILY_MISSION_TEMPLATES: Array<
  Prisma.QuizDailyMissionTemplateUpsertArgs["create"] & { slug: string }
> = [
  {
    slug: "daily_complete_daily_round",
    title: "Daily Check-in",
    description: "Complete 1 Daily Challenge today.",
    objectiveType: QuizDailyMissionObjectiveType.DAILY_ROUNDS_COMPLETED,
    targetValue: 1,
    rewardXp: 15,
    rewardCoins: 5,
    sortOrder: 1,
    rulesConfig: {
      resetPolicy: "local_day",
      focus: "habit",
    },
  },
  {
    slug: "daily_tournament_push",
    title: "Tournament Push",
    description: "Complete 1 Tournament round today.",
    objectiveType: QuizDailyMissionObjectiveType.TOURNAMENT_ROUNDS_COMPLETED,
    targetValue: 1,
    rewardXp: 12,
    rewardCoins: 5,
    sortOrder: 2,
    rulesConfig: {
      resetPolicy: "local_day",
      focus: "event_play",
    },
  },
  {
    slug: "daily_sharp_score",
    title: "Sharp Score",
    description: "Score 80% or better in any scored round today.",
    objectiveType:
      QuizDailyMissionObjectiveType.SCORED_ROUNDS_AT_OR_ABOVE_PERCENT,
    targetValue: 1,
    minimumScorePercent: 80,
    rewardXp: 12,
    rewardCoins: 5,
    sortOrder: 3,
    rulesConfig: {
      resetPolicy: "local_day",
      focus: "accuracy",
    },
  },
];

export async function ensureDefaultQuizDailyMissionTemplates() {
  for (const mission of DEFAULT_QUIZ_DAILY_MISSION_TEMPLATES) {
    await prisma.quizDailyMissionTemplate.upsert({
      where: { slug: mission.slug },
      create: mission,
      update: {
        title: mission.title,
        description: mission.description,
        objectiveType: mission.objectiveType,
        targetValue: mission.targetValue,
        minimumScorePercent: mission.minimumScorePercent ?? null,
        rewardXp: mission.rewardXp,
        rewardCoins: mission.rewardCoins,
        sortOrder: mission.sortOrder,
        isActive: mission.isActive ?? true,
        startsAt: mission.startsAt ?? null,
        endsAt: mission.endsAt ?? null,
        rulesConfig: mission.rulesConfig ?? Prisma.JsonNull,
      },
    });
  }

  logger.info("Default quiz daily mission templates ensured");
}
