import type { Episode, Genre, MediaKind, TitleDetails } from '@movie/shared';

/**
 * Демо-каталог: открытые фильмы Blender Foundation (CC BY). Используется,
 * когда TMDB_API_KEY не задан, — весь интерфейс можно проверить без ключей.
 * Рейтинги намеренно пустые — реальные приходят из TMDB/КП при наличии ключей.
 * ID совпадают с TMDB, поэтому демо-провайдер потоков работает и с реальным каталогом.
 */

const GENRES: Record<MediaKind, Genre[]> = {
  movie: [
    { id: 16, name: 'Мультфильм' },
    { id: 878, name: 'Фантастика' },
    { id: 14, name: 'Фэнтези' },
    { id: 35, name: 'Комедия' },
    { id: 12, name: 'Приключения' },
  ],
  tv: [
    { id: 16, name: 'Мультфильм' },
    { id: 10765, name: 'НФ и Фэнтези' },
  ],
};

const g = (kind: MediaKind, ...ids: number[]) => GENRES[kind].filter((x) => ids.includes(x.id));

export const DEMO_SERIES_ID = 900001;

export const DEMO_TITLES: TitleDetails[] = [
  {
    kind: 'movie',
    id: 10378,
    title: 'Большой кролик',
    originalTitle: 'Big Buck Bunny',
    year: 2008,
    overview:
      'Огромный добродушный кролик наслаждается жизнью на лесной поляне, пока трое хулиганов-грызунов не решают испортить ему день. Терпение кролика небезгранично.',
    tagline: 'Месть бывает пушистой',
    runtimeMin: 10,
    genreIds: [16, 35],
    genres: g('movie', 16, 35),
    ratings: {},
    cast: [],
    imdbId: 'tt1254207',
  },
  {
    kind: 'movie',
    id: 45745,
    title: 'Синтел',
    originalTitle: 'Sintel',
    year: 2010,
    overview:
      'Одинокая странница Синтел ищет детёныша дракона, которого когда-то спасла. Путь приводит её к пугающей правде о том, что время меняет всех.',
    tagline: 'Найти утраченное',
    runtimeMin: 15,
    genreIds: [16, 14, 12],
    genres: g('movie', 16, 14, 12),
    ratings: {},
    cast: [{ id: 1, name: 'Halina Reijn', character: 'Синтел (голос)' }],
    imdbId: 'tt1727587',
  },
  {
    kind: 'movie',
    id: 133701,
    title: 'Слёзы стали',
    originalTitle: 'Tears of Steel',
    year: 2012,
    overview:
      'В недалёком будущем группа учёных и воинов пытается спасти Амстердам от нашествия роботов, вернувшись к моменту, когда всё пошло не так.',
    runtimeMin: 12,
    genreIds: [878],
    genres: g('movie', 878),
    ratings: {},
    cast: [
      { id: 2, name: 'Derek de Lint' },
      { id: 3, name: 'Sergio Hasselbaink' },
      { id: 4, name: 'Vanja Rukavina' },
    ],
    imdbId: 'tt2285752',
  },
  {
    kind: 'tv',
    id: DEMO_SERIES_ID,
    title: 'Открытые фильмы Blender',
    originalTitle: 'Blender Open Movies',
    year: 2008,
    overview: 'Демо-сериал для проверки выбора сезона и серии: каждая серия — отдельный открытый фильм Blender Foundation.',
    genreIds: [16, 10765],
    genres: g('tv', 16, 10765),
    ratings: {},
    cast: [],
    seasons: [{ number: 1, name: 'Сезон 1', episodeCount: 3 }],
  },
];

export const DEMO_EPISODES: Episode[] = [
  { season: 1, episode: 1, name: 'Большой кролик', runtimeMin: 10 },
  { season: 1, episode: 2, name: 'Синтел', runtimeMin: 15 },
  { season: 1, episode: 3, name: 'Слёзы стали', runtimeMin: 12 },
];

export function demoGenres(kind: MediaKind): Genre[] {
  return GENRES[kind];
}
