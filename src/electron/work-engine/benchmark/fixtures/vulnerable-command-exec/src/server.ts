import { exec } from "node:child_process";

export function runLookup(host: string) {
  return exec(`nslookup ${host}`);
}

export function route(query: { host?: string }) {
  return runLookup(query.host ?? "localhost");
}
