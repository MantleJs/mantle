import { mantle, RepositoryService, type MantleApplication } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { MemoryRepository } from "@mantlejs/memory";

export interface Todo extends Record<string, unknown> {
  id: string;
  title: string;
  done: boolean;
}

/** Zero-config Mantle app: one in-memory `todos` service over the zero-dependency HTTP transport. */
export function createApp(): MantleApplication {
  const app = mantle().configure(http({ cors: true }));

  app.use("todos", new RepositoryService<Todo>(new MemoryRepository<Todo>()), {
    methods: ["find", "get", "create", "update", "patch", "remove"],
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`todo-minimal listening on http://localhost:${port}`);
  });
}
