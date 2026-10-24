'use client';

import Hls, { type Level, type MediaPlaylist } from 'hls.js';
import { AnimatePresence, motion } from 'framer-motion';
import { Languages, Loader2, Pause, Play, RotateCcw, RotateCw, Settings2, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, type MediaRef, type PlayerControl, type PlayerState, type StreamSource } from '@movie/shared';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/config';
import { playerBus } from '@/lib/player-bus';
import { FocusSection, useBackHandler, useFocusable, useKeyHandler, useSpatialEngine } from '@/lib/spatial/SpatialNavigation';
import { cn } from '@/lib/cn';
import { FocusButton } from './FocusButton';

export interface PlayerProps {
  media: MediaRef;
  title: string;
  subtitle?: string;
  sources: StreamSource[];
  sourceId: string;
  /** Для MP4 — метка качества; для HLS — потолок качества (ABR не поднимется выше). */
  qualityLabel: string;
  startAt: number;
  onClose: () => void;
  onNext?: () => void;
  onState?: (state: PlayerState) => void;
}

const HIDE_CONTROLS_MS = 4000;
const SAVE_EVERY_MS = 10_000;
const PROGRESS_ID = 'player:progress';

const heightFromLabel = (label: string) => Number(/(\d{3,4})/.exec(label)?.[1] ?? 0) || undefined;

interface MenuItem {
  key: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}

function ProgressBar({ current, duration, buffered, preview }: { current: number; duration: number; buffered: number; preview: number | null }) {
  const { ref, focused } = useFocusable<HTMLDivElement>({ id: PROGRESS_ID });
  const shown = preview ?? current;
  const pct = duration > 0 ? (shown / duration) * 100 : 0;
  return (
    <div ref={ref} className="group relative py-4">
      <div className={cn('relative h-[0.5rem] rounded-full bg-white/25 transition-all duration-200', focused && 'h-[0.8rem]')}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
        <div
          className={cn('absolute top-1/2 size-[1.6rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg transition-transform', focused ? 'scale-125' : 'scale-0')}
          style={{ left: `${pct}%` }}
        />
        {preview !== null && (
          <div className="absolute -top-[4rem] -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1 font-mono text-[1.4rem]" style={{ left: `${pct}%` }}>
            {formatTime(preview)}
          </div>
        )}
      </div>
    </div>
  );
}

function Menu({ title, items, onClose }: { title: string; items: MenuItem[]; onClose: () => void }) {
  useBackHandler(onClose);
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      className="absolute bottom-[12rem] right-[5rem] z-20 w-[28rem] rounded-3xl bg-zinc-900/95 p-4 shadow-2xl backdrop-blur"
    >
      <FocusSection id="player:menu" trap>
        <div className="px-4 pb-3 pt-2 text-[1.3rem] uppercase tracking-wider text-muted">{title}</div>
        <div className="flex max-h-[40rem] flex-col gap-2 overflow-y-auto">
          {items.map((it) => (
            <FocusButton
              key={it.key}
              variant="ghost"
              selected={it.selected}
              onEnter={() => {
                it.onSelect();
                onClose();
              }}
              className={cn('justify-start px-6! py-3! text-[1.45rem]!', it.selected && 'text-accent-soft!')}
            >
              {it.selected ? '● ' : ''}
              {it.label}
            </FocusButton>
          ))}
        </div>
      </FocusSection>
    </motion.div>
  );
}

