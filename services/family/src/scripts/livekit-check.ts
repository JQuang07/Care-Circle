// Creates a room on the local LiveKit server and mints two join tokens.
// Usage: npm run livekit:check
import { loadConfig } from "../config.js";
import { createLiveKitRooms } from "../adapters/livekit.js";

const cfg = loadConfig();
const rooms = createLiveKitRooms(cfg);
const name = `cc-check-${Date.now()}`;
const room = await rooms.createRoom(name, { emptyTimeoutSec: 600 });
const listed = await rooms.listRooms();
const lisa = await rooms.joinToken(name, "mem_lisa", "Lisa");
const danny = await rooms.joinToken(name, "mem_danny", "Danny");
console.log(JSON.stringify({
  ok: listed.includes(name),
  room,
  serverUrl: rooms.serverUrl,
  meetUrls: {
    lisa: `https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(rooms.serverUrl)}&token=${lisa}`,
    danny: `https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(rooms.serverUrl)}&token=${danny}`,
  },
}, null, 2));
