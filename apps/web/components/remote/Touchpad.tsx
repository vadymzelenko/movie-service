'use client';

import { useRef } from 'react';
import type { RemoteKey } from '@movie/shared';
import type { AppSocket } from '@/lib/socket';
import { haptic } from '@/lib/use-remote';
import { cn } from '@/lib/cn';

export type PadMode = 'pointer' | 'swipe';

const TAP_MAX_MS = 220;
const TAP_MAX_PX = 8;
const SWIPE_MIN_PX = 28;
/** В режиме жестов длинное ведение пальцем = несколько шагов фокуса. */
const SWIPE_STEP_PX = 70;

/**
 * Тачпад:
 *  - «Мышь»: палец двигает курсор на TV (с ускорением), тап — клик, два пальца — прокрутка.
 *  - «Жесты»: свайп — шаг фокуса стрелкой (длинный свайп — несколько шагов), тап — OK.
 * Дельты копятся и отправляются раз в кадр (requestAnimationFrame), чтобы не забивать сокет.
 */
export function Touchpad({ socket, mode }: { socket: AppSocket | null; mode: PadMode }) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, startT: 0, moved: 0, multi: false, stepX: 0, stepY: 0 });
  const pending = useRef({ dx: 0, dy: 0, scroll: 0, raf: 0 });

  const flush = () => {
    const p = pending.current;
    p.raf = 0;
    if (!socket) return;
    if (p.dx || p.dy) socket.emit('pointer_move', { dx: clamp(p.dx), dy: clamp(p.dy) });
    if (p.scroll) socket.emit('pointer_scroll', { dy: Math.max(-2000, Math.min(2000, p.scroll)) });
    p.dx = p.dy = p.scroll = 0;
  };
  const schedule = () => {
    if (!pending.current.raf) pending.current.raf = requestAnimationFrame(flush);
  };

  const key = (k: RemoteKey) => {
    haptic();
    socket?.emit('remote_key', { key: k });
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      Object.assign(g, { startX: e.clientX, startY: e.clientY, startT: performance.now(), moved: 0, multi: false, stepX: 0, stepY: 0 });
    } else {
      g.multi = true;
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    g.moved += Math.abs(dx) + Math.abs(dy);

    if (g.multi) {
      // Два пальца — прокрутка (учитываем только один из пальцев, чтобы не удваивать).
      if (e.pointerId === pointers.current.keys().next().value) {
        pending.current.scroll += -dy * 3;
        schedule();
      }
      return;
    }

    if (mode === 'pointer') {
      // Ускорение: быстрые движения уводят курсор дальше.
      const speed = Math.hypot(dx, dy);
      const accel = 1 + Math.min(2.5, speed / 12);
      pending.current.dx += dx * accel;
      pending.current.dy += dy * accel;
      schedule();
      return;
    }

    // Жесты: длинное ведение пальцем = несколько нажатий стрелки.
    const totalX = e.clientX - g.startX;
    const totalY = e.clientY - g.startY;
    const stepsX = Math.trunc(totalX / SWIPE_STEP_PX);
    const stepsY = Math.trunc(totalY / SWIPE_STEP_PX);
    if (Math.abs(totalX) > Math.abs(totalY)) {
      while (g.stepX < stepsX) (g.stepX++, key('right'));
      while (g.stepX > stepsX) (g.stepX--, key('left'));
    } else {
      while (g.stepY < stepsY) (g.stepY++, key('down'));
      while (g.stepY > stepsY) (g.stepY--, key('up'));
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    const dt = performance.now() - g.startT;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (!g.multi && dt < TAP_MAX_MS && g.moved < TAP_MAX_PX) {
      haptic(12);
      if (mode === 'pointer') socket?.emit('pointer_click');
      else socket?.emit('remote_key', { key: 'enter' });
      return;
    }
    // Короткий быстрый свайп, не набравший ни одного шага, — всё равно один шаг.
    if (mode === 'swipe' && !g.multi && g.stepX === 0 && g.stepY === 0 && Math.max(Math.abs(dx), Math.abs(dy)) > SWIPE_MIN_PX) {
      if (Math.abs(dx) > Math.abs(dy)) key(dx > 0 ? 'right' : 'left');
      else key(dy > 0 ? 'down' : 'up');
    }
  };

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={cn(
        'relative flex h-full min-h-[18rem] touch-none select-none items-center justify-center rounded-3xl',
        'bg-gradient-to-b from-zinc-800/80 to-zinc-900 ring-1 ring-white/10',
      )}
    >
      <span className="pointer-events-none text-center text-sm text-white/30">
        {mode === 'pointer' ? 'Ведите пальцем · тап — выбрать · два пальца — прокрутка' : 'Свайп — навигация · тап — OK'}
      </span>
    </div>
  );
}

const clamp = (v: number) => Math.max(-500, Math.min(500, Math.round(v)));
