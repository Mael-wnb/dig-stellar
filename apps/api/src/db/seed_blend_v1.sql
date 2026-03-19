insert into venues (slug, name, chain, venue_type, metadata)
values (
  'blend',
  'Blend',
  'stellar-mainnet',
  'lending',
  '{"source":"discovery"}'::jsonb
)
on conflict (slug) do nothing;

insert into entities (
  venue_id,
  slug,
  name,
  entity_type,
  contract_address,
  metadata
)
select
  v.id,
  'blend-fixed-pool',
  'Fixed',
  'lending_pool',
  'CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD',
  '{"reserveCount":3}'::jsonb
from venues v
where v.slug = 'blend'
on conflict (slug) do nothing;

insert into assets (chain, contract_address, asset_type, symbol, name, decimals, metadata)
values
(
  'stellar-mainnet',
  'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
  'soroban_token',
  'native',
  'native',
  7,
  '{"source":"blend_reserve_assets"}'::jsonb
),
(
  'stellar-mainnet',
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  'soroban_token',
  'USDC',
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  7,
  '{"source":"blend_reserve_assets"}'::jsonb
),
(
  'stellar-mainnet',
  'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
  'soroban_token',
  'EURC',
  'EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
  7,
  '{"source":"blend_reserve_assets"}'::jsonb
)
on conflict (contract_address) do nothing;

insert into entity_assets (entity_id, asset_id, role, metadata)
select
  e.id,
  a.id,
  'reserve',
  '{}'::jsonb
from entities e
join assets a on a.contract_address in (
  'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV'
)
where e.slug = 'blend-fixed-pool'
on conflict (entity_id, asset_id, role) do nothing;