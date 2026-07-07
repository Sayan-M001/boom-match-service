import Joi from "joi";
import { QuizCompetitionStatus } from "@prisma/client";

const getQuizTournaments = {
  query: Joi.object().keys({
    status: Joi.string().valid(...Object.values(QuizCompetitionStatus)),
  }),
};

const createQuizTournament = {
  body: Joi.object().keys({
    name: Joi.string().trim().required(),
    description: Joi.string().allow("", null),
    shortLabel: Joi.string().allow("", null),
    rewardCoins: Joi.number().integer().min(0),
    rewardXp: Joi.number().integer().min(0),
    maxEntriesPerUser: Joi.number().integer().min(1).max(10),
    startsAt: Joi.date().iso().required(),
    endsAt: Joi.date().iso().required(),
  }),
};

const closeQuizTournament = {
  params: Joi.object().keys({
    competitionId: Joi.string().required(),
  }),
};

export default {
  getQuizTournaments,
  createQuizTournament,
  closeQuizTournament,
};
