import type { ChatMessage } from "./matchTypes";
import type { DirectMessageEntry } from "./chat";

export function directMessageToChatMessage(m: DirectMessageEntry): ChatMessage {
  return {
    nickname: m.senderNickname,
    nicknameColor: m.senderNicknameColor ?? "",
    nicknameEffect: m.senderNicknameEffect,
    nicknameGlow: m.senderNicknameGlow,
    text: m.text,
    sentAt: new Date(`${m.createdAt.replace(" ", "T")}+09:00`).getTime(),
  };
}
