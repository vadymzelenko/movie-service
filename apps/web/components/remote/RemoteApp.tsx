'use client';

import { ArrowLeft, Gamepad2, Home, Loader2, MousePointer2, Pause, Play, Search, Tv, Waves } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH, type RemoteKey } from '@movie/shared';
import { haptic, useRemote, type RemoteStatus } from '@/lib/use-remote';
import { cn } from '@/lib/cn';
import { DPad } from './DPad';
import { PlayerPanel } from './PlayerPanel';
import { SearchPanel } from './SearchPanel';
import { Touchpad, type PadMode } from './Touchpad';

type Panel = 'remote' | 'search' | 'player';

const STATUS_TEXT: Record<RemoteStatus, string> = {
  connecting: 'Подключение…',
  paired: 'Подключено',
  not_found: 'Комната не найдена — отсканируйте QR заново',
  tv_offline: 'Телевизор не в сети, ждём…',
  closed: 'Телевизор отключился',
  disconnected: 'Нет связи, переподключаемся…',
};

function PairScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const valid = code.length === ROOM_ID_LENGTH && [...code].every((c) => ROOM_ID_ALPHABET.includes(c));
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <Tv className="size-14 text-white/70" />
      <h1 className="text-2xl font-bold">Пульт Кинозала</h1>
      <p className="max-w-xs text-white/60">Отсканируйте камерой QR-код в углу экрана телевизора или введите код комнаты.</p>
      <form
        className="flex w-full max-w-xs gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) router.replace(`/remote?room=${code}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s/g, '').slice(0, ROOM_ID_LENGTH))}
          placeholder="код"
          className="w-full rounded-2xl bg-white/10 px-4 py-3 text-center font-mono text-xl tracking-[0.3em] outline-none"
          autoCapitalize="off"
          autoComplete="off"
        />
        <button type="submit" disabled={!valid} className="rounded-2xl bg-accent px-5 font-semibold disabled:opacity-40">
          OK
        </button>
      </form>
    </main>
  );
}

export function RemoteApp() {
  const room = useSearchParams().get('room');
  if (!room) return <PairScreen />;
  return <Remote roomId={room} />;
}

function Remote({ roomId }: { roomId: string }) {
  const { socket, status, tvState } = useRemote(roomId);
  const [panel, setPanel] = useState<Panel>('remote');
  const [padMode, setPadMode] = useState<PadMode>('swipe');
  const [useTouchpad, setUseTouchpad] = useState(true);

  // Запустили фильм на TV — сразу показываем управление плеером.
  const playing = tvState?.screen === 'player';
  useEffect(() => {
    if (playing) setPanel('player');
  }, [playing]);

  const key = (k: RemoteKey) => {
    haptic();
    socket?.emit('remote_key', { key: k });
  };

  return (
    <main className="flex h-dvh flex-col bg-bg text-white">
      <header className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn('size-2.5 rounded-full', status === 'paired' ? 'bg-emerald-400' : status === 'connecting' || status === 'disconnected' || status === 'tv_offline' ? 'animate-pulse bg-amber-400' : 'bg-rose-500')} />
          <span className="text-white/70">{STATUS_TEXT[status]}</span>
        </div>
        <span className="font-mono text-xs tracking-widest text-white/40">{roomId}</span>
      </header>

      {status === 'connecting' ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-10 animate-spin text-white/50" />
        </div>
      ) : panel === 'search' ? (
        <SearchPanel socket={socket} tvQuery={tvState?.searchQuery ?? ''} />
      ) : panel === 'player' ? (
        <PlayerPanel socket={socket} state={tvState?.player ?? null} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => setUseTouchpad(false)} className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm', !useTouchpad ? 'bg-white text-black' : 'bg-white/10')}>
              <Gamepad2 className="size-4" /> Кнопки
            </button>
            <button type="button" onClick={() => (setUseTouchpad(true), setPadMode('swipe'))} className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm', useTouchpad && padMode === 'swipe' ? 'bg-white text-black' : 'bg-white/10')}>
              <Waves className="size-4" /> Жесты
            </button>
            <button type="button" onClick={() => (setUseTouchpad(true), setPadMode('pointer'))} className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm', useTouchpad && padMode === 'pointer' ? 'bg-white text-black' : 'bg-white/10')}>
              <MousePointer2 className="size-4" /> Мышь
            </button>
          </div>

          <div className="min-h-0 flex-1">{useTouchpad ? <Touchpad socket={socket} mode={padMode} /> : <div className="flex h-full items-center"><DPad socket={socket} /></div>}</div>

          <div className="grid grid-cols-3 gap-3">
            <button type="button" onClick={() => key('back')} className="flex flex-col items-center gap-1 rounded-2xl bg-white/10 py-3 text-xs active:scale-95">
              <ArrowLeft className="size-6" /> Назад
            </button>
            <button type="button" onClick={() => key('play_pause')} className="flex flex-col items-center gap-1 rounded-2xl bg-white/10 py-3 text-xs active:scale-95">
              <span className="flex">
                <Play className="size-5 fill-current" />
                <Pause className="size-5 fill-current" />
              </span>
              Пауза
            </button>
            <button type="button" onClick={() => key('home')} className="flex flex-col items-center gap-1 rounded-2xl bg-white/10 py-3 text-xs active:scale-95">
              <Home className="size-6" /> Домой
            </button>
          </div>
        </div>
      )}

      <nav className="grid grid-cols-3 border-t border-white/10 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        {(
          [
            ['remote', Gamepad2, 'Пульт'],
            ['search', Search, 'Поиск'],
            ['player', Play, 'Плеер'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button key={id} type="button" onClick={() => setPanel(id)} className={cn('flex flex-col items-center gap-1 py-1 text-xs', panel === id ? 'text-white' : 'text-white/40')}>
            <Icon className="size-6" />
            {label}
          </button>
        ))}
      </nav>
    </main>
  );
}
