import { useEffect, useState } from "react";
import { renderGoogleButton } from "../game/auth";
import styles from "./GoogleLoginScreen.module.css";

const BUTTON_CONTAINER_ID = "google-login-button";

export function GoogleLoginScreen({ onCredential }: { onCredential: (credential: string) => void }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    renderGoogleButton(BUTTON_CONTAINER_ID, onCredential).catch((err) => {
      console.error("Failed to render Google login button", err);
      setError("로그인 버튼을 불러오지 못했어요. 새로고침해주세요.");
    });
  }, [onCredential]);

  return (
    <main className={styles.wrap}>
      <h1>송편 만들기</h1>
      <p className={styles.hint}>온라인 플레이는 구글 로그인이 필요해요</p>
      {error && <p className={styles.error}>{error}</p>}
      <div id={BUTTON_CONTAINER_ID} />
    </main>
  );
}
