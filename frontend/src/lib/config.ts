// Optional-chained so the module also imports cleanly outside Vite (Node
// scripts, tests), where `import.meta.env` does not exist.
const API_BASE = import.meta.env?.VITE_API_URL ?? "http://localhost:4000";

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export const socketUrl = () => {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
};
