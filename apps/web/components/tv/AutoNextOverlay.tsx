'use client';

import { motion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FocusSection, useBackHandler, useKeyHandler } from '@/lib/spatial/SpatialNavigation';
import { FocusButton } from './FocusButton';

export interface NextEpisodeInfo {
  title: string;
  subtitle: string;
  stillUrl?: string;
}

interface AutoNextOverlayProps {
  next: NextEpisodeInfo;
  seconds?: number;
  onPlay: () => void;
  onCancel: () => void;
}

const RING = 2 * Math.PI * 46;

/**
 * Оверлей «Следующая серия» после `ended`: обратный отсчёт, по нулю — автозапуск.
 * Enter — «Смотреть сейчас» (фокус по умолчанию), Back/Escape — «Отмена».
 */
export function AutoNextOverlay({ next, seconds = 8, onPlay, onCancel }: AutoNextOverlayProps) {
  const [left, setLeft] = useState(seconds);
  const fired = useRef(false);

  const fire = () => {
    if (fired.current) return;
    fired.current = true;
    onPlay();
  };

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        clearInterval(t);
        fire();
      }
    }, 200);
    return () => clearInterval(t);
    // Таймер запускается один раз на показ оверлея.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBackHandler(onCancel);
  // Пауза/Play на пульте тоже запускает сразу — привычное поведение на ТВ.
  useKeyHandler((key) => (key === 'play_pause' ? (fire(), true) : false));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-40 flex items-end bg-black/50 p-[5rem] backdrop-blur-xl"
    >
      <FocusSection id="player:autonext" trap className="flex w-full items-end gap-10">
        <div className="relative aspect-video w-[40rem] shrink-0 overflow-hidden rounded-3xl bg-surface-2 shadow-2xl">
          {next.stillUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={next.stillUrl} alt="" className="size-full object-cover" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <svg viewBox="0 0 100 100" className="size-[10rem] -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="5" />
              <motion.circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="white"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={RING}
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: RING }}
                transition={{ duration: seconds, ease: 'linear' }}
              />
            </svg>
            <span className="absolute font-mono text-[4rem] font-bold tabular-nums">{left}</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6 pb-2">
          <div className="text-[1.5rem] uppercase tracking-widest text-white/60">Следующая серия · через {left} с</div>
          <div>
            <div className="text-[3.2rem] font-bold leading-tight">{next.title}</div>
            <div className="text-[1.8rem] text-white/75">{next.subtitle}</div>
          </div>
          <div className="flex gap-4">
            <FocusButton id="autonext:play" variant="primary" autoFocus onEnter={fire}>
              <Play className="size-[2rem] fill-current" /> Смотреть сейчас
            </FocusButton>
            <FocusButton id="autonext:cancel" onEnter={onCancel}>
              <X className="size-[2rem]" /> Отмена
            </FocusButton>
          </div>
        </div>
      </FocusSection>
    </motion.div>
  );
}
