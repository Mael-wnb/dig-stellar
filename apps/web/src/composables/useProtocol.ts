import { computed, nextTick, onMounted, ref, watch } from "vue";
import { fetchPoolById, fetchPools } from "../api/pools";
import { PROTOCOL_META } from "../data/protocolMeta";
import type { PoolListItem } from "../types/protocol";
import { mapPoolToDisplay } from "../mappers/poolMapper";
import type { PoolDisplay } from "../types/poolDisplay";

// Minimum TVL (USD) for a pool to be shown. Pools below this (incl. null/0)
// are filtered out as dust. Tweak here to adjust the threshold.
const MIN_POOL_TVL_USD = 100;

/* ──────────────────────────────────────────────── */
/* TYPES */
/* ──────────────────────────────────────────────── */

export interface ProtocolOption {
  id: string;
  name: string;
  type: string;
}

export interface ProtocolDisplay extends ProtocolOption {
  icon: string;
  iconColor: string;
  iconBg: string;
  logo: string;
}

/* ──────────────────────────────────────────────── */
/* HELPERS */
/* ──────────────────────────────────────────────── */

function getProtocolMeta(protocolId: string) {
  return (
    PROTOCOL_META[protocolId] ?? {
      icon: "•",
      iconColor: "#D5FF2F",
      iconBg: "#1a1a1a",
      logo: "",
    }
  );
}

// Filter out dust (TVL null/0/below MIN_POOL_TVL_USD) THEN sort by TVL desc.
// Non-mutating.
function sortPoolsByTvlDesc(list: PoolListItem[]): PoolListItem[] {
  return list
    .filter((pool) => (pool.metrics.tvlUsd ?? 0) >= MIN_POOL_TVL_USD)
    .sort((a, b) => (b.metrics.tvlUsd ?? 0) - (a.metrics.tvlUsd ?? 0));
}

/* ──────────────────────────────────────────────── */
/* MAIN COMPOSABLE */
/* ──────────────────────────────────────────────── */

