export function config(env: NodeJS.ProcessEnv = process.env) {
  const mock = env.MOCK === "1";
  const result = {
    mock,
    mockDependencies: env.MOCK_DEPENDENCIES === "1",
    port: Number(env.PORT || 4001),
    host: env.HOST || "127.0.0.1",
    secret: env.CC_INTERNAL_SECRET || "",
    databaseUrl: env.DATABASE_URL,
    moneyUrl: env.MONEY_URL || "http://localhost:4002",
    familyUrl: env.FAMILY_URL || "http://localhost:4003",
    metaKey: env.META_API_KEY,
    model: env.MUSE_MODEL || "muse-spark-1.1",
    stt: env.STT_PROVIDER || "fallback",
    tts: env.TTS_PROVIDER || "deepgram",
    deepgramKey: env.DEEPGRAM_API_KEY,
    ttsKey: env.TTS_API_KEY || env.DEEPGRAM_API_KEY,
    sttModel: env.DEEPGRAM_STT_MODEL || "nova-3",
    ttsModel: env.DEEPGRAM_TTS_MODEL || "aura-2-thalia-en",
    publicUrl: env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
    twilioSid: env.TWILIO_ACCOUNT_SID,
    twilioToken: env.TWILIO_AUTH_TOKEN,
    twilioNumber: env.TWILIO_NUMBER,
    seniorIds: (env.SENIOR_IDS || "sen_rose").split(","),
    allowlist: (env.DIAL_ALLOWLIST || "").split(",").filter(Boolean),
    livekitUrl: env.LIVEKIT_URL,
    livekitKey: env.LIVEKIT_API_KEY,
    livekitSecret: env.LIVEKIT_API_SECRET,
    trunkId: env.LIVEKIT_SIP_TRUNK_ID,
    familyTransport: env.FAMILY_CALL_TRANSPORT || "sip",
  };
  if (result.secret.length < 24)
    throw new Error("CC_INTERNAL_SECRET must contain at least 24 characters.");
  if (!mock) {
    if (result.secret.startsWith("replace-with"))
      throw new Error("Replace the example internal secret before live mode.");
    for (const key of [
      "databaseUrl",
      "metaKey",
      "deepgramKey",
      "ttsKey",
      "publicUrl",
      "twilioSid",
      "twilioToken",
      "twilioNumber",
    ] as const)
      if (!result[key]) throw new Error(`Missing live configuration: ${key}`);
    if (result.mockDependencies)
      throw new Error("Live mode cannot use mock dependencies.");
    if (result.stt !== "fallback")
      throw new Error(
        "Muse streaming STT is not verified. Use STT_PROVIDER=fallback (Deepgram).",
      );
    if (result.tts !== "deepgram")
      throw new Error("Supported TTS_PROVIDER: deepgram");
    if (!result.publicUrl?.startsWith("https://"))
      throw new Error("PUBLIC_BASE_URL must use HTTPS.");
    if (!result.allowlist.length)
      throw new Error(
        "DIAL_ALLOWLIST must contain consenting adult test numbers.",
      );
  }
  return result;
}
export type Config = ReturnType<typeof config>;
