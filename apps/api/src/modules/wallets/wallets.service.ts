import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  is_active_signer: boolean;
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

// T2-D1 Gap B part 2 — DeFi position read rows (Blend). Both source tables are
// snapshot-based, so every query below filters to the wallet's LATEST snapshot
// (see getWalletPositions / the defi block) — a naive "latest row per asset"
// would resurrect closed (repaid/exited) positions that are no longer written.
type PoolHealthRow = {
  entity_id: string | null;
  venue_id: string | null;
  health_factor: unknown;
  total_collateral_usd: unknown;
  total_debt_usd: unknown;
  borrow_limit_usd: unknown;
  net_apy: unknown;
  positions_count: unknown;
  snapshot_at: unknown;
  pool_slug: string | null;
  pool_name: string | null;
  venue_slug: string | null;
};

type ProtocolPositionRow = {
  entity_id: string | null;
  venue_id: string | null;
  position_type: string;
  asset_symbol: string | null;
  amount_scaled: unknown;
  amount_usd: unknown;
  metadata: unknown;
  snapshot_at: unknown;
};

type DefiHealthRow = {
  user_wallet_id: string;
  address: string;
  label: string | null;
  pool_slug: string | null;
  pool_name: string | null;
  health_factor: unknown;
  total_collateral_usd: unknown;
  total_debt_usd: unknown;
};

