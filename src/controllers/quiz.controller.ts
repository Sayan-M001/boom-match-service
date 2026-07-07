import httpStatus from "http-status";
import {
  QuizCompetitionMode,
  QuizCompetitionStatus,
  QuizDuelStatus,
  User,
} from "@prisma/client";
import catchAsync from "../utils/catchAsync";
import quizService from "../services/quiz.service";
import quizRewardsService from "../services/quizRewards.service";
import quizDuelService from "../services/quizDuel.service";
import ApiError from "../utils/ApiError";

const routeParam = (value: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const getProfile = catchAsync(async (req, res) => {
  const user = req.user as User;
  const profile = await quizService.getProfile(
    user.id,
    Number(req.query.timezoneOffsetMinutes ?? 0),
  );
  res.status(httpStatus.OK).send(profile);
});

const listCompetitions = catchAsync(async (req, res) => {
  const user = req.user as User;
  const competitions = await quizService.listCompetitions(user.id, {
    mode: req.query.mode as QuizCompetitionMode | undefined,
    status: req.query.status as QuizCompetitionStatus | undefined,
    timezoneOffsetMinutes: Number(req.query.timezoneOffsetMinutes ?? 0),
  });
  res.status(httpStatus.OK).send(competitions);
});

const getCompetitionEligibility = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.getCompetitionEligibility(
    routeParam(req.params.competitionId),
    user.id,
    Number(req.query.timezoneOffsetMinutes ?? 0),
  );
  res.status(httpStatus.OK).send(result);
});

const createCompetitionEntry = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.createCompetitionEntry(
    routeParam(req.params.competitionId),
    user.id,
    Number(req.body.timezoneOffsetMinutes ?? 0),
  );
  res.status(httpStatus.CREATED).send(result);
});

const startDailyChallenge = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.startDailyChallenge(
    user.id,
    Number(req.body.timezoneOffsetMinutes ?? 0),
  );
  res.status(httpStatus.CREATED).send(result);
});

const getMyCompetitionEntry = catchAsync(async (req, res) => {
  const user = req.user as User;
  const entry = await quizService.getMyCompetitionEntry(
    routeParam(req.params.competitionId),
    user.id,
  );
  res.status(httpStatus.OK).send(entry);
});

const completeCompetitionEntry = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.completeCompetitionEntry({
    competitionId: routeParam(req.params.competitionId),
    entryId: routeParam(req.params.entryId),
    userId: user.id,
    correctAnswers: req.body.correctAnswers,
    totalQuestions: req.body.totalQuestions,
    durationMs: req.body.durationMs,
    timezoneOffsetMinutes: Number(req.body.timezoneOffsetMinutes ?? 0),
    coinsEarned:
      req.body.coinsEarned != null ? Number(req.body.coinsEarned) : undefined,
  });
  res.status(httpStatus.OK).send(result);
});

const getLeaderboard = catchAsync(async (req, res) => {
  const user = req.user as User;
  const leaderboard = await quizService.getLeaderboard(
    user.id,
    req.query.mode as QuizCompetitionMode | "GLOBAL_STANDING",
    Number(req.query.timezoneOffsetMinutes ?? 0),
  );
  res.status(httpStatus.OK).send(leaderboard);
});

const saveRoundHistory = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.saveRoundHistory(user.id, req.body);
  res.status(httpStatus.CREATED).send(result);
});

const getRoundHistory = catchAsync(async (req, res) => {
  const result = await quizService.getRoundHistory(
    routeParam(req.params.matchId),
  );
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Round history not found");
  }
  res.status(httpStatus.OK).send(result);
});

const unlockWorld = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.unlockWorld(
    user.id,
    routeParam(req.params.worldId),
  );
  res.status(httpStatus.OK).send(result);
});

const equipWorld = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizService.equipWorld(
    user.id,
    routeParam(req.params.worldId),
  );
  res.status(httpStatus.OK).send(result);
});

const claimPendingCoinRewards = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizRewardsService.claimPendingCoinRewards(user.id);
  res.status(httpStatus.OK).send(result);
});

const createDuel = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duel = await quizDuelService.createDuel({
    inviterUserId: user.id,
    opponentEmail: req.body.opponentEmail,
    proposedStartAts: req.body.proposedStartAts,
    coinAmounts: req.body.coinAmounts,
  });
  res.status(httpStatus.CREATED).send(duel);
});

const listDuels = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duels = await quizDuelService.listDuels(user.id, {
    status: req.query.status as QuizDuelStatus | undefined,
  });
  res.status(httpStatus.OK).send(duels);
});

const getDuel = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duel = await quizDuelService.getDuel(
    routeParam(req.params.duelId),
    user.id,
  );
  res.status(httpStatus.OK).send(duel);
});

const respondToDuel = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duel = await quizDuelService.respondToDuel({
    duelId: routeParam(req.params.duelId),
    userId: user.id,
    action: req.body.action,
    timeOptionId: req.body.timeOptionId,
    stakeOptionId: req.body.stakeOptionId,
  });
  res.status(httpStatus.OK).send(duel);
});

const cancelDuel = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duel = await quizDuelService.cancelDuel({
    duelId: routeParam(req.params.duelId),
    userId: user.id,
  });
  res.status(httpStatus.OK).send(duel);
});

const updateDuelSelection = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duel = await quizDuelService.updateDuelSelection({
    duelId: routeParam(req.params.duelId),
    userId: user.id,
    timeOptionId: req.body.timeOptionId,
    stakeOptionId: req.body.stakeOptionId,
  });
  res.status(httpStatus.OK).send(duel);
});

const lockDuelStake = catchAsync(async (req, res) => {
  const user = req.user as User;
  const duel = await quizDuelService.lockStake({
    duelId: routeParam(req.params.duelId),
    userId: user.id,
  });
  res.status(httpStatus.OK).send(duel);
});

const joinDuel = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizDuelService.joinDuel({
    duelId: routeParam(req.params.duelId),
    userId: user.id,
  });
  res.status(httpStatus.OK).send(result);
});

const completeDuelRound = catchAsync(async (req, res) => {
  const user = req.user as User;
  const result = await quizDuelService.completeDuelRound({
    duelId: routeParam(req.params.duelId),
    userId: user.id,
    correctAnswers: req.body.correctAnswers,
    totalQuestions: req.body.totalQuestions,
    durationMs: req.body.durationMs,
  });
  res.status(httpStatus.OK).send(result);
});

export default {
  getProfile,
  listCompetitions,
  getCompetitionEligibility,
  createCompetitionEntry,
  startDailyChallenge,
  getMyCompetitionEntry,
  completeCompetitionEntry,
  getLeaderboard,
  saveRoundHistory,
  getRoundHistory,
  unlockWorld,
  equipWorld,
  claimPendingCoinRewards,
  createDuel,
  listDuels,
  getDuel,
  respondToDuel,
  cancelDuel,
  updateDuelSelection,
  lockDuelStake,
  joinDuel,
  completeDuelRound,
};
