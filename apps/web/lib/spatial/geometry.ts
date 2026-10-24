export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ORTHOGONAL_WEIGHT = 2.5;
const ALIGNED_BONUS = 0.6;

/**
 * Оценка кандидата для перехода в направлении `dir` (меньше — лучше, null — не подходит).
 *
 * Похоже на W3C CSS Spatial Navigation / алгоритм Netflix:
 *  - кандидат должен лежать «по ту сторону» текущего элемента (по центрам — устойчиво к scale-105);
 *  - основная дистанция — зазор вдоль оси движения;
 *  - смещение поперёк оси штрафуется сильнее, а перекрытие проекций даёт бонус,
 *    поэтому из ряда постеров «вниз» попадаем в постер под текущим, а не в ближайший по диагонали.
 */
export function score(from: Rect, to: Rect, dir: Direction): number | null {
  const fcx = (from.left + from.right) / 2;
  const fcy = (from.top + from.bottom) / 2;
  const tcx = (to.left + to.right) / 2;
  const tcy = (to.top + to.bottom) / 2;

  let primary: number;
  let orthoGap: number;
  let orthoCenter: number;
  const overlapX = Math.min(from.right, to.right) - Math.max(from.left, to.left);
  const overlapY = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);

  switch (dir) {
    case 'right':
      if (tcx <= fcx + 1 || to.right <= from.right - 1) return null;
      primary = Math.max(0, to.left - from.right);
      orthoGap = Math.max(0, -overlapY);
      orthoCenter = Math.abs(tcy - fcy);
      break;
    case 'left':
      if (tcx >= fcx - 1 || to.left >= from.left + 1) return null;
      primary = Math.max(0, from.left - to.right);
      orthoGap = Math.max(0, -overlapY);
      orthoCenter = Math.abs(tcy - fcy);
      break;
    case 'down':
      if (tcy <= fcy + 1 || to.bottom <= from.bottom - 1) return null;
      primary = Math.max(0, to.top - from.bottom);
      orthoGap = Math.max(0, -overlapX);
      orthoCenter = Math.abs(tcx - fcx);
      break;
    case 'up':
      if (tcy >= fcy - 1 || to.top >= from.top + 1) return null;
      primary = Math.max(0, from.top - to.bottom);
      orthoGap = Math.max(0, -overlapX);
      orthoCenter = Math.abs(tcx - fcx);
      break;
  }

  const aligned = orthoGap === 0;
  return (primary + orthoGap * ORTHOGONAL_WEIGHT) * (aligned ? ALIGNED_BONUS : 1) + orthoCenter * 0.05;
}

export function best<T>(from: Rect, candidates: { item: T; rect: Rect }[], dir: Direction): T | null {
  let winner: T | null = null;
  let winnerScore = Infinity;
  for (const c of candidates) {
    const s = score(from, c.rect, dir);
    if (s !== null && s < winnerScore) {
      winner = c.item;
      winnerScore = s;
    }
  }
  return winner;
}
