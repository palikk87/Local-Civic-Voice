/**
 * "119th", "121st", "122nd", "123rd" — and nothing at all when the number is
 * missing.
 *
 * Three places printed `{congress}th` with the suffix hardcoded. Two of them
 * are the Government screens, where the congress number comes from an API
 * response and is not guarded, so before it arrived the screen read "members of
 * the th Congress". The suffix is also simply wrong from the 121st Congress
 * on, which is four years away.
 *
 * Web twin: the `ordinal` export in apps/web/src/lib/civic.ts.
 */
export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const abs = Math.abs(Math.trunc(n));
  // 11th, 12th, 13th are the exceptions to the last-digit rule.
  const teen = abs % 100 >= 11 && abs % 100 <= 13;
  const suffix = teen
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[abs % 10] ?? 'th';
  return `${n}${suffix}`;
}
