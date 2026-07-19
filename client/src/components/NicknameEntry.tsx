import { useState, type FormEvent } from "react";
import { submitNickname } from "../game/auth";
import styles from "./NicknameEntry.module.css";

const MAX_NICKNAME_LENGTH = 10;

export function NicknameEntry({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().slice(0, MAX_NICKNAME_LENGTH);
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const profile = await submitNickname(trimmed);
      if (!profile.nickname) {
        setError("닉네임 설정에 실패했어요");
        return;
      }
      onSubmit(profile.nickname);
    } catch {
      setError("닉네임 설정에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.wrap} onSubmit={handleSubmit}>
      <p className={styles.hint}>
        처음 오셨네요! 사용할 닉네임을 정해주세요
        <br />
        <span className={styles.hintSub}>(나중에 바꿀 수 없어요)</span>
      </p>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_NICKNAME_LENGTH}
        placeholder="닉네임"
        autoFocus
      />
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.submit} type="submit" disabled={!value.trim() || submitting}>
        확인
      </button>
    </form>
  );
}
