import app from "./app";
import config from "./config/config";
import logger from "./config/logger";
import { ensureDefaultQuizDailyMissionTemplates } from "./bootstrap/defaultQuizDailyMissionTemplates";
import { ensureDefaultQuizWeeklyMissionTemplates } from "./bootstrap/defaultQuizWeeklyMissionTemplates";

async function start() {
  await ensureDefaultQuizDailyMissionTemplates();
  await ensureDefaultQuizWeeklyMissionTemplates();

  app.listen(config.port, () => {
    logger.info(`Boom Match service listening on port ${config.port}`);
  });
}

void start();
