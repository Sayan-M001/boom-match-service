import dotenv from "dotenv";

dotenv.config();

const csv = (value?: string) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

const config = {
  port: Number(process.env.PORT ?? 4005),
  boomBackendUrl: (process.env.BOOM_BACKEND_URL ?? "").replace(/\/$/, ""),
  corsAllowedOrigins: csv(process.env.CORS_ALLOWED_ORIGINS),
  boomMatchAdminEmails: csv(process.env.BOOM_MATCH_ADMIN_EMAILS).map((email) =>
    email.toLowerCase(),
  ),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
};

export default config;
