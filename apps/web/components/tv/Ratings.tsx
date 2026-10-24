import type { Ratings as R } from '@movie/shared';
import { cn } from '@/lib/cn';

export function Ratings({ ratings, size = 'md' }: { ratings: R; size?: 'sm' | 'md' }) {
  const items = [
    ratings.imdb ? { label: 'IMDb', value: ratings.imdb, cls: 'bg-imdb text-black' } : null,
    ratings.kinopoisk ? { label: 'КП', value: ratings.kinopoisk, cls: 'bg-kp text-white' } : null,
    !ratings.imdb && !ratings.kinopoisk && ratings.tmdb ? { label: 'TMDB', value: ratings.tmdb, cls: 'bg-sky-600 text-white' } : null,
  ].filter((x) => x !== null);
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-2">
      {items.map((r) => (
        <span
          key={r.label}
          className={cn('inline-flex items-center gap-1.5 rounded-lg font-bold', r.cls, size === 'sm' ? 'px-2 py-0.5 text-[1rem]' : 'px-3 py-1 text-[1.4rem]')}
        >
          {r.label} {r.value.toFixed(1)}
        </span>
      ))}
    </div>
  );
}
