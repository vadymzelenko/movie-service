'use client';

import { useEffect, useRef } from 'react';
import { FOCUS_ATTR } from '@/lib/spatial/engine';
import { useSpatialEngine } from '@/lib/spatial/SpatialNavigation';
import type { AppSocket } from '@/lib/socket';

const HIDE_AFTER_MS = 3000;

function scrollableParent(el: Element | null): HTMLElement | null {
  for (let p = el as HTMLElement | null; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (/(auto|scroll)/.test(oy) && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Курсор, которым управляет тачпад телефона. Наведение фокусирует элемент
 * (тот же движок, что и стрелки), тап — «Enter», два пальца — прокрутка.
 */
export function VirtualCursor({ socket }: { socket: AppSocket | null }) {
  const engine = useSpatialEngine();
  const dotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!socket) return;
    const pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;

    const show = () => {
      const dot = dotRef.current;
      if (!dot) return;
      dot.style.opacity = '1';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => (dot.style.opacity = '0'), HIDE_AFTER_MS);
    };
    const render = () => {
      raf = 0;
      if (dotRef.current) dotRef.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      const target = document.elementFromPoint(pos.x, pos.y)?.closest<HTMLElement>(`[${FOCUS_ATTR}]`);
      const id = target?.getAttribute(FOCUS_ATTR);
      if (id) engine.focus(id, { scroll: false });
    };

    const onMove = ({ dx, dy }: { dx: number; dy: number }) => {
      // Дельты с телефона — в пикселях телефона; экран TV крупнее, масштабируем.
      const k = window.innerWidth / 1000;
      pos.x = Math.max(0, Math.min(window.innerWidth - 1, pos.x + dx * k));
      pos.y = Math.max(0, Math.min(window.innerHeight - 1, pos.y + dy * k));
      show();
      if (!raf) raf = requestAnimationFrame(render);
    };
    const onClick = () => {
      show();
      const el = document.elementFromPoint(pos.x, pos.y);
      const target = el?.closest<HTMLElement>(`[${FOCUS_ATTR}]`);
      const id = target?.getAttribute(FOCUS_ATTR);
      if (id && engine.focus(id, { scroll: false })) engine.enter();
      else (el as HTMLElement | null)?.click();
    };
    const onScroll = ({ dy }: { dy: number }) => {
      show();
      const box = scrollableParent(document.elementFromPoint(pos.x, pos.y));
      (box ?? window).scrollBy({ top: dy * 2 });
    };

    socket.on('pointer_move', onMove);
    socket.on('pointer_click', onClick);
    socket.on('pointer_scroll', onScroll);
    return () => {
      socket.off('pointer_move', onMove);
      socket.off('pointer_click', onClick);
      socket.off('pointer_scroll', onScroll);
      clearTimeout(hideTimer);
      cancelAnimationFrame(raf);
    };
  }, [socket, engine]);

  return (
    <div
      ref={dotRef}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100] opacity-0 transition-opacity duration-300"
      style={{ transform: 'translate3d(50vw, 50vh, 0)' }}
    >
      <div className="-ml-[1.2rem] -mt-[1.2rem] size-[2.4rem] rounded-full border-[0.25rem] border-white bg-white/30 shadow-[0_0_1.5rem_rgba(0,0,0,0.6)]" />
    </div>
  );
}
