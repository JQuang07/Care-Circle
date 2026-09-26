import twilio from "twilio";
import { SipClient } from "livekit-server-sdk";
import type { Config } from "./config.js";
import {
  assert,
  ApiError,
  type Circle,
  type Session,
  type ScheduledCall,
} from "./types.js";
import type { Engine } from "./engine.js";
export class Telephony {
  private tw?: ReturnType<typeof twilio>;
  constructor(
    public c: Config,
    public engine: Engine,
  ) {
    if (!c.mock)
      this.tw = twilio(c.twilioSid, c.twilioToken, {
        autoRetry: false,
        timeout: 10000,
      });
  }
  allowed(phone: string) {
    assert(
      /^\+[1-9]\d{7,14}$/.test(phone) && this.c.allowlist.includes(phone),
      "PHONE_NOT_ALLOWED",
      "Use a stored, consenting adult test number in DIAL_ALLOWLIST.",
      403,
    );
  }
  async verify(parent: Session, holdId: string, memberId: string) {
    const { member } = await this.engine.verificationContext(
      parent.seniorId,
      holdId,
      memberId,
    );
    const existing = [...this.engine.store.sessions.values()].find(
      (s) =>
        s.verification?.parentCallId === parent.callId &&
        s.verification.holdId === holdId &&
        !s.endedAt,
    );
    if (existing) return { callId: existing.callId };
    if (!this.c.mock) {
      assert(
        parent.twilioSid,
        "ACTIVE_CALL_REQUIRED",
        "Senior must be on an active phone call.",
      );
      this.allowed(member.phone);
    }
    const s = await this.engine.create(parent.seniorId, "verification");
    s.verification = { holdId, memberId, parentCallId: parent.callId };
    s.transport = this.c.mock ? "mock" : "twilio-conference";
    await this.engine.store.save(s);
    if (this.tw) {
      // Claim before provider request: uncertain provider outcomes require manual reconciliation, never blind redial.
      if (
        !(await this.engine.store.claim(
          `verification:${parent.callId}:${holdId}`,
          s.callId,
        ))
      )
        throw new ApiError(
          409,
          "ALREADY_DISPATCHED",
          "Verification dispatch already recorded.",
        );
      const response = new twilio.twiml.VoiceResponse();
      response.say(
        `This is Care Circle with your family member. Please talk together about the unexpected request. After you finish, press star to tell Care Circle your decision. Remember to use your private family code word with unexpected callers.`,
      );
      response
        .dial({
          hangupOnStar: true,
          action: `${this.c.publicUrl}/twilio/verification/${s.callId}/decision`,
          method: "POST",
        })
        .conference(
          {
            startConferenceOnEnter: true,
            endConferenceOnExit: false,
            maxParticipants: 2,
          },
          s.callId,
        );
      const call = await this.tw.calls.create({
        to: member.phone,
        from: this.c.twilioNumber!,
        twiml: response.toString(),
        statusCallback: `${this.c.publicUrl}/twilio/status`,
        statusCallbackEvent: ["completed"],
        timeout: 25,
      });
      s.twilioSid = call.sid;
      await this.engine.store.save(s);
      const senior = new twilio.twiml.VoiceResponse();
      senior.say("I’m connecting you with your family now.");
      senior.dial({ timeLimit: 600 }).conference(
        {
          startConferenceOnEnter: false,
          endConferenceOnExit: true,
          maxParticipants: 2,
        },
        s.callId,
      );
      try {
        await this.tw
          .calls(parent.twilioSid!)
          .update({ twiml: senior.toString() });
      } catch (e) {
        await this.tw
          .calls(call.sid)
          .update({ status: "completed" })
          .catch(() => {});
        throw e;
      }
    }
    return { callId: s.callId };
  }
  async finishVerification(s: Session, message: string) {
    const parent = this.engine.store.sessions.get(s.verification!.parentCallId);
    if (this.tw && parent?.twilioSid) {
      const response = new twilio.twiml.VoiceResponse();
      response.say(
        message +
          " Remember to ask unexpected callers for your family’s private code word.",
      );
      response.hangup();
      await this.tw
        .calls(parent.twilioSid)
        .update({ twiml: response.toString() });
    }
  }
  async outbound(body: {
    seniorId: string;
    purpose: "scheduled_family_call" | "reminder";
    scheduledCallId?: string;
    roomName?: string;
  }) {
    const circle = await this.engine.deps.call<Circle>(
      "family",
      "GET",
      `/circle/${body.seniorId}`,
    );
    assert(
      circle.senior.id === body.seniorId,
      "WRONG_SENIOR",
      "Circle senior does not match.",
    );
    if (!this.c.mock) this.allowed(circle.senior.phone);
    let scheduled: ScheduledCall | undefined;
    if (body.scheduledCallId) {
      const upcoming = await this.engine.deps.call<ScheduledCall[]>(
        "family",
        "GET",
        `/schedule/${body.seniorId}/upcoming`,
      );
      scheduled = upcoming.find((c) => c.id === body.scheduledCallId);
      if (!this.c.mock)
        assert(
          scheduled && scheduled.seniorId === body.seniorId,
          "SCHEDULE_NOT_FOUND",
          "Scheduled call must be owned by this senior.",
        );
    }
    if (body.purpose === "scheduled_family_call") {
      assert(
        body.scheduledCallId && body.roomName,
        "ROOM_REQUIRED",
        "Scheduled family calls require scheduledCallId and roomName.",
        400,
      );
      if (scheduled)
        assert(
          scheduled.roomName === body.roomName,
          "ROOM_MISMATCH",
          "Use the room assigned by family.",
        );
      if (
        this.c.familyTransport === "tablet" ||
        scheduled?.seniorJoin === "tablet"
      )
        throw new ApiError(
          409,
          "TABLET_REQUIRED",
          "Use Agent 4’s senior tablet page for this scheduled call.",
        );
      if (!this.c.mock)
        assert(
          this.c.livekitUrl &&
            this.c.livekitKey &&
            this.c.livekitSecret &&
            this.c.trunkId,
          "SIP_NOT_CONFIGURED",
          "Configure LiveKit SIP or switch to tablet.",
          503,
        );
    }
    const key = body.scheduledCallId
      ? `${body.purpose}:${body.scheduledCallId}`
      : undefined;
    const previous = key && this.engine.store.claims.get(key);
    if (previous) {
      assert(
        this.engine.store.sessions.get(previous)?.dispatchStatus === "started",
        "DISPATCH_UNCERTAIN",
        "A dispatch was already attempted. Check the provider before trying again.",
      );
      return { callId: previous };
    }
    const s = await this.engine.create(body.seniorId, "scheduled_family_call");
    s.scheduledCallId = body.scheduledCallId;
    s.purpose = body.purpose;
    s.dispatchStatus = "dispatching";
    s.transport = this.c.mock
      ? "mock"
      : body.purpose === "reminder"
        ? "twilio-reminder"
        : "livekit-sip";
    await this.engine.store.save(s);
    if (key && !(await this.engine.store.claim(key, s.callId)))
      return { callId: this.engine.store.claims.get(key)! };
    try {
      if (!this.c.mock && body.purpose === "scheduled_family_call") {
        const sip = new SipClient(
          this.c.livekitUrl!.replace(/^ws/, "http"),
          this.c.livekitKey,
          this.c.livekitSecret,
        );
        await sip.createSipParticipant(
          this.c.trunkId!,
          circle.senior.phone,
          body.roomName!,
          {
            participantIdentity: s.callId,
            participantName: circle.senior.name,
            waitUntilAnswered: true,
          },
        );
        const { announce } = await import("./room-intro.js");
        await announce(
          this.c,
          body.roomName!,
          `${circle.senior.name}, your family is here. I’ll leave you to enjoy your time together.`,
        );
        // Agent has left; family service owns actual room/call completion.
      } else if (this.tw) {
        const response = new twilio.twiml.VoiceResponse();
        response.say(
          "Hello. This is Care Circle. Your family call is coming up soon. We’ll ring your phone when it’s time.",
        );
        response.hangup();
        const call = await this.tw.calls.create({
          to: circle.senior.phone,
          from: this.c.twilioNumber!,
          twiml: response.toString(),
          statusCallback: `${this.c.publicUrl}/twilio/status`,
          statusCallbackEvent: ["completed"],
          timeout: 25,
        });
        s.twilioSid = call.sid;
        await this.engine.store.save(s);
      }
      s.dispatchStatus = "started";
      await this.engine.store.save(s);
      return { callId: s.callId };
    } catch (e) {
      s.dispatchStatus = "failed";
      await this.engine.store.save(s);
      throw e;
    }
  }
}
