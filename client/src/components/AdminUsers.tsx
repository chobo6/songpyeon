import { useEffect, useState } from "react";
import styles from "./AdminUsers.module.css";

const MAX_NICKNAME_LENGTH = 10;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type UserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
};

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; unauthorized: boolean }> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return { ok: false, unauthorized: res.status === 401 };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, unauthorized: false };
  }
}

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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [banningId, setBanningId] = useState<number | null>(null);
  // 닉네임 수정과 완전히 독립된 별도 상태 — 한쪽을 고치는 동안 다른 쪽 편집 UI가
  // 안 열려있어도 되고, 서로의 저장/취소가 서로에게 영향을 안 준다.
  const [colorEditingId, setColorEditingId] = useState<number | null>(null);
  const [colorEditValue, setColorEditValue] = useState("");
  const [colorSaving, setColorSaving] = useState(false);

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

  function startEdit(user: UserRow) {
    setEditingId(user.id);
    setEditValue(user.nickname ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveEdit(id: number) {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}/nickname`, {
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
      setEditingId(null);
      await loadUsers();
    } catch {
      setError("닉네임 변경에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  function startColorEdit(user: UserRow) {
    setColorEditingId(user.id);
    setColorEditValue(user.nicknameColor ?? "");
    setError(null);
  }

  function cancelColorEdit() {
    setColorEditingId(null);
    setError(null);
  }

  async function saveColorEdit(id: number) {
    const trimmed = colorEditValue.trim();
    if (trimmed && !HEX_COLOR_PATTERN.test(trimmed)) {
      setError("#RRGGBB 형식의 색상 코드를 입력해주세요.");
      return;
    }
    setColorSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}/nickname-color`, {
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
      setColorEditingId(null);
      await loadUsers();
    } catch {
      setError("색상 변경에 실패했습니다");
    } finally {
      setColorSaving(false);
    }
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
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="닉네임으로 검색 (일부만 입력해도 됨)"
      />
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p>불러오는 중...</p>
      ) : filteredUsers.length === 0 ? (
        <p className={styles.noResults}>일치하는 유저가 없어요.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>id</th>
                <th>이메일</th>
                <th>이름</th>
                <th>닉네임</th>
                <th>색상</th>
                <th>가입일</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className={user.bannedAt ? styles.bannedRow : undefined}>
                  <td>{user.id}</td>
                  <td>{user.email ?? "-"}</td>
                  <td>{user.name ?? "-"}</td>
                  <td>
                    {editingId === user.id ? (
                      <input
                        className={styles.editInput}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        maxLength={MAX_NICKNAME_LENGTH}
                        autoFocus
                      />
                    ) : (
                      user.nickname ?? "-"
                    )}
                  </td>
                  <td>
                    {colorEditingId === user.id ? (
                      <div className={styles.colorEditRow}>
                        <input
                          className={styles.colorInput}
                          value={colorEditValue}
                          onChange={(e) => setColorEditValue(e.target.value)}
                          placeholder="#ff6b6b"
                          autoFocus
                        />
                        <button
                          className={styles.smallButton}
                          onClick={() => saveColorEdit(user.id)}
                          disabled={colorSaving}
                        >
                          저장
                        </button>
                        <button className={styles.smallButton} onClick={cancelColorEdit} disabled={colorSaving}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className={styles.colorDisplayRow}>
                        <span
                          className={styles.colorSwatch}
                          style={{ background: user.nicknameColor ?? "transparent" }}
                        />
                        <span>{user.nicknameColor ?? "-"}</span>
                        <button className={styles.smallButton} onClick={() => startColorEdit(user)}>
                          수정
                        </button>
                      </div>
                    )}
                  </td>
                  <td>{user.createdAt}</td>
                  <td className={styles.actionsCell}>
                    {editingId === user.id ? (
                      <>
                        <button
                          className={styles.smallButton}
                          onClick={() => saveEdit(user.id)}
                          disabled={saving || !editValue.trim()}
                        >
                          저장
                        </button>
                        <button className={styles.smallButton} onClick={cancelEdit} disabled={saving}>
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button className={styles.smallButton} onClick={() => startEdit(user)}>
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
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
