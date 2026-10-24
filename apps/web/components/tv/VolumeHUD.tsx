'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

/** Минималистичный индикатор громкости в правом верхнем углу; когда скрывать, решает плеер. */
export function VolumeHUD({ visible, volume, muted }: { visible: boolean; volume: number; muted: boolean }) {
  const level = muted ? 0 : Math.round(volume * 100);
  const Icon = level === 0 ? VolumeX : level < 50 ? Volume1 : Volume2;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.18 }}
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-[4rem] top-[4rem] z-30 flex items-center gap-5 rounded-2xl bg-black/70 px-6 py-4 backdrop-blur-md"
        >
          <Icon className="size-[2.4rem] shrink-0" />
          <div className="h-[0.6rem] w-[18rem] overflow-hidden rounded-full bg-white/20">
            <motion.div className="h-full rounded-full bg-white" animate={{ width: `${level}%` }} transition={{ duration: 0.12 }} />
          </div>
          <span className="w-[4.5rem] text-right font-mono text-[1.6rem] tabular-nums">{level}%</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
