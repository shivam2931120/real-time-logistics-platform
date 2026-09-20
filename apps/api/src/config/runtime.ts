import { dbEnabled } from "../db/client.js";

export type RuntimeEnvironment = "development" | "staging" | "production";

const value = (key: string) => process.env[key]?.trim() || "";

export const runtimeEnvironment = (): RuntimeEnvironment => {
  const configured = value("APP_ENV") || value("NODE_ENV");
  if (configured === "production" || configured === "staging") return configured;
  return "development";
};

export const configurationStatus = () => {
  const environment = runtimeEnvironment();
  const auth = value("AUTH_MODE") || "demo";
  const queue = value("QUEUE_MODE") || "inline";
  const payment = value("RAZORPAY_KEY_ID") || value("RAZORPAY_KEY_SECRET")
    ? "razorpay"
    : "demo";
  const smtpConfigured = Boolean(
    value("GOOGLE_SMTP_USER") && value("GOOGLE_SMTP_APP_PASSWORD"),
  );
  const missing: string[] = [];

  if (environment === "production") {
    if (!dbEnabled) missing.push("DATABASE_URL");
    if (value("JWT_SECRET").length < 32) missing.push("JWT_SECRET (32+ characters)");
    if (auth === "clerk" && !value("CLERK_SECRET_KEY"))
      missing.push("CLERK_SECRET_KEY");
    if (!value("WEB_ORIGIN")) missing.push("WEB_ORIGIN");
  }
  if (queue === "bullmq" && !value("REDIS_URL")) missing.push("REDIS_URL");
  if (payment === "razorpay") {
    if (!value("RAZORPAY_KEY_ID")) missing.push("RAZORPAY_KEY_ID");
    if (!value("RAZORPAY_KEY_SECRET")) missing.push("RAZORPAY_KEY_SECRET");
    if (!value("RAZORPAY_WEBHOOK_SECRET")) missing.push("RAZORPAY_WEBHOOK_SECRET");
  }
  if (Boolean(value("GOOGLE_SMTP_USER")) !== Boolean(value("GOOGLE_SMTP_APP_PASSWORD"))) {
    missing.push("GOOGLE_SMTP_USER and GOOGLE_SMTP_APP_PASSWORD (both required)");
  }

  return {
    environment,
    auth,
    queue,
    payment,
    smtp: smtpConfigured,
    database: dbEnabled,
    demoAuth: value("DEMO_AUTH_ENABLED") !== "false",
    ready: missing.length === 0,
    missing,
  };
};

export const warnOnConfigurationDrift = () => {
  const status = configurationStatus();
  if (!status.ready) {
    console.warn(
      JSON.stringify({
        event: "configuration.incomplete",
        environment: status.environment,
        missing: status.missing,
      }),
    );
  }
  return status;
};
