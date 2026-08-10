import { useEffect, useState } from "react";
import { getDuoListings, type DuoListingEntry, type DuoPosition } from "../game/duoBoard";
import { nicknameStyle } from "../game/nicknameStyle";
import { ProfileModal } from "./ProfileModal";
import { DuoPostModal } from "./DuoPostModal";
import styles from "./DuoBoardModal.module.css";

const PAGE_SIZE = 10;

const POSITION_LABEL: Record<DuoPosition, string> = {
  pig: "🐷 돼지",
  rabbit: "🐰 토끼",
  any: "🔀 상관없음",
};

export function DuoBoardModal({ myNickname, onClose }: { myNickname: string; onClose: () => void }) {
  const [listings, setListings] = useState<DuoListingEntry[] | null>(null);
  const [page, setPage] = useState(0);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [showPostModal, setShowPostModal] = useState(false);

  function refresh() {
    getDuoListings()
      .then(setListings)
      .catch(() => setListings([]));
  }

  useEffect(refresh, []);

  const myListing = listings?.find((l) => l.nickname === myNickname) ?? null;
  const pageCount = listings ? Math.max(1, Math.ceil(listings.length / PAGE_SIZE)) : 1;
  const pageListings = listings?.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) ?? [];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>듀오 구인</h2>

        <button className={styles.postButton} onClick={() => setShowPostModal(true)}>
          {myListing ? "내 구인글 수정" : "글쓰기"}
        </button>

        <section className={styles.section}>
          {listings === null && <p className={styles.loading}>불러오는 중...</p>}
          {listings?.length === 0 && <p className={styles.empty}>아직 구인 글이 없어요</p>}
          {pageListings.map((l) => {
            const effect = nicknameStyle(l.nicknameColor, l.nicknameEffect, l.nicknameGlow, l.nicknameParticle);
            return (
              <div key={l.userId} className={styles.row}>
                <div className={styles.rowTop}>
                  <button className={styles.rowNickname} onClick={() => setProfileNickname(l.nickname)}>
                    <span className={effect.className} style={effect.style}>
                      {l.nickname}
                      {effect.particles.map((p) => (
                        <span key={p.key} className={p.className} style={p.style} />
                      ))}
                    </span>
                  </button>
                  <span className={styles.position}>{POSITION_LABEL[l.position]}</span>
                  <span className={styles.maxRound}>최고 {l.maxRound}라운드</span>
                </div>
                <p className={styles.timeSlot}>접속 시간대 - {l.timeSlot}</p>
                <p className={styles.description}>{l.description}</p>
              </div>
            );
          })}
        </section>

        {listings !== null && listings.length > PAGE_SIZE && (
          <div className={styles.pagination}>
            <button
              className={styles.pageButton}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              이전
            </button>
            <span className={styles.pageIndicator}>
              {page + 1} / {pageCount}
            </span>
            <button
              className={styles.pageButton}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              다음
            </button>
          </div>
        )}

        {showPostModal && (
          <DuoPostModal
            existingListing={myListing}
            onClose={() => setShowPostModal(false)}
            onSaved={refresh}
          />
        )}
        {profileNickname && (
          <ProfileModal
            nickname={profileNickname}
            onClose={() => {
              setProfileNickname(null);
              refresh();
            }}
          />
        )}

        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
