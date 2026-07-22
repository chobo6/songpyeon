const BGM_KEY = "songpyeon:bgmEnabled";
const SFX_KEY = "songpyeon:sfxEnabled";

// Absence of a stored value (first visit, or storage cleared) means "on" —
// only an explicit "false" turns it off, so the default stays enabled.
function readFlag(key: string): boolean {
  return localStorage.getItem(key) !== "false";
}

export function isBgmEnabled(): boolean {
  return readFlag(BGM_KEY);
}

export function isSfxEnabled(): boolean {
  return readFlag(SFX_KEY);
}

export function setBgmEnabled(enabled: boolean): void {
  localStorage.setItem(BGM_KEY, String(enabled));
}

export function setSfxEnabled(enabled: boolean): void {
  localStorage.setItem(SFX_KEY, String(enabled));
}
