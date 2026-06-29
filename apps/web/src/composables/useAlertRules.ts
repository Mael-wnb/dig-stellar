// apps/web/src/composables/useAlertRules.ts
//
// Shared alert-rule CRUD state for the Alerts page. Module-scoped refs in the
// house style (like useNotifications / useAppUser). No poller — rules don't change
// out-of-band; the list reloads on mutation.

import { ref } from 'vue'
import { useAppUser } from './useAppUser'
import {
  createAlertRule,
  deleteAlertRule,
  listAlertRules,
  updateAlertRule,
  type AlertRule,
  type CreateAlertRuleInput,
  type UpdateAlertRuleInput,
} from '../api/alertRules'

// --- module-scoped shared state ---
const rules = ref<AlertRule[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useAlertRules() {
  const { userId } = useAppUser()

  function currentUserId(): string | null {
    const id = userId.value?.trim()
    return id && id.length ? id : null
  }

  async function load(): Promise<void> {
    const id = currentUserId()
    if (!id) {
      rules.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      rules.value = await listAlertRules(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load alerts'
    } finally {
      loading.value = false
    }
  }

  // Create then reload (simple + correct; creation is rare).
  async function createRule(input: CreateAlertRuleInput): Promise<AlertRule | null> {
    const id = currentUserId()
    if (!id) return null
    error.value = null
    const created = await createAlertRule(id, input)
    await load()
    return created
  }

  async function updateRule(
    ruleId: string,
    patch: UpdateAlertRuleInput
  ): Promise<void> {
    const id = currentUserId()
    if (!id) return
    error.value = null
    await updateAlertRule(id, ruleId, patch)
    await load()
  }

  // Optimistic enable/disable: flip locally, roll back on failure.
  async function toggleRule(ruleId: string, enabled: boolean): Promise<void> {
    const id = currentUserId()
    if (!id) return
    const target = rules.value.find((r) => r.id === ruleId)
    if (!target) return
    const prev = target.enabled
    target.enabled = enabled
    try {
      await updateAlertRule(id, ruleId, { enabled })
    } catch (e) {
      target.enabled = prev
      error.value = e instanceof Error ? e.message : 'Failed to update alert'
    }
  }

  async function deleteRule(ruleId: string): Promise<void> {
    const id = currentUserId()
    if (!id) return
    error.value = null
    try {
      await deleteAlertRule(id, ruleId)
      rules.value = rules.value.filter((r) => r.id !== ruleId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete alert'
    }
  }

  return {
    rules,
    loading,
    error,
    load,
    createRule,
    updateRule,
    toggleRule,
    deleteRule,
  }
}
