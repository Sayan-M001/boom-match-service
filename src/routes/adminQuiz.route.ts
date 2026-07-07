import express from "express";
import adminQuizController from "../controllers/adminQuiz.controller";
import { auth, requireBoomMatchAdmin } from "../middlewares/auth";
import validate from "../middlewares/validate";
import adminQuizValidation from "../validations/adminQuiz.validation";

const router = express.Router();

router.use(auth(), requireBoomMatchAdmin);

router
  .route("/quiz/tournaments")
  .get(
    validate(adminQuizValidation.getQuizTournaments),
    adminQuizController.getQuizTournaments,
  )
  .post(
    validate(adminQuizValidation.createQuizTournament),
    adminQuizController.createQuizTournament,
  );

router
  .route("/quiz/tournaments/:competitionId/close")
  .post(
    validate(adminQuizValidation.closeQuizTournament),
    adminQuizController.closeQuizTournament,
  );

export default router;
