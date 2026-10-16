// src/api/campaign.ts
//
// Lot EP (EP1): the ownership-proof + campaign endpoints. POINTS ONLY — the
// API's disclaimer travels in every campaign payload; the web renders it and
// never computes points, streaks or multipliers (recon §6).
import { apiFetch } from "./client";

export interface AuthChallenge {
  address: string;
  nonce: string;
  /** Plain text the wallet signs; it states that this is NOT a transaction. */
  message: string;
  expiresAt: string;
}

export type AuthVerifyResult =
  | {
      ok: true;
      address: string;
      userId: string | null;
      verifiedAt: string;
      signatureVariant: "raw" | "sha256";
    }
  | { ok: false; reason: "challenge-invalid-or-expired" | "signature-invalid" };

export function requestAuthChallenge(address: string): Promise<AuthChallenge> {
  return apiFetch<AuthChallenge>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function verifyAuthChallenge(payload: {
  address: string;
  nonce: string;
  signedMessage: string;
  provider?: string | null;
  userId?: string | null;
}): Promise<AuthVerifyResult> {
  return apiFetch<AuthVerifyResult>("/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      address: payload.address,
      nonce: payload.nonce,
      signedMessage: payload.signedMessage,
      ...(payload.provider ? { provider: payload.provider } : {}),
      ...(payload.userId ? { userId: payload.userId } : {}),
    }),
  });
}
