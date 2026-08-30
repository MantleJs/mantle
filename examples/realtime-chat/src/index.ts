import { createApp, migrate } from "./app.js";

async function main(): Promise<void> {
  const app = createApp();
  await migrate(app);
  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, () => {
    console.log(`realtime-chat listening on http://localhost:${port}`);
  });
}

void main();
