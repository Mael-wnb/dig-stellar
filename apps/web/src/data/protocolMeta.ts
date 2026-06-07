import blendLogo from '@/assets/protocols/blend-logo.svg'
import aquariusLogo from '@/assets/protocols/aquarius-logo.svg'
import soroswapLogo from '@/assets/protocols/soroswap-logo.svg'
import defindexLogo from '@/assets/protocols/defindex-logo.svg'

export const PROTOCOL_META: Record<
  string,
  { icon: string; iconColor: string; iconBg: string; logo: string }
> = {
  blend: {
    icon: '◈',
    iconColor: '#2cb13e',
    iconBg: '#1a2a10',
    logo: blendLogo,
  },
  aquarius: {
    icon: '◎',
    iconColor: '#872ab0',
    iconBg: '#1a1a2e',
    logo: aquariusLogo,
  },
  soroswap: {
    icon: '⬡',
    iconColor: '#8865dd',
    iconBg: '#1a2020',
    logo: soroswapLogo,
  },
  defindex: {
    icon: '✦',
    iconColor: '#F59E0B',
    iconBg: '#221a10',
    logo: defindexLogo,
  },
}
