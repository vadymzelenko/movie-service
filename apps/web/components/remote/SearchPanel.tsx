'use client';

import { Info, Search, Tv, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TitleSummary } from '@movie/shared';
import { api } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { haptic } from '@/lib/use-remote';

/**
 * Поиск с телефона: каждый символ мгновенно дублируется в поисковую строку TV,
 * а результаты показываются и здесь — с кнопкой «Смотреть на ТВ» (cast).
 */
export function SearchPanel({ socket, tvQuery }: { socket: AppSocket | null; tvQuery: string }) {
  const [value, setValue] = useState(tvQuery);
  const [results, setResults] = useState<TitleSummary[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) return setResults([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void api
        .search(q, ctrl.signal)
        .then((r) => setResults(r.results.slice(0, 20)))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  const update = (v: string, submit = false) => {
    setValue(v);
    socket?.emit('text_input', { value: v, submit });
  };

  const cast = (t: TitleSummary, autoplay: boolean) => {
    haptic(20);
    socket?.emit('cast_media', { media: { kind: t.kind, id: t.id }, autoplay });
    setSent(`${t.kind}:${t.id}`);
    setTimeout(() => setSent(null), 1500);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <form
        className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          update(value, true);
          inputRef.current?.blur();
        }}
      >
        <Search className="size-5 text-white/50" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => update(e.target.value)}
          placeholder="Фильм, сериал, актёр…"
          className="w-full bg-transparent text-base outline-none placeholder:text-white/40"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
        />
        {value && (
          <button type="button" aria-label="Очистить" onClick={() => update('')}>
            <X className="size-5 text-white/50" />
          </button>
        )}
      </form>

      <ul className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1">
        {results.map((t) => (
          <li key={`${t.kind}:${t.id}`} className="flex items-center gap-3 rounded-2xl bg-white/5 p-2">
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-white/10">
              {t.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.posterUrl.replace('/w500/', '/w185/')} alt="" className="size-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{t.title}</div>
              <div className="text-xs text-white/50">
                {t.kind === 'tv' ? 'Сериал' : 'Фильм'}
                {t.year ? ` · ${t.year}` : ''}
                {t.ratings.imdb ? ` · IMDb ${t.ratings.imdb}` : t.ratings.tmdb ? ` · ${t.ratings.tmdb}` : ''}
              </div>
            </div>
            <button type="button" aria-label="Открыть на ТВ" onClick={() => cast(t, false)} className="rounded-full bg-white/10 p-3 active:scale-95">
              <Info className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => cast(t, true)}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2.5 text-sm font-semibold active:scale-95"
            >
              <Tv className="size-4" />
              {sent === `${t.kind}:${t.id}` ? 'Отправлено' : 'На ТВ'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
