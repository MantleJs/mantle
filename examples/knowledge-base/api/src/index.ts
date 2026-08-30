import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import { createProductionLogger } from "./logger.js";

async function main(): Promise<void> {
  const logger = await createProductionLogger();
  const app = createApp({ logger });
  await migrate(app);
  const port = app.get<{ port?: number }>("app")?.port ?? 3030;
  app.listen(port, () => {
    console.log(`knowledge-base-api listening on http://localhost:${port}`);
  });
}

void main();
