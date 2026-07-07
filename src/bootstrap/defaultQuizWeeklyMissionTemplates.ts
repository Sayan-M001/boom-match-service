import { Prisma, QuizWeeklyMissionObjectiveType } from "@prisma/client";
import prisma from "../client";
import logger from "../config/logger";

const DEFAULT_QUIZ_WEEKLY_MISSION_TEMPLATES: Array<
  Prisma.QuizWeeklyMissionTemplateUpsertArgs["create"] & { slug: string }
> = [
  {
    slug: "weekly_daily_loop",
    title: "Daily Loop",
    description: "Complete 3 Daily Challenge rounds this week.",
    objectiveType: QuizWeeklyMissionObjectiveType.DAILY_ROUNDS_COMPLETED,
    targetValue: 3,
    rewardXp: 25,
    rewardCoins: 10,
    sortOrder: 1,
    rulesConfig: {
      resetPolicy: "local_week",
      focus: "habit",
    },
  },
  {
    slug: "weekly_tournament_push",
    title: "Tournament Push",
    description: "Complete 2 Tournament rounds this week.",
    objectiveType: QuizWeeklyMissionObjectiveType.TOURNAMENT_ROUNDS_COMPLETED,
    targetValue: 2,
    rewardXp: 40,
    rewardCoins: 20,
    sortOrder: 2,
    rulesConfig: {
      resetPolicy: "local_week",
      focus: "event_play",
    },
  },
  {
    slug: "weekly_sharp_scoring",
    title: "Sharp Scoring",
    description: "Score 80% or better in 3 scored rounds this week.",
    objectiveType:
      QuizWeeklyMissionObjectiveType.SCORED_ROUNDS_AT_OR_ABOVE_PERCENT,
    targetValue: 3,
    minimumScorePercent: 80,
    rewardXp: 30,
    rewardCoins: 15,
    sortOrder: 3,
    rulesConfig: {
      resetPolicy: "local_week",
      focus: "accuracy",
    },
  },
];

export async function ensureDefaultQuizWeeklyMissionTemplates() {
  for (const mission of DEFAULT_QUIZ_WEEKLY_MISSION_TEMPLATES) {
    await prisma.quizWeeklyMissionTemplate.upsert({
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

  logger.info("Default quiz weekly mission templates ensured");
}
