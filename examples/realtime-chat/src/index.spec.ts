import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
// Side-effect import: pulls in @mantlejs/express's `declare module` augmentation of
// `MantleApplication.listen` for this file's own compilation unit (tsconfig project
// references don't propagate ambient merges from `app.ts` across the project boundary).
import "@mantlejs/express";
import { createApp, migrate } from "./app.js";

describe("realtime-chat", () => {
  it("registers, authenticates, and broadcasts a new message over the socket", async () => {
    const app = createApp({ dbFilename: ":memory:", jwtSecret: "test-secret" });
    await migrate(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

    let socket: Socket | undefined;
    try {
      const registered = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com", password: "s3cret!", name: "Ada" }),
      });
      expect(registered.status).toBe(201);

      const authResponse = await fetch(`${baseUrl}/authentication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy: "local", email: "ada@example.com", password: "s3cret!" }),
      });
      expect(authResponse.status).toBe(201);
      const { accessToken } = (await authResponse.json()) as { accessToken: string };

      const s = ioClient(baseUrl, { transports: ["websocket"] });
      socket = s;
      await new Promise<void>((resolve) => s.on("connect", resolve));

      const created = new Promise<{ text: string; userId: number }>((resolve) => {
        s.on("messages created", resolve);
      });

      const posted = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ text: "hello, chat" }),
      });
      expect(posted.status).toBe(201);

      const event = await created;
      expect(event.text).toBe("hello, chat");
      expect(event.userId).toBe(1);
    } finally {
      socket?.close();
      server.close();
    }
  });

  it("allows sorting message history by createdAt — the query the web client runs on login", async () => {
    const app = createApp({ dbFilename: ":memory:", jwtSecret: "test-secret" });
    await migrate(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

    try {
      const registered = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "grace@example.com", password: "s3cret!", name: "Grace" }),
      });
      expect(registered.status).toBe(201);

      const authResponse = await fetch(`${baseUrl}/authentication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy: "local", email: "grace@example.com", password: "s3cret!" }),
      });
      const { accessToken } = (await authResponse.json()) as { accessToken: string };

      const history = await fetch(`${baseUrl}/messages?$sort[createdAt]=asc&$limit=50`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(history.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("rejects an unauthenticated message post", async () => {
    const app = createApp({ dbFilename: ":memory:", jwtSecret: "test-secret" });
    await migrate(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

    try {
      const posted = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "should be rejected" }),
      });
      expect(posted.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
