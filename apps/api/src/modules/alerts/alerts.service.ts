// apps/api/src/modules/alerts/alerts.service.ts
//
// D2 alerting — rule CRUD service (lot 3). Validation + ownership are enforced
// HERE (the controller is a thin delegator), mirroring WalletsService: manual
// checks throwing BadRequest/NotFound (no class-validator in this repo), userId
// normalized to the default user when absent. Every read/mutation is scoped to
// the caller's userId by AlertsRepository; this layer turns "not owned" (repo
// null/false) into a 404 so one user can never see or touch another's rule.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertsRepository,
  type AlertRule,
  type CreateRuleInput,
  type UpdateRuleInput,
} from './alerts.repository';

// Request bodies — plain camelCase types, like wallets.controller.ts (there is no
// ValidationPipe whitelist in this app, so unknown extra fields are simply ignored).
export type CreateAlertRuleBody = {
  userId?: string;
  metric?: string;
  operator?: string;
  threshold?: number;
  cooldownSeconds?: number;
  rearmHysteresis?: number | null;
  userWalletId?: string | null;
  poolEntityId?: string | null;
  assetId?: string | null;
  enabled?: boolean;
};

export type UpdateAlertRuleBody = Partial<CreateAlertRuleBody>;

// Lot N: creatable families = the ones the evaluator actually runs (honesty rule).
const SUPPORTED_METRICS = new Set(['health_factor', 'price', 'tvl_drop_pct']);
const OPERATORS = new Set(['lt', 'lte', 'gt', 'gte']);
const DEFAULT_COOLDOWN_SECONDS = 3600;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function has<T extends object>(obj: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

@Injectable()
export class AlertsService {
  constructor(private readonly alerts: AlertsRepository) {}

  private normalizeUserId(userId?: string): string {
    const value = (userId ?? '00000000-0000-0000-0000-000000000001').trim();
    if (!value) {
      throw new BadRequestException('userId is required');
    }
    if (!isUuid(value)) {
      throw new BadRequestException(
        'userId must be a valid UUID, for example 00000000-0000-0000-0000-000000000001',
      );
    }
    return value;
  }

  private normalizeRuleId(id?: string): string {
    const value = (id ?? '').trim();
    if (!value) {
      throw new BadRequestException('rule id is required');
    }
    if (!isUuid(value)) {
      throw new BadRequestException('rule id must be a valid UUID');
    }
    return value;
  }

  // --- field validators (shared by create + patch) -------------------------

  private validateMetric(
    metric: unknown,
  ): 'health_factor' | 'price' | 'tvl_drop_pct' {
    if (typeof metric !== 'string' || !SUPPORTED_METRICS.has(metric)) {
      throw new BadRequestException(
        `Unsupported metric. Supported today: 'health_factor', 'price', 'tvl_drop_pct'.`,
      );
    }
    return metric as 'health_factor' | 'price' | 'tvl_drop_pct';
  }

  private validateOperator(operator: unknown): 'lt' | 'lte' | 'gt' | 'gte' {
    if (typeof operator !== 'string' || !OPERATORS.has(operator)) {
      throw new BadRequestException(
        `operator must be one of: lt, lte, gt, gte.`,
      );
    }
    return operator as 'lt' | 'lte' | 'gt' | 'gte';
  }

  // threshold is the user's risk choice — required and NEVER silently defaulted.
  // Recommended HF warning band sits ~1.1–1.5 (HF <= 1.0 = liquidatable), but the
  // value is the user's to pick; we only enforce that it is a finite number.
  private validateThreshold(threshold: unknown): number {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
      throw new BadRequestException(
        'threshold is required and must be a finite number (recommended HF band ~1.1–1.5).',
      );
    }
    return threshold;
  }

  private validateCooldown(cooldownSeconds: unknown): number {
    if (
      typeof cooldownSeconds !== 'number' ||
      !Number.isInteger(cooldownSeconds) ||
      cooldownSeconds <= 0
    ) {
      throw new BadRequestException(
        'cooldownSeconds must be a positive integer.',
      );
    }
    return cooldownSeconds;
  }

  private validateHysteresis(rearmHysteresis: unknown): number | null {
    if (rearmHysteresis === null || rearmHysteresis === undefined) return null;
    if (
      typeof rearmHysteresis !== 'number' ||
      !Number.isFinite(rearmHysteresis) ||
      rearmHysteresis < 0
    ) {
      throw new BadRequestException(
        'rearmHysteresis must be a non-negative number or null.',
      );
    }
    return rearmHysteresis;
  }

  // optional uuid; null/undefined => null ("all wallets" / "all pools" per design).
  private validateOptionalUuid(value: unknown, field: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new BadRequestException(`${field} must be a valid UUID or null.`);
    }
    return value;
  }

  private validateEnabled(enabled: unknown): boolean {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean.');
    }
    return enabled;
  }

  // Reject a rule that scopes to a wallet the user does not own.
  private async assertWalletOwned(
    userId: string,
    walletId: string,
  ): Promise<void> {
    const owned = await this.alerts.walletBelongsToUser(userId, walletId);
    if (!owned) {
      throw new BadRequestException(
        'userWalletId does not belong to this user.',
      );
    }
  }

  // --- CRUD ----------------------------------------------------------------

  // Family invariants (Lot N): a price rule's subject is an asset, never a
  // wallet/pool; a tvl-drop rule's subject is a specific pool; a health-factor
  // rule's subjects are wallet/pool, never an asset.
  private assertFamilyShape(input: {
    metric: 'health_factor' | 'price' | 'tvl_drop_pct';
    userWalletId: string | null;
    poolEntityId: string | null;
    assetId: string | null;
  }): void {
    if (input.metric === 'price') {
      if (input.assetId === null) {
        throw new BadRequestException('a price rule requires assetId.');
      }
      if (input.userWalletId !== null || input.poolEntityId !== null) {
        throw new BadRequestException(
          'a price rule is asset-scoped: userWalletId and poolEntityId must be null.',
        );
      }
      return;
    }
    if (input.metric === 'tvl_drop_pct') {
      if (input.poolEntityId === null) {
        throw new BadRequestException(
          'a tvl_drop_pct rule requires poolEntityId (a specific pool).',
        );
      }
      if (input.userWalletId !== null || input.assetId !== null) {
        throw new BadRequestException(
          'a tvl_drop_pct rule is pool-scoped: userWalletId and assetId must be null.',
        );
      }
      return;
    }
    if (input.assetId !== null) {
      throw new BadRequestException(
        'assetId only applies to price rules; must be null for health_factor.',
      );
    }
  }

  // tvl_drop_pct condition sanity: the observed value is a DROP percentage, so
  // only "drop ≥/> X" is meaningful, and X must be a positive percentage — an
  // lt/lte or zero threshold would breach permanently on a stable pool.
  private assertTvlDropCondition(operator: string, threshold: number): void {
    if (operator !== 'gt' && operator !== 'gte') {
      throw new BadRequestException(
        'a tvl_drop_pct rule requires operator gt or gte (fires when the drop exceeds the threshold).',
      );
    }
    if (threshold <= 0) {
      throw new BadRequestException(
        'a tvl_drop_pct threshold must be a positive drop percentage.',
      );
    }
  }

  async createRule(rawUserId: string | undefined, body: CreateAlertRuleBody) {
    const userId = this.normalizeUserId(rawUserId ?? body?.userId);
    const b = body ?? {};

    const input: CreateRuleInput = {
      metric: this.validateMetric(b.metric),
      operator: this.validateOperator(b.operator),
      threshold: this.validateThreshold(b.threshold),
      cooldownSeconds:
        b.cooldownSeconds === undefined
          ? DEFAULT_COOLDOWN_SECONDS
          : this.validateCooldown(b.cooldownSeconds),
      rearmHysteresis: this.validateHysteresis(b.rearmHysteresis),
      userWalletId: this.validateOptionalUuid(b.userWalletId, 'userWalletId'),
      poolEntityId: this.validateOptionalUuid(b.poolEntityId, 'poolEntityId'),
      assetId: this.validateOptionalUuid(b.assetId, 'assetId'),
      enabled: b.enabled === undefined ? true : this.validateEnabled(b.enabled),
    };

    this.assertFamilyShape(input);
    if (input.metric === 'tvl_drop_pct') {
      this.assertTvlDropCondition(input.operator, input.threshold);
    }

    if (input.userWalletId !== null) {
      await this.assertWalletOwned(userId, input.userWalletId);
    }

    return this.alerts.createRule(userId, input);
  }

  async listRules(rawUserId?: string) {
    const userId = this.normalizeUserId(rawUserId);
    return this.alerts.listRules(userId);
  }

  // Lot N — the vetted asset list for price rules: every asset the pipeline
  // actually prices (recent asset_prices row), with its latest observation so
  // the modal can show current price + freshness. Not user-scoped (market data).
  async listPricedAssets() {
    const assets = await this.alerts.listPricedAssets();
    return { count: assets.length, assets };
  }

  // Lot N (N3) — pools eligible for TVL-drop rules: active entities with
  // reserve-batch history on the live refresh path. Not user-scoped.
  async listTvlPools() {
    const pools = await this.alerts.listTvlPools();
    return { count: pools.length, pools };
  }

  async getRule(rawUserId: string | undefined, id: string): Promise<AlertRule> {
    const userId = this.normalizeUserId(rawUserId);
    const ruleId = this.normalizeRuleId(id);
    const rule = await this.alerts.getRule(userId, ruleId);
    if (!rule) {
      throw new NotFoundException('Alert rule not found.');
    }
    return rule;
  }

  async updateRule(
    rawUserId: string | undefined,
    id: string,
    body: UpdateAlertRuleBody,
  ): Promise<AlertRule> {
    const userId = this.normalizeUserId(rawUserId ?? body?.userId);
    const ruleId = this.normalizeRuleId(id);
    const b = body ?? {};

    // Only validate + write the keys actually present (explicit null is honored
    // for the nullable columns, e.g. clearing user_wallet_id back to "all").
    // Lot N: metric (the family) is immutable after creation — switching family
    // would orphan the rule's edge state and invalidate its subject columns.
    const patch: UpdateRuleInput = {};
    if (has(b, 'metric')) {
      throw new BadRequestException(
        'metric cannot be changed after creation; delete the rule and create a new one.',
      );
    }
    if (has(b, 'operator')) patch.operator = this.validateOperator(b.operator);
    if (has(b, 'threshold'))
      patch.threshold = this.validateThreshold(b.threshold);
    if (has(b, 'cooldownSeconds'))
      patch.cooldownSeconds = this.validateCooldown(b.cooldownSeconds);
    if (has(b, 'rearmHysteresis'))
      patch.rearmHysteresis = this.validateHysteresis(b.rearmHysteresis);
    if (has(b, 'userWalletId'))
      patch.userWalletId = this.validateOptionalUuid(
        b.userWalletId,
        'userWalletId',
      );
    if (has(b, 'poolEntityId'))
      patch.poolEntityId = this.validateOptionalUuid(
        b.poolEntityId,
        'poolEntityId',
      );
    if (has(b, 'assetId'))
      patch.assetId = this.validateOptionalUuid(b.assetId, 'assetId');
    if (has(b, 'enabled')) patch.enabled = this.validateEnabled(b.enabled);

    // A patched subject or condition must keep the rule's family shape valid —
    // merge with the current (ownership-scoped) row and re-check the invariants.
    if (
      patch.userWalletId !== undefined ||
      patch.poolEntityId !== undefined ||
      patch.assetId !== undefined ||
      patch.operator !== undefined ||
      patch.threshold !== undefined
    ) {
      const current = await this.alerts.getRule(userId, ruleId);
      if (!current) {
        throw new NotFoundException('Alert rule not found.');
      }
      this.assertFamilyShape({
        metric: current.metric,
        userWalletId:
          patch.userWalletId !== undefined
            ? patch.userWalletId
            : current.userWalletId,
        poolEntityId:
          patch.poolEntityId !== undefined
            ? patch.poolEntityId
            : current.poolEntityId,
        assetId: patch.assetId !== undefined ? patch.assetId : current.assetId,
      });
      if (current.metric === 'tvl_drop_pct') {
        this.assertTvlDropCondition(
          patch.operator ?? current.operator,
          patch.threshold ?? current.threshold ?? Number.NaN,
        );
      }
    }

    if (patch.userWalletId !== undefined && patch.userWalletId !== null) {
      await this.assertWalletOwned(userId, patch.userWalletId);
    }

    const updated = await this.alerts.updateRule(userId, ruleId, patch);
    if (!updated) {
      throw new NotFoundException('Alert rule not found.');
    }
    return updated;
  }

  async deleteRule(rawUserId: string | undefined, id: string) {
    const userId = this.normalizeUserId(rawUserId);
    const ruleId = this.normalizeRuleId(id);
    const deleted = await this.alerts.deleteRule(userId, ruleId);
    if (!deleted) {
      throw new NotFoundException('Alert rule not found.');
    }
    return { deleted: true, id: ruleId };
  }

  // --- notifications feed --------------------------------------------------

  private normalizeNotificationId(id?: string): string {
    const value = (id ?? '').trim();
    if (!value) {
      throw new BadRequestException('notification id is required');
    }
    if (!isUuid(value)) {
      throw new BadRequestException('notification id must be a valid UUID');
    }
    return value;
  }

  // Optional keyset cursor: must be a parseable timestamp if provided.
  private normalizeBefore(before?: string | null): string | null {
    if (before === null || before === undefined || before === '') return null;
    if (Number.isNaN(Date.parse(before))) {
      throw new BadRequestException('before must be an ISO timestamp.');
    }
    return before;
  }

  async listNotifications(
    rawUserId: string | undefined,
    query: { limit?: number; before?: string } = {},
  ) {
    const userId = this.normalizeUserId(rawUserId);
    const before = this.normalizeBefore(query.before);
    // limit is clamped to the hard cap inside the repository (mirrors bridge).
    const notifications = await this.alerts.listNotifications(userId, {
      limit: query.limit,
      before,
    });
    return { count: notifications.length, notifications };
  }

  async getUnreadCount(rawUserId?: string) {
    const userId = this.normalizeUserId(rawUserId);
    const count = await this.alerts.countUnread(userId);
    return { count };
  }

  // Mark one read. Distinguishes "not owned/absent" (404) from "already read"
  // (200 no-op): markRead returns false in BOTH cases, so we disambiguate with an
  // ownership-scoped existence check. A non-owner never reaches the "already read"
  // branch — notificationExists is also scoped by user_id, so they get a 404.
  async markRead(rawUserId: string | undefined, id: string) {
    const userId = this.normalizeUserId(rawUserId);
    const notifId = this.normalizeNotificationId(id);

    const marked = await this.alerts.markRead(userId, notifId);
    if (marked) {
      return { read: true, id: notifId, alreadyRead: false };
    }

    const exists = await this.alerts.notificationExists(userId, notifId);
    if (!exists) {
      throw new NotFoundException('Notification not found.');
    }
    return { read: true, id: notifId, alreadyRead: true };
  }

  async markAllRead(rawUserId?: string) {
    const userId = this.normalizeUserId(rawUserId);
    const count = await this.alerts.markAllRead(userId);
    return { read: true, count };
  }
}
