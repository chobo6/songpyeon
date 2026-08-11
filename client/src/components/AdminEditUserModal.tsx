import { useEffect, useState } from "react";
import type { NicknameEffect, NicknameParticle } from "../game/nicknameStyle";
import styles from "./AdminEditUserModal.module.css";

const MAX_NICKNAME_LENGTH = 10;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type NicknameChangeSource = "initial" | "ticket" | "admin";
const SOURCE_LABEL: Record<NicknameChangeSource, string> = {
  initial: "최초 설정",
  ticket: "변경권 사용",
  admin: "관리자 수정",
};

type NicknameHistoryEntry = {
  oldNickname: string | null;
  newNickname: string;
  source: NicknameChangeSource;
  changedAt: string;
};

export type UserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  gameMoney: number;
};

export function AdminEditUserModal({
  user,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const [nicknameValue, setNicknameValue] = useState(user.nickname ?? "");
  const [nicknameSaving, setNicknameSaving] = useState(false);

  const [colorValue, setColorValue] = useState(user.nicknameColor ?? "");
  const [colorSaving, setColorSaving] = useState(false);

  // 로컬 상태로 관리해서 저장 즉시 드롭다운/체크박스가 최신 값을 보여줌
  // (부모가 다시 목록을 fetch할 때까지 안 기다려도 됨).
  const [effect, setEffectValue] = useState<NicknameEffect>(user.nicknameEffect);
  const [glow, setGlowValue] = useState(user.nicknameGlow);
  const [particle, setParticleValue] = useState<NicknameParticle>(user.nicknameParticle);
  const [effectSaving, setEffectSaving] = useState(false);

  const [moneyDelta, setMoneyDelta] = useState("");
  const [moneySaving, setMoneySaving] = useState(false);
  const [currentMoney, setCurrentMoney] = useState(user.gameMoney);

  const [ipHistory, setIpHistory] = useState<{ ip: string; firstSeen: string; lastSeen: string }[] | null>(
    null,
  );
  const [nicknameHistory, setNicknameHistory] = useState<NicknameHistoryEntry[] | null>(null);

  // 모달이 열릴 때(user.id 확정 시) 한 번만 불러온다 — AdminDashboard.tsx의
  // 방문자 통계와 같은 패턴(폴링 없이 mount 시 1회 fetch). 수정 기능은
  // 없으므로 저장 관련 상태(saving 등)가 필요 없다.
  useEffect(() => {
    let cancelled = false;
    setIpHistory(null);
    fetch(`/api/admin/users/${user.id}/ips`, { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          onUnauthorized();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setIpHistory(data as { ip: string; firstSeen: string; lastSeen: string }[]);
      })
      .catch(() => {
        if (!cancelled) setIpHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id, onUnauthorized]);

  useEffect(() => {
    let cancelled = false;
    setNicknameHistory(null);
    fetch(`/api/admin/users/${user.id}/nickname-history`, { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          onUnauthorized();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setNicknameHistory(data as NicknameHistoryEntry[]);
      })
      .catch(() => {
        if (!cancelled) setNicknameHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id, onUnauthorized]);

  async function saveNickname() {
    const trimmed = nicknameValue.trim();
    if (!trimmed) return;
    setNicknameSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ nickname: trimmed }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "닉네임 변경에 실패했습니다");
        return;
      }
      onSaved();
    } catch {
      setError("닉네임 변경에 실패했습니다");
    } finally {
      setNicknameSaving(false);
    }
  }

  async function saveColor() {
    const trimmed = colorValue.trim();
    if (trimmed && !HEX_COLOR_PATTERN.test(trimmed)) {
      setError("#RRGGBB 형식의 색상 코드를 입력해주세요.");
      return;
    }
    setColorSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-color`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ color: trimmed || null }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "색상 변경에 실패했습니다");
        return;
      }
      onSaved();
    } catch {
      setError("색상 변경에 실패했습니다");
    } finally {
      setColorSaving(false);
    }
  }

  async function saveEffect(nextEffect: NicknameEffect, nextGlow: boolean, nextParticle: NicknameParticle) {
    setEffectSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ effect: nextEffect, glow: nextGlow, particle: nextParticle }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setError("효과 변경에 실패했습니다");
        return;
      }
      setEffectValue(nextEffect);
      setGlowValue(nextGlow);
      setParticleValue(nextParticle);
      onSaved();
    } catch {
      setError("효과 변경에 실패했습니다");
    } finally {
      setEffectSaving(false);
    }
  }

  async function saveMoney() {
    const delta = Number(moneyDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setError("0이 아닌 정수를 입력해주세요 (예: 10000 또는 -5000).");
      return;
    }
    setMoneySaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/game-money`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "게임머니 변경에 실패했습니다");
        return;
      }
      setCurrentMoney((prev) => Math.max(0, prev + delta));
      setMoneyDelta("");
      onSaved();
    } catch {
      setError("게임머니 변경에 실패했습니다");
    } finally {
      setMoneySaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{user.nickname ?? `유저 ${user.id}`} 수정</h2>
        {error && <p className={styles.error}>{error}</p>}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>닉네임</h3>
          <div className={styles.row}>
            <input
              className={styles.textInput}
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              maxLength={MAX_NICKNAME_LENGTH}
            />
            <button
              className={styles.saveButton}
              onClick={saveNickname}
              disabled={nicknameSaving || !nicknameValue.trim()}
            >
              저장
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>닉네임 색상</h3>
          <div className={styles.row}>
            <span className={styles.colorSwatch} style={{ background: colorValue || "transparent" }} />
            <input
              className={styles.textInput}
              value={colorValue}
              onChange={(e) => setColorValue(e.target.value)}
              placeholder="#ff6b6b"
            />
            <button className={styles.saveButton} onClick={saveColor} disabled={colorSaving}>
              저장
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>효과 / 글로우 / 파티클</h3>
          <div className={styles.row}>
            <select
              value={effect}
              disabled={effectSaving}
              onChange={(e) => saveEffect(e.target.value as NicknameEffect, glow, particle)}
            >
              <option value="none">없음</option>
              <option value="rainbow">레인보우</option>
              <option value="shine">샤인</option>
              <option value="hologram">홀로그램</option>
              <option value="pulse">Pulse</option>
              <option value="neon">네온사인</option>
              <option value="chrome">크롬</option>
            </select>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={glow}
                disabled={effectSaving || effect === "pulse" || effect === "neon"}
                onChange={(e) => saveEffect(effect, e.target.checked, particle)}
              />
              글로우
            </label>
            <select
              value={particle}
              disabled={effectSaving}
              onChange={(e) => saveEffect(effect, glow, e.target.value as NicknameParticle)}
            >
              <option value="none">파티클 없음</option>
              <option value="twinkle">반짝임</option>
              <option value="rising">상승</option>
              <option value="orbit">궤도</option>
              <option value="snow">눈</option>
            </select>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>게임머니</h3>
          <p className={styles.moneyDisplay}>현재 잔액: {currentMoney.toLocaleString("ko-KR")}원</p>
          <div className={styles.row}>
            <input
              className={styles.textInput}
              value={moneyDelta}
              onChange={(e) => setMoneyDelta(e.target.value)}
              placeholder="+10000 또는 -5000"
            />
            <button className={styles.saveButton} onClick={saveMoney} disabled={moneySaving || !moneyDelta.trim()}>
              적용
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>IP 이력</h3>
          {ipHistory === null ? (
            <p className={styles.moneyDisplay}>불러오는 중...</p>
          ) : ipHistory.length === 0 ? (
            <p className={styles.moneyDisplay}>기록된 IP가 없습니다.</p>
          ) : (
            <ul className={styles.ipList}>
              {ipHistory.map((entry) => (
                <li key={entry.ip} className={styles.ipEntry}>
                  <span>{entry.ip}</span>
                  <span>
                    최초 {entry.firstSeen} · 최근 {entry.lastSeen}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>닉네임 변경 이력</h3>
          {nicknameHistory === null ? (
            <p className={styles.moneyDisplay}>불러오는 중...</p>
          ) : nicknameHistory.length === 0 ? (
            <p className={styles.moneyDisplay}>변경 기록이 없습니다.</p>
          ) : (
            <ul className={styles.ipList}>
              {nicknameHistory.map((entry, i) => (
                <li key={i} className={styles.ipEntry}>
                  <span>
                    {entry.oldNickname ?? "(없음)"} → {entry.newNickname} ({SOURCE_LABEL[entry.source]})
                  </span>
                  <span>{entry.changedAt}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
