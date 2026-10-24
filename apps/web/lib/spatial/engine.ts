import { best, type Direction, type Rect } from './geometry';

export type NavKey = Direction | 'enter' | 'back' | 'play_pause' | 'home';

export interface FocusableEntry {
  id: string;
  el: HTMLElement;
  onEnter?: () => void;
  onFocus?: () => void;
  disabled?: boolean;
}

/** Обработчик клавиш поверх стандартной навигации. true — событие поглощено. */
export type KeyHandler = (key: NavKey, source: 'keyboard' | 'remote') => boolean | void;

interface Trap {
  el: HTMLElement;
  restoreTo: string | null;
}

export const SECTION_ATTR = 'data-nav-section';
export const REMEMBER_ATTR = 'data-nav-remember';
export const FOCUS_ATTR = 'data-focus-id';

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/**
 * Движок пространственной навигации. Хранит реестр фокусируемых элементов,
 * текущий фокус, стек модальных «ловушек» и память секций.
 * Не зависит от React: React-слой (SpatialNavigation.tsx) только регистрирует элементы.
 */
export class SpatialEngine {
  private items = new Map<string, FocusableEntry>();
  private focusedId: string | null = null;
  private listeners = new Set<() => void>();
  private traps: Trap[] = [];
  private memory = new Map<string, string>();
  private handlers: KeyHandler[] = [];

  // ---- Подписка (useSyncExternalStore) -------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getFocusedId = () => this.focusedId;
  private emit() {
    for (const fn of this.listeners) fn();
  }

  // ---- Регистрация -----------------------------------------------------------

  register(entry: FocusableEntry) {
    entry.el.setAttribute(FOCUS_ATTR, entry.id);
    this.items.set(entry.id, entry);
  }

  update(id: string, patch: Partial<Omit<FocusableEntry, 'id' | 'el'>>) {
    const e = this.items.get(id);
    if (e) Object.assign(e, patch);
  }

  unregister(id: string) {
    this.items.delete(id);
    if (this.focusedId === id) {
      // Элемент исчез (например, отфильтровали карточку) — фокус не должен «потеряться».
      this.focusedId = null;
      queueMicrotask(() => {
        if (!this.focusedId) this.focusFirst();
      });
      this.emit();
    }
  }

  get(id: string) {
    return this.items.get(id);
  }

  // ---- Фокус ------------------------------------------------------------------

  focus(id: string, opts: { scroll?: boolean } = {}) {
    const entry = this.items.get(id);
    if (!entry || entry.disabled || !this.inScope(entry.el)) return false;
    if (this.focusedId === id) return true;
    this.focusedId = id;
    const section = entry.el.closest<HTMLElement>(`[${SECTION_ATTR}]`);
    if (section?.hasAttribute(REMEMBER_ATTR)) this.memory.set(section.getAttribute(SECTION_ATTR)!, id);

    entry.el.focus({ preventScroll: true });
    if (opts.scroll !== false) scrollIntoViewIfNeeded(entry.el);
    entry.onFocus?.();
    this.emit();
    return true;
  }

  /** Первый видимый элемент в текущей области (с учётом ловушки) — сверху-слева. */
  focusFirst(within?: HTMLElement): boolean {
    const scope = within ?? this.scope();
    const candidates = this.candidates(scope);
    candidates.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const first = candidates[0];
    return first ? this.focus(first.item.id) : false;
  }

  /** Фокус в секцию: на запомненный элемент, иначе на первый. */
  focusSection(sectionId: string): boolean {
    const remembered = this.memory.get(sectionId);
    if (remembered && this.focus(remembered)) return true;
    const el = document.querySelector<HTMLElement>(`[${SECTION_ATTR}="${CSS.escape(sectionId)}"]`);
    return el ? this.focusFirst(el) : false;
  }

