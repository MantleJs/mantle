import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import type { User } from "./entities/user.js";
import type { Article } from "./entities/article.js";

/** Seeds through the registered services (not raw repositories) so hashing, the
 * multi-repo article write, and embeddings all happen exactly as they would in prod. */
async function main(): Promise<void> {
  const app = createApp();
  await migrate(app);

  const seedUsers: Array<Partial<User>> = [
    { email: "ada@example.com", password: "s3cretpass", name: "Ada Lovelace" },
    { email: "grace@example.com", password: "s3cretpass", name: "Grace Hopper" },
  ];
  const users: User[] = [];
  for (const data of seedUsers) {
    users.push(await app.service<User>("users").create(data));
  }

  const seedArticles: Array<Partial<Article>> = [
    {
      title: "Onboarding Guide",
      body: "Welcome to the team! Set up your laptop, join #general, and read the on-call runbook before your first week ends.",
      authorId: users[0].id,
    },
    {
      title: "Expense Policy",
      body: "Submit expenses within 30 days via the finance portal. Receipts are required for anything over $25.",
      authorId: users[1].id,
    },
    {
      title: "On-call Runbook",
      body: "Rotation is weekly, Monday to Monday. Escalate to #incidents after 15 minutes of no response.",
      authorId: users[0].id,
    },
  ];
  const articles: Article[] = [];
  for (const data of seedArticles) {
    articles.push(await app.service<Article>("articles").create(data, { user: users[0] }));
  }

  await app.service("comments").create(
    { articleId: articles[0].id, body: "Super helpful, thanks for writing this up!" },
    { user: users[1] },
  );

  console.log(`Seeded ${users.length} users and ${articles.length} articles.`);
  await app.teardown();
}

void main();
