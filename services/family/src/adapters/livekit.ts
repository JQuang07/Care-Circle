import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import type { Config } from "../config.js";

export interface Rooms {
  /** ws(s):// URL clients connect to. */
  serverUrl: string;
  createRoom(name: string, opts?: { emptyTimeoutSec?: number; metadata?: string }): Promise<{ name: string; sid?: string }>;
  listRooms(): Promise<string[]>;
  joinToken(roomName: string, identity: string, displayName: string, ttlSec?: number): Promise<string>;
}

export function createLiveKitRooms(cfg: Config): Rooms {
  const { livekitUrl, livekitApiKey, livekitApiSecret } = cfg;
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    throw new Error("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing");
  }
  const httpUrl = livekitUrl.replace(/^ws/, "http");
  const svc = new RoomServiceClient(httpUrl, livekitApiKey, livekitApiSecret);
  return {
    serverUrl: livekitUrl,
    async createRoom(name, opts = {}) {
      const room = await svc.createRoom({
        name,
        // Scheduled rooms are created ahead of time; keep them around for a day.
        emptyTimeout: opts.emptyTimeoutSec ?? 24 * 3600,
        maxParticipants: 12,
        metadata: opts.metadata,
      });
      return { name: room.name, sid: room.sid };
    },
    async listRooms() {
      return (await svc.listRooms()).map((r) => r.name);
    },
    async joinToken(roomName, identity, displayName, ttlSec = 36 * 3600) {
      const at = new AccessToken(livekitApiKey, livekitApiSecret, { identity, name: displayName, ttl: ttlSec });
      at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
      return await at.toJwt();
    },
  };
}

/** In-process fake used by tests and when LiveKit is unreachable in MOCK mode. */
export function fakeRooms(): Rooms & { created: string[] } {
  const created: string[] = [];
  return {
    serverUrl: "ws://fake-livekit",
    created,
    async createRoom(name) { created.push(name); return { name, sid: `RM_fake_${created.length}` }; },
    async listRooms() { return [...created]; },
    async joinToken(roomName, identity) { return `fake.${roomName}.${identity}`; },
  };
}
