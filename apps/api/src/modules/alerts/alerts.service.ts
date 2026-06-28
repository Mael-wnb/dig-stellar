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
  enabled?: boolean;
};

export type UpdateAlertRuleBody = Partial<CreateAlertRuleBody>;

const SUPPORTED_METRICS = new Set(['health_factor']);
const OPERATORS = new Set(['lt', 'lte', 'gt', 'gte']);
const DEFAULT_COOLDOWN_SECONDS = 3600;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
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
        'userId must be a valid UUID, for example 00000000-0000-0000-0000-000000000001'
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

  private validateMetric(metric: unknown): 'health_factor' {
    if (typeof metric !== 'string' || !SUPPORTED_METRICS.has(metric)) {
      throw new BadRequestException(
        `Unsupported metric. Only 'health_factor' is supported today.`
      );
    }
    return metric as 'health_factor';
  }

  private validateOperator(operator: unknown): 'lt' | 'lte' | 'gt' | 'gte' {
    if (typeof operator !== 'string' || !OPERATORS.has(operator)) {
      throw new BadRequestException(
        `operator must be one of: lt, lte, gt, gte.`
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
        'threshold is required and must be a finite number (recommended HF band ~1.1–1.5).'
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
        'cooldownSeconds must be a positive integer.'
      );
    }
    return cooldownSeconds;
  }

  private validateHysteresis(rearmHysteresis: unknown): number | null {
    if (rearmHysteresis === null || rearmHysteresis === undefined) return null;
    if (typeof rearmHysteresis !== 'number' || !Number.isFinite(rearmHysteresis) || rearmHysteresis < 0) {
      throw new BadRequestException(
        'rearmHysteresis must be a non-negative number or null.'
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
    walletId: string
  ): Promise<void> {
    const owned = await this.alerts.walletBelongsToUser(userId, walletId);
    if (!owned) {
      throw new BadRequestException(
        'userWalletId does not belong to this user.'
      );
    }
  }

  // --- CRUD ----------------------------------------------------------------

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
      enabled: b.enabled === undefined ? true : this.validateEnabled(b.enabled),
    };

    if (input.userWalletId !== null) {
      await this.assertWalletOwned(userId, input.userWalletId);
    }

    return this.alerts.createRule(userId, input);
  }

  async listRules(rawUserId?: string) {
    const userId = this.normalizeUserId(rawUserId);
    return this.alerts.listRules(userId);
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
    body: UpdateAlertRuleBody
  ): Promise<AlertRule> {
    const userId = this.normalizeUserId(rawUserId ?? body?.userId);
    const ruleId = this.normalizeRuleId(id);
    const b = body ?? {};

    // Only validate + write the keys actually present (explicit null is honored
    // for the nullable columns, e.g. clearing user_wallet_id back to "all").
    const patch: UpdateRuleInput = {};
    if (has(b, 'metric')) patch.metric = this.validateMetric(b.metric);
    if (has(b, 'operator')) patch.operator = this.validateOperator(b.operator);
    if (has(b, 'threshold')) patch.threshold = this.validateThreshold(b.threshold);
    if (has(b, 'cooldownSeconds'))
      patch.cooldownSeconds = this.validateCooldown(b.cooldownSeconds);
    if (has(b, 'rearmHysteresis'))
      patch.rearmHysteresis = this.validateHysteresis(b.rearmHysteresis);
    if (has(b, 'userWalletId'))
      patch.userWalletId = this.validateOptionalUuid(b.userWalletId, 'userWalletId');
    if (has(b, 'poolEntityId'))
      patch.poolEntityId = this.validateOptionalUuid(b.poolEntityId, 'poolEntityId');
    if (has(b, 'enabled')) patch.enabled = this.validateEnabled(b.enabled);

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
    query: { limit?: number; before?: string } = {}
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
