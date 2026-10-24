import type { PlayerControl } from '@movie/shared';

type Listener = (cmd: PlayerControl) => void;

/** Команды плееру с телефона. Плеер подписывается, пока смонтирован. */
class PlayerBus {
  private listeners = new Set<Listener>();
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit(cmd: PlayerControl) {
    for (const fn of this.listeners) fn(cmd);
  }
}

export const playerBus = new PlayerBus();
