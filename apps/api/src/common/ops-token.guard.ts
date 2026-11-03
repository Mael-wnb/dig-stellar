// apps/api/src/common/ops-token.guard.ts
//
// Lot PRE (D): operator gate for read-only INTERNAL metrics (first use:
// GET /v1/campaign/metrics). The token is a random string set in the VPS env
// (`OPS_METRICS_TOKEN`, generated with `openssl rand -hex 32`, never in the
// repo); it is not a key and cannot sign anything (security-invariants.md §7
// amendment, §9 untouched). Rules:
//   • env var unset  → 404 (the route is dark by default, like FAUCET_ENABLED);
//   • header missing / malformed / wrong → 404, never 403 (the route stays
//     invisible, the same "no existence oracle" discipline as the user-scoped
//     routes);
//   • comparison is constant-time (crypto.timingSafeEqual on equal-length
//     buffers; a length mismatch is rejected before comparing);
//   • nothing is ever logged here — neither the header nor the token.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export const OPS_TOKEN_ENV = 'OPS_METRICS_TOKEN';

/** Pure check: `Authorization: Bearer <token>` against the configured token. */
export function opsTokenMatches(
  authorization: string | string[] | undefined,
  configured: string | undefined,
): boolean {
  const expected = configured?.trim() ?? '';
  if (expected.length === 0) return false;
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return false;
  const presented = Buffer.from(match[1], 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (presented.length !== wanted.length) return false;
  return timingSafeEqual(presented, wanted);
}

@Injectable()
export class OpsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    if (
      !opsTokenMatches(req.headers?.authorization, process.env[OPS_TOKEN_ENV])
    ) {
      throw new NotFoundException();
    }
    return true;
  }
}
