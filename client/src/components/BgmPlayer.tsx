import { useEffect, useRef } from "react";
import { isBgmEnabled } from "../game/audioSettings";

const BGM_VOLUME = 0.4;

export function BgmPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = BGM_VOLUME;
  }, []);

  // Checked once at mount, not reactively — the BGM on/off toggle lives on
  // the main menu, which BgmPlayer is never mounted alongside (it only
  // mounts inside Game.tsx/SoloPlayScreen.tsx once a match starts), so the
  // preference is always settled before this component exists.
  if (!isBgmEnabled()) return null;

  return (
    <audio ref={audioRef} src="/game-assets/audio/bgm.mp3" loop autoPlay />
  );
}
