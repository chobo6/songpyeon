import { useState } from "react";
import { getSavedNickname, saveNickname } from "../game/nickname";
import styles from "./NicknameEntry.module.css";

const MAX_NICKNAME_LENGTH = 10;

export function NicknameEntry({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState(() => getSavedNickname());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().slice(0, MAX_NICKNAME_LENGTH);
    if (!trimmed) return;
    saveNickname(trimmed);
    onSubmit(trimmed);
  }

  return (
    <form className={styles.wrap} onSubmit={handleSubmit}>
      <p className={styles.hint}>닉네임을 입력하세요</p>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_NICKNAME_LENGTH}
        placeholder="닉네임"
        autoFocus
      />
      <button className={styles.submit} type="submit" disabled={!value.trim()}>
        확인
      </button>
    </form>
  );
}
