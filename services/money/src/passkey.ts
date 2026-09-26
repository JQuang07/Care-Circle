/**
 * Passkey check for releasing high-risk holds.
 *
 * SIMULATED (as CLAUDE.md allows in Stripe fallback mode): the rule is enforced for real,
 * only the cryptography is stubbed. A valid assertion must name the credential registered to
 * the releasing member and be bound to this specific hold. Swap in @simplewebauthn/server
 * once the web app does real registration (needs a challenge endpoint: contract change).
 */
export interface PasskeyAssertion { credentialId: string; holdId: string; signature: string }

export interface PasskeyVerifier { verify(assertion: unknown, memberId: string, holdId: string): Promise<boolean> }

export const SIMULATED_CREDENTIALS: Record<string, string> = {
  mem_lisa: 'cred_mem_lisa',
  mem_danny: 'cred_mem_danny',
  mem_mark: 'cred_mem_mark',
};

export const simulatedPasskey: PasskeyVerifier = {
  async verify(assertion, memberId, holdId) {
    if (!assertion || typeof assertion !== 'object') return false;
    const a = assertion as Partial<PasskeyAssertion>;
    return typeof a.signature === 'string' && a.signature.length > 0 &&
      a.holdId === holdId &&
      !!SIMULATED_CREDENTIALS[memberId] && a.credentialId === SIMULATED_CREDENTIALS[memberId];
  },
};
