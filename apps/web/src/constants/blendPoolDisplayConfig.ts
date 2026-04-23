// src/constants/blendPoolDisplayConfig.ts

export type BlendPoolDisplayConfig = {
    maxPosition: string
    minCollateral: string
  }
  
  export const BLEND_POOL_DISPLAY_CONFIG: Record<string, BlendPoolDisplayConfig> = {
    'blend-fixed-pool': {
      maxPosition: '$—',
      minCollateral: '—%',
    },
    'blend-etherfuse-pool': {
      maxPosition: '$—',
      minCollateral: '—%',
    },
    'blend-orbit-pool': {
      maxPosition: '$—',
      minCollateral: '—%',
    },
  }
  
  export function getBlendPoolDisplayConfig(poolId: string): BlendPoolDisplayConfig {
    return (
      BLEND_POOL_DISPLAY_CONFIG[poolId] ?? {
        maxPosition: '$—',
        minCollateral: '—%',
      }
    )
  }