'use client';

import { Check } from 'lucide-react';
import type { TitleSummary } from '@movie/shared';
import { useLibrary } from '@/lib/library-store';
import { useFocusable } from '@/lib/spatial/SpatialNavigation';
import { cn } from '@/lib/cn';
import { Ratings } from './Ratings';

interface PosterCardProps {
  item: TitleSummary;
  onOpen: (item: TitleSummary) => void;
  onFocus?: () => void;
  id?: string;
  className?: string;
}

/** Заглушка-постер с градиентом по id, если у тайтла нет картинки. */
function Placeholder({ item }: { item: TitleSummary }) {
  const hue = (item.id * 47) % 360;
  return (
    <div
      className="flex size-full items-end p-5"
      style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 28%), hsl(${(hue + 40) % 360} 50% 10%))` }}
    >
      <span className="text-[1.6rem] font-bold leading-tight">{item.title}</span>
    </div>
  );
}

export function PosterCard({ item, onOpen, onFocus, id, className }: PosterCardProps) {
  const { ref, focused } = useFocusable<HTMLDivElement>({ id, onEnter: () => onOpen(item), onFocus });
  const lib = useLibrary();
  const watched = lib.isWatched(item);
  const progress = lib.progressOf(item);
  const pct = progress && progress.duration > 0 && !progress.watched ? progress.position / progress.duration : 0;

  return (
    <div ref={ref} role="button" aria-label={item.title} className={cn('group relative w-[15rem] shrink-0', className)}>
      <div
        className={cn(
          'relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface transition-all duration-200 ease-tv',
          focused ? 'focus-glow z-10 scale-105' : 'scale-100',
          watched && !focused && 'opacity-60',
        )}
      >
        {item.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.posterUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <Placeholder item={item} />
        )}

        {watched && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-black/75 px-3 py-1 text-[1.05rem] font-semibold backdrop-blur">
            <Check className="size-[1.1rem]" /> Просмотрено
          </span>
        )}
        {pct > 0.01 && (
          <div className="absolute inset-x-0 bottom-0 h-[0.4rem] bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, pct * 100)}%` }} />
          </div>
        )}
      </div>
      <div className={cn('mt-3 space-y-1 transition-opacity', focused ? 'opacity-100' : 'opacity-70')}>
        <div className="truncate text-[1.35rem] font-semibold">{item.title}</div>
        <div className="flex items-center gap-2 text-[1.1rem] text-muted">
          {item.year && <span>{item.year}</span>}
          <Ratings ratings={item.ratings} size="sm" />
        </div>
      </div>
    </div>
  );
}
