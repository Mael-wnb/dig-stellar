export type HorizonReserve = {
    asset: string;
    amount: string;
  };
  
  export type HorizonPool = {
    id: string;
  
    fee_bp: number;
  
    type?: string;
  
    total_trustlines: string;
  
    total_shares: string;
  
    reserves: HorizonReserve[];
  
    last_modified_ledger: number;
  
    last_modified_time: string | null;
  };
  
  export type HorizonPoolsResult = {
    fetchedAt: string;
    count: number;
    pools: HorizonPool[];
  };