import { useEffect, useState } from "react";
import styles from "./AdminInquiries.module.css";

type Inquiry = {
  id: number;
  userId: number;
  nickname: string;
  title: string;
  content: string;
  createdAt: number;
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

export function AdminInquiries({
  onUnauthorized,
  onBack,
}: {
  onUnauthorized: () => void;
  onBack: () => void;
}) {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Inquiry[]>("/api/admin/inquiries").then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.unauthorized) onUnauthorized();
        return;
      }
      setInquiries(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          ← 대시보드로
        </button>
        <h1 className={styles.heading}>문의 내역 ({inquiries.length})</h1>
      </div>
      {loading ? (
        <p>불러오는 중...</p>
      ) : inquiries.length === 0 ? (
        <p className={styles.noResults}>접수된 문의가 없어요.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>시각</th>
                <th>닉네임</th>
                <th>제목</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((inquiry) => (
                <tr key={inquiry.id}>
                  <td>{new Date(inquiry.createdAt).toLocaleString()}</td>
                  <td>{inquiry.nickname}</td>
                  <td>{inquiry.title}</td>
                  <td className={styles.contentCell}>{inquiry.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
