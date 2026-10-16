// apps/api/src/modules/campaign/challenge-message.ts
//
// Lot EP (EP1): the ownership-proof challenge text. PURE. The exact wording is
// a product + security decision (founder, Gate 2): it says in plain words that
// signing is NOT a transaction, and it embeds the wallet, the nonce, the issue
// time and the site name so a signature can never be replayed for another
// wallet, another challenge or another site. The server stores the rendered
// text and rebuilds verification from the STORED row, never from the client.
// challenge-message.spec.ts pins the template byte for byte.

export const CHALLENGE_SITE_NAME = 'Dig Stellar';

export const CHALLENGE_MESSAGE_TEMPLATE =
  'Dig Stellar wants to verify that you own this wallet.\n\n' +
  'This is NOT a transaction. Signing moves no funds and costs nothing.\n\n' +
  'Wallet: <address>\nNonce: <nonce>\nIssued: <issuedAt>\nSite: <site>';

export interface ChallengeMessageInput {
  address: string;
  nonce: string;
  /** ISO 8601 UTC, e.g. 2026-10-16T09:00:00.000Z */
  issuedAtIso: string;
}

export function buildChallengeMessage(input: ChallengeMessageInput): string {
  return CHALLENGE_MESSAGE_TEMPLATE.replace('<address>', input.address)
    .replace('<nonce>', input.nonce)
    .replace('<issuedAt>', input.issuedAtIso)
    .replace('<site>', CHALLENGE_SITE_NAME);
}