  move(dir: Direction): boolean {
    const current = this.focusedId ? this.items.get(this.focusedId) : undefined;
    if (!current || !current.el.isConnected) return this.focusFirst();

    const from = toRect(current.el.getBoundingClientRect());
    const all = this.candidates(this.scope()).filter((c) => c.item.id !== current.id);
    const target = best(from, all, dir);
    if (!target) return false;

    // Вход в новую секцию с памятью — возвращаемся к последнему элементу в ней (как в рядах Netflix).
    const fromSection = current.el.closest<HTMLElement>(`[${SECTION_ATTR}]`);
    const toSection = target.el.closest<HTMLElement>(`[${SECTION_ATTR}]`);
    if (toSection && toSection !== fromSection && toSection.hasAttribute(REMEMBER_ATTR)) {
      const remembered = this.memory.get(toSection.getAttribute(SECTION_ATTR)!);
      const rememberedEntry = remembered ? this.items.get(remembered) : undefined;
      if (rememberedEntry && toSection.contains(rememberedEntry.el) && this.focus(rememberedEntry.id)) return true;
    }
    return this.focus(target.id);
  }

  enter(): boolean {
    const current = this.focusedId ? this.items.get(this.focusedId) : undefined;
    if (!current || current.disabled) return false;
    if (current.onEnter) current.onEnter();
    else current.el.click();
    return true;
  }

  // ---- Ловушки (модальные окна, плеер, меню) ---------------------------------

  pushTrap(el: HTMLElement) {
    this.traps.push({ el, restoreTo: this.focusedId });
  }

  popTrap(el: HTMLElement) {
    const idx = this.traps.findIndex((t) => t.el === el);
    if (idx === -1) return;
    const [trap] = this.traps.splice(idx, 1);
    if (idx === this.traps.length && trap) {
      // Закрыли верхнюю ловушку — возвращаем фокус туда, где он был до её открытия.
      queueMicrotask(() => {
        if (trap.restoreTo && this.focus(trap.restoreTo)) return;
        if (!this.focusedId || !this.inScope(this.items.get(this.focusedId)?.el)) this.focusFirst();
      });
    }
  }

  // ---- Обработчики клавиш -----------------------------------------------------

  /** Последний добавленный обработчик получает клавишу первым. */
  addHandler(fn: KeyHandler) {
    this.handlers.push(fn);
    return () => {
      const i = this.handlers.lastIndexOf(fn);
      if (i !== -1) this.handlers.splice(i, 1);
    };
  }

  dispatch(key: NavKey, source: 'keyboard' | 'remote' = 'keyboard'): boolean {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      if (this.handlers[i]!(key, source) === true) return true;
    }
    switch (key) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        return this.move(key);
      case 'enter':
        return this.enter();
      default:
        return false;
    }
  }

  // ---- Внутреннее -------------------------------------------------------------

  private scope(): HTMLElement {
    return this.traps.at(-1)?.el ?? document.body;
  }

  private inScope(el: HTMLElement | undefined): boolean {
    return !!el && this.scope().contains(el);
  }

  private candidates(scope: HTMLElement) {
    const out: { item: FocusableEntry; rect: Rect }[] = [];
    for (const item of this.items.values()) {
      if (item.disabled || !item.el.isConnected || !scope.contains(item.el)) continue;
      const r = item.el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({ item, rect: toRect(r) });
    }
    return out;
  }
}

/**
 * Прокрутка к элементу с «запасом», чтобы сфокусированный постер не прилипал к краю
 * экрана и был виден следующий ряд. Работает и для горизонтальных рядов.
 */
function scrollIntoViewIfNeeded(el: HTMLElement) {
  const margin = 0.12;
  let verticalHandled = false;
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const scrollX = /(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
    const scrollY = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;
    if (scrollX || scrollY) {
      const p = parent.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (scrollX) {
        const pad = p.width * margin;
        if (r.left < p.left + pad) dx = r.left - p.left - pad;
        else if (r.right > p.right - pad) dx = r.right - p.right + pad;
      }
      if (scrollY) {
        verticalHandled = true;
        const pad = p.height * margin;
        if (r.top < p.top + pad) dy = r.top - p.top - pad;
        else if (r.bottom > p.bottom - pad) dy = r.bottom - p.bottom + pad;
      }
      if (dx || dy) parent.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
    }
    parent = parent.parentElement;
  }
  // Вертикальная прокрутка страницы — если элемент не внутри собственного скролл-контейнера (модалки).
  if (verticalHandled) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const pad = vh * 0.18;
  if (r.top < pad) window.scrollBy({ top: r.top - pad, behavior: 'smooth' });
  else if (r.bottom > vh - pad) window.scrollBy({ top: r.bottom - vh + pad, behavior: 'smooth' });
}
