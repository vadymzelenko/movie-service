'use client';

import { Pause, Play, RotateCcw, RotateCw, Square, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatTime, type PlayerControl, type PlayerState } from '@movie/shared';
import type { AppSocket } from '@/lib/socket';
import { haptic } from '@/lib/use-remote';

export function PlayerPanel({ socket, state }: { socket: AppSocket | null; state: PlayerState | null }) {
  const send = (cmd: PlayerControl) => {
    haptic();
    socket?.emit('player_control', cmd);
  };
  // Пока палец на слайдере — показываем локальное значение, а не «прыгающее» с TV.
  const [scrub, setScrub] = useState<number | null>(null);
  const [vol, setVol] = useState<number | null>(null);
  useEffect(() => {
    if (scrub === null) return;
    const t = setTimeout(() => setScrub(null), 4000);
    return () => clearTimeout(t);
  }, [scrub]);

  if (!state) {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-white/40">На телевизоре сейчас ничего не воспроизводится</div>;
  }

  const time = scrub ?? state.currentTime;
  const volume = vol ?? state.volume;
  const VolIcon = state.muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex flex-1 flex-col gap-8 p-5">
      <div>
        <div className="text-xl font-bold leading-tight">{state.title}</div>
        {state.subtitle && <div className="text-sm text-white/60">{state.subtitle}</div>}
      </div>

      <div className="space-y-2">
        <input
          type="range"
          className="remote-range w-full"
          min={0}
          max={Math.max(1, state.duration)}
          step={1}
          value={Math.min(time, state.duration)}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => scrub !== null && (send({ type: 'seek_absolute', seconds: scrub }), setTimeout(() => setScrub(null), 1200))}
          onKeyUp={() => scrub !== null && send({ type: 'seek_absolute', seconds: scrub })}
          aria-label="Таймлайн"
        />
        <div className="flex justify-between font-mono text-sm text-white/60">
          <span>{formatTime(time)}</span>
          <span>{formatTime(state.duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button type="button" aria-label="Назад 10 секунд" onClick={() => send({ type: 'seek_relative', seconds: -10 })} className="rounded-full bg-white/10 p-4 active:scale-95">
          <RotateCcw className="size-7" />
        </button>
        <button type="button" aria-label={state.paused ? 'Играть' : 'Пауза'} onClick={() => send({ type: 'toggle' })} className="rounded-full bg-white p-6 text-black active:scale-95">
          {state.paused ? <Play className="size-9 fill-current" /> : <Pause className="size-9 fill-current" />}
        </button>
        <button type="button" aria-label="Вперёд 10 секунд" onClick={() => send({ type: 'seek_relative', seconds: 10 })} className="rounded-full bg-white/10 p-4 active:scale-95">
          <RotateCw className="size-7" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button type="button" aria-label="Звук" onClick={() => send({ type: 'mute', muted: !state.muted })} className="rounded-full bg-white/10 p-3">
          <VolIcon className="size-6" />
        </button>
        <input
          type="range"
          className="remote-range flex-1"
          min={0}
          max={1}
          step={0.05}
          value={state.muted ? 0 : volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVol(v);
            socket?.emit('player_control', { type: 'volume', value: v });
          }}
          onPointerUp={() => setTimeout(() => setVol(null), 1500)}
          aria-label="Громкость"
        />
      </div>

      <button type="button" onClick={() => send({ type: 'stop' })} className="mx-auto flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm active:scale-95">
        <Square className="size-4 fill-current" /> Остановить
      </button>
    </div>
  );
}
