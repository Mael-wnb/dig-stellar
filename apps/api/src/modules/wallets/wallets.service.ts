// apps/api/src/modules/wallets/wallets.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);

  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  if (typeof value === 'object' && value !== null) {
    if ('toString' in value && typeof (value as { toString: unknown }).toString === 'function') {
      const n = Number((value as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : null;
    }
  }

  return null;
}

type WalletUserRow = {
  id: string;
  external_user_id: string;
};

type WalletRow = {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  is_active: boolean;
  created_at: unknown;
  updated_at: unknown;
};

type WalletOverviewRow = {
  total_wallets: unknown;
  active_wallets: unknown;
};

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeUserId(userId?: string): string {
    const value = (userId ?? 'local-dev-user').trim();
    if (!value) {
      throw new BadRequestException('userId is required');
    }
    return value;
  }

  private normalizeChain(chain?: string): string {
    const value = (chain ?? 'stellar').trim().toLowerCase();

    const allowedChains = new Set(['stellar']);
    if (!allowedChains.has(value)) {
      throw new BadRequestException(`Unsupported chain: ${chain}`);
    }

    return value;
  }

  private normalizeAddress(address?: string): string {
    const value = (address ?? '').trim();

    if (!value) {
      throw new BadRequestException('address is required');
    }

    if (value.length < 10) {
      throw new BadRequestException('address looks invalid');
    }

    return value;
  }

  private normalizeLabel(label?: string | null): string | null {
    if (label === undefined || label === null) return null;

    const value = label.trim();
    return value.length ? value : null;
  }

  private async ensureWalletUser(externalUserId: string): Promise<WalletUserRow> {
    const existing = await this.prisma.$queryRawUnsafe<WalletUserRow[]>(
      `
      select
        id,
        external_user_id
      from wallet_users
      where external_user_id = $1
      limit 1
      `,
      externalUserId
    );

    if (existing[0]) {
      return existing[0];
    }

    const inserted = await this.prisma.$queryRawUnsafe<WalletUserRow[]>(
      `
      insert into wallet_users (external_user_id)
      values ($1)
      returning id, external_user_id
      `,
      externalUserId
    );

    return inserted[0];
  }

  async createWallet(params: {
    userId?: string;
    chain?: string;
    address?: string;
    label?: string | null;
  }) {
    const externalUserId = this.normalizeUserId(params.userId);
    const chain = this.normalizeChain(params.chain);
    const address = this.normalizeAddress(params.address);
    const label = this.normalizeLabel(params.label);

    const user = await this.ensureWalletUser(externalUserId);

    const existing = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      select
        id,
        chain,
        address,
        label,
        is_active,
        created_at,
        updated_at
      from tracked_wallets
      where user_id = $1::uuid
        and lower(chain) = lower($2)
        and lower(address) = lower($3)
      limit 1
      `,
      user.id,
      chain,
      address
    );

    if (existing[0]) {
      const updated = await this.prisma.$queryRawUnsafe<WalletRow[]>(
        `
        update tracked_wallets
        set
          label = coalesce($2, label),
          is_active = true,
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          chain,
          address,
          label,
          is_active,
          created_at,
          updated_at
        `,
        existing[0].id,
        label
      );

      return {
        created: false,
        wallet: {
          id: updated[0].id,
          chain: updated[0].chain,
          address: updated[0].address,
          label: updated[0].label,
          isActive: updated[0].is_active,
          createdAt: updated[0].created_at,
          updatedAt: updated[0].updated_at,
        },
      };
    }

    const inserted = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      insert into tracked_wallets (
        user_id,
        chain,
        address,
        label,
        is_active
      )
      values ($1::uuid, $2, $3, $4, true)
      returning
        id,
        chain,
        address,
        label,
        is_active,
        created_at,
        updated_at
      `,
      user.id,
      chain,
      address,
      label
    );

    return {
      created: true,
      wallet: {
        id: inserted[0].id,
        chain: inserted[0].chain,
        address: inserted[0].address,
        label: inserted[0].label,
        isActive: inserted[0].is_active,
        createdAt: inserted[0].created_at,
        updatedAt: inserted[0].updated_at,
      },
    };
  }

  async getWallets(userId?: string) {
    const externalUserId = this.normalizeUserId(userId);
    const user = await this.ensureWalletUser(externalUserId);

    const rows = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      select
        id,
        chain,
        address,
        label,
        is_active,
        created_at,
        updated_at
      from tracked_wallets
      where user_id = $1::uuid
      order by created_at desc, address asc
      `,
      user.id
    );

    return {
      userId: externalUserId,
      count: rows.length,
      wallets: rows.map((row) => ({
        id: row.id,
        chain: row.chain,
        address: row.address,
        label: row.label,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  async getWalletsOverview(userId?: string) {
    const externalUserId = this.normalizeUserId(userId);
    const user = await this.ensureWalletUser(externalUserId);

    const overviewRows = await this.prisma.$queryRawUnsafe<WalletOverviewRow[]>(
      `
      select
        count(*) as total_wallets,
        count(*) filter (where is_active = true) as active_wallets
      from tracked_wallets
      where user_id = $1::uuid
      `,
      user.id
    );

    const overview = overviewRows[0] ?? {
      total_wallets: 0,
      active_wallets: 0,
    };

    const chainRows = await this.prisma.$queryRawUnsafe<
      Array<{ chain: string; total: unknown; active: unknown }>
    >(
      `
      select
        chain,
        count(*) as total,
        count(*) filter (where is_active = true) as active
      from tracked_wallets
      where user_id = $1::uuid
      group by chain
      order by chain asc
      `,
      user.id
    );

    const walletRows = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      select
        id,
        chain,
        address,
        label,
        is_active,
        created_at,
        updated_at
      from tracked_wallets
      where user_id = $1::uuid
      order by created_at desc, address asc
      `,
      user.id
    );

    return {
      userId: externalUserId,
      summary: {
        totalWallets: toNumber(overview.total_wallets) ?? 0,
        activeWallets: toNumber(overview.active_wallets) ?? 0,
        totalTrackedPositions: 0,
        totalPortfolioUsd: 0,
      },
      byChain: chainRows.map((row) => ({
        chain: row.chain,
        totalWallets: toNumber(row.total) ?? 0,
        activeWallets: toNumber(row.active) ?? 0,
      })),
      wallets: walletRows.map((row) => ({
        id: row.id,
        chain: row.chain,
        address: row.address,
        label: row.label,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }
}