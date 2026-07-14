const NICKNAME_KEY = "songpyeon:nickname";

export function getSavedNickname(): string {
  try {
    return sessionStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(nickname: string): void {
  try {
    sessionStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // best-effort — next visit this tab just won't have it prefilled.
  }
}
