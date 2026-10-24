'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { RemoteKey } from '@movie/shared';
import type { AppSocket } from '@/lib/socket';
import { haptic } from '@/lib/use-remote';
import { cn } from '@/lib/cn';

/** Кнопка с автоповтором при удержании — как у физического пульта. */
function RepeatButton({ onPress, className, children, label }: { onPress: () => void; className?: string; children: ReactNode; label: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => clearTimeout(timer.current);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    onPress();
    const repeat = (delay: number) => {
      timer.current = setTimeout(() => {
        onPress();
        repeat(Math.max(70, delay * 0.8));
      }, delay);
    };
    repeat(380);
  };
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={cn('flex touch-none select-none items-center justify-center transition active:scale-95 active:bg-white/20', className)}
    >
      {children}
    </button>
  );
}

export function DPad({ socket }: { socket: AppSocket | null }) {
  const send = (key: RemoteKey) => {
    haptic();
    socket?.emit('remote_key', { key });
  };
  const arrow = 'absolute size-[30%] rounded-2xl text-white/80';
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[19rem] rounded-full bg-zinc-800/80 ring-1 ring-white/10">
      <RepeatButton label="Вверх" onPress={() => send('up')} className={cn(arrow, 'left-[35%] top-[3%]')}>
        <ChevronUp className="size-9" />
      </RepeatButton>
      <RepeatButton label="Вниз" onPress={() => send('down')} className={cn(arrow, 'bottom-[3%] left-[35%]')}>
        <ChevronDown className="size-9" />
      </RepeatButton>
      <RepeatButton label="Влево" onPress={() => send('left')} className={cn(arrow, 'left-[3%] top-[35%]')}>
        <ChevronLeft className="size-9" />
      </RepeatButton>
      <RepeatButton label="Вправо" onPress={() => send('right')} className={cn(arrow, 'right-[3%] top-[35%]')}>
        <ChevronRight className="size-9" />
      </RepeatButton>
      <button
        type="button"
        onClick={() => send('enter')}
        className="absolute left-[30%] top-[30%] flex size-[40%] items-center justify-center rounded-full bg-white text-lg font-bold text-black transition active:scale-95"
      >
        OK
      </button>
    </div>
  );
}
