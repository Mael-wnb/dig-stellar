export function toScaled(
    raw: string | number | bigint | null,
    decimals: number | null
  ): string | null {
    if (raw === null || raw === undefined) return null;
    if (decimals === null || !Number.isFinite(decimals)) return null;
  
    const s = String(raw);
    const d = Number(decimals);
  
    if (d === 0) return s;
  
    const padded = s.padStart(d + 1, '0');
    const intPart = padded.slice(0, -d);
    const fracPart = padded.slice(-d).replace(/0+$/, '');
  
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  }