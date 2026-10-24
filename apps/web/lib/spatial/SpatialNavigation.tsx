'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { REMEMBER_ATTR, SECTION_ATTR, SpatialEngine, type KeyHandler, type NavKey } from './engine';

export type { NavKey } from './engine';

const EngineContext = createContext<SpatialEngine | null>(null);

/**
 * Коды клавиш пультов. Smart TV-браузеры часто не заполняют `event.key`,
 * поэтому дополнительно смотрим на `keyCode`.
 */
const KEY_CODES: Record<number, NavKey> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'enter',
  32: 'play_pause', // Space
  27: 'back',
  461: 'back', // LG webOS
  10009: 'back', // Samsung Tizen
  10182: 'home', // Tizen Exit
  179: 'play_pause',
  415: 'play_pause', // Play
  19: 'play_pause', // Pause
  10252: 'play_pause', // Tizen MediaPlayPause
};

const KEY_NAMES: Record<string, NavKey> = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  Enter: 'enter',
  Escape: 'back',
  GoBack: 'back',
  BrowserBack: 'back',
  MediaPlayPause: 'play_pause',
  MediaPlay: 'play_pause',
  MediaPause: 'play_pause',
  ' ': 'play_pause',
};

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return (
    !!el &&
    (el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes((el as HTMLInputElement).type)))
  );
}

export function SpatialNavigationProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new SpatialEngine());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      let key: NavKey | undefined = KEY_NAMES[e.key] ?? KEY_CODES[e.keyCode];
      const active = document.activeElement;

      if (isTextInput(active)) {
        // В поле ввода стрелки влево/вправо двигают курсор, пока он не упрётся в край.
        const atStart = active.selectionStart === 0 && active.selectionEnd === 0;
        const atEnd = active.selectionStart === active.value.length;
        if ((key === 'left' && !atStart) || (key === 'right' && !atEnd)) return;
        if (e.key === ' ') return;
        // Backspace в поле — стирание, а не «назад».
        if (e.key === 'Backspace') return;
      } else if (e.key === 'Backspace') {
        key = 'back';
      }
      if (!key) return;
      if (engine.dispatch(key, 'keyboard') || key !== 'back') e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useSpatialEngine(): SpatialEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useSpatialEngine: нет SpatialNavigationProvider');
  return engine;
}

export interface UseFocusableOptions {
  /** Стабильный id — нужен, чтобы восстанавливать фокус (например, после закрытия модалки). */
  id?: string;
  onEnter?: () => void;
  onFocus?: () => void;
  disabled?: boolean;
  /** Взять фокус при монтировании. */
  autoFocus?: boolean;
}

/**
 * Регистрирует элемент в движке навигации.
 *
 * const { ref, focused } = useFocusable({ onEnter: open });
 * <button ref={ref} className={focused ? 'ring-4 scale-105' : ''} />
 */
export function useFocusable<T extends HTMLElement = HTMLElement>(opts: UseFocusableOptions = {}) {
  const engine = useSpatialEngine();
  const autoId = useId();
  const id = opts.id ?? autoId;
  const [el, ref] = useState<T | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const focused = useSyncExternalStore(
    engine.subscribe,
    () => engine.getFocusedId() === id,
    () => false,
  );

  useLayoutEffect(() => {
    if (!el) return;
    engine.register({
      id,
      el,
      onEnter: () => (optsRef.current.onEnter ? optsRef.current.onEnter() : el.click()),
      onFocus: () => optsRef.current.onFocus?.(),
      disabled: optsRef.current.disabled,
    });
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    if (optsRef.current.autoFocus) engine.focus(id);

    // Указатель (LG Magic Remote, мышь, виртуальный курсор с телефона) тоже двигает фокус.
    const onPointerEnter = () => engine.focus(id, { scroll: false });
    const onClick = (e: MouseEvent) => {
      engine.focus(id, { scroll: false });
      if (!optsRef.current.onEnter) return;
      e.preventDefault();
      optsRef.current.onEnter();
    };
    el.addEventListener('pointerenter', onPointerEnter);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('pointerenter', onPointerEnter);
      el.removeEventListener('click', onClick);
      engine.unregister(id);
    };
  }, [engine, id, el]);

  useEffect(() => engine.update(id, { disabled: opts.disabled }), [engine, id, opts.disabled]);

  return { ref, focused, id, focus: () => engine.focus(id) };
}

export interface FocusSectionProps {
  id: string;
  children: ReactNode;
  className?: string;
  /** Помнить последний сфокусированный элемент и возвращаться к нему при входе в секцию. */
  remember?: boolean;
  /** Модальная ловушка: фокус не выходит за пределы секции, пока она смонтирована. */
  trap?: boolean;
  /** Для ловушки: сфокусировать первый элемент при открытии (по умолчанию true). */
  autoFocus?: boolean;
  as?: 'div' | 'section' | 'nav' | 'header' | 'ul';
}

export function FocusSection({ id, children, className, remember, trap, autoFocus = true, as: Tag = 'div' }: FocusSectionProps) {
  const engine = useSpatialEngine();
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!trap || !el) return;
    engine.pushTrap(el);
    if (autoFocus) requestAnimationFrame(() => engine.focusFirst(el));
    return () => engine.popTrap(el);
  }, [engine, trap, autoFocus]);

  const attrs = { [SECTION_ATTR]: id, ...(remember ? { [REMEMBER_ATTR]: '' } : {}) };
  return (
    <Tag ref={ref as never} className={className} {...attrs}>
      {children}
    </Tag>
  );
}

/**
 * Перехват клавиш поверх навигации. Обработчики образуют стек: последний
 * смонтированный (например, плеер поверх модалки) получает клавишу первым.
 */
export function useKeyHandler(handler: KeyHandler, active = true) {
  const engine = useSpatialEngine();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return engine.addHandler((key, source) => ref.current(key, source));
  }, [engine, active]);
}

/** Сахар для кнопки «Назад» пульта / Escape. */
export function useBackHandler(onBack: () => void, active = true) {
  useKeyHandler((key) => {
    if (key !== 'back') return false;
    onBack();
    return true;
  }, active);
}
