import Database from "better-sqlite3";

export function createDb(filename: string): Database.Database {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      nickname TEXT,
      max_round INTEGER NOT NULL DEFAULT 0,
      banned_at TEXT,
      nickname_color TEXT,
      last_login_at TEXT,
      pig_play_count INTEGER NOT NULL DEFAULT 0,
      rabbit_play_count INTEGER NOT NULL DEFAULT 0,
      game_money INTEGER NOT NULL DEFAULT 0,
      nickname_effect TEXT NOT NULL DEFAULT 'none',
      nickname_glow INTEGER NOT NULL DEFAULT 0,
      nickname_particle TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);
  // SQLite's UNIQUE index treats each NULL as distinct from every other NULL,
  // so accounts that haven't set a nickname yet (nickname IS NULL) don't
  // collide with each other — only two non-null nicknames can't match.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)`);

  // 입장/퇴장 로그(IP 포함) — 예전엔 서버 메모리에만 있어서 재배포/재시작마다
  // 사라졌음(admin/eventLog.ts 참고). DB로 옮겨 재시작을 견디게 함.
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_title TEXT NOT NULL,
      ip TEXT NOT NULL,
      session_id TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);

  // 관리자에게 보내는 1회성 문의(답장 없음) — 누가 보냈는지 추적할 수 있게
  // user_id/nickname을 같이 저장한다. events와 달리 개인정보(IP) 보관 목적이
  // 아니라 실제 민원 기록이라 별도 만료 없이 계속 보관한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // CREATE TABLE IF NOT EXISTS only defines max_round/banned_at for a
  // brand-new database — it does nothing to the production DB file, which
  // already has a users table from before these columns existed. ALTER
  // TABLE ADD COLUMN is the migration for that case; guarded so re-running
  // it on an already-migrated DB (every subsequent server start) is a no-op
  // instead of an error.
  const columns = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((col) => col.name);
  if (!columns.includes("max_round")) {
    db.exec(`ALTER TABLE users ADD COLUMN max_round INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("banned_at")) {
    db.exec(`ALTER TABLE users ADD COLUMN banned_at TEXT`);
  }
  if (!columns.includes("nickname_color")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_color TEXT`);
  }
  if (!columns.includes("last_login_at")) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);
  }
  if (!columns.includes("pig_play_count")) {
    db.exec(`ALTER TABLE users ADD COLUMN pig_play_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("rabbit_play_count")) {
    db.exec(`ALTER TABLE users ADD COLUMN rabbit_play_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("game_money")) {
    db.exec(`ALTER TABLE users ADD COLUMN game_money INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("nickname_glow")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_glow INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("nickname_effect")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_effect TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!columns.includes("nickname_particle")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_particle TEXT NOT NULL DEFAULT 'none'`);
  }

  // created_at used to default to UTC (datetime('now')); rows written before
  // this changed to KST (+9 hours, above and in getOrCreateUser's INSERT)
  // still hold UTC values. user_version gates the one-time shift so it never
  // re-runs on a later startup and drifts already-corrected rows forward
  // again — SQLite databases default to user_version 0 and nothing else in
  // this app touches that pragma.
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  if (schemaVersion < 1) {
    db.exec(`UPDATE users SET created_at = datetime(created_at, '+9 hours')`);
    db.pragma("user_version = 1");
  }
  if (schemaVersion < 2) {
    // 신규 DB(CREATE TABLE이 이미 새 스키마로 만듦)는 nickname_rainbow 컬럼이
    // 아예 없으므로, 옛 DB에만 있는 이 컬럼이 실제로 존재할 때만 백필+제거한다.
    if (columns.includes("nickname_rainbow")) {
      db.exec(`UPDATE users SET nickname_effect = 'rainbow' WHERE nickname_rainbow = 1`);
      db.exec(`ALTER TABLE users DROP COLUMN nickname_rainbow`);
    }
    db.pragma("user_version = 2");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted'
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      responded_at TEXT
    )
  `);
  // 한 쌍(A,B) 사이에는 요청 방향과 무관하게 유효한 row가 항상 하나만 있어야 함 —
  // 애플리케이션 레벨에서 보장(friends/friendships.ts의 sendFriendRequest 참고).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_messages_pair ON direct_messages(sender_id, recipient_id, id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_messages_pair2 ON direct_messages(recipient_id, sender_id, id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_read_state (
      user_id INTEGER NOT NULL,
      other_user_id INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, other_user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS owned_nickname_effects (
      user_id INTEGER NOT NULL,
      effect TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'admin', -- 'purchase' | 'admin' — admin이 지급한 건 회수 시 소유권도 같이 지워지지만, 실제 구매는 절대 자동으로 뺏기지 않음
      purchased_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      PRIMARY KEY (user_id, effect)
    )
  `);
  // 이 테이블이 처음 배포됐을 땐 source 컬럼이 없었음 — 그 시점에 생긴 기존 행은
  // 전부 관리자 테스트 지급이었으므로(아직 실제 구매 사례 없음) 'admin'으로
  // 백필해도 안전하고, 그래야 이번 회수 로직으로 바로 정리됨.
  const ownedEffectColumns = (db.prepare(`PRAGMA table_info(owned_nickname_effects)`).all() as { name: string }[]).map(
    (col) => col.name,
  );
  if (!ownedEffectColumns.includes("source")) {
    db.exec(`ALTER TABLE owned_nickname_effects ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'`);
  }

  // daily_visits(집계 카운터)는 사용자당 하루 1회 중복 제거 방식으로
  // 바뀌면서 폐기됐다 — 기존에 쌓인 값을 초기화하려는 의도도 겸해서
  // DROP한다. 매 시작마다 실행해도 안전(두 번째 시작부턴 이미 없어서 no-op).
  db.exec(`DROP TABLE IF EXISTS daily_visits`);

  // 로그인 여부와 무관하게 사이트에 들어온 방문자를 "하루에 한 명당 1회"로
  // 집계한다 — visitor_key가 PRIMARY KEY의 일부라 INSERT OR IGNORE 한 번으로
  // 중복 제거가 끝난다(dailyVisits.ts 참고). user_id 대신 문자열 키를 쓰는
  // 이유: 로그인 유저는 "user:<id>", 비로그인 유저는 "ip:<IP>"로 서로 다른
  // 식별 방식을 한 컬럼에 같이 담기 위함. IP가 들어갈 수 있으므로 events
  // 테이블과 동일하게 90일 보관 후 자동 삭제(dailyVisits.ts의
  // recordVisitForDate 참고).
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_visit_log (
      date TEXT NOT NULL,
      visitor_key TEXT NOT NULL,
      PRIMARY KEY (date, visitor_key)
    )
  `);

  // 계정이 온라인 모드에 진입할 때마다(GET /api/auth/me) 그 계정이 쓴 IP를
  // 누적 기록한다 — events 테이블과 달리 매치룸에 안 들어가도(로그인만
  // 해도) 기록된다. PRIMARY KEY (user_id, ip)라 같은 IP로 다시 들어오면
  // last_seen만 갱신되고(중복 행 없음), 새 IP면 새 행이 추가된다.
  // 보관 기간: 무기한(이 테이블의 존재 이유 자체가 장기 조사 목적이라
  // events/daily_visit_log의 90일 자동 삭제를 의도적으로 적용하지 않는다).
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_ips (
      user_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      PRIMARY KEY (user_id, ip)
    )
  `);

  // 대기실/인게임 채팅 로그 — MatchRoom.pushChat이 실제 유저 발화(닉네임이 있는
  // 메시지, 입장/퇴장 같은 시스템 안내 제외)마다 기록한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);

  return db;
}

export const db = createDb(process.env.SQLITE_DB_PATH ?? "data/songpyeon.db");

// SQLite는 boolean이 없어 0/1 INTEGER로 저장한다 — 이 값을 읽는 모든 곳(여러
// 파일에 흩어진 SELECT 결과)에서 이 함수로 명시적으로 변환해서 실제 TS
// boolean으로 다룬다. 그냥 `as SomeType`으로 캐스팅하면 타입은 boolean인데
// 실제 값은 0/1 숫자로 남아있는 거짓말이 생긴다.
export function sqliteBool(value: number): boolean {
  return value === 1;
}
