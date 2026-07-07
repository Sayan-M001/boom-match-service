import express from "express";
import quizController from "../controllers/quiz.controller";
import { auth } from "../middlewares/auth";
import validate from "../middlewares/validate";
import quizValidation from "../validations/quiz.validation";

const router = express.Router();

router.route("/profile").get(auth(), quizController.getProfile);
router
  .route("/rewards/claim")
  .post(auth(), quizController.claimPendingCoinRewards);

router
  .route("/duels")
  .post(auth(), validate(quizValidation.createDuel), quizController.createDuel)
  .get(auth(), validate(quizValidation.listDuels), quizController.listDuels);

router
  .route("/duels/:duelId")
  .get(auth(), validate(quizValidation.getDuel), quizController.getDuel);
router
  .route("/duels/:duelId/respond")
  .post(
    auth(),
    validate(quizValidation.respondToDuel),
    quizController.respondToDuel,
  );
router
  .route("/duels/:duelId/cancel")
  .post(auth(), validate(quizValidation.getDuel), quizController.cancelDuel);
router
  .route("/duels/:duelId/selection")
  .patch(
    auth(),
    validate(quizValidation.updateDuelSelection),
    quizController.updateDuelSelection,
  );
router
  .route("/duels/:duelId/lock-stake")
  .post(auth(), validate(quizValidation.getDuel), quizController.lockDuelStake);
router
  .route("/duels/:duelId/join")
  .post(auth(), validate(quizValidation.getDuel), quizController.joinDuel);
router
  .route("/duels/:duelId/complete")
  .post(
    auth(),
    validate(quizValidation.completeDuelRound),
    quizController.completeDuelRound,
  );

router
  .route("/daily/start")
  .post(
    auth(),
    validate(quizValidation.startDailyChallenge),
    quizController.startDailyChallenge,
  );
router
  .route("/competitions")
  .get(
    auth(),
    validate(quizValidation.listCompetitions),
    quizController.listCompetitions,
  );
router
  .route("/competitions/:competitionId/eligibility")
  .get(
    auth(),
    validate(quizValidation.getCompetitionEligibility),
    quizController.getCompetitionEligibility,
  );
router
  .route("/competitions/:competitionId/entries")
  .post(
    auth(),
    validate(quizValidation.createCompetitionEntry),
    quizController.createCompetitionEntry,
  );
router
  .route("/competitions/:competitionId/entries/me")
  .get(
    auth(),
    validate(quizValidation.getMyCompetitionEntry),
    quizController.getMyCompetitionEntry,
  );
router
  .route("/competitions/:competitionId/entries/:entryId/complete")
  .post(
    auth(),
    validate(quizValidation.completeCompetitionEntry),
    quizController.completeCompetitionEntry,
  );

router
  .route("/leaderboard")
  .get(
    auth(),
    validate(quizValidation.getLeaderboard),
    quizController.getLeaderboard,
  );
router
  .route("/worlds/:worldId/unlock")
  .post(
    auth(),
    validate(quizValidation.worldAction),
    quizController.unlockWorld,
  );
router
  .route("/worlds/:worldId/equip")
  .post(
    auth(),
    validate(quizValidation.worldAction),
    quizController.equipWorld,
  );
router.route("/history").post(auth(), quizController.saveRoundHistory);
router.route("/history/:matchId").get(auth(), quizController.getRoundHistory);

export default router;
