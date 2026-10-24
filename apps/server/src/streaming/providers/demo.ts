import { DEMO_SERIES_ID } from '../../metadata/demo.js';
import type { ProviderStream, ResolveParams, StreamProvider } from './types.js';

/** Публичные тестовые HLS-потоки открытых фильмов Blender Foundation. */
const STREAMS: Record<number, ProviderStream[]> = {
  10378: [
    { label: 'Оригинал', type: 'hls', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
  ],
  45745: [
    // Мультиязычный поток: озвучки придут как HLS audio tracks.
    { label: 'Оригинал', type: 'hls', url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8' },
  ],
  133701: [
    { label: 'Оригинал', type: 'hls', url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8' },
  ],
};

const EPISODES = [10378, 45745, 133701];

export class DemoProvider implements StreamProvider {
  readonly id = 'demo';
  readonly name = 'Демо (открытые фильмы)';

  async resolveMedia(p: ResolveParams): Promise<ProviderStream[] | null> {
    if (p.kind === 'movie') return STREAMS[p.tmdbId] ?? null;
    if (p.tmdbId === DEMO_SERIES_ID && p.season === 1 && p.episode) {
      const movieId = EPISODES[p.episode - 1];
      return movieId ? (STREAMS[movieId] ?? null) : null;
    }
    return null;
  }
}
