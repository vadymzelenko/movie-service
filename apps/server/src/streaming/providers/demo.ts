import type { MediaRef } from '@movie/shared';
import { DEMO_SERIES_ID } from '../../metadata/demo.js';
import type { RawSource, StreamProvider } from './types.js';

/** Публичные тестовые HLS-потоки открытых фильмов Blender Foundation. */
const STREAMS: Record<number, RawSource[]> = {
  10378: [
    { voice: 'Оригинал', type: 'hls', qualities: [{ label: 'Auto', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }] },
  ],
  45745: [
    // Мультиязычный поток: озвучки придут как HLS audio tracks.
    { voice: 'Оригинал', type: 'hls', qualities: [{ label: 'Auto', url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8' }] },
  ],
  133701: [
    {
      voice: 'Оригинал',
      type: 'hls',
      qualities: [{ label: 'Auto', url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8' }],
    },
  ],
};

const EPISODES = [10378, 45745, 133701];

export class DemoProvider implements StreamProvider {
  readonly id = 'demo';
  readonly name = 'Открытые фильмы';

  async resolve(media: MediaRef): Promise<RawSource[]> {
    if (media.kind === 'movie') return STREAMS[media.id] ?? [];
    if (media.id === DEMO_SERIES_ID && media.season === 1 && media.episode) {
      const movieId = EPISODES[media.episode - 1];
      return movieId ? (STREAMS[movieId] ?? []) : [];
    }
    return [];
  }
}
