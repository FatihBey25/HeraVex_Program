// Block-level 3-way merge for note HTML (v0.9.8 — team mode).
//
// Notes are stored as one HTML string. When two teammates edit the SAME
// note over a cloud folder, last-writer-wins would silently drop one
// side's work. This does a diff3 over top-level HTML blocks (paragraphs,
// headings, lists, callouts, …) using LCS-anchored regions:
//
//   • a block changed on only one side  → take that side's version
//   • both sides made the identical edit → take it once
//   • both sides changed the same region differently → KEEP BOTH
//
// The last rule is deliberate: the #1 rule for an automatic merge is
// "never lose data". A rare same-region conflict yields a duplicated
// block the user can trivially clean up — far better than vanished work.

/** Split note HTML into an ordered list of top-level block strings whose
 *  concatenation reproduces the original exactly. */
export function splitBlocks(html: string): string[] {
  if (!html) return [];
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const out: string[] = [];
  tpl.content.childNodes.forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      out.push((n as Element).outerHTML);
    } else if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").length > 0) {
      // Re-serialise so entities stay escaped (join must reproduce innerHTML).
      const span = document.createElement("span");
      span.appendChild(n.cloneNode(true));
      out.push(span.innerHTML);
    }
  });
  return out.length ? out : [html];
}

/** LCS matched index pairs [i(in a), j(in b)] in increasing order. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function eq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Resolve one region (base/ours/theirs slices). Returns [blocks, conflicted]. */
function resolveRegion(base: string[], ours: string[], theirs: string[]): [string[], boolean] {
  if (eq(ours, base)) return [theirs, false];   // only theirs changed
  if (eq(theirs, base)) return [ours, false];   // only ours changed
  if (eq(ours, theirs)) return [ours, false];   // same change both sides
  return [[...ours, ...theirs], true];          // divergent → keep both
}

export interface MergeResult { merged: string; conflicts: number; changed: boolean }

export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { merged: ours, conflicts: 0, changed: false };
  if (ours === base)  return { merged: theirs, conflicts: 0, changed: true };  // adopt theirs
  if (theirs === base) return { merged: ours, conflicts: 0, changed: false };

  const B = splitBlocks(base), O = splitBlocks(ours), T = splitBlocks(theirs);
  const bo = new Map(lcsPairs(B, O)); // baseIdx → oursIdx
  const bt = new Map(lcsPairs(B, T)); // baseIdx → theirsIdx
  // Stable anchors: base blocks kept in BOTH sides, in order.
  const anchors: Array<[number, number, number]> = [];
  for (let bi = 0; bi < B.length; bi++) {
    if (bo.has(bi) && bt.has(bi)) anchors.push([bi, bo.get(bi)!, bt.get(bi)!]);
  }

  const merged: string[] = [];
  let conflicts = 0;
  let pb = -1, po = -1, pt = -1;
  const emitRegion = (bi: number, oi: number, ti: number) => {
    const [blocks, conflicted] = resolveRegion(
      B.slice(pb + 1, bi), O.slice(po + 1, oi), T.slice(pt + 1, ti),
    );
    merged.push(...blocks);
    if (conflicted) conflicts++;
  };
  for (const [bi, oi, ti] of anchors) {
    emitRegion(bi, oi, ti);
    merged.push(B[bi]);
    pb = bi; po = oi; pt = ti;
  }
  emitRegion(B.length, O.length, T.length); // trailing region

  return { merged: merged.join(""), conflicts, changed: true };
}
