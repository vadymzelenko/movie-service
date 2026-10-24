'use client';

import type { ReactNode } from 'react';
import { useFocusable } from '@/lib/spatial/SpatialNavigation';
import { cn } from '@/lib/cn';

interface FocusButtonProps {
  children: ReactNode;
  onEnter?: () => void;
  onFocus?: () => void;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'chip';
  /** Для chip: выбранное значение (озвучка, качество, сезон…). */
  selected?: boolean;
  className?: string;
  ariaLabel?: string;
}

const variants = {
  primary: 'bg-white text-black',
  secondary: 'bg-white/10 text-white',
  ghost: 'bg-transparent text-white/80',
  chip: 'bg-white/8 text-white/85',
};

/** Кнопка 10-foot UI: крупная, с хорошо заметным фокусом. */
export function FocusButton({ children, onEnter, onFocus, id, autoFocus, disabled, variant = 'secondary', selected, className, ariaLabel }: FocusButtonProps) {
  const { ref, focused } = useFocusable<HTMLButtonElement>({ id, onEnter, onFocus, autoFocus, disabled });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-3 font-semibold transition-all duration-200 ease-tv',
        variant === 'chip' ? 'rounded-full px-6 py-3 text-[1.35rem]' : 'rounded-2xl px-9 py-4 text-[1.6rem]',
        // Цвета взаимоисключающие: в Tailwind v4 порядок классов в строке не решает конфликт.
        selected && variant === 'chip'
          ? 'bg-white/90 text-black'
          : focused && variant !== 'primary'
            ? 'bg-white/25 text-white'
            : variants[variant],
        focused && 'focus-glow scale-105',
        disabled && 'opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}
