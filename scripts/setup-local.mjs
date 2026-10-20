import { copyFileSync, existsSync, readFileSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const [source, target] of [
  ["apps/api/.env.local.example", "apps/api/.env"],
  ["apps/web/.env.local.example", "apps/web/.env.local"],
]) {
  if (!existsSync(resolve(root, target))) {
    copyFileSync(resolve(root, source), resolve(root, target), constants.COPYFILE_EXCL);
    console.info(`Created ${target}`);
  }
}

const config = parseEnv(readFileSync(resolve(root, "apps/api/.env"), "utf8"));
const environment = { ...config, ...process.env };
const database = environment.DATABASE_URL;
if (!database || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)) {
  throw new Error("Local setup requires DATABASE_URL pointing to a local PostgreSQL instance.");
}
if ((environment.AUTH_MODE || "demo") !== "demo" ||
    ["production", "staging"].includes(environment.APP_ENV || environment.NODE_ENV)) {
  throw new Error("Local setup requires demo authentication and a development environment.");
}

for (const [command, args] of [
  ["docker", ["compose", "up", "-d", "--wait"]],
  ["npm", ["run", "db:migrate", "-w", "@routepulse/api"]],
  ["npm", ["run", "db:seed", "-w", "@routepulse/api"]],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.info("Local infrastructure is ready. Run npm run dev to open RoutePulse.");
