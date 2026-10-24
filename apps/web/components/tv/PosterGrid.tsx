'use client';

import type { TitleSummary } from '@movie/shared';
import { FocusSection } from '@/lib/spatial/SpatialNavigation';
import { PosterCard } from './PosterCard';

interface PosterGridProps {
  id: string;
  items: TitleSummary[];
  onOpen: (item: TitleSummary) => void;
  onNearEnd?: () => void;
  empty?: string;
}

const COLUMNS = 6;

export function PosterGrid({ id, items, onOpen, onNearEnd, empty = 'Ничего не найдено' }: PosterGridProps) {
  if (!items.length) return <p className="px-[5rem] py-16 text-[1.8rem] text-muted">{empty}</p>;
  return (
    <FocusSection id={id} remember className="px-[5rem] pb-16 pt-4">
      <div className="grid gap-x-7 gap-y-10" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 15rem)` }}>
        {items.map((item, i) => (
          <PosterCard
            key={`${item.kind}:${item.id}`}
            id={`${id}:${item.kind}:${item.id}`}
            item={item}
            onOpen={onOpen}
            // Подгружаем следующую страницу, когда фокус дошёл до последнего ряда.
            onFocus={i >= items.length - COLUMNS ? onNearEnd : undefined}
          />
        ))}
      </div>
    </FocusSection>
  );
}
