import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startLayoutWatcher } from "./services/layout-watcher.js";
import { startAssetWatcher } from "./services/asset-watcher.js";
import { log } from "./logging.js";

const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  log.info({ port: config.PORT, host: config.HOST }, "admin server listening");
} catch (err) {
  log.error({ err }, "admin server failed to start");
  process.exit(1);
}

startLayoutWatcher(app.prisma, config.LAYOUTS_DIR, app.layoutModuleCache);
startAssetWatcher(app.prisma, config.ASSETS_DIR);
