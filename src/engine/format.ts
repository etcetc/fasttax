export function dollars(n: number): string {
  const r = Math.round(n)
  return (r < 0 ? '−$' : '$') + Math.abs(r).toLocaleString('en-US')
}
