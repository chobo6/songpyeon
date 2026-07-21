import { useEffect, useState } from "react";
import styles from "./AdminUsers.module.css";

const MAX_NICKNAME_LENGTH = 10;

type UserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
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

export function AdminUsers({ onUnauthorized, onBack }: { onUnauthorized: () => void; onBack: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [banningId, setBanningId] = useState<number | null>(null);

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

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          ← 대시보드로
        </button>
        <h1 className={styles.heading}>유저 정보 ({users.length})</h1>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>id</th>
                <th>이메일</th>
                <th>이름</th>
                <th>닉네임</th>
                <th>가입일</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
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
