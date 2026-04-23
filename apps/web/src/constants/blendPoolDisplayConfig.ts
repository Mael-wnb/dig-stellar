// src/constants/blendPoolDisplayConfig.ts

export type BlendPoolDisplayConfig = {
    maxPosition: string
    minCollateral: string
  }
  
  export const BLEND_POOL_DISPLAY_CONFIG: Record<string, BlendPoolDisplayConfig> = {
    'blend-fixed-pool': {
      maxPosition: '6',
      minCollateral: '$5.00',
    },
    'blend-etherfuse-pool': {
      maxPosition: '6',
      minCollateral: '$5.00',
    },
    'blend-orbit-pool': {
      maxPosition: '6',
      minCollateral: '$10.00',
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