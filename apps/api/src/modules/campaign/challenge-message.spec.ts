// Lot EP (EP1): the challenge text is pinned byte for byte (Gate 2 wording).
import { buildChallengeMessage, CHALLENGE_MESSAGE_TEMPLATE } from './challenge-message';

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ';
const NONCE = '0123456789abcdef0123456789abcdef';
const ISSUED = '2026-10-16T09:00:00.000Z';

describe('buildChallengeMessage', () => {
  it('renders exactly the founder-approved text', () => {
    expect(buildChallengeMessage({ address: ADDRESS, nonce: NONCE, issuedAtIso: ISSUED })).toBe(
      'Dig Stellar wants to verify that you own this wallet.\n\n' +
        'This is NOT a transaction. Signing moves no funds and costs nothing.\n\n' +
        `Wallet: ${ADDRESS}\nNonce: ${NONCE}\nIssued: ${ISSUED}\nSite: Dig Stellar`,
    );
  });

  it('keeps the template itself unchanged', () => {
    expect(CHALLENGE_MESSAGE_TEMPLATE).toBe(
      'Dig Stellar wants to verify that you own this wallet.\n\n' +
        'This is NOT a transaction. Signing moves no funds and costs nothing.\n\n' +
        'Wallet: <address>\nNonce: <nonce>\nIssued: <issuedAt>\nSite: <site>',
    );
  });

  it('binds every replay dimension: wallet, nonce, issue time, site', () => {
    const m = buildChallengeMessage({ address: ADDRESS, nonce: NONCE, issuedAtIso: ISSUED });
    expect(m).toContain(`Wallet: ${ADDRESS}`);
    expect(m).toContain(`Nonce: ${NONCE}`);
    expect(m).toContain(`Issued: ${ISSUED}`);
    expect(m).toContain('Site: Dig Stellar');
    expect(m).toContain('This is NOT a transaction');
    expect(m).not.toContain('<');
  });

  it('never mentions a token, airdrop or reward', () => {
    const m = buildChallengeMessage({ address: ADDRESS, nonce: NONCE, issuedAtIso: ISSUED }).toLowerCase();
    for (const word of ['token', 'airdrop', 'reward', 'xlm']) expect(m).not.toContain(word);
  });
});
