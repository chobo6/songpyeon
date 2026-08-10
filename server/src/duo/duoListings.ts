import { db, sqliteBool } from "../db/connection";
import type { NicknameEffect, NicknameParticle } from "../auth/googleAuth";

export type DuoPosition = "pig" | "rabbit" | "any";
const VALID_POSITIONS: readonly DuoPosition[] = ["pig", "rabbit", "any"];

export const MAX_TIME_SLOT_LENGTH = 12;
export const MAX_DESCRIPTION_LENGTH = 30;

// 셋 다 실패 시 ""를 반환 — 호출부(라우트)가 빈 값을 보고 거부한다
// (sanitizeRoomTitle과 같은 계약).
export function sanitizeDuoPosition(input: unknown): DuoPosition | "" {
  return typeof input === "string" && (VALID_POSITIONS as string[]).includes(input) ? (input as DuoPosition) : "";
}

export function sanitizeDuoTimeSlot(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_TIME_SLOT_LENGTH);
}

export function sanitizeDuoDescription(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

export type DuoListingEntry = {
  userId: number;
  nickname: string;
  maxRound: number;
  position: DuoPosition;
  timeSlot: string;
  description: string;
  createdAt: string;
  nicknameColor: string | null;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};

export function upsertDuoListing(userId: number, position: DuoPosition, timeSlot: string, description: string): void {
  db.prepare(
    `INSERT INTO duo_listings (user_id, position, time_slot, description) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       position = excluded.position,
       time_slot = excluded.time_slot,
       description = excluded.description,
       created_at = datetime('now', '+9 hours')`,
  ).run(userId, position, timeSlot, description);
}

export function removeDuoListing(userId: number): void {
  db.prepare(`DELETE FROM duo_listings WHERE user_id = ?`).run(userId);
}

// 최신 게시(재게시 포함)가 위로 오도록 정렬. maxRound는 users 테이블에서 매번
// 새로 조인해서 가져온다 — 게시 이후 최고라운드가 갱신돼도 글에 자동 반영되게.
export function listDuoListings(): DuoListingEntry[] {
  const rows = db
    .prepare(
      `SELECT d.user_id AS userId,
              u.nickname AS nickname,
              u.max_round AS maxRound,
              d.position AS position,
              d.time_slot AS timeSlot,
              d.description AS description,
              d.created_at AS createdAt,
              u.nickname_color AS nicknameColor,
              u.nickname_effect AS nicknameEffect,
              u.nickname_glow AS nicknameGlow,
              u.nickname_particle AS nicknameParticle
       FROM duo_listings d
       JOIN users u ON u.id = d.user_id
       ORDER BY d.created_at DESC`,
    )
    .all() as (Omit<DuoListingEntry, "nicknameGlow"> & { nicknameGlow: number })[];
  return rows.map((row) => ({
    ...row,
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM duo_listings`);
}
