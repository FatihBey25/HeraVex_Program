// Allocation rules for shared general-expenses.
//
// A global (studio-wide) expense can opt into per-game allocation by
// setting `sharedWithGameIds`. The amount is then split EVENLY across
// the listed games when computing each game's spend — never multiplied.
//
// Studio-level reports keep counting the full amount once. Per-game
// reports get amount / n. This keeps both "studio total" and
// "this game's P&L" honest at the same time:
//
//   Claude Code $20 shared between [A, B, C, D]
//     ⇒ Studio total: $20  (the cash actually left the account once)
//     ⇒ Game A spend: $5
//     ⇒ Game B spend: $5
//     ⇒ Game C spend: $5
//     ⇒ Game D spend: $5
//     ⇒ Sum of per-game shares: $20  ✓ no double-count

import type { ExpenseItem } from "../types";
import { calculateAccumulatedAmount } from "../components/PieChartWidget";

/** Returns the per-game share of a global expense in its native
 *  currency, before USD conversion. When the expense isn't shared, or
 *  the targeted game isn't in the share list, returns 0. */
export function allocatedAmountForGame(exp: ExpenseItem, gameId: string): number {
  const shared = exp.sharedWithGameIds ?? [];
  if (shared.length === 0) return 0;
  if (!shared.includes(gameId)) return 0;
  return exp.amount / shared.length;
}

/** Sum the per-game share of all global expenses linked to the given
 *  game, converting each to USD via the caller-provided rate-getter.
 *  Pass this alongside the game's own expenses to compute its true
 *  spend including shared overhead. */
export function totalSharedSpendForGame(
  globalExpenses: ExpenseItem[],
  gameId: string,
  rate: (currency: string) => number,
): number {
  let sum = 0;
  for (const e of globalExpenses) {
    const share = allocatedAmountForGame(e, gameId);
    if (share <= 0) continue;
    // Reuse the accrual helper so recurring expenses get the same
    // treatment they do in the per-game expense list.
    const factor = calculateAccumulatedAmount(
      { ...e, amount: share },
      rate(e.currency ?? "USD"),
    );
    sum += factor;
  }
  return sum;
}

/** Convenience: how many games this expense is shared across. Returns
 *  0 when the expense is studio-only. */
export function sharedCount(exp: ExpenseItem): number {
  return exp.sharedWithGameIds?.length ?? 0;
}
