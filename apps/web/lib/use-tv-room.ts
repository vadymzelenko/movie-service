'use client';

import { useEffect, useState } from 'react';
import type { PeerInfo } from '@movie/shared';
import { api } from './api';
import { createSocket, type AppSocket } from './socket';

const STORAGE_KEY = 'tv-room';

export interface TvRoom {
  socket: AppSocket | null;
  roomId: string | null;
  /** Ссылка для QR-кода. */
  remoteUrl: string | null;
  peers: PeerInfo[];
  connected: boolean;
}

/** Если TV открыт по localhost, телефон туда не достучится — подставляем LAN-IP сервера. */
async function publicOrigin(): Promise<string> {
  const { protocol, hostname, port } = window.location;
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return window.location.origin;
  const { addresses } = await api.network().catch(() => ({ addresses: [] as string[] }));
  const ip = addresses.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) ?? addresses[0];
  return ip ? `${protocol}//${ip}${port ? `:${port}` : ''}` : window.location.origin;
}

/**
 * Комната сопряжения TV. Переживает перезагрузку страницы и обрывы сети:
 * room_id + секретный tvToken лежат в sessionStorage и используются для `room:resume`,
 * поэтому уже подключённым телефонам не нужно сканировать QR заново.
 */
export function useTvRoom(): TvRoom {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = createSocket();
    setSocket(s);

    const createRoom = () =>
      s.emit('room:create', (res) => {
        if (!res.ok) return;
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId: res.roomId, tvToken: res.tvToken }));
        } catch {
          /* приватный режим — просто не переживём перезагрузку */
        }
        setRoomId(res.roomId);
        setPeers([]);
      });

    const joinOrCreate = () => {
      let saved: { roomId: string; tvToken: string } | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
      } catch {
        saved = null;
      }
      if (!saved) return createRoom();
      s.emit('room:resume', saved, (res) => {
        if (res.ok) setRoomId(res.roomId);
        else createRoom();
      });
    };

    s.on('connect', () => {
      setConnected(true);
      joinOrCreate();
    });
    s.on('disconnect', () => setConnected(false));
    s.on('room:peers', setPeers);

    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void publicOrigin().then((origin) => {
      if (!cancelled) setRemoteUrl(`${origin}/remote?room=${roomId}`);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return { socket, roomId, remoteUrl, peers, connected };
}
