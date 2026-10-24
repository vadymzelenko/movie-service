'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Info, Play } from 'lucide-react';
import type { TitleSummary } from '@movie/shared';
import { useEffect } from 'react';
import { FocusSection, useSpatialEngine } from '@/lib/spatial/SpatialNavigation';
import { FocusButton } from './FocusButton';
import { Ratings } from './Ratings';

export function Hero({ item, onOpen, onPlay }: { item: TitleSummary | undefined; onOpen: (t: TitleSummary) => void; onPlay: (t: TitleSummary) => void }) {
  const engine = useSpatialEngine();
  const ready = !!item;
  // Стартовый фокус на «Смотреть», если пользователь ещё никуда не перешёл.
  useEffect(() => {
    if (ready && !engine.getFocusedId()) requestAnimationFrame(() => engine.focus('hero:play'));
  }, [ready, engine]);
  if (!item) return <div className="h-[34rem]" />;
  return (
    <section className="relative h-[34rem] overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-0"
        >
          {item.backdropUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.backdropUrl} alt="" className="size-full object-cover object-top" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
        </motion.div>
      </AnimatePresence>
      <FocusSection id="hero" className="relative flex h-full max-w-[60rem] flex-col justify-end gap-5 px-[5rem] pb-10">
        <h1 className="text-[4.2rem] font-black leading-none tracking-tight">{item.title}</h1>
        <div className="flex items-center gap-4 text-[1.4rem] text-white/80">
          {item.year && <span>{item.year}</span>}
          <Ratings ratings={item.ratings} />
        </div>
        {item.overview && <p className="line-clamp-3 text-[1.45rem] leading-relaxed text-white/80">{item.overview}</p>}
        <div className="flex gap-4 pt-2">
          <FocusButton id="hero:play" variant="primary" onEnter={() => onPlay(item)}>
            <Play className="size-[1.8rem] fill-current" /> Смотреть
          </FocusButton>
          <FocusButton id="hero:info" onEnter={() => onOpen(item)}>
            <Info className="size-[1.8rem]" /> Подробнее
          </FocusButton>
        </div>
      </FocusSection>
    </section>
  );
}
