export function toRials(amount: number, currency: string): number {
  const norm = currency.toUpperCase();
  if (norm === 'IRT' || norm === 'TOMAN') {
    return amount * 10;
  }
  return amount; // default IRR
}
