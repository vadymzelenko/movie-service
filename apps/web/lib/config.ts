/**
 * Адрес backend-а. По умолчанию — тот же хост, что у открытой страницы, порт 4000:
 * так TV (http://192.168.1.5:3000/tv) и телефон (http://192.168.1.5:3000/remote)
 * автоматически ходят на один и тот же сервер в локальной сети.
 */
export function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

export const apiUrl = (path: string) => (/^https?:/.test(path) ? path : `${apiBase()}${path}`);
