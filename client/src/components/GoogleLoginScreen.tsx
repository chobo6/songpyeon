import { useEffect, useRef } from "react";
import { renderGoogleButton } from "../game/auth";
import styles from "./GoogleLoginScreen.module.css";

const BUTTON_CONTAINER_ID = "google-login-button";

export function GoogleLoginScreen({ onCredential }: { onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    renderGoogleButton(BUTTON_CONTAINER_ID, onCredential);
  }, [onCredential]);

  return (
    <main className={styles.wrap}>
      <h1>송편 만들기</h1>
      <p className={styles.hint}>온라인 플레이는 구글 로그인이 필요해요</p>
      <div ref={containerRef} id={BUTTON_CONTAINER_ID} />
    </main>
  );
}
