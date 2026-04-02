// src/data/mock/notifications.ts
export interface Notification {
    wallet: string
    protocol: string
    status: string
    color: string
  }
  
  export const NOTIFICATIONS: Notification[] = [
    { wallet: 'Wallet 1', protocol: 'Blend · Fixed', status: 'Rebalancing', color: '#60A5FA' },
    { wallet: 'Wallet 2', protocol: 'Blend · Fixed', status: 'Claim', color: '#D5FF2F' },
    { wallet: 'Wallet 3', protocol: 'Aquarius · PYUSD/USDC', status: 'Unbalanced', color: '#FF5A5A' },
  ]