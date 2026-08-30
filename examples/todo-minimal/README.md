# todo-minimal

The smallest possible Mantle app — one file, one service, zero external infra:
[`@mantlejs/http`](../../packages/http) (zero-dependency transport) over
[`@mantlejs/memory`](../../packages/memory) (in-memory repository).

```bash
npx nx build todo-minimal
npx nx run todo-minimal:serve   # http://localhost:3000
```

```bash
curl -X POST http://localhost:3000/todos -H 'content-type: application/json' \
  -d '{"title": "write the README", "done": false}'
curl http://localhost:3000/todos
```

See [`src/index.ts`](./src/index.ts) for the entire app.
