import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

/** Screen point the circular theme reveal grows from (usually the clicked control). */
export interface RevealOrigin {
  x: number;
  y: number;
}

interface ThemeContextType {
  /** The theme currently applied to the document. */
  theme: Theme;
  /** What the user picked; "system" follows the OS setting. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference, origin?: RevealOrigin) => void;
  toggleTheme: (origin?: RevealOrigin) => void;
  setTheme: (theme: Theme, origin?: RevealOrigin) => void;
}

const STORAGE_KEY = "agentq-theme";
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to the OS theme.
  }
  return "system";
}

function writePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Not persisting is fine; the choice still applies for this session.
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/**
 * Switch the document theme with an animation: a circular reveal from `origin`
 * where View Transitions are supported, a short color cross-fade otherwise.
 * `commit` updates React state; it runs inside the transition so the "before"
 * snapshot is captured first.
 */
function transitionTheme(next: Theme, commit: () => void, origin?: RevealOrigin) {
  const root = document.documentElement;
  const update = () => {
    applyTheme(next);
    flushSync(commit);
  };
  if (root.getAttribute("data-theme") === next || prefersReducedMotion()) {
    update();
    return;
  }

  const doc = document as ViewTransitionDocument;
  if (doc.startViewTransition) {
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transition = doc.startViewTransition(update);
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: 480,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {});
    return;
  }

  root.classList.add("theme-transition");
  update();
  window.setTimeout(() => root.classList.remove("theme-transition"), 320);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme: Theme = preference === "system" ? system : preference;

  // Keeps the attribute in sync on first render and on OS theme changes; the
  // animated path in setPreference has usually applied it already.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const setPreference = useCallback((next: ThemePreference, origin?: RevealOrigin) => {
    writePreference(next);
    transitionTheme(
      next === "system" ? systemTheme() : next,
      () => setPreferenceState(next),
      origin,
    );
  }, []);

  const value = useMemo<ThemeContextType>(
    () => ({
      theme,
      preference,
      setPreference,
      setTheme: (t, origin) => setPreference(t, origin),
      toggleTheme: (origin) => setPreference(theme === "light" ? "dark" : "light", origin),
    }),
    [theme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