// Health factor ascending, NULLs (no-debt, not at risk) last — riskiest first.
function compareHealthFactorAscNullsLast(
  a: number | null,
  b: number | null
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

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
      isActiveSigner: row.is_active_signer,
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
        is_active_signer,
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

  private async getWalletByAddress(params: {
    chain: string;
    address: string;
  }): Promise<WalletRow | null> {
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
        is_active_signer,
        metadata,
        created_at,
        updated_at
      from user_wallets
      where lower(chain) = lower($1)
        and lower(address) = lower($2)
      limit 1
      `,
      params.chain,
      params.address
    )) as WalletRow[];

    return rows[0] ?? null;
  }

  private async createWalletForUser(params: {
    userId: string;
    chain: string;
    address: string;
    label?: string | null;
  }) {
    const label = this.normalizeLabel(params.label);

    const primaryRows = (await this.prisma.$queryRawUnsafe(
      `
      select count(*) as count
      from user_wallets
      where user_id = $1::uuid
      `,
      params.userId
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
        is_active_signer,
        metadata,
        created_at,
        updated_at
      `,
      params.userId,
      params.chain,
      params.address,
      label,
      isPrimary
    )) as WalletRow[];

    return inserted[0];
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

  private runIndexerWalletScript(
    scriptRelPath: string,
    walletId: string,
    label: string
  ): Promise<void> {
    const indexerDir = this.resolveIndexerDir();

    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['tsx', scriptRelPath], {
        cwd: indexerDir,
        env: {
          ...process.env,
          WALLET_ID: walletId,
        },
        stdio: 'pipe',
      });

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
              `${label} script failed with exit code ${code}.`,
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

  private runWalletBalanceRefreshScript(walletId: string): Promise<void> {
    return this.runIndexerWalletScript(
      'src/scripts/wallets/80-stellar-wallet-balance-snapshots.ts',
      walletId,
      'Wallet balance refresh'
    );
  }

  private runWalletBlendPositionsScript(walletId: string): Promise<void> {
    return this.runIndexerWalletScript(
      'src/scripts/wallets/81-stellar-wallet-blend-positions.ts',
      walletId,
      'Wallet Blend positions refresh'
    );
  }

  async connectWallet(params: {
    chain?: string;
    address?: string;
    label?: string | null;
  }) {
    const chain = this.normalizeChain(params.chain);
    const address = this.normalizeAddress(params.address);
    const label = this.normalizeLabel(params.label);

    const existingWallet = await this.getWalletByAddress({
      chain,
      address,
    });

    if (existingWallet) {
      // Connecting via the Kit proves control of this address → it becomes the
      // user's active signer (singleton; demotes any previous signer).
      const promoted = await this.promoteToActiveSigner(
        existingWallet.user_id,
        existingWallet.id
      );
      const overview = await this.getWalletsOverview(existingWallet.user_id);

      return {
        connected: true,
        createdUser: false,
        createdWallet: false,
        wallet: this.mapWallet(promoted),
        ...overview,
      };
    }

    const newUserId = randomUUID();

    const createdWallet = await this.createWalletForUser({
      userId: newUserId,
      chain,
      address,
      label,
    });

    // A freshly connected wallet is the active signer for its new user.
    const promoted = await this.promoteToActiveSigner(newUserId, createdWallet.id);

    const overview = await this.getWalletsOverview(newUserId);

    return {
      connected: true,
      createdUser: true,
      createdWallet: true,
      wallet: this.mapWallet(promoted),
      ...overview,
    };
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
        is_active_signer,
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
          is_active_signer,
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

    const inserted = await this.createWalletForUser({
      userId,
      chain,
      address,
      label,
    });

    return {
      created: true,
      wallet: this.mapWallet(inserted),
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
        is_active_signer,
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
        is_active_signer,
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

    // Consolidated DeFi (Blend) view across ALL the user's tracked wallets
    // (signer + watch-only). Each wallet contributes its LATEST health snapshot
    // only, so closed positions don't linger. Kept DISTINCT from
    // total_portfolio_usd: supplied funds have left the wallet and borrowed is a
    // liability — folding them into one number would mislead.
    const defiRows = (await this.prisma.$queryRawUnsafe(
      `
      with latest as (
        select h.user_wallet_id, max(h.snapshot_at) as snap
        from wallet_pool_health h
        join user_wallets uw on uw.id = h.user_wallet_id
        where uw.user_id = $1::uuid
        group by h.user_wallet_id
      )
      select
        h.user_wallet_id,
        uw.address,
        uw.label,
        e.slug as pool_slug,
        e.name as pool_name,
        h.health_factor,
        h.total_collateral_usd,
        h.total_debt_usd
      from wallet_pool_health h
      join latest l
        on l.user_wallet_id = h.user_wallet_id
       and l.snap = h.snapshot_at
      join user_wallets uw on uw.id = h.user_wallet_id
      left join entities e on e.id = h.entity_id
      where uw.user_id = $1::uuid
      `,
      normalizedUserId
    )) as DefiHealthRow[];

    let totalSuppliedUsd = 0;
    let totalBorrowedUsd = 0;
    const poolHealth = defiRows.map((row) => {
      const collateralUsd = toNumber(row.total_collateral_usd) ?? 0;
      const debtUsd = toNumber(row.total_debt_usd) ?? 0;
      totalSuppliedUsd += collateralUsd;
      totalBorrowedUsd += debtUsd;
      return {
        walletId: row.user_wallet_id,
        address: row.address,
        label: row.label,
        poolSlug: row.pool_slug,
        poolName: row.pool_name,
        healthFactor: toNumber(row.health_factor),
        totalCollateralUsd: collateralUsd,
        totalDebtUsd: debtUsd,
      };
    });

    poolHealth.sort((a, b) =>
      compareHealthFactorAscNullsLast(a.healthFactor, b.healthFactor)
    );

    const defi = {
      totalSuppliedUsd: Number(totalSuppliedUsd.toFixed(6)),
      totalBorrowedUsd: Number(totalBorrowedUsd.toFixed(6)),
      netDefiUsd: Number((totalSuppliedUsd - totalBorrowedUsd).toFixed(6)),
      poolHealth,
    };

    return {
      userId: normalizedUserId,
      summary: {
        totalWallets: toNumber(overview.total_wallets) ?? 0,
        activeWallets: toNumber(overview.active_wallets) ?? 0,
        totalTrackedPositions: toNumber(portfolio.total_tracked_positions) ?? 0,
        totalPortfolioUsd: toNumber(portfolio.total_portfolio_usd) ?? 0,
      },
      defi,
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

  // Per-wallet DeFi (Blend) positions + pool health. Reads ONLY the wallet's
  // most recent refresh (latest snapshot_at) so repaid/exited positions don't
  // linger — each refresh is a complete snapshot of the wallet's current state.
  async getWalletPositions(params: { userId?: string; walletId?: string }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    const wallet = await this.getWalletOrThrow(walletId, userId);

    const healthRows = (await this.prisma.$queryRawUnsafe(
      `
      with latest as (
        select max(snapshot_at) as snap
        from wallet_pool_health
        where user_wallet_id = $1::uuid
      )
      select
        h.entity_id,
        h.venue_id,
        h.health_factor,
        h.total_collateral_usd,
        h.total_debt_usd,
        h.borrow_limit_usd,
        h.net_apy,
        h.positions_count,
        h.snapshot_at,
        e.slug as pool_slug,
        e.name as pool_name,
        v.slug as venue_slug
      from wallet_pool_health h
      join latest l on h.snapshot_at = l.snap
      left join entities e on e.id = h.entity_id
      left join venues v on v.id = h.venue_id
      where h.user_wallet_id = $1::uuid
      `,
      walletId
    )) as PoolHealthRow[];

    const positionRows = (await this.prisma.$queryRawUnsafe(
      `
      with latest as (
        select max(snapshot_at) as snap
        from wallet_protocol_positions
        where user_wallet_id = $1::uuid
      )
      select
        p.entity_id,
        p.venue_id,
        p.position_type,
        p.asset_symbol,
        p.amount_scaled,
        p.amount_usd,
        p.metadata,
        p.snapshot_at
      from wallet_protocol_positions p
      join latest l on p.snapshot_at = l.snap
      where p.user_wallet_id = $1::uuid
      `,
      walletId
    )) as ProtocolPositionRow[];

    type PoolPosition = {
      positionType: string;
      assetSymbol: string | null;
      amountScaled: number;
      amountUsd: number | null;
      collateralEnabled?: boolean;
    };
    type Pool = {
      venueSlug: string | null;
      entityId: string | null; // pool entity id (nullable in wallet_pool_health)
      poolSlug: string | null;
      poolName: string | null;
      healthFactor: number | null;
      totalCollateralUsd: number;
      totalDebtUsd: number;
      borrowLimitUsd: number | null;
      netApy: number | null;
      positionsCount: number | null;
      snapshotAt: unknown;
      positions: PoolPosition[];
    };

    // Group by pool (entity_id). Seed from health rows, then attach per-asset
    // positions. A pool key is the entity_id; fall back to venue if ever absent.
    const poolMap = new Map<string, Pool>();
    const keyOf = (entityId: string | null, venueId: string | null): string =>
      entityId ?? `venue:${venueId ?? 'unknown'}`;

    for (const h of healthRows) {
      poolMap.set(keyOf(h.entity_id, h.venue_id), {
        venueSlug: h.venue_slug,
        entityId: h.entity_id,
        poolSlug: h.pool_slug,
        poolName: h.pool_name,
        healthFactor: toNumber(h.health_factor),
        totalCollateralUsd: toNumber(h.total_collateral_usd) ?? 0,
        totalDebtUsd: toNumber(h.total_debt_usd) ?? 0,
        borrowLimitUsd: toNumber(h.borrow_limit_usd),
        netApy: toNumber(h.net_apy),
        positionsCount: toNumber(h.positions_count),
        snapshotAt: h.snapshot_at,
        positions: [],
      });
    }

    for (const p of positionRows) {
      const key = keyOf(p.entity_id, p.venue_id);
      let pool = poolMap.get(key);
      if (!pool) {
        pool = {
          venueSlug: null,
          entityId: p.entity_id,
          poolSlug: null,
          poolName: null,
          healthFactor: null,
          totalCollateralUsd: 0,
          totalDebtUsd: 0,
          borrowLimitUsd: null,
          netApy: null,
          positionsCount: null,
          snapshotAt: p.snapshot_at,
          positions: [],
        };
        poolMap.set(key, pool);
      }

      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      const position: PoolPosition = {
        positionType: p.position_type,
        assetSymbol: p.asset_symbol,
        amountScaled: toNumber(p.amount_scaled) ?? 0,
        amountUsd: toNumber(p.amount_usd),
      };
      if (typeof meta.collateralEnabled === 'boolean') {
        position.collateralEnabled = meta.collateralEnabled;
      }
      pool.positions.push(position);
    }

    const pools = Array.from(poolMap.values()).sort((a, b) =>
      compareHealthFactorAscNullsLast(a.healthFactor, b.healthFactor)
    );

    return {
      walletId,
      address: wallet.address,
      pools,
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

    // Blend positions + health factor refresh — NON-FATAL. A Blend/RPC hiccup
    // must not break the balance refresh; one "refresh" updates balances and,
    // best-effort, DeFi positions. (T2-D1 Gap B.)
    try {
      await this.runWalletBlendPositionsScript(walletId);
    } catch (error) {
      console.error(
        '[wallets] Blend positions refresh failed (non-fatal):',
        error instanceof Error ? error.message : error
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
        is_active_signer,
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

  // Singleton promotion of one wallet to the user's active signer. Mirrors the
  // two-step pattern of setPrimaryWallet, but the singleton is also DB-enforced
  // by user_wallets_one_signer_per_user. A signer is always kept active
  // (is_active = true) — you cannot have a paused signer. Orthogonal to
  // is_primary: promoting a signer must NOT touch the primary designation.
  private async promoteToActiveSigner(
    userId: string,
    walletId: string
  ): Promise<WalletRow> {
    await this.prisma.$executeRawUnsafe(
      `
      update user_wallets
      set
        is_active_signer = false,
        updated_at = now()
      where user_id = $1::uuid
        and is_active_signer = true
        and id <> $2::uuid
      `,
      userId,
      walletId
    );

    const updated = (await this.prisma.$queryRawUnsafe(
      `
      update user_wallets
      set
        is_active_signer = true,
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
        is_active_signer,
        metadata,
        created_at,
        updated_at
      `,
      walletId,
      userId
    )) as WalletRow[];

    return updated[0];
  }

  async setActiveSigner(params: { userId?: string; walletId?: string }) {
    const userId = this.normalizeUserId(params.userId);
    const walletId = this.normalizeWalletId(params.walletId);

    await this.getWalletOrThrow(walletId, userId);

    const updated = await this.promoteToActiveSigner(userId, walletId);

    return {
      updated: true,
      wallet: this.mapWallet(updated),
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
        is_active_signer,
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