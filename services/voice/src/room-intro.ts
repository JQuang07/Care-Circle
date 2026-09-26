import { AccessToken } from "livekit-server-sdk";
import {
  Room,
  AudioSource,
  LocalAudioTrack,
  AudioFrame,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { synthesize } from "./speech.js";
function decodeMuLaw(byte: number) {
  const value = ~byte & 255;
  const magnitude = (((value & 15) << 3) + 132) << ((value & 112) >> 4);
  return value & 128 ? 132 - magnitude : magnitude - 132;
}
/** One-shot speaker: never subscribes to family audio and always disconnects. */
export async function announce(c: Config, roomName: string, text: string) {
  const room = new Room();
  const source = new AudioSource(8000, 1);
  const token = new AccessToken(c.livekitKey, c.livekitSecret, {
    identity: `care-circle-intro-${randomUUID()}`,
    ttl: 60,
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: false,
    canPublishData: false,
  });
  try {
    await room.connect(
      c.livekitUrl!.replace(/^http/, "ws"),
      await token.toJwt(),
      { autoSubscribe: false, dynacast: false },
    );
    const track = LocalAudioTrack.createAudioTrack(
      "Care Circle introduction",
      source,
    );
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant!.publishTrack(track, options);
    let buffer = Buffer.alloc(0);
    for await (const chunk of synthesize(c, text)) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 160) {
        const frame = new Int16Array(160);
        for (let i = 0; i < 160; i++) frame[i] = decodeMuLaw(buffer[i]!);
        await source.captureFrame(new AudioFrame(frame, 8000, 1, 160));
        buffer = buffer.subarray(160);
      }
    }
    if (buffer.length) {
      const frame = new Int16Array(160);
      for (let i = 0; i < buffer.length; i++)
        frame[i] = decodeMuLaw(buffer[i]!);
      await source.captureFrame(new AudioFrame(frame, 8000, 1, 160));
    }
    await source.waitForPlayout();
  } finally {
    await room.disconnect();
    await source.close();
  }
}
