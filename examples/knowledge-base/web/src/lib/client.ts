import { mantle } from "@mantlejs/client";

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3030";

export const client = mantle({
  url: apiUrl,
  socket: {},
  batch: true,
});
