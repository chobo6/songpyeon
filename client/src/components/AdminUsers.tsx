import { useEffect, useState } from "react";
import { AdminEditUserModal, type UserRow } from "./AdminEditUserModal";
import styles from "./AdminUsers.module.css";

const PAGE_SIZE = 50;

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; unauthorized: boolean }> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return { ok: false, unauthorized: res.status === 401 };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, unauthorized: false };
  }
}

const EFFECT_LABELS: Record<UserRow["nicknameEffect"], string> = {
  none: "없음",
  rainbow: "레인보우",
  shine: "샤인",
  hologram: "홀로그램",
  pulse: "Pulse",
  neon: "네온사인",
  chrome: "크롬",
};

const PARTICLE_LABELS: Record<UserRow["nicknameParticle"], string> = {
  none: "없음",
  twinkle: "반짝임",
  rising: "상승",
  orbit: "궤도",
  snow: "눈",
};

export function AdminUsers({
  onUnauthorized,
  onBack,
  onOpenMonitor,
}: {
  onUnauthorized: () => void;
  onBack: () => void;
  onOpenMonitor: (userId: number, nickname: string) => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [banningId, setBanningId] = useState<number | null>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  async function loadUsers() {
    const result = await fetchJson<UserRow[]>("/api/admin/users");
    if (!result.ok) {
      if (result.unauthorized) onUnauthorized();
      return;
    }
    setUsers(result.data);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setPage(0);
  }

  async function toggleBan(user: UserRow) {
    setBanningId(user.id);
    setError(null);
    try {
      const endpoint = user.bannedAt ? "unban" : "ban";
      const res = await fetch(`/api/admin/users/${user.id}/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setError("처리에 실패했습니다");
        return;
      }
      await loadUsers();
    } catch {
      setError("처리에 실패했습니다");
    } finally {
      setBanningId(null);
    }
  }

  const filteredUsers = searchQuery.trim()
    ? users.filter((user) => (user.nickname ?? "").includes(searchQuery.trim()))
    : users;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageUsers = filteredUsers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          ← 대시보드로
        </button>
        <h1 className={styles.heading}>유저 정보 ({users.length})</h1>
      </div>
      <input
        className={styles.searchInput}
        value={searchQuery}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="닉네임으로 검색 (일부만 입력해도 됨)"
      />
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p>불러오는 중...</p>
      ) : filteredUsers.length === 0 ? (
        <p className={styles.noResults}>일치하는 유저가 없어요.</p>
      ) : (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>id</th>
                  <th>이메일</th>
                  <th>이름</th>
                  <th>닉네임</th>
                  <th>색상</th>
                  <th>효과</th>
                  <th>가입일</th>
                  <th>최근 로그인</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => (
                  <tr key={user.id} className={user.bannedAt ? styles.bannedRow : undefined}>
                    <td>{user.id}</td>
                    <td>{user.email ?? "-"}</td>
                    <td>{user.name ?? "-"}</td>
                    <td>{user.nickname ?? "-"}</td>
                    <td>
                      <div className={styles.colorDisplayRow}>
                        <span
                          className={styles.colorSwatch}
                          style={{ background: user.nicknameColor ?? "transparent" }}
                        />
                        <span>{user.nicknameColor ?? "-"}</span>
                      </div>
                    </td>
                    <td>
                      {EFFECT_LABELS[user.nicknameEffect]}
                      {user.nicknameGlow ? " + 글로우" : ""}
                      {user.nicknameParticle !== "none" ? ` + ${PARTICLE_LABELS[user.nicknameParticle]}` : ""}
                    </td>
                    <td>{user.createdAt}</td>
                    <td>{user.lastLoginAt ?? "-"}</td>
                    <td className={styles.actionsCell}>
                      <button className={styles.smallButton} onClick={() => setEditingUser(user)}>
                        수정
                      </button>
                      <button
                        className={styles.smallButton}
                        onClick={() => toggleBan(user)}
                        disabled={banningId === user.id}
                      >
                        {user.bannedAt ? "밴 해제" : "밴"}
                      </button>
                      <button
                        className={styles.smallButton}
                        onClick={() => onOpenMonitor(user.id, user.nickname ?? `유저 ${user.id}`)}
                      >
                        모니터링
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <button
              className={styles.smallButton}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              이전
            </button>
            <span className={styles.pageIndicator}>
              {safePage + 1} / {totalPages}
            </span>
            <button
              className={styles.smallButton}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              다음
            </button>
          </div>
        </>
      )}
      {editingUser && (
        <AdminEditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={loadUsers}
          onUnauthorized={onUnauthorized}
        />
      )}
    </main>
  );
}
