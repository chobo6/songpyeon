import { useEffect, useRef } from "react";

const BGM_VOLUME = 0.4;

export function BgmPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = BGM_VOLUME;
  }, []);

  return (
    <audio ref={audioRef} src="/game-assets/audio/bgm.mp3" loop autoPlay />
  );
}
