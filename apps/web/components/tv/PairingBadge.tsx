'use client';

import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, WifiOff } from 'lucide-react';
import type { TvRoom } from '@/lib/use-tv-room';

/** QR-код сопряжения в углу экрана. Сканируется камерой телефона без приложений. */
export function PairingBadge({ room }: { room: TvRoom }) {
  if (!room.connected) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-red-500/15 px-5 py-3 text-[1.2rem] text-red-200">
        <WifiOff className="size-[1.6rem]" /> Нет связи с сервером
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-zinc-900/90 p-3 pr-5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
      <div className="rounded-xl bg-white p-2">
        {room.remoteUrl ? <QRCodeSVG value={room.remoteUrl} size={88} level="M" /> : <div className="size-[88px]" />}
      </div>
      <div className="space-y-1 text-[1.15rem]">
        <div className="flex items-center gap-2 font-semibold">
          <Smartphone className="size-[1.4rem]" />
          {room.peers.length ? `Пульт: ${room.peers.map((p) => p.deviceName).join(', ')}` : 'Пульт на телефоне'}
        </div>
        <div className="text-muted">Код комнаты</div>
        <div className="font-mono text-[1.5rem] tracking-[0.3em]">{room.roomId ?? '········'}</div>
      </div>
    </div>
  );
}
