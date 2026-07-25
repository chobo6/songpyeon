import { useCallback, useEffect } from "react";
import type { Room } from "colyseus.js";
import type { MatchState, PlayerState, ItemId } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { useSequencePressSound } from "../game/useSequencePressSound";
import { useColorKeyPress } from "../game/useColorKeyPress";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

// Mirrors server/src/game/mortar.ts's STARTING_MORTARS — see
// TeamRosterPanel.tsx for the same constant and reasoning.
const MAX_MORTARS = 5;

// Keyboard button presses (useColorKeyPress) are restricted to this one
// nickname while the feature's still being tried out online — everyone else
// keeps playing touch/click-only. Solo mode (SoloPlayScreen) doesn't have
// this restriction because it dropped keyboard support entirely instead.
const KEYBOARD_PRESS_ALLOWED_NICKNAME = "홍바들";

export function MyTurnScreen({
  room,
  me,
  clockOffsetMs,
  onMyPress,
  onMyTurnStart,
}: {
  room: Room<MatchState>;
  me: PlayerState;
  clockOffsetMs: number;
  // Game.tsx의 usePersonalPressSpeed()가 반환하는 recordPress/resetAnchor —
  // 이 화면은 보통 활성 팀이 바뀔 때마다 언마운트/리마운트되지만(누적 평균
  // 자체는 이 컴포넌트 밖(Game.tsx)에 살아있어야 턴이 넘어가도 안 날아감),
  // 다른 팀이 전부 탈락해 내 팀 혼자 남으면 activeTeamIndex가 매 턴 그대로라
  // 이 컴포넌트가 리마운트 없이 계속 재사용됨(nextActiveTeamIndex가 남은
  // 팀이 하나뿐이면 currentIndex를 그대로 반환 — server/src/game/rotation.ts).
  // 그래서 "마운트 1회" 대신 turnEndsAt(서버가 startTurn()마다 갱신하는 값,
  // 리마운트 여부와 무관하게 매 턴 바뀜)이 바뀔 때마다 리셋한다.
  onMyPress: () => void;
  onMyTurnStart: () => void;
}) {
  const { sequence, cursor, turnOutcome, missedRole, round, turnEndsAt, teams, bonusItemIndex, bonusItemId } =
    room.state;
  const myTeam = teams.find((team) => team.id === me.teamId);
  const disabled = turnOutcome !== "pending";
  // My own presses already get instant local feedback (ButtonPanel plays on
  // press, before the server round-trip) — this is for hearing my
  // teammate's presses, which I'd otherwise only see, never hear.
  useSequencePressSound(sequence, cursor, me.role as "pig" | "rabbit");

  // turnEndsAt이 바뀔 때마다(= 새 턴이 시작될 때마다, 리마운트 여부와 무관하게)
  // 기준점을 리셋 — 턴 사이 공백이 평균속도 계산에 안 섞이게 함
  // (usePersonalPressSpeed.ts 참고).
  useEffect(() => {
    onMyTurnStart();
  }, [turnEndsAt, onMyTurnStart]);

  // room is a stable reference for the lifetime of the connection (set once
  // by useMatchRoom, never reassigned) — memoized so ButtonPanel's own
  // React.memo isn't defeated by a fresh onPress function every render.
  const press = useCallback(
    (color: Color) => {
      room.send("pressButton", { color });
      onMyPress();
    },
    [room, onMyPress],
  );

  const useItem = useCallback(
    (itemId: ItemId) => {
      room.send("useItem", { itemId });
    },
    [room],
  );

  const keyboardPressDisabled = disabled || me.nickname !== KEYBOARD_PRESS_ALLOWED_NICKNAME;
  useColorKeyPress(me.role as "pig" | "rabbit", keyboardPressDisabled, press);

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <p className={styles.round}>ROUND {round}</p>
        {myTeam && (
          <div className={styles.myMortars}>
            {Array.from({ length: MAX_MORTARS }, (_, i) => (
              <img
                key={i}
                className={styles.myMortarHeart}
                alt=""
                src={
                  i < myTeam.mortars
                    ? "/game-assets/ui/thanksgiving_room_heart.png"
                    : "/game-assets/ui/thanksgiving_room_heart_off.png"
                }
              />
            ))}
          </div>
        )}
        <TimerBar turnEndsAt={turnEndsAt} clockOffsetMs={clockOffsetMs} />
        <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
        <div className={styles.boardArea}>
          <SequenceBoard
            sequence={sequence}
            cursor={cursor}
            turnOutcome={turnOutcome}
            missedRole={missedRole}
            bonusItemIndex={bonusItemIndex}
            bonusItemId={bonusItemId}
          />
          <TurnOutcomeBanner outcome={turnOutcome} />
        </div>
      </div>
      <ButtonPanel
        role={me.role as "pig" | "rabbit"}
        disabled={disabled}
        onPress={press}
        // Colyseus mutates this ArraySchema in place on push/splice — the
        // reference itself never changes, so ButtonPanel's React.memo would
        // otherwise miss real content changes (item picked up, then not
        // shown until some unrelated prop like `disabled` happens to flip).
        // A fresh array each render makes the memo comparison see it.
        inventory={Array.from(me.inventory)}
        onUseItem={useItem}
      />
    </div>
  );
}
