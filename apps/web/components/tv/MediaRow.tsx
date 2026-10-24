'use client';

import type { TitleSummary } from '@movie/shared';
import { FocusSection } from '@/lib/spatial/SpatialNavigation';
import { PosterCard } from './PosterCard';

interface MediaRowProps {
  id: string;
  title: string;
  items: TitleSummary[];
  onOpen: (item: TitleSummary) => void;
  /** Фокус дошёл до конца ряда — можно подгрузить ещё. */
  onNearEnd?: () => void;
}

/** Горизонтальный ряд постеров. Секция помнит последний фокус — как ряды Netflix/Apple TV. */
export function MediaRow({ id, title, items, onOpen, onNearEnd }: MediaRowProps) {
  if (!items.length) return null;
  return (
    <FocusSection id={id} remember as="section" className="space-y-4">
      <h2 className="px-[5rem] text-[2rem] font-bold tracking-tight">{title}</h2>
      <div className="no-scrollbar flex gap-7 overflow-x-auto px-[5rem] pb-8 pt-4">
        {items.map((item, i) => (
          <PosterCard
            key={`${item.kind}:${item.id}`}
            id={`${id}:${item.kind}:${item.id}`}
            item={item}
            onOpen={onOpen}
            onFocus={i >= items.length - 4 ? onNearEnd : undefined}
          />
        ))}
      </div>
    </FocusSection>
  );
}
