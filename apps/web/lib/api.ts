import {
  mediaKey,
  type CatalogQuery,
  type Episode,
  type Genre,
  type ListEntry,
  type ListName,
  type MediaKind,
  type MediaRef,
  type Paged,
  type ProgressEntry,
  type ProgressUpdate,
  type Review,
  type SourcesResponse,
  type TitleDetails,
  type TitleSummary,
} from '@movie/shared';
import { apiUrl } from './config';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  catalog: (q: Partial<CatalogQuery>) => request<Paged<TitleSummary>>(`/api/catalog?${qs(q)}`),
  search: (q: string, signal?: AbortSignal) => request<Paged<TitleSummary>>(`/api/search?${qs({ q })}`, { signal }),
  genres: (kind: MediaKind) => request<Genre[]>(`/api/genres/${kind}`),
  title: (kind: MediaKind, id: number) => request<TitleDetails>(`/api/title/${kind}/${id}`),
  reviews: (kind: MediaKind, id: number) => request<Review[]>(`/api/title/${kind}/${id}/reviews`),
  episodes: (id: number, season: number) => request<Episode[]>(`/api/tv/${id}/season/${season}`),
  /** Источники с фоллбеком по цепочке провайдеров; `provider` — выбранный вручную, `exclude` — упавшие. */
  sources: (ref: MediaRef, opts: { provider?: string; exclude?: string[] } = {}) =>
    request<SourcesResponse>(
      `/api/sources?${qs({ kind: ref.kind, id: ref.id, season: ref.season, episode: ref.episode, provider: opts.provider, exclude: opts.exclude?.join(',') || undefined })}`,
    ),

  progress: () => request<ProgressEntry[]>('/api/progress'),
  titleProgress: (kind: MediaKind, id: number) => request<ProgressEntry[]>(`/api/progress/title/${kind}/${id}`),
  saveProgress: (ref: MediaRef | string, update: ProgressUpdate) =>
    request<ProgressEntry>(`/api/progress/${typeof ref === 'string' ? ref : mediaKey(ref)}`, {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  /** Надёжная отправка при закрытии страницы/плеера. */
  beaconProgress: (ref: MediaRef, update: ProgressUpdate) => {
    const url = apiUrl(`/api/progress/${mediaKey(ref)}`);
    const body = JSON.stringify(update);
    if (!navigator.sendBeacon?.(url, body)) void fetch(url, { method: 'POST', body, keepalive: true });
  },
  deleteProgress: (key: string) => request<void>(`/api/progress/${key}`, { method: 'DELETE' }),

  lists: () => request<ListEntry[]>('/api/lists'),
  addToList: (list: ListName, t: TitleSummary) =>
    request<void>(`/api/lists/${list}/${t.kind}/${t.id}`, { method: 'PUT', body: JSON.stringify(toSummary(t)) }),
  removeFromList: (list: ListName, kind: MediaKind, id: number) =>
    request<void>(`/api/lists/${list}/${kind}/${id}`, { method: 'DELETE' }),

  network: () => request<{ addresses: string[] }>('/api/network'),
};

/** Отрезаем поля деталей — в список сохраняется только карточка. */
export function toSummary(t: TitleSummary): TitleSummary {
  const { kind, id, title, originalTitle, year, posterUrl, backdropUrl, overview, genreIds, ratings } = t;
  return { kind, id, title, originalTitle, year, posterUrl, backdropUrl, overview, genreIds, ratings };
}
