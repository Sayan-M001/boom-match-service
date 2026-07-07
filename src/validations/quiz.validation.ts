import Joi from "joi";
import {
  QuizCompetitionMode,
  QuizCompetitionStatus,
  QuizDuelStatus,
} from "@prisma/client";

const competitionModes = [
  QuizCompetitionMode.DAILY_CHALLENGE,
  QuizCompetitionMode.TOURNAMENT,
];
const leaderboardModes = [...competitionModes, "GLOBAL_STANDING"];
const competitionStatuses = Object.values(QuizCompetitionStatus);
const duelStatuses = Object.values(QuizDuelStatus);

const competitionIdParams = {
  params: Joi.object().keys({
    competitionId: Joi.string().required(),
  }),
};

const competitionEntryParams = {
  params: Joi.object().keys({
    competitionId: Joi.string().required(),
    entryId: Joi.string().required(),
  }),
};

const listCompetitions = {
  query: Joi.object().keys({
    mode: Joi.string().valid(...competitionModes),
    status: Joi.string().valid(...competitionStatuses),
    timezoneOffsetMinutes: Joi.number().integer().min(-840).max(840),
  }),
};

const getCompetitionEligibility = {
  ...competitionIdParams,
  query: Joi.object().keys({
    timezoneOffsetMinutes: Joi.number().integer().min(-840).max(840),
  }),
};

const createCompetitionEntry = {
  params: competitionIdParams.params,
  body: Joi.object().keys({
    timezoneOffsetMinutes: Joi.number().integer().min(-840).max(840),
  }),
};

const startDailyChallenge = {
  body: Joi.object().keys({
    timezoneOffsetMinutes: Joi.number().integer().min(-840).max(840),
  }),
};

const getMyCompetitionEntry = competitionIdParams;

const completeCompetitionEntry = {
  ...competitionEntryParams,
  body: Joi.object().keys({
    correctAnswers: Joi.number().integer().min(0).required(),
    totalQuestions: Joi.number().integer().min(1).max(100).required(),
    durationMs: Joi.number().integer().min(0).required(),
    timezoneOffsetMinutes: Joi.number().integer().min(-840).max(840),
    coinsEarned: Joi.number().integer().min(0).optional(),
  }),
};

const getLeaderboard = {
  query: Joi.object().keys({
    mode: Joi.string()
      .valid(...leaderboardModes)
      .required(),
    timezoneOffsetMinutes: Joi.number().integer().min(-840).max(840),
  }),
};

const worldAction = {
  params: Joi.object().keys({
    worldId: Joi.string().required(),
  }),
};

const duelIdParams = {
  params: Joi.object().keys({
    duelId: Joi.string().required(),
  }),
};

const createDuel = {
  body: Joi.object().keys({
    opponentEmail: Joi.string().trim().lowercase().email().required(),
    proposedStartAts: Joi.array()
      .items(Joi.string().isoDate())
      .length(3)
      .required(),
    coinAmounts: Joi.array()
      .items(Joi.number().integer().positive())
      .length(3)
      .required(),
  }),
};

const listDuels = {
  query: Joi.object().keys({
    status: Joi.string().valid(...duelStatuses),
  }),
};

const getDuel = duelIdParams;

const respondToDuel = {
  ...duelIdParams,
  body: Joi.object()
    .keys({
      action: Joi.string().valid("ACCEPT", "DECLINE").required(),
      timeOptionId: Joi.string(),
      stakeOptionId: Joi.string(),
    })
    .custom((value, helpers) => {
      if (
        value.action === "ACCEPT" &&
        (!value.timeOptionId || !value.stakeOptionId)
      ) {
        return helpers.error("any.invalid");
      }
      return value;
    })
    .messages({
      "any.invalid":
        "Accepting a duel requires both timeOptionId and stakeOptionId.",
    }),
};

const updateDuelSelection = {
  ...duelIdParams,
  body: Joi.object().keys({
    timeOptionId: Joi.string().required(),
    stakeOptionId: Joi.string().required(),
  }),
};

const completeDuelRound = {
  ...duelIdParams,
  body: Joi.object().keys({
    correctAnswers: Joi.number().integer().min(0).required(),
    totalQuestions: Joi.number().integer().min(1).max(100).required(),
    durationMs: Joi.number().integer().min(0).required(),
  }),
};

export default {
  listCompetitions,
  getCompetitionEligibility,
  createCompetitionEntry,
  startDailyChallenge,
  getMyCompetitionEntry,
  completeCompetitionEntry,
  getLeaderboard,
  worldAction,
  createDuel,
  listDuels,
  getDuel,
  respondToDuel,
  cancelDuel: getDuel,
  updateDuelSelection,
  completeDuelRound,
};
