'use client';

import { Eye, EyeOff, Search, X } from 'lucide-react';
import { useRef } from 'react';
import { useLibrary } from '@/lib/library-store';
import { FocusSection, useFocusable } from '@/lib/spatial/SpatialNavigation';
import { cn } from '@/lib/cn';
import { FocusButton } from './FocusButton';

export type Tab = 'home' | 'movie' | 'tv' | 'lists';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Главная' },
  { id: 'movie', label: 'Фильмы' },
  { id: 'tv', label: 'Сериалы' },
  { id: 'lists', label: 'Мои списки' },
];

interface HeaderProps {
  tab: Tab;
  onTab: (t: Tab) => void;
  query: string;
  onQuery: (q: string) => void;
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { ref, focused } = useFocusable<HTMLInputElement>({
    id: 'header:search',
    // Enter на поле открывает экранную клавиатуру TV (через нативный focus/click).
    onEnter: () => inputRef.current?.click(),
  });
  return (
    <label
      className={cn(
        'flex h-[4.2rem] w-[28rem] items-center gap-4 rounded-2xl bg-white/8 px-6 transition-all duration-200 ease-tv',
        focused && 'focus-glow bg-white/15',
      )}
    >
      <Search className="size-[1.8rem] shrink-0 text-muted" />
      <input
        ref={(el) => {
          inputRef.current = el;
          ref(el);
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск — или введите с телефона"
        className="w-full bg-transparent text-[1.5rem] placeholder:text-white/40"
        enterKeyHint="search"
      />
      {value && <X className="size-[1.6rem] shrink-0 text-muted" onClick={() => onChange('')} />}
    </label>
  );
}

export function Header({ tab, onTab, query, onQuery }: HeaderProps) {
  const lib = useLibrary();
  return (
    <FocusSection id="header" as="header" className="flex items-center gap-6 px-[5rem] pb-6 pt-10">
      <div className="mr-6 text-[2.4rem] font-black tracking-tight">
        Кино<span className="text-accent">зал</span>
      </div>
      <nav className="flex gap-2">
        {TABS.map((t) => (
          <FocusButton key={t.id} id={`tab:${t.id}`} variant="ghost" selected={tab === t.id} onEnter={() => onTab(t.id)} className={cn('px-7! py-3!', tab === t.id && !query && 'text-white! underline decoration-accent decoration-[0.25rem] underline-offset-[0.8rem]')}>
            {t.label}
          </FocusButton>
        ))}
      </nav>
      <div className="flex-1" />
      <SearchField value={query} onChange={onQuery} />
      <FocusButton id="header:hide-watched" variant="secondary" selected={lib.hideWatched} onEnter={() => lib.setHideWatched(!lib.hideWatched)} className="px-6! text-[1.3rem]!">
        {lib.hideWatched ? <EyeOff className="size-[1.6rem]" /> : <Eye className="size-[1.6rem]" />}
        {lib.hideWatched ? 'Показать просмотренные' : 'Скрыть просмотренные'}
      </FocusButton>
    </FocusSection>
  );
}
