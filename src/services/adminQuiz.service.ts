import { randomBytes } from "crypto";
import httpStatus from "http-status";
import {
  QuizCompetitionMode,
  QuizCompetitionStatus,
  QuizCompetitionVisibility,
} from "@prisma/client";
import prisma from "../client";
import ApiError from "../utils/ApiError";
import { resolveTournament } from "./achievements.service";

type CreateQuizTournamentData = {
  name: string;
  description?: string;
  shortLabel?: string;
  rewardCoins?: number;
  rewardXp?: number;
  maxEntriesPerUser?: number;
  startsAt: string | Date;
  endsAt: string | Date;
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const generateQuizTournamentSlug = async (name: string) => {
  const base = toSlug(name) || "tournament";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${base}-${randomBytes(3).toString("hex")}`;
    const existing = await prisma.quizCompetition.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) return slug;
  }

  throw new ApiError(
    httpStatus.CONFLICT,
    "Could not generate a unique tournament slug",
  );
};

const getQuizTournamentStatusForWindow = (startsAt: Date, endsAt: Date) => {
  const now = new Date();

  if (endsAt <= now) return QuizCompetitionStatus.CLOSED;
  if (startsAt > now) return QuizCompetitionStatus.SCHEDULED;
  return QuizCompetitionStatus.ACTIVE;
};

const getQuizTournaments = async (
  filter: { status?: QuizCompetitionStatus } = {},
) => {
  return prisma.quizCompetition.findMany({
    where: {
      mode: QuizCompetitionMode.TOURNAMENT,
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: {
      _count: {
        select: { entries: true },
      },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });
};

const createQuizTournament = async (data: CreateQuizTournamentData) => {
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Invalid tournament date window",
    );
  }

  if (endsAt <= startsAt) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Tournament end time must be after start time",
    );
  }

  return prisma.quizCompetition.create({
    data: {
      name: data.name.trim(),
      slug: await generateQuizTournamentSlug(data.name),
      mode: QuizCompetitionMode.TOURNAMENT,
      status: getQuizTournamentStatusForWindow(startsAt, endsAt),
      visibility: QuizCompetitionVisibility.PUBLIC,
      description: data.description?.trim() || null,
      shortLabel: data.shortLabel?.trim() || null,
      impactsLeaderboard: true,
      maxEntriesPerUser: data.maxEntriesPerUser ?? 1,
      rewardCoins: data.rewardCoins ?? 200,
      rewardXp: data.rewardXp ?? 0,
      startsAt,
      endsAt,
      rulesConfig: {
        lookbackHours: 24,
        minimumSegmentCount: 6,
      },
    },
  });
};

const closeQuizTournament = async (competitionId: string) => {
  const tournament = await prisma.quizCompetition.findUnique({
    where: { id: competitionId },
  });

  if (!tournament || tournament.mode !== QuizCompetitionMode.TOURNAMENT) {
    throw new ApiError(httpStatus.NOT_FOUND, "Tournament not found");
  }

  if (tournament.status === QuizCompetitionStatus.CANCELLED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Cancelled tournaments cannot be closed",
    );
  }

  const result = await resolveTournament(competitionId);

  return {
    ...result,
    notifiedUserCount: 0,
  };
};

export default {
  getQuizTournaments,
  createQuizTournament,
  closeQuizTournament,
};
