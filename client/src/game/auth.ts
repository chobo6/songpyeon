const GIS_SRC = "https://accounts.google.com/gsi/client";

type GoogleAccountsId = {
  initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string>) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // 캐시된 실패 Promise가 남아있으면 재시도가 영원히 막히므로 초기화한다.
      scriptPromise = null;
      reject(new Error("Failed to load Google Identity Services script"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// containerId 엘리먼트 안에 구글 로그인 버튼을 렌더링한다.
// 로그인 성공 시 onCredential(idTokenString)이 호출된다.
export async function renderGoogleButton(
  containerId: string,
  onCredential: (credential: string) => void,
): Promise<void> {
  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  });
  const container = document.getElementById(containerId);
  if (!container) return;
  // effect 재실행(StrictMode 이중 호출 등) 시 버튼이 중복으로 쌓이지 않도록 기존 내용을 비운다.
  container.innerHTML = "";
  window.google!.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
  });
}

export type Profile = { id: number; nickname: string | null };

export async function loginWithGoogle(credential: string): Promise<Profile> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error("로그인에 실패했습니다.");
  return res.json();
}

export async function fetchMe(): Promise<Profile | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) return null;
  return res.json();
}

export async function submitNickname(nickname: string): Promise<Profile> {
  const res = await fetch("/api/auth/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error("닉네임 설정에 실패했습니다.");
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}
