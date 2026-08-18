import { useState, type FormEvent } from "react";
import type { GameMode } from "../game/gameMode";
import styles from "./CreateRoomModal.module.css";

const MAX_TITLE_LENGTH = 20;
const MIN_TEAM_COUNT = 1;
const MAX_TEAM_COUNT = 4;
const MIN_SINGLE_ROLE_HEADCOUNT = 2;

const GAME_MODE_LABEL: Record<GameMode, string> = {
  normal: "일반",
  beginner: "초보",
  pigOnly: "돼지",
  rabbitOnly: "토끼",
};

export function CreateRoomModal({
  onCreate,
  onClose,
}: {
  onCreate: (
    title: string,
    teamCount: number,
    allowSpectators: boolean,
    itemsEnabled: boolean,
    aiPracticeMode: boolean,
    gameMode: GameMode,
  ) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamCount, setTeamCount] = useState(2);
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [itemsEnabled, setItemsEnabled] = useState(true);
  const [aiPracticeMode, setAiPracticeMode] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>("normal");

  const isSingleRoleMode = gameMode === "pigOnly" || gameMode === "rabbitOnly";

  // 정상/초보모드는 "팀 수"(1~4), 돼지전/토끼전은 "인원수"(2~4, 팀=1인)라는 다른 의미를
  // 같은 입력칸이 표현한다 — 모드를 바꾸면 현재 값을 그 모드의 유효 범위로 다시 클램프한다.
  function handleGameModeChange(next: GameMode) {
    setGameMode(next);
    const nextIsSingleRole = next === "pigOnly" || next === "rabbitOnly";
    if (nextIsSingleRole) {
      setAiPracticeMode(false);
      setTeamCount((prev) => Math.max(MIN_SINGLE_ROLE_HEADCOUNT, prev));
    }
  }

  // Digits only, then clamp to the valid range for the current mode.
  function handleTeamCountChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    const min = isSingleRoleMode ? MIN_SINGLE_ROLE_HEADCOUNT : MIN_TEAM_COUNT;
    if (!digits) {
      setTeamCount(min);
      return;
    }
    const lastDigit = Number(digits[digits.length - 1]);
    setTeamCount(Math.min(MAX_TEAM_COUNT, Math.max(min, lastDigit)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, teamCount, allowSpectators, itemsEnabled, aiPracticeMode, gameMode);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className={styles.heading}>방 만들기</h2>
        <div className={styles.field}>
          <span>게임 모드</span>
          <div className={styles.modeGroup}>
            {(Object.keys(GAME_MODE_LABEL) as GameMode[]).map((mode) => (
              <label key={mode} className={styles.modeOption}>
                <input
                  type="radio"
                  name="gameMode"
                  checked={gameMode === mode}
                  onChange={() => handleGameModeChange(mode)}
                />
                <span>{GAME_MODE_LABEL[mode]}</span>
              </label>
            ))}
          </div>
        </div>
        <label className={styles.field}>
          <span>방 제목</span>
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="방 제목을 입력하세요"
            autoFocus
          />
        </label>
        <label className={styles.field}>
          <span>{isSingleRoleMode ? `인원수 (${MIN_SINGLE_ROLE_HEADCOUNT}~${MAX_TEAM_COUNT})` : "팀 수 (1~4)"}</span>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={teamCount}
            onChange={(e) => handleTeamCountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            disabled={aiPracticeMode}
          />
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={allowSpectators}
            onChange={(e) => setAllowSpectators(e.target.checked)}
          />
          <span>관전 허용</span>
        </label>
        <label className={styles.checkboxField}>
          <input type="checkbox" checked={itemsEnabled} onChange={(e) => setItemsEnabled(e.target.checked)} />
          <span>아이템전</span>
        </label>
        {!isSingleRoleMode && (
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={aiPracticeMode}
              onChange={(e) => {
                setAiPracticeMode(e.target.checked);
                if (e.target.checked) setTeamCount(1);
              }}
            />
            <span>AI 연습모드</span>
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={styles.submitButton} disabled={!title.trim()}>
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}