export function Player({ media, title, subtitle, sources, sourceId, qualityLabel, startAt, onClose, onNext, onState }: PlayerProps) {
  const engine = useSpatialEngine();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [activeSourceId, setActiveSourceId] = useState(sourceId);
  const [activeQuality, setActiveQuality] = useState(qualityLabel);
  const source = sources.find((s) => s.id === activeSourceId) ?? sources[0];
  const quality = source?.qualities.find((q) => q.label === activeQuality) ?? source?.qualities[0];

  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<MediaPlaylist[]>([]);
  const [audioTrack, setAudioTrack] = useState(-1);

  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<'voice' | 'quality' | null>(null);
  const menuOpen = useRef(false);
  menuOpen.current = menu !== null;
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Позиция, с которой стартуем после смены источника/качества. */
  const resumeAt = useRef(startAt);

  // ---- Видео-движок ---------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || !quality) return;
    const url = apiUrl(quality.url);
    setError(null);
    setBuffering(true);
    setLevels([]);
    setAudioTracks([]);

    const seekToResume = () => {
      const at = resumeAt.current;
      if (at > 5 && (!video.duration || at < video.duration * 0.97)) video.currentTime = at;
      void video.play().catch(() => setPaused(true));
    };

    if (source.type === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // У телевизоров мало памяти — держим буфер скромным.
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
        startPosition: resumeAt.current > 5 ? resumeAt.current : -1,
        capLevelToPlayerSize: true,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setLevels(data.levels);
        const cap = heightFromLabel(qualityLabel);
        if (cap) {
          // «Не выше выбранного качества»: ABR работает только в этом диапазоне.
          const allowed = data.levels.map((l, i) => ({ h: l.height, i })).filter((l) => l.h <= cap);
          if (allowed.length) hls.autoLevelCapping = allowed.reduce((a, b) => (b.h > a.h ? b : a)).i;
        }
        void video.play().catch(() => setPaused(true));
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => setLevel(hls.autoLevelEnabled ? -1 : hls.currentLevel));
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
        setAudioTracks(data.audioTracks);
        setAudioTrack(hls.audioTrack);
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => setAudioTrack(data.id));
      let mediaRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 2) hls.recoverMediaError();
        else setError('Не удалось воспроизвести поток. Попробуйте другую озвучку или качество.');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // Нативный HLS (Safari/tvOS/часть Tizen) или MP4.
    video.src = url;
    video.addEventListener('loadedmetadata', seekToResume, { once: true });
    return () => {
      video.removeEventListener('loadedmetadata', seekToResume);
      video.removeAttribute('src');
      video.load();
    };
  }, [source, quality, qualityLabel]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrent(v.currentTime);
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const handlers: [keyof HTMLVideoElementEventMap, () => void][] = [
      ['timeupdate', onTime],
      ['durationchange', () => setDuration(Number.isFinite(v.duration) ? v.duration : 0)],
      ['play', () => (setPaused(false), setEnded(false))],
      ['pause', () => setPaused(true)],
      ['waiting', () => setBuffering(true)],
      ['playing', () => setBuffering(false)],
      ['canplay', () => setBuffering(false)],
      ['volumechange', () => (setVolume(v.volume), setMuted(v.muted))],
      ['ended', () => setEnded(true)],
    ];
    for (const [ev, fn] of handlers) v.addEventListener(ev, fn);
    return () => {
      for (const [ev, fn] of handlers) v.removeEventListener(ev, fn);
    };
  }, []);

  // ---- Сохранение таймкода --------------------------------------------------

  useEffect(() => {
    // Элемент захватываем в замыкание: при размонтировании videoRef.current уже null.
    const v = videoRef.current;
    if (!v) return;
    const snapshot = () =>
      Number.isFinite(v.duration) && v.duration > 0 ? { position: v.ended ? v.duration : v.currentTime, duration: v.duration } : null;
    const save = () => {
      const s = snapshot();
      if (s && s.position > 0) void api.saveProgress(media, s).catch(() => {});
    };
    const timer = setInterval(() => {
      if (!v.paused) save();
    }, SAVE_EVERY_MS);
    const onHide = () => {
      const s = snapshot();
      if (document.visibilityState === 'hidden' && s) api.beaconProgress(media, s);
    };
    v.addEventListener('pause', save);
    v.addEventListener('ended', save);
    v.addEventListener('seeked', save);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      v.removeEventListener('pause', save);
      v.removeEventListener('ended', save);
      v.removeEventListener('seeked', save);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      // Выход из плеера — финальная запись (beacon переживёт и закрытие вкладки).
      const s = snapshot();
      if (s && s.position > 0) api.beaconProgress(media, s);
    };
  }, [media]);

  // ---- Публикация состояния для пульта ---------------------------------------

  const stateRef = useRef<PlayerState | null>(null);
  stateRef.current = { media, title, subtitle, currentTime: current, duration, paused, buffering, volume, muted };
  useEffect(() => {
    if (!onState) return;
    const tick = () => stateRef.current && onState(stateRef.current);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [onState, paused, muted, duration]);

  // ---- Управление -----------------------------------------------------------

  const showControls = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused && !menuOpen.current) setControls(false);
    }, HIDE_CONTROLS_MS);
  }, []);

  useEffect(() => {
    if (paused) {
      setControls(true);
      clearTimeout(hideTimer.current);
    } else showControls();
  }, [paused, showControls]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.5));
  }, []);

  // Перемотка с ускорением: частые нажатия увеличивают шаг (10 → 30 → 60 с).
  const seekState = useRef({ last: 0, streak: 0, target: 0, commit: undefined as ReturnType<typeof setTimeout> | undefined });
  const nudge = useCallback(
    (dir: 1 | -1) => {
      const v = videoRef.current;
      if (!v) return;
      const s = seekState.current;
      const now = Date.now();
      s.streak = now - s.last < 450 ? s.streak + 1 : 0;
      if (s.streak === 0) s.target = v.currentTime;
      s.last = now;
      const step = s.streak > 12 ? 60 : s.streak > 5 ? 30 : 10;
      s.target = Math.max(0, Math.min(s.target + dir * step, v.duration || Infinity));
      setSeekPreview(s.target);
      clearTimeout(s.commit);
      s.commit = setTimeout(() => {
        seekTo(s.target);
        setSeekPreview(null);
      }, 350);
    },
    [seekTo],
  );

  const exit = useCallback(async () => {
    const v = videoRef.current;
    v?.pause();
    // Дожидаемся записи таймкода, чтобы карточка сразу показала «Смотреть с MM:SS».
    if (v && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime > 0) {
      await api.saveProgress(media, { position: v.ended ? v.duration : v.currentTime, duration: v.duration }).catch(() => {});
    }
    onClose();
  }, [media, onClose]);

  useKeyHandler((key) => {
    showControls();
    if (key === 'play_pause') return toggle(), true;
    if (key === 'back') {
      if (menu) return false; // закроет само меню (его обработчик выше по стеку)
      void exit();
      return true;
    }
    if (menu) return false;
    if (!controls) {
      // OSD скрыт: стрелки — перемотка, Enter — пауза, вверх/вниз — показать панель.
      if (key === 'left' || key === 'right') return nudge(key === 'right' ? 1 : -1), true;
      if (key === 'enter') return toggle(), true;
      if (key === 'up' || key === 'down') {
        requestAnimationFrame(() => engine.focus('player:toggle'));
        return true;
      }
    }
    if (engine.getFocusedId() === PROGRESS_ID) {
      if (key === 'left' || key === 'right') return nudge(key === 'right' ? 1 : -1), true;
      if (key === 'enter') return toggle(), true;
    }
    return false;
  });

  // Команды с телефона.
  useEffect(
    () =>
      playerBus.on((cmd: PlayerControl) => {
        const v = videoRef.current;
        if (!v) return;
        showControls();
        switch (cmd.type) {
          case 'play':
            return void v.play();
          case 'pause':
            return v.pause();
          case 'toggle':
            return toggle();
          case 'stop':
            return void exit();
          case 'seek_relative':
            return seekTo(v.currentTime + cmd.seconds);
          case 'seek_absolute':
            return seekTo(cmd.seconds);
          case 'volume':
            v.volume = cmd.value;
            if (cmd.value > 0) v.muted = false;
            return;
          case 'mute':
            v.muted = cmd.muted;
        }
      }),
    [showControls, toggle, exit, seekTo],
  );

  // ---- Меню озвучки/качества -------------------------------------------------

  const voiceItems: MenuItem[] = useMemo(() => {
    const fromSources = sources.map((s) => ({
      key: `src:${s.id}`,
      label: sources.filter((x) => x.voice === s.voice).length > 1 ? `${s.voice} · ${s.providerName}` : s.voice,
      selected: s.id === activeSourceId && audioTracks.length <= 1,
      onSelect: () => {
        resumeAt.current = videoRef.current?.currentTime ?? 0;
        setActiveSourceId(s.id);
        setActiveQuality(s.qualities[0]?.label ?? 'Auto');
      },
    }));
    // Внутренние аудиодорожки HLS (мультиязычный поток) — тоже «озвучки».
    const fromTracks =
      audioTracks.length > 1
        ? audioTracks.map((t, i) => ({
            key: `aud:${i}`,
            label: t.name || t.lang || `Дорожка ${i + 1}`,
            selected: i === audioTrack,
            onSelect: () => {
              if (hlsRef.current) hlsRef.current.audioTrack = i;
            },
          }))
        : [];
    return [...fromTracks, ...(sources.length > 1 || !fromTracks.length ? fromSources : [])];
  }, [sources, activeSourceId, audioTracks, audioTrack]);

  const qualityItems: MenuItem[] = useMemo(() => {
    if (source?.type === 'mp4') {
      return source.qualities.map((q) => ({
        key: q.label,
        label: q.label,
        selected: q.label === activeQuality,
        onSelect: () => {
          resumeAt.current = videoRef.current?.currentTime ?? 0;
          setActiveQuality(q.label);
        },
      }));
    }
    const auto: MenuItem = {
      key: 'auto',
      label: 'Авто',
      selected: level === -1,
      onSelect: () => {
        if (!hlsRef.current) return;
        hlsRef.current.autoLevelCapping = -1;
        hlsRef.current.currentLevel = -1;
      },
    };
    const byHeight = levels
      .map((l, i) => ({ l, i }))
      .sort((a, b) => b.l.height - a.l.height)
      .filter((x, idx, arr) => arr.findIndex((y) => y.l.height === x.l.height) === idx);
    return [
      auto,
      ...byHeight.map(({ l, i }) => ({
        key: `lvl:${i}`,
        label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} кбит/с`,
        selected: level === i,
        onSelect: () => {
          if (hlsRef.current) hlsRef.current.currentLevel = i;
        },
      })),
    ];
  }, [source, activeQuality, levels, level]);

  const currentQualityLabel =
    source?.type === 'mp4' ? activeQuality : level === -1 ? 'Авто' : levels[level]?.height ? `${levels[level]!.height}p` : 'Авто';
  const currentVoice = voiceItems.find((v) => v.selected)?.label ?? source?.voice;

  return (
    <FocusSection id="player" trap autoFocus={false} className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} className="absolute inset-0 size-full bg-black object-contain" playsInline />

      {(buffering || error) && (
        <div className="absolute inset-0 flex items-center justify-center">
          {error ? (
            <div className="max-w-[50rem] rounded-3xl bg-black/80 p-10 text-center text-[1.8rem]">{error}</div>
          ) : (
            <Loader2 className="size-[6rem] animate-spin text-white/80" />
          )}
        </div>
      )}

      <AnimatePresence>
        {controls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 flex flex-col justify-between"
          >
            <div className="bg-gradient-to-b from-black/80 to-transparent px-[5rem] pb-24 pt-12">
              <div className="text-[2.6rem] font-bold">{title}</div>
              {subtitle && <div className="text-[1.6rem] text-white/70">{subtitle}</div>}
            </div>

            <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-[5rem] pb-12 pt-32">
              <ProgressBar current={current} duration={duration} buffered={buffered} preview={seekPreview} />
              <div className="flex items-center justify-between pb-6 font-mono text-[1.4rem] text-white/80">
                <span>{formatTime(seekPreview ?? current)}</span>
                <span>−{formatTime(Math.max(0, duration - (seekPreview ?? current)))}</span>
              </div>
              <div className="flex items-center gap-4">
                <FocusButton id="player:back10" variant="ghost" ariaLabel="Назад 10 секунд" onEnter={() => nudge(-1)}>
                  <RotateCcw className="size-[2.2rem]" />
                </FocusButton>
                <FocusButton id="player:toggle" autoFocus variant="primary" ariaLabel={paused ? 'Смотреть' : 'Пауза'} onEnter={toggle} className="px-8!">
                  {paused ? <Play className="size-[2.2rem] fill-current" /> : <Pause className="size-[2.2rem] fill-current" />}
                </FocusButton>
                <FocusButton id="player:fwd10" variant="ghost" ariaLabel="Вперёд 10 секунд" onEnter={() => nudge(1)}>
                  <RotateCw className="size-[2.2rem]" />
                </FocusButton>
                <div className="flex-1" />
                {onNext && (
                  <FocusButton id="player:next" variant={ended ? 'primary' : 'secondary'} onEnter={onNext} autoFocus={ended}>
                    <SkipForward className="size-[2rem]" /> Следующая серия
                  </FocusButton>
                )}
                {voiceItems.length > 1 && (
                  <FocusButton id="player:voice" onEnter={() => setMenu('voice')}>
                    <Languages className="size-[2rem]" /> {currentVoice}
                  </FocusButton>
                )}
                <FocusButton id="player:quality" onEnter={() => setMenu('quality')}>
                  <Settings2 className="size-[2rem]" /> {currentQualityLabel}
                </FocusButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menu === 'voice' && <Menu key="voice" title="Озвучка" items={voiceItems} onClose={() => setMenu(null)} />}
        {menu === 'quality' && <Menu key="quality" title="Качество" items={qualityItems} onClose={() => setMenu(null)} />}
      </AnimatePresence>
    </FocusSection>
  );
}
