import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { configureSockets } from "./realtime/socket.js";
import { closeNotifications } from "./services/notifications.js";
import { initializePersistence } from "./db/persistence.js";
import { closeDb } from "./db/client.js";
import { allowedWebOrigins } from "./config/origins.js";
import {
  configurationStatus,
  warnOnConfigurationDrift,
} from "./config/runtime.js";
import { initializeRouteRuns } from "./services/routeRuns.js";
import { closeBulkImportQueue } from "./services/bulkImportQueue.js";
import { runMigrations } from "./db/migrate.js";

const boot = async () => {
  const app = createApp();
  const server = createServer(app);
  const io = new Server(server, { cors: { origin: allowedWebOrigins() } });
  app.set("io", io);
  configureSockets(io);
  app.locals.startupReady = false;
  let shuttingDown = false;
  let retryTimer: NodeJS.Timeout | undefined;

  const initialize = async () => {
    try {
      if (process.env.MIGRATE_ON_START === "true") await runMigrations(false);
      await initializePersistence();
      await initializeRouteRuns();
      warnOnConfigurationDrift();
      const config = configurationStatus();
      if (process.env.STRICT_CONFIG === "true" && !config.ready)
        throw new Error(
          `RoutePulse configuration is incomplete: ${config.missing.join(", ")}`,
        );
      app.locals.startupReady = true;
      app.locals.startupError = false;
      console.info("RoutePulse durable services initialized");
    } catch (error) {
      if (shuttingDown) return;
      app.locals.startupError = true;
      console.error("RoutePulse startup initialization failed", error);
      if (process.env.STRICT_CONFIG === "true") {
        server.close(() => process.exit(1));
        return;
      }
      retryTimer = setTimeout(() => void initialize(), 30_000);
    }
  };

  const port = Number(process.env.PORT || 4000);
  server.listen(port, () => {
    console.info(`RoutePulse API listening on http://localhost:${port}`);
    void initialize();
  });

  const shutdown = () => {
    shuttingDown = true;
    if (retryTimer) clearTimeout(retryTimer);
    server.close(async () => {
      io.close();
      await closeNotifications();
      await closeBulkImportQueue();
      await closeDb();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

void boot().catch((error) => {
  console.error("RoutePulse startup failed", error);
  process.exit(1);
});
