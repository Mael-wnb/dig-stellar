export interface PoolDisplay {
    id: string
    name: string
  
    metrics: {
      label: string
      value: string
      lime?: boolean
    }[]
  
    onChainInfo: {
      key: string
      value: string
      lime?: boolean
    }[]
  
    reserves?: any[]
  }