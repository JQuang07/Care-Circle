import type { Config } from "./config.js";
import type { Clock } from "./clock.js";
import type { Store } from "./store/types.js";
import type { Muse } from "./adapters/muse.js";
import type { Rooms } from "./adapters/livekit.js";
import type { MoneyClient, VoiceClient } from "./adapters/services.js";

export interface Logger {
  info(obj: any, msg?: string): void;
  warn(obj: any, msg?: string): void;
  error(obj: any, msg?: string): void;
}

export interface Deps {
  cfg: Config;
  store: Store;
  clock: Clock;
  muse: Muse;
  rooms: Rooms;
  voice: VoiceClient;
  money: MoneyClient;
  log: Logger;
}

/** Maps to CONTRACTS §0 error shape. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (msg: string, code = "BAD_REQUEST") => new AppError(400, code, msg);
export const conflict = (msg: string, code = "CONFLICT") => new AppError(409, code, msg);

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
