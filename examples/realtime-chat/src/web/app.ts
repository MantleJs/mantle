import { mantle } from "@mantlejs/client";

interface User extends Record<string, unknown> {
  id: number;
  email: string;
  name: string;
}

interface Message extends Record<string, unknown> {
  id: number;
  userId: number;
  text: string;
  createdAt?: string;
}

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const client = mantle({ url: window.location.origin, socket: {} });

const authSection = requireEl<HTMLElement>("#auth-section");
const chatSection = requireEl<HTMLElement>("#chat-section");
const loginForm = requireEl<HTMLFormElement>("#login-form");
const registerForm = requireEl<HTMLFormElement>("#register-form");
const messageForm = requireEl<HTMLFormElement>("#message-form");
const messagesEl = requireEl<HTMLElement>("#messages");
const errorEl = requireEl<HTMLElement>("#error");
const logoutButton = requireEl<HTMLButtonElement>("#logout");

const users = client.service<User>("users");
const messages = client.service<Message>("messages");
const userNames = new Map<number, string>();

function showError(message: string): void {
  errorEl.textContent = message;
}

function renderMessage(message: Message): void {
  const li = document.createElement("li");
  const author = userNames.get(message.userId) ?? `user #${message.userId}`;
  li.textContent = `${author}: ${message.text}`;
  messagesEl.append(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function enterChat(): Promise<void> {
  showError("");
  authSection.hidden = true;
  chatSection.hidden = false;

  const page = await users.find({ query: { $limit: 100 } });
  const list = Array.isArray(page) ? page : page.data;
  for (const user of list) userNames.set(user.id, user.name);

  const history = await messages.find({ query: { $sort: { createdAt: "asc" }, $limit: 50 } });
  const historyList = Array.isArray(history) ? history : history.data;
  messagesEl.replaceChildren();
  for (const message of historyList) renderMessage(message);

  messages.on("created", (message) => {
    if (!userNames.has(message.userId)) {
      void users.get(message.userId).then((user) => userNames.set(user.id, user.name));
    }
    renderMessage(message);
  });
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const data = new FormData(loginForm);
    try {
      await client.authenticate({
        strategy: "local",
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      await enterChat();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Login failed");
    }
  })();
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const data = new FormData(registerForm);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    try {
      await users.create({ email, password, name: String(data.get("name")) });
      await client.authenticate({ strategy: "local", email, password });
      await enterChat();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Registration failed");
    }
  })();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const data = new FormData(messageForm);
    const text = String(data.get("text") ?? "").trim();
    if (!text) return;
    try {
      await messages.create({ text });
      messageForm.reset();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to send message");
    }
  })();
});

logoutButton.addEventListener("click", () => {
  void client.logout().then(() => {
    chatSection.hidden = true;
    authSection.hidden = false;
  });
});
