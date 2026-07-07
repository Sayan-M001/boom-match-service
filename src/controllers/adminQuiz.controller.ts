import httpStatus from "http-status";
import { QuizCompetitionStatus } from "@prisma/client";
import catchAsync from "../utils/catchAsync";
import adminQuizService from "../services/adminQuiz.service";

const routeParam = (value: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const getQuizTournaments = catchAsync(async (req, res) => {
  const result = await adminQuizService.getQuizTournaments({
    status: req.query.status as QuizCompetitionStatus | undefined,
  });
  res.status(httpStatus.OK).send(result);
});

const createQuizTournament = catchAsync(async (req, res) => {
  const result = await adminQuizService.createQuizTournament(req.body);
  res.status(httpStatus.CREATED).send(result);
});

const closeQuizTournament = catchAsync(async (req, res) => {
  const result = await adminQuizService.closeQuizTournament(
    routeParam(req.params.competitionId),
  );
  res.status(httpStatus.OK).send(result);
});

export default {
  getQuizTournaments,
  createQuizTournament,
  closeQuizTournament,
};
