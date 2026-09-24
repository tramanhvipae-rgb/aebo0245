'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'tu.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS nhan_vien (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ho_ten            TEXT NOT NULL,
  bo_account        TEXT NOT NULL UNIQUE,
  brand             TEXT NOT NULL DEFAULT 'AE888',
  vai_tro           TEXT NOT NULL DEFAULT 'CS',
  muc               TEXT NOT NULL DEFAULT 'thuong',   -- thuong | cao
  telegram_id       TEXT UNIQUE,
  bind_token        TEXT,
  pin_hash          TEXT,
  seed_enc          TEXT,
  ca_bat_dau        TEXT NOT NULL DEFAULT '09:00',
  ca_ket_thuc       TEXT NOT NULL DEFAULT '21:00',
  tz_offset         INTEGER NOT NULL DEFAULT 420,     -- VN 420, ARM 240
  han_muc_ca        INTEGER NOT NULL DEFAULT 20,
  trang_thai        TEXT NOT NULL DEFAULT 'hoat_dong', -- hoat_dong | khoa
  sai_pin_lien_tiep INTEGER NOT NULL DEFAULT 0,
  khoa_tam_den      INTEGER,
  tao_luc           INTEGER NOT NULL,
  sua_luc           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nhat_ky (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nhan_vien_id INTEGER,
  bo_account  TEXT,
  hanh_dong   TEXT NOT NULL,
  ket_qua     TEXT NOT NULL,
  chi_tiet    TEXT,
  nguon       TEXT,
  ip          TEXT,
  nguoi_duyet TEXT,
  luc         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhat_ky_luc ON nhat_ky(luc DESC);
CREATE INDEX IF NOT EXISTS idx_nhat_ky_nv ON nhat_ky(nhan_vien_id, luc DESC);

CREATE TABLE IF NOT EXISTS canh_bao (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nhan_vien_id INTEGER,
  loai        TEXT NOT NULL,
  noi_dung    TEXT NOT NULL,
  da_xem      INTEGER NOT NULL DEFAULT 0,
  luc         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canh_bao_luc ON canh_bao(luc DESC);

CREATE TABLE IF NOT EXISTS yeu_cau_duyet (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nhan_vien_id INTEGER NOT NULL,
  ly_do       TEXT,
  trang_thai  TEXT NOT NULL DEFAULT 'cho',  -- cho | duyet | tu_choi | het_han
  nguon       TEXT,
  chat_id     TEXT,
  message_id  TEXT,
  tao_luc     INTEGER NOT NULL,
  het_han_luc INTEGER NOT NULL,
  quyet_luc   INTEGER
);

CREATE TABLE IF NOT EXISTS ma_pha_kinh (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nhan_vien_id INTEGER NOT NULL,
  ma_hash     TEXT NOT NULL,
  dung_luc    INTEGER,
  tao_luc     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gan_may (
  telegram_id  TEXT NOT NULL,
  nhan_vien_id INTEGER NOT NULL,
  nhan_dang    TEXT,
  tao_luc      INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, nhan_vien_id)
);

CREATE TABLE IF NOT EXISTS thiet_bi (
  may_id     TEXT PRIMARY KEY,      -- chuỗi ngẫu nhiên sinh trên máy, lưu ở C:\\TuPhatMa
  van_tay    TEXT NOT NULL,         -- băm của tên máy + MachineGuid + serial ổ C
  ten_may    TEXT,
  trang_thai TEXT NOT NULL DEFAULT 'cho',   -- cho | duyet | tu_choi
  nhan_vien_id INTEGER,             -- ai xin đăng ký máy này
  tao_luc    INTEGER NOT NULL,
  duyet_luc  INTEGER
);

CREATE TABLE IF NOT EXISTS chan_telegram (
  telegram_id TEXT PRIMARY KEY,
  nhan_dang   TEXT,
  ly_do       TEXT,
  den_luc     INTEGER NOT NULL,
  tao_luc     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cai_dat (
  khoa     TEXT PRIMARY KEY,
  gia_tri  TEXT NOT NULL
);
`);

// Cột thêm sau này — bỏ qua nếu đã có.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN cho_nhieu_may INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN doi_may_luc INTEGER'); } catch (e) {}
// Ngày (theo giờ nơi người đó làm) mà mã gắn Telegram đã được dùng lần gần nhất.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN bind_ngay TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN bind_luc INTEGER'); } catch (e) {}
// Mốc bắt đầu ca mà mã gắn Telegram đã được mở. Hết ca là gắn hết hiệu lực.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN bind_ca_start INTEGER'); } catch (e) {}
// Máy mà tài khoản này đã gắn trong ca hiện tại. Giữ độc lập với bảng gan_may:
// nhường máy sẽ xoá dòng trong gan_may, nhưng dấu vết "ca này đã gắn máy nào"
// phải còn, nếu không mã CCB được tự do nhảy sang máy khác.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN bind_may_id TEXT'); } catch (e) {}
// Mốc ca đã bắn lệnh đá phiên BO, để không bắn lại nhiều lần cho cùng một ca.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN da_da_ca INTEGER'); } catch (e) {}
// ID nội bộ của tài khoản trong BO. Endpoint đá phiên thường nhận ID này chứ không
// nhận tên tài khoản. Để trống nếu BO nhận thẳng tên.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN bo_user_id TEXT'); } catch (e) {}
// Dấu vân HMAC của mã CCB. Từ khi bỏ mã cá nhân thì CCB là bí mật duy nhất,
// nên không lưu chuỗi gốc nữa.
try { db.exec('ALTER TABLE nhan_vien ADD COLUMN bind_hmac TEXT'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_bind_hmac ON nhan_vien(bind_hmac)'); } catch (e) {}


// Lịch làm việc theo từng ngày.
// - Dòng WORK/OFF có thể dùng như override thủ công.
// - Khi một tháng được đánh dấu trong lich_thang_ap_dung, file tháng là nguồn chuẩn:
//   ngày không có dòng WORK/OFF cũng được hiểu là OFF, tuyệt đối không fallback ca mặc định.
db.exec(`
CREATE TABLE IF NOT EXISTS lich_lam_viec (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nhan_vien_id    INTEGER NOT NULL,
  ngay            TEXT NOT NULL,                    -- YYYY-MM-DD theo lịch làm việc
  ca_bat_dau      TEXT,
  ca_ket_thuc     TEXT,
  tz_offset       INTEGER NOT NULL,
  trang_thai      TEXT NOT NULL DEFAULT 'WORK',     -- WORK | OFF
  bat_dau_luc     INTEGER,
  ket_thuc_luc    INTEGER,
  tu_tinh_ket_thuc INTEGER NOT NULL DEFAULT 0,       -- 1 = file chỉ ghi giờ vào; giờ ra theo độ dài ca NV
  nguon           TEXT NOT NULL DEFAULT 'IMPORT',
  tao_luc         INTEGER NOT NULL,
  sua_luc         INTEGER NOT NULL,
  UNIQUE(nhan_vien_id, ngay),
  FOREIGN KEY(nhan_vien_id) REFERENCES nhan_vien(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lich_nv_ngay ON lich_lam_viec(nhan_vien_id, ngay);
CREATE INDEX IF NOT EXISTS idx_lich_ket_thuc ON lich_lam_viec(ket_thuc_luc);

CREATE TABLE IF NOT EXISTS lich_thang_ap_dung (
  nhan_vien_id INTEGER NOT NULL,
  thang        TEXT NOT NULL,                       -- YYYY-MM
  nguon        TEXT NOT NULL DEFAULT 'IMPORT',
  sua_luc      INTEGER NOT NULL,
  PRIMARY KEY (nhan_vien_id, thang),
  FOREIGN KEY(nhan_vien_id) REFERENCES nhan_vien(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lich_thang ON lich_thang_ap_dung(thang);
`);

// Từ V6: mọi ca WORK chỉ giữ giờ vào; giờ ra luôn chạy theo "Độ dài ca" của nhân viên.
// Cột giữ lại để tương thích dữ liệu cũ, nhưng WORK luôn = 1, OFF luôn = 0.
try { db.exec('ALTER TABLE lich_lam_viec ADD COLUMN tu_tinh_ket_thuc INTEGER'); } catch (e) {}
try { db.exec(`UPDATE lich_lam_viec SET tu_tinh_ket_thuc=1 WHERE trang_thai='WORK'`); } catch (e) {}
try { db.exec(`UPDATE lich_lam_viec SET tu_tinh_ket_thuc=0 WHERE trang_thai='OFF'`); } catch (e) {}

// Chuyển các gắn máy 1-1 cũ sang bảng nhiều-nhiều. Chạy một lần, không hại nếu chạy lại.
db.prepare(`INSERT OR IGNORE INTO gan_may (telegram_id, nhan_vien_id, tao_luc)
  SELECT telegram_id, id, sua_luc FROM nhan_vien WHERE telegram_id IS NOT NULL`).run();

const now = () => Date.now();


const pad2 = (n) => String(n).padStart(2, '0');
function ngayTheoOffset(tzOffset, ms = Date.now()) {
  const d = new Date(ms + Number(tzOffset || 0) * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function lechNgay(ymd, delta) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + delta));
  return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
}
function mocLich(ngay, batDau, ketThuc, tzOffset) {
  if (!batDau || !ketThuc) return { bat_dau_luc: null, ket_thuc_luc: null };
  const [y, m, d] = String(ngay).split('-').map(Number);
  const [h1, p1] = String(batDau).split(':').map(Number);
  const [h2, p2] = String(ketThuc).split(':').map(Number);
  const off = Number(tzOffset || 0) * 60000;
  const aPhut = h1 * 60 + p1, bPhut = h2 * 60 + p2;
  const bat_dau_luc = Date.UTC(y, m - 1, d, h1, p1) - off;
  const ket_thuc_luc = Date.UTC(y, m - 1, d + (bPhut <= aPhut ? 1 : 0), h2, p2) - off;
  return { bat_dau_luc, ket_thuc_luc };
}
function ganLichRuntime(nv, ms = Date.now()) {
  if (!nv) return nv;
  const hom = ngayTheoOffset(nv.tz_offset, ms);
  const ngay = [lechNgay(hom, -1), hom, lechNgay(hom, 1)];
  const ds = db.prepare(`SELECT * FROM lich_lam_viec
    WHERE nhan_vien_id = ? AND ngay IN (?,?,?) ORDER BY ngay`).all(nv.id, ...ngay);
  const thangs = [...new Set(ngay.map((d) => d.slice(0, 7)))];
  const marks = thangs.length
    ? db.prepare(`SELECT thang FROM lich_thang_ap_dung
        WHERE nhan_vien_id = ? AND thang IN (${thangs.map(() => '?').join(',')})`)
        .all(nv.id, ...thangs).map((r) => r.thang)
    : [];
  return { ...nv, _lich_ngay: ds, _lich_thang_ap_dung: marks };
}

/* ---------- nhân viên ---------- */
// Bản trả ra cho trình duyệt. Tuyệt đối KHÔNG có bind_token, bind_hmac, seed_enc:
// mã CCB giờ là bí mật duy nhất, lộ nó là lộ tất cả.
const NV_FIELDS = `id, ho_ten, bo_account, brand, vai_tro, muc,
  ca_bat_dau, ca_ket_thuc, tz_offset, han_muc_ca, trang_thai, sai_pin_lien_tiep, cho_nhieu_may,
  bind_ca_start, bind_may_id, da_da_ca, bo_user_id, (bind_hmac IS NOT NULL) AS co_ma_bind,
  khoa_tam_den, tao_luc, sua_luc,
  (seed_enc IS NOT NULL) AS co_hat_giong,
  (SELECT COUNT(*) FROM gan_may g WHERE g.nhan_vien_id = nhan_vien.id) AS so_may`;

// Bản public: KHÔNG chứa seed_enc, KHÔNG chứa pin_hash.
const listNhanVien = () =>
  db.prepare(`SELECT ${NV_FIELDS} FROM nhan_vien ORDER BY brand, ho_ten`).all();

const getNhanVienPublic = (id) =>
  db.prepare(`SELECT ${NV_FIELDS} FROM nhan_vien WHERE id = ?`).get(id);

// Bản nội bộ, chỉ dùng trong service/totp. Không bao giờ trả thẳng ra HTTP.
const getNhanVienFull = (id) =>
  ganLichRuntime(db.prepare('SELECT * FROM nhan_vien WHERE id = ?').get(id));
const getByTelegram = (tid) =>
  ganLichRuntime(db.prepare('SELECT * FROM nhan_vien WHERE telegram_id = ?').get(String(tid)));
const getByBoAccount = (acc) =>
  ganLichRuntime(db.prepare('SELECT * FROM nhan_vien WHERE bo_account = ?').get(acc));
const getByBoAccountCI = (acc) =>
  ganLichRuntime(db.prepare('SELECT * FROM nhan_vien WHERE lower(bo_account) = lower(?)').get(String(acc)));
function getByNameCI(name) {
  const rows = db.prepare('SELECT * FROM nhan_vien WHERE lower(trim(ho_ten)) = lower(trim(?))').all(String(name || ''));
  return rows.length === 1 ? ganLichRuntime(rows[0]) : (rows.length ? { _nhieu_ket_qua: true, _so_luong: rows.length } : undefined);
}
const getByBindHmac = (h) =>
  ganLichRuntime(db.prepare('SELECT * FROM nhan_vien WHERE bind_hmac = ?').get(h));

function themNhanVien(d) {
  const t = now();
  const r = db.prepare(`INSERT INTO nhan_vien
    (ho_ten, bo_account, brand, vai_tro, muc, ca_bat_dau, ca_ket_thuc, tz_offset,
     han_muc_ca, tao_luc, sua_luc)
    VALUES (@ho_ten, @bo_account, @brand, @vai_tro, @muc, @ca_bat_dau, @ca_ket_thuc,
            @tz_offset, @han_muc_ca, @tao_luc, @sua_luc)`)
    .run({ ...d, tao_luc: t, sua_luc: t });
  return r.lastInsertRowid;
}

function capNhatNhanVien(id, d) {
  const cols = Object.keys(d);
  if (!cols.length) return;
  const set = cols.map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE nhan_vien SET ${set}, sua_luc = @sua_luc WHERE id = @id`)
    .run({ ...d, id, sua_luc: now() });
}

/**
 * Xoá một người khỏi tủ. Dọn luôn gắn máy, mã phá kính, yêu cầu duyệt đang treo.
 * Nhật ký giữ nguyên — đã ghi tài khoản BO nên vẫn tra được sau khi người đó biến mất.
 */
const xoaNhanVien = db.transaction((id) => {
  db.prepare('DELETE FROM gan_may WHERE nhan_vien_id = ?').run(id);
  db.prepare('DELETE FROM ma_pha_kinh WHERE nhan_vien_id = ?').run(id);
  db.prepare('DELETE FROM lich_lam_viec WHERE nhan_vien_id = ?').run(id);
  db.prepare("DELETE FROM yeu_cau_duyet WHERE nhan_vien_id = ? AND trang_thai = 'cho'").run(id);
  db.prepare('DELETE FROM nhan_vien WHERE id = ?').run(id);
});

/* ---------- nhật ký ---------- */
function ghiNhatKy(e) {
  db.prepare(`INSERT INTO nhat_ky
    (nhan_vien_id, bo_account, hanh_dong, ket_qua, chi_tiet, nguon, ip, nguoi_duyet, luc)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(e.nhan_vien_id ?? null, e.bo_account ?? null, e.hanh_dong, e.ket_qua,
         e.chi_tiet ?? null, e.nguon ?? null, e.ip ?? null, e.nguoi_duyet ?? null, now());
}

function docNhatKy({ nhan_vien_id, hanh_dong, tu, limit = 200 } = {}) {
  const w = [], p = [];
  if (nhan_vien_id) { w.push('n.nhan_vien_id = ?'); p.push(nhan_vien_id); }
  if (hanh_dong) { w.push('n.hanh_dong = ?'); p.push(hanh_dong); }
  if (tu) { w.push('n.luc >= ?'); p.push(tu); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  return db.prepare(`SELECT n.*, v.ho_ten FROM nhat_ky n
    LEFT JOIN nhan_vien v ON v.id = n.nhan_vien_id
    ${where} ORDER BY n.luc DESC LIMIT ?`).all(...p, limit);
}

const demTuLuc = (nvId, hanhDong, ketQua, tu) =>
  db.prepare(`SELECT COUNT(*) c FROM nhat_ky
    WHERE nhan_vien_id = ? AND hanh_dong = ? AND ket_qua = ? AND luc >= ?`)
    .get(nvId, hanhDong, ketQua, tu).c;

/* ---------- cảnh báo ---------- */
function themCanhBao(nvId, loai, noiDung) {
  db.prepare('INSERT INTO canh_bao (nhan_vien_id, loai, noi_dung, luc) VALUES (?,?,?,?)')
    .run(nvId ?? null, loai, noiDung, now());
}
const docCanhBao = (limit = 100) =>
  db.prepare(`SELECT c.*, v.ho_ten, v.bo_account FROM canh_bao c
    LEFT JOIN nhan_vien v ON v.id = c.nhan_vien_id
    ORDER BY c.luc DESC LIMIT ?`).all(limit);
const danhDauDaXem = () => db.prepare('UPDATE canh_bao SET da_xem = 1').run();

/* ---------- yêu cầu duyệt ---------- */
function taoYeuCauDuyet(nvId, lyDo, nguon, ttlMs = 120000) {
  const t = now();
  const r = db.prepare(`INSERT INTO yeu_cau_duyet
    (nhan_vien_id, ly_do, nguon, tao_luc, het_han_luc) VALUES (?,?,?,?,?)`)
    .run(nvId, lyDo, nguon, t, t + ttlMs);
  return r.lastInsertRowid;
}
const getYeuCau = (id) =>
  db.prepare(`SELECT y.*, v.ho_ten, v.bo_account FROM yeu_cau_duyet y
    JOIN nhan_vien v ON v.id = y.nhan_vien_id WHERE y.id = ?`).get(id);
const capNhatYeuCau = (id, trangThai, extra = {}) => {
  const cols = Object.keys(extra);
  const set = cols.length ? ', ' + cols.map((c) => `${c} = @${c}`).join(', ') : '';
  db.prepare(`UPDATE yeu_cau_duyet SET trang_thai = @tt, quyet_luc = @ql ${set} WHERE id = @id`)
    .run({ ...extra, id, tt: trangThai, ql: now() });
};
const dsYeuCauCho = () =>
  db.prepare(`SELECT y.*, v.ho_ten, v.bo_account FROM yeu_cau_duyet y
    JOIN nhan_vien v ON v.id = y.nhan_vien_id
    WHERE y.trang_thai = 'cho' AND y.het_han_luc > ? ORDER BY y.tao_luc DESC`).all(now());

/* ---------- mã phá kính ---------- */
const xoaMaPhaKinh = (nvId) =>
  db.prepare('DELETE FROM ma_pha_kinh WHERE nhan_vien_id = ?').run(nvId);
const themMaPhaKinh = (nvId, hash) =>
  db.prepare('INSERT INTO ma_pha_kinh (nhan_vien_id, ma_hash, tao_luc) VALUES (?,?,?)')
    .run(nvId, hash, now());
const dsMaPhaKinhChuaDung = (nvId) =>
  db.prepare('SELECT * FROM ma_pha_kinh WHERE nhan_vien_id = ? AND dung_luc IS NULL').all(nvId);
const danhDauDaDung = (id) =>
  db.prepare('UPDATE ma_pha_kinh SET dung_luc = ? WHERE id = ?').run(now(), id);
const demMaPhaKinh = (nvId) =>
  db.prepare('SELECT COUNT(*) c FROM ma_pha_kinh WHERE nhan_vien_id = ? AND dung_luc IS NULL')
    .get(nvId).c;

/* ---------- gắn máy (một Telegram gắn được nhiều tài khoản BO) ---------- */
const themGanMay = (tid, nvId, nhanDang) =>
  db.prepare(`INSERT INTO gan_may (telegram_id, nhan_vien_id, nhan_dang, tao_luc)
    VALUES (?,?,?,?) ON CONFLICT(telegram_id, nhan_vien_id) DO UPDATE SET nhan_dang = excluded.nhan_dang`)
    .run(String(tid), nvId, nhanDang, now());

/** Danh sách tài khoản BO mà một Telegram được phép xin mã. */
const dsTheoTelegram = (tid) =>
  db.prepare(`SELECT v.* FROM gan_may g JOIN nhan_vien v ON v.id = g.nhan_vien_id
    WHERE g.telegram_id = ? ORDER BY v.bo_account`).all(String(tid)).map((nv) => ganLichRuntime(nv));

/**
 * Gắn độc quyền: máy mới vào thì mọi máy cũ của tài khoản BO đó bị gỡ.
 * Trả về danh sách máy vừa bị đá, để bot báo cho cả Jason lẫn máy cũ.
 */
function ganMayDocQuyen(tid, nvId, nhanDang) {
  const cu = db.prepare('SELECT * FROM gan_may WHERE nhan_vien_id = ? AND telegram_id != ?')
    .all(nvId, String(tid));
  const chay = db.transaction(() => {
    db.prepare('DELETE FROM gan_may WHERE nhan_vien_id = ? AND telegram_id != ?').run(nvId, String(tid));
    themGanMay(tid, nvId, nhanDang);
  });
  chay();
  return cu;
}

/** Các máy đang gắn với một tài khoản BO. */
const dsMayCua = (nvId) =>
  db.prepare('SELECT * FROM gan_may WHERE nhan_vien_id = ? ORDER BY tao_luc DESC').all(nvId);

const demMay = (nvId) =>
  db.prepare('SELECT COUNT(*) c FROM gan_may WHERE nhan_vien_id = ?').get(nvId).c;

const xoaGanMay = (tid, nvId) =>
  db.prepare('DELETE FROM gan_may WHERE telegram_id = ? AND nhan_vien_id = ?').run(String(tid), nvId);

/** Gỡ mọi tài khoản BO khác đang gắn trên cùng một máy. Một lúc chỉ một người ngồi. */
const xoaGanMayKhacTren = (tid, nvId) => {
  const cu = db.prepare(`SELECT g.*, v.ho_ten, v.bo_account FROM gan_may g
    JOIN nhan_vien v ON v.id = g.nhan_vien_id
    WHERE g.telegram_id = ? AND g.nhan_vien_id != ?`).all(String(tid), nvId);
  if (cu.length) {
    db.prepare('DELETE FROM gan_may WHERE telegram_id = ? AND nhan_vien_id != ?').run(String(tid), nvId);
  }
  return cu;
};

const xoaMoiMayCua = (nvId) =>
  db.prepare('DELETE FROM gan_may WHERE nhan_vien_id = ?').run(nvId);

/* ---------- thiết bị (máy chạy PowerShell) ---------- */
const themThietBi = (mayId, vanTay, tenMay, nvId) =>
  db.prepare(`INSERT INTO thiet_bi (may_id, van_tay, ten_may, nhan_vien_id, tao_luc)
    VALUES (?,?,?,?,?) ON CONFLICT(may_id) DO UPDATE SET
    van_tay = excluded.van_tay, ten_may = excluded.ten_may,
    nhan_vien_id = excluded.nhan_vien_id, trang_thai = 'cho', tao_luc = excluded.tao_luc, duyet_luc = NULL`)
    .run(String(mayId), vanTay, tenMay ?? null, nvId ?? null, now());

/** Tìm máy theo dấu vân — đây mới là định danh thật của máy vật lý. */
const getThietBiTheoVanTay = (vanTay) =>
  db.prepare('SELECT * FROM thiet_bi WHERE van_tay = ? ORDER BY (trang_thai = \'duyet\') DESC, tao_luc DESC').get(vanTay);

const getThietBi = (mayId) =>
  db.prepare('SELECT * FROM thiet_bi WHERE may_id = ?').get(String(mayId));

const dsThietBi = () =>
  db.prepare(`SELECT t.*, v.ho_ten, v.bo_account,
    (SELECT COUNT(*) FROM gan_may g WHERE g.telegram_id = 'may:' || t.may_id) AS dang_gan
    FROM thiet_bi t LEFT JOIN nhan_vien v ON v.id = t.nhan_vien_id
    ORDER BY (t.trang_thai = 'cho') DESC, t.tao_luc DESC`).all();

const quyetThietBi = (mayId, trangThai) =>
  db.prepare('UPDATE thiet_bi SET trang_thai = ?, duyet_luc = ? WHERE may_id = ?')
    .run(trangThai, now(), String(mayId));

const xoaThietBi = db.transaction((mayId) => {
  db.prepare('DELETE FROM gan_may WHERE telegram_id = ?').run('may:' + mayId);
  db.prepare('DELETE FROM thiet_bi WHERE may_id = ?').run(String(mayId));
});

/* ---------- chặn Telegram ID ---------- */
function chanTelegram(tid, nhanDang, lyDo, denLuc) {
  db.prepare(`INSERT INTO chan_telegram (telegram_id, nhan_dang, ly_do, den_luc, tao_luc)
    VALUES (?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET
    nhan_dang = excluded.nhan_dang, ly_do = excluded.ly_do, den_luc = excluded.den_luc`)
    .run(String(tid), nhanDang, lyDo, denLuc, now());
}
const dangBiChan = (tid) =>
  db.prepare('SELECT * FROM chan_telegram WHERE telegram_id = ? AND den_luc > ?')
    .get(String(tid), now());
const dsChan = () =>
  db.prepare('SELECT * FROM chan_telegram WHERE den_luc > ? ORDER BY tao_luc DESC').all(now());
const boChan = (tid) =>
  db.prepare('DELETE FROM chan_telegram WHERE telegram_id = ?').run(String(tid));

/** Đếm số lần một Telegram ID thử sai, dựa trên nhật ký. */
const demTheoChiTiet = (hanhDong, ketQua, chiTiet, tu) =>
  db.prepare(`SELECT COUNT(*) c FROM nhat_ky
    WHERE hanh_dong = ? AND ket_qua = ? AND chi_tiet = ? AND luc >= ?`)
    .get(hanhDong, ketQua, String(chiTiet), tu).c;


/* ---------- lịch làm việc theo ngày / tháng chính thức ---------- */
function upsertLichNgay(d) {
  const t = now();
  const tt = String(d.trang_thai || 'WORK').toUpperCase() === 'OFF' ? 'OFF' : 'WORK';
  const tz = Number(d.tz_offset ?? 420);
  const m = tt === 'OFF' ? { bat_dau_luc: null, ket_thuc_luc: null }
    : mocLich(d.ngay, d.ca_bat_dau, d.ca_ket_thuc, tz);
  db.prepare(`INSERT INTO lich_lam_viec
    (nhan_vien_id, ngay, ca_bat_dau, ca_ket_thuc, tz_offset, trang_thai,
     bat_dau_luc, ket_thuc_luc, tu_tinh_ket_thuc, nguon, tao_luc, sua_luc)
    VALUES (@nhan_vien_id,@ngay,@ca_bat_dau,@ca_ket_thuc,@tz_offset,@trang_thai,
            @bat_dau_luc,@ket_thuc_luc,@tu_tinh_ket_thuc,@nguon,@tao_luc,@sua_luc)
    ON CONFLICT(nhan_vien_id, ngay) DO UPDATE SET
      ca_bat_dau=excluded.ca_bat_dau, ca_ket_thuc=excluded.ca_ket_thuc,
      tz_offset=excluded.tz_offset, trang_thai=excluded.trang_thai,
      bat_dau_luc=excluded.bat_dau_luc, ket_thuc_luc=excluded.ket_thuc_luc,
      tu_tinh_ket_thuc=excluded.tu_tinh_ket_thuc,
      nguon=excluded.nguon, sua_luc=excluded.sua_luc`)
    .run({ nhan_vien_id: Number(d.nhan_vien_id), ngay: d.ngay,
      ca_bat_dau: tt === 'OFF' ? null : d.ca_bat_dau,
      ca_ket_thuc: tt === 'OFF' ? null : d.ca_ket_thuc,
      tz_offset: tz, trang_thai: tt, ...m,
      tu_tinh_ket_thuc: tt === 'OFF' ? 0 : (d.tu_tinh_ket_thuc ? 1 : 0),
      nguon: d.nguon || 'IMPORT', tao_luc: t, sua_luc: t });
  return db.prepare('SELECT * FROM lich_lam_viec WHERE nhan_vien_id = ? AND ngay = ?')
    .get(Number(d.nhan_vien_id), d.ngay);
}

const getLichNgay = (nvId, ngay) =>
  db.prepare('SELECT * FROM lich_lam_viec WHERE nhan_vien_id = ? AND ngay = ?').get(Number(nvId), ngay);

function danhDauLichThang(nvId, thang, nguon = 'IMPORT') {
  db.prepare(`INSERT INTO lich_thang_ap_dung (nhan_vien_id, thang, nguon, sua_luc) VALUES (?,?,?,?)
    ON CONFLICT(nhan_vien_id, thang) DO UPDATE SET nguon=excluded.nguon, sua_luc=excluded.sua_luc`)
    .run(Number(nvId), String(thang), String(nguon), now());
}
const thangCoLich = (nvId, thang) => !!db.prepare(
  'SELECT 1 FROM lich_thang_ap_dung WHERE nhan_vien_id=? AND thang=?').get(Number(nvId), String(thang));
const xoaDanhDauLichThang = (nvId, thang) => db.prepare(
  'DELETE FROM lich_thang_ap_dung WHERE nhan_vien_id=? AND thang=?').run(Number(nvId), String(thang));
const xoaDanhDauThangTatCa = (thang) => db.prepare(
  'DELETE FROM lich_thang_ap_dung WHERE thang=?').run(String(thang));

function docLichThang({ thang, q = '' } = {}) {
  const p = [String(thang) + '%'];
  let where = 'l.ngay LIKE ?';
  if (q) { where += ' AND (lower(v.ho_ten) LIKE lower(?) OR lower(v.bo_account) LIKE lower(?))'; p.push('%'+q+'%', '%'+q+'%'); }
  return db.prepare(`SELECT l.*, v.ho_ten, v.bo_account, v.vai_tro,
      CASE WHEN l.tz_offset = 240 THEN 'ARM' ELSE 'VN' END AS khu_vuc,
      EXISTS(SELECT 1 FROM lich_thang_ap_dung a WHERE a.nhan_vien_id=l.nhan_vien_id AND a.thang=substr(l.ngay,1,7)) AS lich_thang_chinh_thuc
    FROM lich_lam_viec l JOIN nhan_vien v ON v.id = l.nhan_vien_id
    WHERE ${where} ORDER BY l.ngay, v.ho_ten`).all(...p);
}

function docApDungLichThang({ thang, q = '' } = {}) {
  const p = [String(thang) + '%', String(thang)];
  let where = 'a.thang=?';
  if (q) { where += ' AND (lower(v.ho_ten) LIKE lower(?) OR lower(v.bo_account) LIKE lower(?))'; p.push('%'+q+'%', '%'+q+'%'); }
  return db.prepare(`SELECT a.nhan_vien_id, a.thang, a.nguon, a.sua_luc,
      v.ho_ten, v.bo_account, v.vai_tro, v.tz_offset,
      COUNT(l.id) AS ngay_lam
    FROM lich_thang_ap_dung a
    JOIN nhan_vien v ON v.id=a.nhan_vien_id
    LEFT JOIN lich_lam_viec l ON l.nhan_vien_id=a.nhan_vien_id
      AND l.ngay LIKE ? AND l.trang_thai='WORK'
    WHERE ${where}
    GROUP BY a.nhan_vien_id, a.thang, a.nguon, a.sua_luc, v.ho_ten, v.bo_account, v.vai_tro, v.tz_offset
    ORDER BY v.ho_ten`).all(...p);
}

const xoaLichNgay = (id) => db.prepare('DELETE FROM lich_lam_viec WHERE id = ?').run(Number(id));
const xoaLichKhoang = (nvId, tu, den) =>
  db.prepare('DELETE FROM lich_lam_viec WHERE nhan_vien_id = ? AND ngay BETWEEN ? AND ?')
    .run(Number(nvId), tu, den);
const xoaLichThangCua = (nvId, thang) => db.prepare(
  'DELETE FROM lich_lam_viec WHERE nhan_vien_id=? AND ngay LIKE ?').run(Number(nvId), String(thang) + '%');
const xoaLichThangTatCa = (thang) => db.prepare(
  'DELETE FROM lich_lam_viec WHERE ngay LIKE ?').run(String(thang) + '%');

const lichVuaKetThuc = (nvId, tuMs, denMs) =>
  db.prepare(`SELECT * FROM lich_lam_viec
    WHERE nhan_vien_id = ? AND trang_thai = 'WORK' AND ket_thuc_luc BETWEEN ? AND ?
    ORDER BY ket_thuc_luc DESC LIMIT 1`).get(Number(nvId), Number(tuMs), Number(denMs));

function congGioLich(hhmm, phut) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const total = (((h * 60 + m + Number(phut || 0)) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * Khi đổi "Độ dài ca", mọi ca WORK hôm nay và tương lai đều tính lại giờ ra.
 * File/ngày chỉ giữ GIỜ VÀO; Độ dài ca của nhân viên là nguồn duy nhất cho GIỜ RA.
 * Không viết lại lịch sử đã qua.
 */
function capNhatDoDaiLichTuTinh(nvId, phut) {
  const nv = getNhanVienFull(Number(nvId));
  if (!nv) return 0;
  const tuNgay = ngayTheoOffset(nv.tz_offset, Date.now());
  const rows = db.prepare(`SELECT * FROM lich_lam_viec
    WHERE nhan_vien_id=? AND trang_thai='WORK'
      AND ngay>=?
    ORDER BY ngay`).all(Number(nvId), tuNgay);
  if (!rows.length) return 0;

  const st = db.prepare(`UPDATE lich_lam_viec SET
    ca_ket_thuc=@ca_ket_thuc,
    bat_dau_luc=@bat_dau_luc,
    ket_thuc_luc=@ket_thuc_luc,
    sua_luc=@sua_luc
    WHERE id=@id`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      const kt = congGioLich(r.ca_bat_dau, Number(phut));
      const moc = mocLich(r.ngay, r.ca_bat_dau, kt, r.tz_offset);
      st.run({ id: r.id, ca_ket_thuc: kt, ...moc, sua_luc: now() });
    }
  });
  tx();
  return rows.length;
}

/** Đồng bộ lịch hôm nay + tương lai của tất cả nhân viên theo Độ dài ca hiện tại.
 * Dùng lúc server khởi động để sửa ngay dữ liệu từ bản cũ.
 */
function dongBoTatCaLichTheoDoDai() {
  let tong = 0;
  for (const nv of listNhanVien()) {
    const [h1,m1] = String(nv.ca_bat_dau).split(':').map(Number);
    const [h2,m2] = String(nv.ca_ket_thuc).split(':').map(Number);
    const a = h1*60+m1, b = h2*60+m2;
    const phut = b > a ? b-a : 1440-a+b;
    tong += capNhatDoDaiLichTuTinh(nv.id, phut);
  }
  return tong;
}

/* ---------- cài đặt ---------- */
function docCaiDat(khoa, macDinh = null) {
  const r = db.prepare('SELECT gia_tri FROM cai_dat WHERE khoa = ?').get(khoa);
  return r ? r.gia_tri : macDinh;
}
function datCaiDat(khoa, giaTri) {
  db.prepare('INSERT INTO cai_dat (khoa, gia_tri) VALUES (?,?) ON CONFLICT(khoa) DO UPDATE SET gia_tri = excluded.gia_tri')
    .run(khoa, String(giaTri));
}

/* ---------- đổi ca hàng loạt ---------- */
function doiCaHangLoat(ids, ca) {
  const st = db.prepare(`UPDATE nhan_vien
    SET ca_bat_dau = @ca_bat_dau, ca_ket_thuc = @ca_ket_thuc, tz_offset = @tz_offset, sua_luc = @sua_luc
    WHERE id = @id`);
  const chay = db.transaction((ds) => {
    for (const id of ds) st.run({ ...ca, id, sua_luc: now() });
  });
  chay(ids);
  return ids.length;
}

module.exports = {
  listNhanVien, getNhanVienPublic, getNhanVienFull, getByTelegram, getByBoAccount, getByBoAccountCI, getByNameCI,
  getByBindHmac, themNhanVien, capNhatNhanVien, xoaNhanVien, ganLichRuntime,
  ghiNhatKy, docNhatKy, demTuLuc,
  themCanhBao, docCanhBao, danhDauDaXem,
  taoYeuCauDuyet, getYeuCau, capNhatYeuCau, dsYeuCauCho,
  xoaMaPhaKinh, themMaPhaKinh, dsMaPhaKinhChuaDung, danhDauDaDung, demMaPhaKinh,
  docCaiDat, datCaiDat, doiCaHangLoat,
  upsertLichNgay, getLichNgay, docLichThang, docApDungLichThang, xoaLichNgay, xoaLichKhoang, xoaLichThangCua, xoaLichThangTatCa,
  danhDauLichThang, thangCoLich, xoaDanhDauLichThang, xoaDanhDauThangTatCa, lichVuaKetThuc, capNhatDoDaiLichTuTinh, dongBoTatCaLichTheoDoDai,
  chanTelegram, dangBiChan, dsChan, boChan, demTheoChiTiet,
  themThietBi, getThietBi, getThietBiTheoVanTay, dsThietBi, quyetThietBi, xoaThietBi,
  themGanMay, ganMayDocQuyen, dsTheoTelegram, dsMayCua, demMay, xoaGanMay, xoaMoiMayCua,
  xoaGanMayKhacTren,
  db, DATA_DIR,
};
