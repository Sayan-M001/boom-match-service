import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import config from "./config/config";
import quizRoute from "./routes/quiz.route";
import adminQuizRoute from "./routes/adminQuiz.route";
import { errorConverter, errorHandler } from "./middlewares/error";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsAllowedOrigins.length === 0) {
        callback(null, true);
        return;
      }

      callback(null, config.corsAllowedOrigins.includes(origin));
    },
    credentials: true,
  }),
);

app.get("/health", (_req, res) => res.send({ status: "ok" }));
app.use("/v1/quiz", quizRoute);
app.use("/v1/admin", adminQuizRoute);

app.use(errorConverter);
app.use(errorHandler);

export default app;
