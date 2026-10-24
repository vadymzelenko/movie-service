'use client';

import { useEffect, useRef, useState } from 'react';
import type { TvState } from '@movie/shared';
import { createSocket, type AppSocket } from './socket';

export type RemoteStatus = 'connecting' | 'paired' | 'not_found' | 'tv_offline' | 'closed' | 'disconnected';

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const android = /Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/.exec(ua)?.[1];
  if (android) return android.trim().slice(0, 40);
  return /Android/.test(ua) ? 'Android' : 'Браузер';
}

/** Подключение пульта к комнате TV; автоматически переподключается после обрыва Wi-Fi. */
export function useRemote(roomId: string | null) {
  const [status, setStatus] = useState<RemoteStatus>('connecting');
  const [tvState, setTvState] = useState<TvState | null>(null);
  const socketRef = useRef<AppSocket | null>(null);
  const [socket, setSocket] = useState<AppSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const s = createSocket();
    socketRef.current = s;
    setSocket(s);
    setStatus('connecting');

    const pair = () =>
      s.emit('pair', { roomId, deviceName: deviceName() }, (res) => {
        if (!res.ok) return setStatus(res.error === 'room_not_found' ? 'not_found' : 'disconnected');
        setStatus('paired');
        if (res.tvState) setTvState(res.tvState);
      });

    s.on('connect', pair);
    s.on('disconnect', () => setStatus('disconnected'));
    s.on('tv_state', setTvState);
    s.on('room:tv_presence', ({ online }) => setStatus(online ? 'paired' : 'tv_offline'));
    s.on('room:closed', () => setStatus('closed'));

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  return { socket, status, tvState };
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* нет вибромотора */
  }
}
