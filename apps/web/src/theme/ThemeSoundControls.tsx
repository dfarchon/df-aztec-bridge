import { useCallback, useEffect, useRef, useState } from "react";
import { useSound } from "./SoundContext.tsx";
import { useTheme } from "./ThemeContext.tsx";

const MUSIC_PATH = `${import.meta.env.BASE_URL}audio/music/bgm.mp3`;

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M16.5 3.2A8.5 8.5 0 1 0 20.8 16 7 7 0 0 1 16.5 3.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconVolume({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M4 10h3.2L12 6.2v11.6L7.2 14H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="M16 9.5 20.5 14M20.5 9.5 16 14" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path
          d="M16 9.2a3.4 3.4 0 0 1 0 5.6M18.2 7a6 6 0 0 1 0 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      className="icon-btn utility-control"
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function BackgroundMusic() {
  const { musicEnabled, setStatus, registerPlay } = useSound();
  const audioRef = useRef<HTMLAudioElement>(null);
  const fadeRef = useRef<number | undefined>(undefined);

  const fade = useCallback((target: number, pause = false) => {
    window.clearInterval(fadeRef.current);
    const audio = audioRef.current;
    if (!audio) return;
    fadeRef.current = window.setInterval(() => {
      const delta = target - audio.volume;
      if (Math.abs(delta) < 0.04) {
        audio.volume = target;
        window.clearInterval(fadeRef.current);
        if (pause) audio.pause();
        return;
      }
      audio.volume = Math.max(0, Math.min(1, audio.volume + Math.sign(delta) * 0.04));
    }, 45);
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setStatus("loading");
    audio.volume = 0;
    void audio
      .play()
      .then(() => {
        setStatus("playing");
        fade(navigator.maxTouchPoints > 0 ? 0.1 : 0.7);
      })
      .catch(() => setStatus("unavailable"));
  }, [fade, setStatus]);

  useEffect(() => {
    registerPlay(play);
    return () => registerPlay(null);
  }, [play, registerPlay]);
  useEffect(() => {
    if (musicEnabled) play();
    else {
      fade(0, true);
      setStatus("paused");
    }
  }, [musicEnabled, fade, play, setStatus]);
  useEffect(() => () => window.clearInterval(fadeRef.current), []);

  return (
    <audio ref={audioRef} src={MUSIC_PATH} preload="none" loop onError={() => setStatus("unavailable")} />
  );
}

function InterfaceSounds() {
  const { effectsEnabled } = useSound();
  useEffect(() => {
    if (!effectsEnabled) return;
    let context: AudioContext | undefined;
    const play = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("button, a[href]")) return;
      if (event.target.closest(".sound-menu")) return;
      context ??= new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(520, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(760, context.currentTime + 0.045);
      gain.gain.setValueAtTime(navigator.maxTouchPoints > 0 ? 0.015 : 0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.06);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.065);
    };
    document.addEventListener("click", play, true);
    return () => {
      document.removeEventListener("click", play, true);
      void context?.close();
    };
  }, [effectsEnabled]);
  return null;
}

export function SoundMenu() {
  const { musicEnabled, effectsEnabled, status, toggleMusic, toggleEffects, muteAll } = useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="sound-menu" ref={ref}>
      <button
        className="icon-btn utility-control"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Sound settings"
        aria-expanded={open}
      >
        <IconVolume muted={!(musicEnabled || effectsEnabled)} />
      </button>
      {open ? (
        <div className="sound-popover">
          <p>Sound // settings</p>
          <button type="button" onClick={toggleMusic}>
            <span>Background music</span>
            <small>{musicEnabled ? status : "off"}</small>
          </button>
          <button type="button" onClick={toggleEffects}>
            <span>Interface sounds</span>
            <small>{effectsEnabled ? "on" : "off"}</small>
          </button>
          {musicEnabled || effectsEnabled ? (
            <button type="button" className="mute-all" onClick={muteAll}>
              Mute all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SoundSystem() {
  return (
    <>
      <BackgroundMusic />
      <InterfaceSounds />
    </>
  );
}