export function useProtocol() {
  const pools = ref<PoolListItem[]>([]);

  const selectedProtocolId = ref<string>("");
  const selectedPoolId = ref<string>("");

  const selectedPool = ref<PoolDisplay | null>(null);

  const loadingProtocols = ref(false);
  const loadingPoolDetail = ref(false);
  const error = ref<string | null>(null);

  /* ───────────────────────── */
  /* COMPUTED */
  /* ───────────────────────── */

  const protocols = computed<ProtocolOption[]>(() => {
    const map = new Map<string, ProtocolOption>();

    for (const pool of pools.value) {
      if (!map.has(pool.protocol.id)) {
        map.set(pool.protocol.id, {
          id: pool.protocol.id,
          name: pool.protocol.name,
          type: pool.protocol.type,
        });
      }
    }

    return Array.from(map.values());
  });

  const protocolDisplays = computed<ProtocolDisplay[]>(() =>
    protocols.value.map((protocol) => ({
      ...protocol,
      ...getProtocolMeta(protocol.id),
    })),
  );

  const protocolPools = computed(() =>
    sortPoolsByTvlDesc(
      pools.value.filter(
        (pool) => pool.protocol.id === selectedProtocolId.value,
      ),
    ),
  );

  const selectedProtocol = computed<ProtocolDisplay | null>(() => {
    const protocol = protocols.value.find(
      (item) => item.id === selectedProtocolId.value,
    );

    if (!protocol) return null;

    return {
      ...protocol,
      ...getProtocolMeta(protocol.id),
    };
  });

  /* ───────────────────────── */
  /* LOAD LIST */
  /* ───────────────────────── */

  async function loadPools() {
    loadingProtocols.value = true;
    error.value = null;

    try {
      const data = sortPoolsByTvlDesc(await fetchPools());

      // ✅ IMPORTANT : ne pas recréer les refs (évite flicker)
      pools.value = data;

      if (!data.length) {
        selectedProtocolId.value = "";
        selectedPoolId.value = "";
        selectedPool.value = null;
        return;
      }

      if (
        !selectedProtocolId.value ||
        !data.some((p) => p.protocol.id === selectedProtocolId.value)
      ) {
        selectedProtocolId.value = data[0].protocol.id;
      }

      const poolsForProtocol = data.filter(
        (pool) => pool.protocol.id === selectedProtocolId.value,
      );

      if (
        !selectedPoolId.value ||
        !poolsForProtocol.some((p) => p.id === selectedPoolId.value)
      ) {
        selectedPoolId.value = poolsForProtocol[0]?.id ?? "";
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load pools";
    } finally {
      loadingProtocols.value = false;
    }
  }

  /* ───────────────────────── */
  /* LOAD DETAIL (FIXED) */
  /* ───────────────────────── */

  // Monotonic token: every loadPoolDetail call claims a number; only the most
  // recent call is allowed to commit. A protocol/pool switch fired while a
  // previous fetch is in flight bumps the token, so the stale fetch bails out
  // instead of clobbering selectedPool with the wrong (or out-of-order) data.
  let detailRequestToken = 0;

  async function loadPoolDetail(poolId: string) {
    if (!poolId) return;

    const requestToken = ++detailRequestToken;
    const isStale = () =>
      requestToken !== detailRequestToken || selectedPoolId.value !== poolId;

    loadingPoolDetail.value = true;
    error.value = null;

    try {
      const data = await fetchPoolById(poolId);

      // A newer selection superseded this fetch while it was in flight → drop it.
      if (isStale()) return;

      // Commit AFTER Vue has flushed the patch triggered by the selection
      // change. Writing selectedPool mid-patch races the renderer and throws
      // "Cannot read properties of null (reading 'subTree')". nextTick lands us
      // safely after the current render.
      await nextTick();
      if (isStale()) return;

      // ✅ NE MET PAS selectedPool à null → évite flicker
      selectedPool.value = mapPoolToDisplay(data);
    } catch (err) {
      if (isStale()) return;
      error.value =
        err instanceof Error ? err.message : "Failed to load pool detail";
      // ❌ ne pas reset selectedPool ici
    } finally {
      // Only the live request owns the loading flag.
      if (requestToken === detailRequestToken) {
        loadingPoolDetail.value = false;
      }
    }
  }

  /* ───────────────────────── */
  /* ACTIONS */
  /* ───────────────────────── */

  function selectProtocol(protocolId: string) {
    if (protocolId === selectedProtocolId.value) return;

    // selectedPoolId is reset by the watch on selectedProtocolId below,
    // so it always lands on the first *visible* pool (dust-filtered + sorted).
    selectedProtocolId.value = protocolId;
  }

  function selectPool(poolId: string) {
    if (poolId === selectedPoolId.value) return;
    selectedPoolId.value = poolId;
  }

  /* ───────────────────────── */
  /* WATCHERS (FIXED) */
  /* ───────────────────────── */

  // When the protocol changes, the previously selected pool no longer belongs
  // to protocolPools (different protocol and/or dropped by the dust filter).
  // Reset to the first *visible* pool, or "" if this protocol has none.
  //
  // NB: derive the first pool straight from pools.value here instead of reading
  // protocolPools.value. The computed depends on selectedProtocolId too, and a
  // pre-flush watch can run before Vue re-evaluates it — leaving us with the
  // PREVIOUS protocol's pools. Filtering by protocolId locally is order-safe.
  watch(selectedProtocolId, (protocolId) => {
    const firstVisible = sortPoolsByTvlDesc(
      pools.value.filter((pool) => pool.protocol.id === protocolId),
    )[0];

    selectedPoolId.value = firstVisible?.id ?? "";
  });

  watch(selectedPoolId, (poolId) => {
    if (!poolId) return;

    // ✅ laisse le DOM se stabiliser AVANT fetch
    requestAnimationFrame(() => {
      void loadPoolDetail(poolId);
    });
  });

  /* ───────────────────────── */
  /* INIT */
  /* ───────────────────────── */

  onMounted(() => {
    void loadPools();
  });

  /* ───────────────────────── */
  /* EXPORT */
  /* ───────────────────────── */

  return {
    pools,
    protocols,
    protocolDisplays,
    protocolPools,
    selectedProtocolId,
    selectedPoolId,
    selectedProtocol,
    selectedPool,
    loadingProtocols,
    loadingPoolDetail,
    error,
    selectProtocol,
    selectPool,
  };
}
