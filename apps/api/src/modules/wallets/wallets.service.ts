import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
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

type WalletBalanceRow = {
  id: string;
  user_wallet_id: string;
  asset_id: string | null;
  asset_contract_id: string | null;
  asset_symbol: string | null;
  balance_raw: unknown;
  balance_scaled: unknown;
  price_usd: unknown;
  balance_usd: unknown;
  snapshot_at: unknown;
  metadata: unknown;
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

  private normalizeWalletId(walletId?: string): string {
    const value = (walletId ?? '').trim();

    if (!value) {
      throw new BadRequestException('walletId is required');
    }

    if (!isUuid(value)) {
      throw new BadRequestException('walletId must be a valid UUID');
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

  private mapWallet(row: WalletRow) {
    return {
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
    };
  }

  private async getWalletOrThrow(walletId: string, userId: string): Promise<WalletRow> {
    const rows = (await this.prisma.$queryRawUnsafe(
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
      where id = $1::uuid
        and user_id = $2::uuid
      limit 1
      `,
      walletId,
      userId
    )) as WalletRow[];

    const wallet = rows[0];
    if (!wallet) {
      throw new NotFoundException(`Wallet not found: ${walletId}`);
    }

    return wallet;
  }

  private resolveIndexerDir(): string {
    const candidates = [
      process.env.INDEXER_DIR,
      path.resolve(process.cwd(), '../indexer'),
      path.resolve(process.cwd(), '../../apps/indexer'),
      path.resolve(__dirname, '../../../../indexer'),
      path.resolve(__dirname, '../../../../../apps/indexer'),
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const normalized = path.resolve(candidate);
      if (existsSync(normalized)) {
        return normalized;
      }
    }

    throw new InternalServerErrorException(
      'Could not resolve indexer directory. Set INDEXER_DIR if needed.'
    );
  }

  private runWalletBalanceRefreshScript(walletId: string): Promise<void> {
    const indexerDir = this.resolveIndexerDir();

    return new Promise((resolve, reject) => {
      const child = spawn(
        'pnpm',
        ['tsx', 'src/scripts/wallets/80-stellar-wallet-balance-snapshots.ts'],
        {
          cwd: indexerDir,
          env: {
            ...process.env,
            WALLET_ID: walletId,
          },
          stdio: 'pipe',
        }
      );

      let stderr = '';
      let stdout = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            [
              `Wallet refresh script failed with exit code ${code}.`,
              stdout ? `stdout:\n${stdout}` : '',
              stderr ? `stderr:\n${stderr}` : '',
            ]
              .filter(Boolean)
              .join('\n\n')
          )
        );
      });
    });
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

    const existing = (await this.prisma.$queryRawUnsafe(
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
    )) as WalletRow[];

    if (existing[0]) {
      const updated = (await this.prisma.$queryRawUnsafe(
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
      )) as WalletRow[];

      return {
        created: false,
        wallet: this.mapWallet(updated[0]),
      };
    }

    const primaryRows = (await this.prisma.$queryRawUnsafe(
      `
      select count(*) as count
      from user_wallets
      where user_id = $1::uuid
      `,
      userId
    )) as Array<{ count: unknown }>;

    const isPrimary = (toNumber(primaryRows[0]?.count) ?? 0) === 0;

    const inserted = (await this.prisma.$queryRawUnsafe(
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
    )) as WalletRow[];

    return {
      created: true,
      wallet: this.mapWallet(inserted[0]),
    };
  }

  async getWallets(userId?: string) {
    const normalizedUserId = this.normalizeUserId(userId);

    const rows = (await this.prisma.$queryRawUnsafe(
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
    )) as WalletRow[];

    return {
      userId: normalizedUserId,
      count: rows.length,
      wallets: rows.map((row) => this.mapWallet(row)),
    };
  }

  async getWalletsOverview(userId?: string) {
    const normalizedUserId = this.normalizeUserId(userId);

    const overviewRows = (await this.prisma.$queryRawUnsafe(
      `
      select
        count(*) as total_wallets,
        count(*) filter (where is_active = true) as active_wallets
      from user_wallets
      where user_id = $1::uuid
      `,
      normalizedUserId
    )) as WalletOverviewRow[];

    const overview = overviewRows[0] ?? {
      total_wallets: 0,
      active_wallets: 0,
    };

    const chainRows = (await this.prisma.$queryRawUnsafe(
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
    )) as Array<{ chain: string; total: unknown; active: unknown }>;

    const walletRows = (await this.prisma.$queryRawUnsafe(
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
    )) as WalletRow[];

    const portfolioRows = (await this.prisma.$queryRawUnsafe(
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
    )) as Array<{ total_portfolio_usd: unknown; total_tracked_positions: unknown }>;

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
      wallets: walletRows.map((row) => this.mapWallet(row)),
    };
  }

  async getWalletBalances(params: { userId?: string; walletId?: string }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    const wallet = await this.getWalletOrThrow(walletId, userId);

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select distinct on (
        wbs.user_wallet_id,
        coalesce(wbs.asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(wbs.asset_contract_id, '')
      )
        wbs.id,
        wbs.user_wallet_id,
        wbs.asset_id,
        wbs.asset_contract_id,
        wbs.asset_symbol,
        wbs.balance_raw,
        wbs.balance_scaled,
        wbs.price_usd,
        wbs.balance_usd,
        wbs.snapshot_at,
        wbs.metadata
      from wallet_balance_snapshots wbs
      where wbs.user_wallet_id = $1::uuid
      order by
        wbs.user_wallet_id,
        coalesce(wbs.asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(wbs.asset_contract_id, ''),
        wbs.snapshot_at desc,
        wbs.created_at desc
      `,
      walletId
    )) as WalletBalanceRow[];

    const balances = rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      assetContractId: row.asset_contract_id,
      symbol: row.asset_symbol,
      balanceRaw: row.balance_raw,
      balance: toNumber(row.balance_scaled),
      priceUsd: toNumber(row.price_usd),
      balanceUsd: toNumber(row.balance_usd),
      snapshotAt: row.snapshot_at,
      metadata: row.metadata,
    }));

    const totalPortfolioUsd = balances.reduce((sum, row) => sum + (row.balanceUsd ?? 0), 0);

    return {
      wallet: this.mapWallet(wallet),
      count: balances.length,
      totalPortfolioUsd,
      balances,
    };
  }

  async refreshWallet(params: { userId?: string; walletId?: string }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    const wallet = await this.getWalletOrThrow(walletId, userId);

    try {
      await this.runWalletBalanceRefreshScript(walletId);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Wallet refresh failed'
      );
    }

    const refreshedBalances = await this.getWalletBalances({
      userId,
      walletId,
    });

    return {
      refreshed: true,
      wallet: this.mapWallet(wallet),
      count: refreshedBalances.count,
      totalPortfolioUsd: refreshedBalances.totalPortfolioUsd,
      balances: refreshedBalances.balances,
    };
  }

  async setPrimaryWallet(params: { userId?: string; walletId?: string }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    await this.getWalletOrThrow(walletId, userId);

    await this.prisma.$executeRawUnsafe(
      `
      update user_wallets
      set
        is_primary = false,
        updated_at = now()
      where user_id = $1::uuid
        and is_primary = true
      `,
      userId
    );

    const updated = (await this.prisma.$queryRawUnsafe(
      `
      update user_wallets
      set
        is_primary = true,
        is_active = true,
        updated_at = now()
      where id = $1::uuid
        and user_id = $2::uuid
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
      walletId,
      userId
    )) as WalletRow[];

    return {
      updated: true,
      wallet: this.mapWallet(updated[0]),
    };
  }

  async setWalletActive(params: {
    userId?: string;
    walletId?: string;
    isActive?: boolean;
  }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    if (typeof params.isActive !== 'boolean') {
      throw new BadRequestException('isActive must be provided as a boolean');
    }

    const current = await this.getWalletOrThrow(walletId, userId);

    if (!params.isActive && current.is_primary) {
      const otherActiveRows = (await this.prisma.$queryRawUnsafe(
        `
        select id
        from user_wallets
        where user_id = $1::uuid
          and id <> $2::uuid
          and is_active = true
        order by created_at asc
        limit 1
        `,
        userId,
        walletId
      )) as Array<{ id: string }>;

      if (!otherActiveRows[0]) {
        throw new BadRequestException('Cannot deactivate the only active primary wallet');
      }

      await this.prisma.$executeRawUnsafe(
        `
        update user_wallets
        set
          is_primary = true,
          updated_at = now()
        where id = $1::uuid
        `,
        otherActiveRows[0].id
      );
    }

    const updated = (await this.prisma.$queryRawUnsafe(
      `
      update user_wallets
      set
        is_active = $3,
        is_primary = case
          when $3 = false then false
          else is_primary
        end,
        updated_at = now()
      where id = $1::uuid
        and user_id = $2::uuid
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
      walletId,
      userId,
      params.isActive
    )) as WalletRow[];

    return {
      updated: true,
      wallet: this.mapWallet(updated[0]),
    };
  }

  async deleteWallet(params: { userId?: string; walletId?: string }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    const current = await this.getWalletOrThrow(walletId, userId);

    if (current.is_primary) {
      const otherActiveRows = (await this.prisma.$queryRawUnsafe(
        `
        select id
        from user_wallets
        where user_id = $1::uuid
          and id <> $2::uuid
          and is_active = true
        order by created_at asc
        limit 1
        `,
        userId,
        walletId
      )) as Array<{ id: string }>;

      if (!otherActiveRows[0]) {
        throw new BadRequestException('Cannot delete the only active primary wallet');
      }

      await this.prisma.$executeRawUnsafe(
        `
        update user_wallets
        set
          is_primary = true,
          updated_at = now()
        where id = $1::uuid
        `,
        otherActiveRows[0].id
      );
    }

    await this.prisma.$executeRawUnsafe(
      `
      delete from user_wallets
      where id = $1::uuid
        and user_id = $2::uuid
      `,
      walletId,
      userId
    );

    return {
      deleted: true,
      walletId,
      userId,
      address: current.address,
    };
  }
}