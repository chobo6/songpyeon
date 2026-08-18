// Manually mirrors server/src/game/gameMode.ts's GameMode union — see
// matchTypes.ts's own comment for why (separate npm workspaces, no shared
// types package).
export type GameMode = "normal" | "beginner" | "pigOnly" | "rabbitOnly";
