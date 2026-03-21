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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

type WalletRow = {
  id: string;
  user_id: string;
  chain: string;
  address: string;
  label: string | null;
  is_primary: boolean;
  is_active: boolean;
  metadata: unknown;
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
    const value = (userId ?? '00000000-0000-0000-0000-000000000001').trim();

    if (!value) {
      throw new BadRequestException('userId is required');
    }

    if (!isUuid(value)) {
      throw new BadRequestException(
        'userId must be a valid UUID, for example 00000000-0000-0000-0000-000000000001'
      );
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

  async createWallet(params: {
    userId?: string;
    chain?: string;
    address?: string;
    label?: string | null;
  }) {
    const userId = this.normalizeUserId(params.userId);
    const chain = this.normalizeChain(params.chain);
    const address = this.normalizeAddress(params.address);
    const label = this.normalizeLabel(params.label);

    const existing = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      select
        id,
        user_id,
        chain,
        address,
        label,
        is_primary,
        is_active,
        metadata,
        created_at,
        updated_at
      from user_wallets
      where user_id = $1::uuid
        and lower(chain) = lower($2)
        and lower(address) = lower($3)
      limit 1
      `,
      userId,
      chain,
      address
    );

    if (existing[0]) {
      const updated = await this.prisma.$queryRawUnsafe<WalletRow[]>(
        `
        update user_wallets
        set
          label = coalesce($2, label),
          is_active = true,
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          user_id,
          chain,
          address,
          label,
          is_primary,
          is_active,
          metadata,
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
          userId: updated[0].user_id,
          chain: updated[0].chain,
          address: updated[0].address,
          label: updated[0].label,
          isPrimary: updated[0].is_primary,
          isActive: updated[0].is_active,
          metadata: updated[0].metadata,
          createdAt: updated[0].created_at,
          updatedAt: updated[0].updated_at,
        },
      };
    }

    const primaryRows = await this.prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
      `
      select count(*) as count
      from user_wallets
      where user_id = $1::uuid
      `,
      userId
    );

    const isPrimary = (toNumber(primaryRows[0]?.count) ?? 0) === 0;

    const inserted = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      insert into user_wallets (
        user_id,
        chain,
        address,
        label,
        is_primary,
        is_active,
        metadata
      )
      values ($1::uuid, $2, $3, $4, $5, true, '{}'::jsonb)
      returning
        id,
        user_id,
        chain,
        address,
        label,
        is_primary,
        is_active,
        metadata,
        created_at,
        updated_at
      `,
      userId,
      chain,
      address,
      label,
      isPrimary
    );

    return {
      created: true,
      wallet: {
        id: inserted[0].id,
        userId: inserted[0].user_id,
        chain: inserted[0].chain,
        address: inserted[0].address,
        label: inserted[0].label,
        isPrimary: inserted[0].is_primary,
        isActive: inserted[0].is_active,
        metadata: inserted[0].metadata,
        createdAt: inserted[0].created_at,
        updatedAt: inserted[0].updated_at,
      },
    };
  }

  async getWallets(userId?: string) {
    const normalizedUserId = this.normalizeUserId(userId);

    const rows = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      select
        id,
        user_id,
        chain,
        address,
        label,
        is_primary,
        is_active,
        metadata,
        created_at,
        updated_at
      from user_wallets
      where user_id = $1::uuid
      order by is_primary desc, created_at desc, address asc
      `,
      normalizedUserId
    );

    return {
      userId: normalizedUserId,
      count: rows.length,
      wallets: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        chain: row.chain,
        address: row.address,
        label: row.label,
        isPrimary: row.is_primary,
        isActive: row.is_active,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  async getWalletsOverview(userId?: string) {
    const normalizedUserId = this.normalizeUserId(userId);

    const overviewRows = await this.prisma.$queryRawUnsafe<WalletOverviewRow[]>(
      `
      select
        count(*) as total_wallets,
        count(*) filter (where is_active = true) as active_wallets
      from user_wallets
      where user_id = $1::uuid
      `,
      normalizedUserId
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
      from user_wallets
      where user_id = $1::uuid
      group by chain
      order by chain asc
      `,
      normalizedUserId
    );

    const walletRows = await this.prisma.$queryRawUnsafe<WalletRow[]>(
      `
      select
        id,
        user_id,
        chain,
        address,
        label,
        is_primary,
        is_active,
        metadata,
        created_at,
        updated_at
      from user_wallets
      where user_id = $1::uuid
      order by is_primary desc, created_at desc, address asc
      `,
      normalizedUserId
    );

    const portfolioRows = await this.prisma.$queryRawUnsafe<
      Array<{ total_portfolio_usd: unknown; total_tracked_positions: unknown }>
    >(
      `
      select
        coalesce(sum(latest_balances.balance_usd), 0) as total_portfolio_usd,
        coalesce(count(latest_positions.id), 0) as total_tracked_positions
      from user_wallets uw
      left join lateral (
        select distinct on (
          wbs.user_wallet_id,
          coalesce(wbs.asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(wbs.asset_contract_id, '')
        )
          wbs.balance_usd
        from wallet_balance_snapshots wbs
        where wbs.user_wallet_id = uw.id
        order by
          wbs.user_wallet_id,
          coalesce(wbs.asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(wbs.asset_contract_id, ''),
          wbs.snapshot_at desc,
          wbs.created_at desc
      ) latest_balances on true
      left join lateral (
        select distinct on (
          wpp.user_wallet_id,
          coalesce(wpp.venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(wpp.entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
          wpp.position_type,
          coalesce(wpp.asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(wpp.asset_contract_id, '')
        )
          wpp.id
        from wallet_protocol_positions wpp
        where wpp.user_wallet_id = uw.id
        order by
          wpp.user_wallet_id,
          coalesce(wpp.venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(wpp.entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
          wpp.position_type,
          coalesce(wpp.asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(wpp.asset_contract_id, ''),
          wpp.snapshot_at desc,
          wpp.created_at desc
      ) latest_positions on true
      where uw.user_id = $1::uuid
      `,
      normalizedUserId
    );

    const portfolio = portfolioRows[0] ?? {
      total_portfolio_usd: 0,
      total_tracked_positions: 0,
    };

    return {
      userId: normalizedUserId,
      summary: {
        totalWallets: toNumber(overview.total_wallets) ?? 0,
        activeWallets: toNumber(overview.active_wallets) ?? 0,
        totalTrackedPositions: toNumber(portfolio.total_tracked_positions) ?? 0,
        totalPortfolioUsd: toNumber(portfolio.total_portfolio_usd) ?? 0,
      },
      byChain: chainRows.map((row) => ({
        chain: row.chain,
        totalWallets: toNumber(row.total) ?? 0,
        activeWallets: toNumber(row.active) ?? 0,
      })),
      wallets: walletRows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        chain: row.chain,
        address: row.address,
        label: row.label,
        isPrimary: row.is_primary,
        isActive: row.is_active,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }
}