import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type BgmStatus = "paused" | "loading" | "playing" | "unavailable";

const SoundContext = createContext<{
  musicEnabled: boolean;
  effectsEnabled: boolean;
  status: BgmStatus;
  toggleMusic: () => void;
  toggleEffects: () => void;
  muteAll: () => void;
  setStatus: (status: BgmStatus) => void;
  registerPlay: (play: (() => void) | null) => void;
} | null>(null);

function storedBoolean(key: string) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function SoundProvider(props: { children: ReactNode }) {
  const [musicEnabled, setMusicEnabled] = useState(() => storedBoolean("dfaztec.music.v1"));
  const [effectsEnabled, setEffectsEnabled] = useState(() => storedBoolean("dfaztec.effects.v1"));
  const [status, setStatus] = useState<BgmStatus>("paused");
  const playRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("dfaztec.music.v1", String(musicEnabled));
    } catch {
      /* no-op */
    }
  }, [musicEnabled]);
  useEffect(() => {
    try {
      localStorage.setItem("dfaztec.effects.v1", String(effectsEnabled));
    } catch {
      /* no-op */
    }
  }, [effectsEnabled]);

  const toggleMusic = useCallback(() => {
    setMusicEnabled((enabled) => {
      if (!enabled) queueMicrotask(() => playRef.current?.());
      return !enabled;
    });
  }, []);
  const toggleEffects = useCallback(() => setEffectsEnabled((enabled) => !enabled), []);
  const muteAll = useCallback(() => {
    setMusicEnabled(false);
    setEffectsEnabled(false);
  }, []);
  const registerPlay = useCallback((play: (() => void) | null) => {
    playRef.current = play;
  }, []);

  const value = useMemo(
    () => ({
      musicEnabled,
      effectsEnabled,
      status,
      toggleMusic,
      toggleEffects,
      muteAll,
      setStatus,
      registerPlay,
    }),
    [musicEnabled, effectsEnabled, status, toggleMusic, toggleEffects, muteAll, registerPlay],
  );
  return <SoundContext.Provider value={value}>{props.children}</SoundContext.Provider>;
}

export function useSound() {
  const value = useContext(SoundContext);
  if (!value) throw new Error("useSound must be used inside SoundProvider");
  return value;
}
