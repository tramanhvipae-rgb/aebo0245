'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const crypto = require('./src/crypto');
const db = require('./src/db');
const svc = require('./src/service');
const bot = require('./src/bot');
const nhansu = require('./src/nhansu');
const lich = require('./src/lich');
const may = require('./src/may');
const hengio = require('./src/hengio');
const totp = require('./src/totp');
const { ca_hieu_luc, gioDiaPhuong, congGio, doDaiPhut, LUAT } = require('./src/policy');

try {
  const n = db.dongBoTatCaLichTheoDoDai ? db.dongBoTatCaLichTheoDoDai() : 0;
  if (n) console.log(`[tủ] Đã đồng bộ ${n} ca lịch theo Độ dài ca hiện tại.`);
} catch (e) {
  console.warn('[tủ] Không đồng bộ được lịch theo độ dài ca:', e.message);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

// Tăng số này mỗi khi giao thức với máy trạm đổi. Script so số này với số của nó
// và báo ngay nếu lệch — client mới ghép server cũ là nguồn của mọi lỗi khó hiểu.
const PHIEN_BAN = 5;

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MASTER_KEY = process.env.MASTER_KEY || '';

/* ---------------- mở khoá ---------------- */
// Có MASTER_KEY trong env thì mở khoá lúc khởi động.
// Không có thì tủ nằm im tới khi Jason gõ khoá qua /unlock — khoá chỉ sống trong RAM,
// ai đọc được đĩa hay biến môi trường của Render vẫn không giải mã được hạt giống.
/** Chuyển mã CCB cũ đang lưu trần sang dấu vân HMAC. Chạy một lần sau khi mở khoá. */
function diTruCCB() {
  const cu = db.db.prepare('SELECT id, bind_token FROM nhan_vien WHERE bind_token IS NOT NULL').all();
  for (const r of cu) {
    db.capNhatNhanVien(r.id, { bind_hmac: crypto.dauVan(r.bind_token), bind_token: null });
  }
  if (cu.length) console.log(`[tủ] Đã chuyển ${cu.length} mã CCB sang dấu vân HMAC.`);
}

if (MASTER_KEY) {
  crypto.initMasterKey(MASTER_KEY);
  diTruCCB();
  console.log('[tủ] Đã mở khoá bằng MASTER_KEY trong biến môi trường.');
} else {
  console.log('[tủ] Chưa mở khoá. Vào /unlock để nhập khoá chủ.');
}

/* ---------------- phiên quản trị ---------------- */
const PHIEN = new Set();
function laAdmin(req) { return PHIEN.has(req.cookies?.sid); }
function chanAdmin(req, res, next) {
  if (!laAdmin(req)) return res.status(401).json({ loi: 'Chưa đăng nhập.' });
  next();
}
function chanKhoa(req, res, next) {
  if (!crypto.isUnlocked()) return res.status(423).json({ loi: 'Tủ chưa mở khoá.' });
  next();
}
const ipCua = (req) => (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

app.post('/api/dang-nhap', (req, res) => {
  if (!ADMIN_PASSWORD || req.body?.mat_khau !== ADMIN_PASSWORD) {
    return res.status(401).json({ loi: 'Sai mật khẩu.' });
  }
  const sid = crypto.randomToken(24);
  PHIEN.add(sid);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', secure: !!process.env.RENDER, maxAge: 8 * 3600000 });
  res.json({ ok: true });
});

app.post('/api/dang-xuat', (req, res) => { PHIEN.delete(req.cookies?.sid); res.json({ ok: true }); });

app.post('/api/mo-khoa', chanAdmin, (req, res) => {
  const khoa = String(req.body?.khoa || '');
  if (khoa.length < 32) {
    return res.status(400).json({ loi: `Khoá chủ phải dài ít nhất 32 ký tự — đang nhập ${khoa.length}.` });
  }
  try {
    crypto.initMasterKey(khoa);
  } catch (e) {
    crypto.lock();
    return res.status(400).json({ loi: e.message });
  }
  // Xác minh khoá đúng: thử giải mã một hạt giống bất kỳ.
  // Tủ còn trống thì không có gì để đối chiếu, mở luôn.
  const mau = db.db.prepare('SELECT seed_enc FROM nhan_vien WHERE seed_enc IS NOT NULL LIMIT 1').get();
  if (!mau) return res.json({ ok: true, tu_trong: true });
  try {
    crypto.unseal(mau.seed_enc);
    res.json({ ok: true });
  } catch (e) {
    crypto.lock();
    res.status(400).json({ loi: 'Khoá này không khớp với hạt giống đang lưu trong tủ. Phải đúng khoá đã dùng lúc nạp.' });
  }
});

app.get('/api/trang-thai', (req, res) => res.json({
  dang_nhap: laAdmin(req),
  mo_khoa: crypto.isUnlocked(),
  phien_ban: PHIEN_BAN,
  co_bot: bot.coBot(),
  co_admin_id: bot.coAdminId(),
  con_lai: totp.conLai(),
}));

/* ---------------- quản lý nhân viên ---------------- */
app.get('/api/nhan-vien', chanAdmin, (req, res) => {
  const ds = db.listNhanVien().map((nv) => {
    const run = db.getNhanVienFull(nv.id);
    const ca = ca_hieu_luc(run);
    return { ...nv,
      trong_ca: ca.trong_ca,
      gio_dia_phuong: gioDiaPhuong(run),
      da_lay_trong_ca: ca.off ? 0 : db.demTuLuc(nv.id, 'PHAT_MA', 'ok', ca.moc_dem),
      may: db.dsMayCua(nv.id),
      do_dai_ca_phut: doDaiPhut(nv.ca_bat_dau, nv.ca_ket_thuc),
      ca_start: ca.off ? null : ca.start,
      ca_hieu_luc_bat_dau: ca.ca_bat_dau, ca_hieu_luc_ket_thuc: ca.ca_ket_thuc,
      nguon_ca: ca.nguon_ca, ngay_ca: ca.ngay_ca, off_hom_nay: !!ca.off,
      pha_kinh_con: db.demMaPhaKinh(nv.id) };
  });
  res.json(ds);
});

app.post('/api/nhan-vien', chanAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.ho_ten || !b.bo_account) return res.status(400).json({ loi: 'Thiếu họ tên hoặc tài khoản BO.' });
  try {
    const id = db.themNhanVien({
      ho_ten: b.ho_ten, bo_account: b.bo_account,
      brand: 'ST666', vai_tro: b.vai_tro || 'CS', muc: b.muc || 'thuong',
      ca_bat_dau: b.ca_bat_dau || '09:00',
      ca_ket_thuc: b.do_dai_ca_phut
        ? congGio(b.ca_bat_dau || '09:00', Number(b.do_dai_ca_phut))
        : (b.ca_ket_thuc || '21:00'),
      tz_offset: Number(b.tz_offset ?? 420), han_muc_ca: Number(b.han_muc_ca ?? 20),
    });
    db.ghiNhatKy({ nhan_vien_id: id, bo_account: b.bo_account, hanh_dong: 'THEM_NV', ket_qua: 'ok', nguon: 'admin', ip: ipCua(req) });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ loi: e.message.includes('UNIQUE') ? 'Tài khoản BO này đã có trong tủ.' : e.message });
  }
});

/**
 * Nhập danh sách nhân sự từ file. Chỉ đọc bốn cột: Tên, Tài khoản BO, Khu vực, Bộ phận.
 * Ca làm việc đặt sau trong bảng — file không mang ca.
 * Gửi thu=true để chỉ kiểm tra, không ghi gì.
 */
app.post('/api/nhan-vien/nhap-file', chanAdmin, (req, res) => {
  try {
    const b64 = String(req.body?.file || '').split(',').pop();
    if (!b64) return res.status(400).json({ loi: 'Chưa chọn file.' });
    const thu = !!req.body?.thu;
    const md = req.body?.mac_dinh || {};
    const kq = nhansu.doc_file(Buffer.from(b64, 'base64'));

    for (const d of kq.dong) {
      if (!d.se_them || thu) continue;
      // Giờ vào ca lấy từ file nếu có, không thì lấy giá trị chung.
      // Giờ ra tính từ độ dài ca — file chỉ cần một mốc giờ.
      const bd = d.se_them.ca_bat_dau || md.ca_bat_dau || '09:00';
      const dai = md.do_dai_ca_phut ? Number(md.do_dai_ca_phut) : null;
      const nv = {
        ho_ten: d.se_them.ho_ten,
        bo_account: d.se_them.bo_account,
        brand: 'ST666',
        vai_tro: d.se_them.vai_tro || md.vai_tro || 'CS',
        muc: 'thuong',
        tz_offset: d.se_them.tz_offset ?? Number(md.tz_offset ?? 420),
        ca_bat_dau: bd,
        ca_ket_thuc: dai ? congGio(bd, dai) : (md.ca_ket_thuc || '21:00'),
        han_muc_ca: Number(md.han_muc_ca || 2),
      };
      try {
        const id = db.themNhanVien(nv);
        db.ghiNhatKy({ nhan_vien_id: id, bo_account: nv.bo_account, hanh_dong: 'THEM_NV',
          ket_qua: 'ok', chi_tiet: 'nhập từ file', nguon: 'admin', ip: ipCua(req) });
        d.id = id;
      } catch (e) { d.loi = e.message; delete d.se_them; }
    }

    // Điền giá trị chung vào bản xem trước để m thấy đúng thứ sẽ được ghi.
    for (const d of kq.dong) {
      if (!d.se_them) continue;
      d.se_them.vai_tro = d.se_them.vai_tro || md.vai_tro || 'CS';
      d.se_them.tz_offset = d.se_them.tz_offset ?? Number(md.tz_offset ?? 420);
      const bd2 = d.se_them.ca_bat_dau || md.ca_bat_dau || '09:00';
      const dai2 = md.do_dai_ca_phut ? Number(md.do_dai_ca_phut) : null;
      d.se_them.ca_bat_dau = bd2;
      d.se_them.ca_ket_thuc = dai2 ? congGio(bd2, dai2) : (md.ca_ket_thuc || '21:00');
    }

    res.json({ thu, cot: kq.cot, tong: kq.dong.length,
      thanh_cong: kq.dong.filter((d) => !d.loi).length,
      hong: kq.dong.filter((d) => d.loi).length,
      dong: kq.dong });
  } catch (e) { res.status(400).json({ loi: e.message }); }
});


/* ---------------- lịch làm việc theo tháng / điều chỉnh từng ngày ---------------- */
app.get('/api/lich', chanAdmin, (req, res) => {
  const thang = String(req.query.thang || '').trim();
  if (!/^\d{4}-\d{2}$/.test(thang)) return res.status(400).json({ loi: 'Tháng phải dạng YYYY-MM.' });
  const q = String(req.query.q || '').trim();
  res.json({ thang,
    dong: db.docLichThang({ thang, q }),
    ap_dung: db.docApDungLichThang({ thang, q }) });
});

/**
 * Nhập lịch tháng cùng kiểu với hệ thống Điểm danh:
 * - một dòng một người, mỗi ngày trong tháng một cột;
 * - ô ghi giờ vào ca, giờ ra suy từ độ dài ca mặc định;
 * - HH:MM-HH:MM vẫn nhận;
 * - DO / AL / OFF / trống = nghỉ.
 * mode=preview | merge | replace
 */
app.post('/api/lich/nhap-file', chanAdmin, (req, res) => {
  try {
    const b64 = String(req.body?.file || '').split(',').pop();
    if (!b64) return res.status(400).json({ loi: 'Chưa chọn file lịch.' });
    const thang = String(req.body?.thang || '').trim();
    if (!/^\d{4}-\d{2}$/.test(thang)) return res.status(400).json({ loi: 'Chưa chọn tháng áp dụng.' });
    const mode = ['preview', 'merge', 'replace'].includes(req.body?.mode) ? req.body.mode : 'preview';

    const hoursOf = (id, name) => {
      let nv = id ? db.getByBoAccountCI(id) : null;
      if (!nv && name) {
        const byName = db.getByNameCI(name);
        if (byName && !byName._nhieu_ket_qua) nv = byName;
      }
      return nv ? doDaiPhut(nv.ca_bat_dau, nv.ca_ket_thuc) / 60 : 8;
    };
    const parsed = lich.parseScheduleFile(Buffer.from(b64, 'base64'), thang, hoursOf);
    if (!parsed.count) {
      return res.status(400).json({ loi: parsed.errors[0] || 'Không đọc được lịch trong file.', errors: parsed.errors });
    }

    // Chặn chọn nhầm tháng trước khi có bất kỳ thao tác xóa/ghi nào.
    const headerMonths = parsed.headerMonths || {};
    const totalHeaderDays = Object.values(headerMonths).reduce((a, n) => a + n, 0);
    const monthHeaderDays = headerMonths[thang] || 0;
    if (totalHeaderDays && monthHeaderDays / totalHeaderDays < 0.6) {
      const found = Object.entries(headerMonths).sort((a,b)=>b[1]-a[1])
        .slice(0,3).map(([m,n]) => `${m} (${n} cột)`).join(', ');
      return res.status(400).json({ loi: `Tháng áp dụng ${thang} không khớp file. File chủ yếu là ${found || 'tháng khác'}. Chưa ghi hoặc xóa dữ liệu nào.` });
    }

    const matched = [], missing = [], resolved = [];
    for (const rec of parsed.rows) {
      let nv = rec.bo_account ? db.getByBoAccountCI(rec.bo_account) : null;
      if (!nv && rec.ma) nv = db.getByBoAccountCI(rec.ma); // file nào dùng cột Ma để ghi BO account vẫn nhận
      if (!nv && rec.name) {
        const byName = db.getByNameCI(rec.name);
        if (byName?._nhieu_ket_qua) {
          missing.push(`${rec.name}: trùng tên ${byName._so_luong} người, cần thêm cột TaiKhoanBO`);
          continue;
        }
        nv = byName;
      }
      if (!nv) {
        missing.push(`${rec.name || rec.bo_account || rec.ma || '(không rõ)'}: không khớp nhân sự trong tủ`);
        continue;
      }
      matched.push(`${nv.ho_ten} (${nv.bo_account})`);
      resolved.push({ nv, rec });
    }

    const dayCount = resolved.reduce((n, x) => n + Object.keys(x.rec.days || {}).length, 0);
    if (mode !== 'preview' && !resolved.length) {
      return res.status(400).json({ loi: 'Không có nhân viên nào trong file khớp với Tủ. Chưa ghi dữ liệu.' });
    }
    if (mode === 'preview') {
      return res.json({ ok: true, preview: true, thang, count: parsed.count, dayCount,
        matched, missing, warnings: parsed.errors || [], headerMonths });
    }

    // Ghi đè tháng là thao tác có tính phá hủy: có dòng không khớp thì dừng để tránh
    // vô tình biến cả tháng của người đó thành OFF.
    if (mode === 'replace' && missing.length) {
      return res.status(400).json({
        loi: `File còn ${missing.length} người không khớp. Ghi đè tháng chưa được thực hiện: ${missing.slice(0,5).join(' · ')}${missing.length > 5 ? ' …' : ''}`,
        errors: missing });
    }

    const tx = db.db.transaction(() => {
      if (mode === 'replace') {
        db.xoaLichThangTatCa(thang);
        db.xoaDanhDauThangTatCa(thang);
        // Ghi đè tháng = lịch tháng trở thành nguồn chuẩn cho toàn bộ nhân sự đang hoạt động.
        for (const nv of db.listNhanVien().filter((x) => x.trang_thai === 'hoat_dong')) {
          db.danhDauLichThang(nv.id, thang, 'IMPORT_REPLACE');
        }
      }

      for (const { nv, rec } of resolved) {
        if (mode === 'replace') db.danhDauLichThang(nv.id, thang, 'IMPORT_REPLACE');
        if (mode === 'merge') {
          // Merge chỉ đụng người có trong file, nhưng với người đó cả tháng trong file là chuẩn:
          // xoá ca tháng cũ, ghi lại ngày làm; ô trống/OFF sẽ không có dòng -> OFF.
          db.xoaLichThangCua(nv.id, thang);
          db.danhDauLichThang(nv.id, thang, 'IMPORT_MERGE');
        }

        if (rec.tz_offset != null && Number(rec.tz_offset) !== Number(nv.tz_offset)) {
          db.capNhatNhanVien(nv.id, { tz_offset: Number(rec.tz_offset) });
          nv.tz_offset = Number(rec.tz_offset);
        }

        for (const [ngay, ca] of Object.entries(rec.days || {})) {
          const doDaiNv = doDaiPhut(nv.ca_bat_dau, nv.ca_ket_thuc);
          db.upsertLichNgay({ nhan_vien_id: nv.id, ngay,
            ca_bat_dau: ca.start, ca_ket_thuc: congGio(ca.start, doDaiNv),
            tz_offset: rec.tz_offset == null ? nv.tz_offset : Number(rec.tz_offset),
            trang_thai: 'WORK',
            tu_tinh_ket_thuc: 1,
            nguon: mode === 'replace' ? 'IMPORT_REPLACE' : 'IMPORT_MERGE' });
        }
        db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account,
          hanh_dong: 'LICH_THANG', ket_qua: 'ok',
          chi_tiet: `${thang} · ${mode} · ${Object.keys(rec.days || {}).length} ngày làm`,
          nguon: 'admin', ip: ipCua(req) });
      }
    });
    tx();

    res.json({ ok: true, preview: false, mode, thang, count: parsed.count, dayCount,
      matched, missing, warnings: parsed.errors || [],
      message: `Đã ${mode === 'replace' ? 'ghi đè' : 'merge'} lịch tháng ${thang}: ${resolved.length} người, ${dayCount} ngày làm. Ngày không có ca được hiểu là OFF.` });
  } catch (e) { res.status(400).json({ loi: e.message }); }
});

/* Điều chỉnh riêng một ngày. Nếu tháng đã up lịch, sửa này nằm trong lịch chính thức;
   nếu tháng chưa up thì đây chỉ là override ngày và các ngày khác vẫn dùng ca mặc định. */
app.put('/api/lich/ngay', chanAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const nv = b.nhan_vien_id ? db.getNhanVienFull(Number(b.nhan_vien_id)) : db.getByBoAccountCI(String(b.bo_account || ''));
    if (!nv) return res.status(404).json({ loi: 'Không có tài khoản BO này trong tủ.' });
    const ngay = String(b.ngay || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return res.status(400).json({ loi: 'Ngày phải dạng YYYY-MM-DD.' });
    const tt = String(b.trang_thai || 'WORK').toUpperCase() === 'OFF' ? 'OFF' : 'WORK';
    const bd = tt === 'OFF' ? null : String(b.ca_bat_dau || '');
    let kt = null;
    if (tt === 'WORK') {
      if (!/^\d{2}:\d{2}$/.test(bd)) {
        return res.status(400).json({ loi: 'Giờ vào phải dạng HH:MM.' });
      }
      const doDaiNv = doDaiPhut(nv.ca_bat_dau, nv.ca_ket_thuc);
      kt = congGio(bd, doDaiNv);
    }
    const row = db.upsertLichNgay({ nhan_vien_id: nv.id, ngay, ca_bat_dau: bd, ca_ket_thuc: kt,
      tz_offset: Number(b.tz_offset ?? nv.tz_offset), trang_thai: tt,
      tu_tinh_ket_thuc: tt === 'WORK' ? 1 : 0, nguon: 'MANUAL' });
    const official = db.thangCoLich(nv.id, ngay.slice(0,7));
    db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'LICH_NGAY', ket_qua: 'ok',
      chi_tiet: `${ngay} · ${tt === 'OFF' ? 'OFF' : bd + '–' + kt}${official ? ' · lịch tháng chính thức' : ' · override'}`,
      nguon: 'admin', ip: ipCua(req) });
    res.json({ ok: true, row, lich_thang_chinh_thuc: official });
  } catch (e) { res.status(400).json({ loi: e.message }); }
});

app.delete('/api/lich/:id', chanAdmin, (req, res) => {
  const row = db.db.prepare(`SELECT l.*, v.bo_account FROM lich_lam_viec l
    JOIN nhan_vien v ON v.id = l.nhan_vien_id WHERE l.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ loi: 'Không có dòng lịch này.' });
  const official = db.thangCoLich(row.nhan_vien_id, row.ngay.slice(0,7));
  db.xoaLichNgay(row.id);
  db.ghiNhatKy({ nhan_vien_id: row.nhan_vien_id, bo_account: row.bo_account,
    hanh_dong: 'LICH_NGAY', ket_qua: 'ok',
    chi_tiet: `${row.ngay} · xoá ca${official ? ' -> OFF theo lịch tháng' : ' -> quay về ca mặc định'}`,
    nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true, ngay_thanh_off: official });
});

app.patch('/api/nhan-vien/:id', chanAdmin, (req, res) => {
  const cho_phep = ['ho_ten', 'vai_tro', 'muc', 'ca_bat_dau', 'ca_ket_thuc',
    'tz_offset', 'han_muc_ca', 'trang_thai', 'cho_nhieu_may', 'bo_user_id'];
  const patch = {};
  for (const k of cho_phep) if (k in (req.body || {})) patch[k] = req.body[k];

  // Độ dài ca không lưu riêng — nó chỉ là cách nhập nhanh giờ kết thúc.
  // Hai nguồn sự thật cho cùng một thứ là chỗ sinh lỗi, nên chỉ giữ giờ vào/ra.
  const doiDoDai = 'do_dai_ca_phut' in (req.body || {});
  const doDaiMoi = doiDoDai ? Number(req.body.do_dai_ca_phut) : null;
  if (doiDoDai) {
    if (!Number.isFinite(doDaiMoi) || doDaiMoi < 60 || doDaiMoi > 24 * 60) {
      return res.status(400).json({ loi: 'Độ dài ca không hợp lệ.' });
    }
    const nvCu = db.getNhanVienFull(req.params.id);
    const bd = patch.ca_bat_dau || (nvCu && nvCu.ca_bat_dau) || '09:00';
    patch.ca_ket_thuc = congGio(bd, doDaiMoi);
  }
  if (patch.trang_thai === 'hoat_dong') { patch.sai_pin_lien_tiep = 0; patch.khoa_tam_den = null; }
  db.capNhatNhanVien(req.params.id, patch);

  // Nếu lịch tháng được import bằng ô chỉ có giờ vào (ví dụ 06:00), đổi độ dài ca
  // phải đổi luôn 06:00-14:00 -> 06:00-16:00 khi chọn 10 tiếng.
  // Dòng lịch đã ghi rõ 06:00-14:00 thì giữ nguyên.
  const lichDaDongBo = doiDoDai ? db.capNhatDoDaiLichTuTinh(req.params.id, doDaiMoi) : 0;

  db.ghiNhatKy({ nhan_vien_id: Number(req.params.id), hanh_dong: 'SUA_NV', ket_qua: 'ok',
    chi_tiet: Object.keys(patch).join(',') + (lichDaDongBo ? ` · đồng bộ ${lichDaDongBo} ca lịch` : ''),
    nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true, lich_da_dong_bo: lichDaDongBo });
});

app.delete('/api/nhan-vien/:id', chanAdmin, (req, res) => {
  const nv = db.getNhanVienPublic(req.params.id);
  if (!nv) return res.status(404).json({ loi: 'Không có người này trong tủ.' });
  // Phải gõ lại đúng tài khoản BO — xoá là mất hạt giống, không lấy lại được.
  if (String(req.body?.xac_nhan || '').trim() !== nv.bo_account) {
    return res.status(400).json({ loi: 'Chưa xác nhận đúng tài khoản BO.' });
  }
  db.xoaNhanVien(Number(req.params.id));
  db.ghiNhatKy({ bo_account: nv.bo_account, hanh_dong: 'XOA_NV', ket_qua: 'ok',
    chi_tiet: nv.ho_ten, nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true });
});

/** Nạp hạt giống. Chuỗi trần chỉ tồn tại trong request này rồi biến mất. */
app.post('/api/nhan-vien/:id/hat-giong', chanAdmin, chanKhoa, (req, res) => {
  try {
    const seed = totp.tachHatGiong(req.body?.hat_giong);
    totp.kiemTraHatGiong(seed);
    db.capNhatNhanVien(req.params.id, { seed_enc: crypto.seal(seed) });
    const nv = db.getNhanVienPublic(req.params.id);
    db.ghiNhatKy({ nhan_vien_id: Number(req.params.id), bo_account: nv.bo_account,
      hanh_dong: 'NAP_HAT_GIONG', ket_qua: 'ok', nguon: 'admin', ip: ipCua(req) });

    // Trả luôn mã hiện tại để đối chiếu ngay với Google Authenticator.
    // Không đối chiếu tại chỗ thì sai hạt giống chỉ lộ ra lúc nhân viên không vào được BO.
    const enc = db.getNhanVienFull(req.params.id).seed_enc;
    const kt = totp.chan_doan_lech_gio(enc, 0);

    // Cùng một tài khoản BO mà có hai dòng thì máy trạm có thể gắn nhầm dòng
    // chưa nạp hạt giống — mã sinh ra sẽ khác, rất khó lần ra nếu không báo ở đây.
    const trung = db.listNhanVien().filter(
      (x) => x.bo_account.toLowerCase() === nv.bo_account.toLowerCase());

    res.json({ ok: true,
      ma_hien_tai: kt.danh_sach[0].ma,
      con_lai: kt.con_lai,
      so_dong_trung: trung.length,
      dong_trung: trung.length > 1 ? trung.map((x) => ({ id: x.id, ho_ten: x.ho_ten,
        co_hat_giong: !!x.co_hat_giong })) : [] });
  } catch (e) {
    res.status(400).json({ loi: e.message });
  }
});

/** Cấp mã CCB Telegram, dùng một lần. */
/**
 * Dò lệch đồng hồ: trả mã của các cửa sổ liền kề để đối chiếu với BO.
 * Chỉ cửa sổ -30/+30 chạy được nghĩa là đồng hồ máy chủ lệch, không phải hạt giống sai.
 */
app.post('/api/nhan-vien/:id/chan-doan-totp', chanAdmin, chanKhoa, (req, res) => {
  const nv = db.getNhanVienFull(req.params.id);
  if (!nv) return res.status(404).json({ loi: 'Không có người này.' });
  if (!nv.seed_enc) return res.status(400).json({ loi: 'Người này chưa nạp hạt giống.' });
  db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'CHAN_DOAN_TOTP',
    ket_qua: 'ok', nguon: 'admin', ip: ipCua(req) });
  res.json(totp.chan_doan_lech_gio(nv.seed_enc, 2));
});

app.post('/api/nhan-vien/:id/ma-bind', chanAdmin, (req, res) => {
  // Cấp mã mới làm mã cũ hết hiệu lực ngay. Muốn thu hồi chìa của ai thì bấm nút này.
  const token = bot.tao_ma_bind(req.params.id);
  db.ghiNhatKy({ nhan_vien_id: Number(req.params.id), hanh_dong: 'CAP_MA_BIND', ket_qua: 'ok', nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true, ma_bind: token });
});

/** Sinh bộ mã phá kính. Bản trần trả về đúng một lần để in. */
app.post('/api/nhan-vien/:id/pha-kinh', chanAdmin, (req, res) => {
  res.json({ ok: true, ma: svc.tao_ma_pha_kinh(Number(req.params.id), Number(req.body?.so_luong || 3)) });
});

/** Đổi ca cho nhiều người một lượt — dùng đầu mỗi tháng khi xếp lại ca. */
app.post('/api/doi-ca', chanAdmin, (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const ca = {
    ca_bat_dau: String(req.body?.ca_bat_dau || ''),
    ca_ket_thuc: String(req.body?.ca_ket_thuc || ''),
    tz_offset: Number(req.body?.tz_offset ?? 420),
  };
  if (!ids.length) return res.status(400).json({ loi: 'Chưa chọn ai.' });
  if (!/^\d{2}:\d{2}$/.test(ca.ca_bat_dau) || !/^\d{2}:\d{2}$/.test(ca.ca_ket_thuc)) {
    return res.status(400).json({ loi: 'Giờ ca phải theo dạng HH:MM.' });
  }
  db.doiCaHangLoat(ids, ca);
  for (const id of ids) {
    db.ghiNhatKy({ nhan_vien_id: id, hanh_dong: 'DOI_CA', ket_qua: 'ok',
      chi_tiet: `${ca.ca_bat_dau}–${ca.ca_ket_thuc}`, nguon: 'admin', ip: ipCua(req) });
  }
  res.json({ ok: true, so_nguoi: ids.length });
});

/* ---------------- máy trạm (PowerShell) ---------------- */
// Các endpoint dưới đây do script trên máy nhân viên gọi, không cần đăng nhập quản trị:
// bản thân mã CCB, máy đã đăng ký và dấu vân máy đã là ba lớp xác thực.
app.get('/api/may/phien-ban', (req, res) => res.json({ phien_ban: PHIEN_BAN }));

app.post('/api/may/dang-ky', chanKhoa, (req, res) => {
  const b = req.body || {};
  if (!b.may_id || !b.van_tay) return res.status(400).json({ loi: 'Thiếu định danh máy.' });
  res.json(may.dang_ky(b));
});

app.get('/api/may/trang-thai', chanKhoa, (req, res) =>
  res.json(may.trang_thai_may(String(req.query.may_id || ''))));

// Script hỏi lúc khởi động: máy này đã gắn cho ca hiện tại chưa.
app.post('/api/may/trang-thai-ca', chanKhoa, (req, res) => {
  const b = req.body || {};
  if (!b.may_id || !b.van_tay) return res.status(400).json({ loi: 'Thiếu định danh máy.' });
  res.json(may.trang_thai_ca(b.may_id, b.van_tay));
});

app.post('/api/may/gan-ca', chanKhoa, (req, res) => {
  const b = req.body || {};
  if (!b.may_id || !b.van_tay || !b.ma_bind) return res.status(400).json({ loi: 'Thiếu tham số.' });
  res.json(may.gan_ca(b));
});

app.post('/api/may/xin-ma', chanKhoa, async (req, res) => {
  const b = req.body || {};
  if (!b.may_id || !b.van_tay || !b.ccb) return res.status(400).json({ loi: 'Thiếu tham số.' });
  res.json(await may.xin_ma(b));
});

app.get('/api/may/duyet/:id', chanKhoa, (req, res) => res.json(may.trang_thai_duyet(req.params.id)));

app.post('/api/may/pha-kinh', chanKhoa, async (req, res) => {
  const b = req.body || {};
  if (!b.bo_account || !b.ma_giay) return res.status(400).json({ loi: 'Thiếu tham số.' });
  res.json(await may.pha_kinh(b));
});

/* ---- quản trị máy trạm ---- */
app.get('/api/thiet-bi', chanAdmin, (req, res) => res.json(db.dsThietBi()));

app.post('/api/thiet-bi/:id/duyet', chanAdmin, (req, res) => {
  const tb = db.getThietBi(req.params.id);
  if (!tb) return res.status(404).json({ loi: 'Không có máy này.' });
  const dongY = !!req.body?.dong_y;
  db.quyetThietBi(req.params.id, dongY ? 'duyet' : 'tu_choi');
  db.ghiNhatKy({ nhan_vien_id: tb.nhan_vien_id, hanh_dong: 'DANG_KY_MAY',
    ket_qua: dongY ? 'ok' : 'tu_choi', chi_tiet: tb.ten_may || tb.may_id,
    nguon: 'admin', nguoi_duyet: 'Jason', ip: ipCua(req) });
  res.json({ ok: true });
});

app.delete('/api/thiet-bi/:id', chanAdmin, (req, res) => {
  const tb = db.getThietBi(req.params.id);
  db.xoaThietBi(req.params.id);
  db.ghiNhatKy({ hanh_dong: 'XOA_MAY', ket_qua: 'ok', chi_tiet: tb?.ten_may || req.params.id,
    nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true });
});

/* ---------------- tổng quan ---------------- */
app.get('/api/tong-quan', chanAdmin, (req, res) => {
  const now = Date.now();
  const ds = db.listNhanVien();
  let trongCa = 0, daGan = 0, thieuSetup = 0;

  for (const nv of ds) {
    if (nv.trang_thai !== 'hoat_dong') continue;
    const run = db.getNhanVienFull(nv.id);
    const ca = ca_hieu_luc(run);
    if (ca.trong_ca) {
      trongCa++;
      if (nv.bind_ca_start === ca.start) daGan++;
    }
    if (!nv.co_hat_giong || !nv.co_ma_bind) thieuSetup++;
  }

  // Mã phát theo từng giờ trong 24 giờ qua, để vẽ biểu đồ.
  const gio = Array(24).fill(0);
  const moc = now - 24 * 3600000;
  for (const r of db.docNhatKy({ hanh_dong: 'PHAT_MA', tu: moc, limit: 5000 })) {
    const i = Math.floor((r.luc - moc) / 3600000);
    if (i >= 0 && i < 24) gio[i]++;
  }

  const canhBao = db.docCanhBao(100);
  res.json({
    tong_nguoi: ds.length,
    dang_hoat_dong: ds.filter((n) => n.trang_thai === 'hoat_dong').length,
    trong_ca: trongCa,
    da_gan_ca_nay: daGan,
    thieu_setup: thieuSetup,
    ma_24h: gio.reduce((a, b) => a + b, 0),
    da_phien_24h: db.docNhatKy({ hanh_dong: 'DA_PHIEN_BO', tu: moc, limit: 500 })
      .reduce((t, r) => ({ ok: t.ok + (r.ket_qua === 'ok' ? 1 : 0),
        hong: t.hong + (r.ket_qua === 'hong' ? 1 : 0) }), { ok: 0, hong: 0 }),
    ma_theo_gio: gio,
    cho_duyet: db.dsYeuCauCho().length,
    may_cho_duyet: db.dsThietBi().filter((t) => t.trang_thai === 'cho').length,
    canh_bao_chua_xem: canhBao.filter((c) => !c.da_xem).length,
    gian_lan: canhBao.filter((c) => c.loai === 'GIAN_LAN' && !c.da_xem),
    canh_bao_moi: canhBao.slice(0, 6),
    hoat_dong: db.docNhatKy({ hanh_dong: 'PHAT_MA', limit: 8 }),
  });
});

/* ---------------- cài đặt ---------------- */
app.get('/api/cai-dat', chanAdmin, (req, res) => res.json({
  bao_moi_lan_phat_ma: db.docCaiDat('bao_moi_lan_phat_ma', '1') === '1',
  gan_han_chot_phut: db.docCaiDat('gan_han_chot_phut', '0'),
  ...(() => {
    // Không bao giờ trả mật khẩu ra ngoài, kể cả bản đã mã hoá.
    const { bo_mat_khau_enc, ...con_lai } = hengio.cau_hinh();
    return { ...con_lai, co_mat_khau_bo: !!bo_mat_khau_enc };
  })(),
}));

app.post('/api/cai-dat', chanAdmin, (req, res) => {
  const b = req.body || {};
  if ('bao_moi_lan_phat_ma' in b) {
    db.datCaiDat('bao_moi_lan_phat_ma', b.bao_moi_lan_phat_ma ? '1' : '0');
  }
  if ('webhook_bat' in b) db.datCaiDat('webhook_bat', b.webhook_bat ? '1' : '0');
  for (const k of ['webhook_url', 'webhook_method', 'webhook_headers', 'webhook_body',
    'webhook_tre_phut', 'bo_token', 'gan_han_chot_phut',
    'bo_login_url', 'bo_userid']) {
    if (k in b) db.datCaiDat(k, String(b[k]));
  }
  if ('bo_tu_dang_nhap' in b) db.datCaiDat('bo_tu_dang_nhap', b.bo_tu_dang_nhap ? '1' : '0');
  // Mật khẩu (chuỗi hash SHA1 lấy từ DevTools) lưu mã hoá bằng khoá chủ.
  if (b.bo_mat_khau) {
    if (!crypto.isUnlocked()) return res.status(423).json({ loi: 'Tủ chưa mở khoá.' });
    db.datCaiDat('bo_mat_khau_enc', crypto.seal(String(b.bo_mat_khau).trim()));
  }
  res.json({ ok: true });
});

app.get('/api/hen-gio', chanAdmin, (req, res) => res.json(hengio.chan_doan()));

app.post('/api/hen-gio/da-ngay', chanAdmin, async (req, res) =>
  res.json({ ket_qua: await hengio.da_nhung_nguoi_het_ca() }));

app.post('/api/bo/dang-nhap', chanAdmin, chanKhoa, async (req, res) =>
  res.json(await hengio.dang_nhap_bo()));

/** Đá phiên BO của một người ngay bây giờ — dùng để thử webhook. */
app.post('/api/nhan-vien/:id/da-phien', chanAdmin, async (req, res) => {
  const nv = db.getNhanVienFull(req.params.id);
  if (!nv) return res.status(404).json({ loi: 'Không có người này.' });
  const ca = ca_hieu_luc(nv);
  const nvCa = ca.off ? nv : { ...nv, ca_bat_dau: ca.ca_bat_dau, ca_ket_thuc: ca.ca_ket_thuc,
    tz_offset: ca.tz_offset ?? nv.tz_offset };
  res.json(await hengio.da_mot_nguoi(nvCa, null, 'admin'));
});

/** Gỡ một máy khỏi tài khoản BO. */
app.delete('/api/nhan-vien/:id/may/:tid', chanAdmin, (req, res) => {
  db.xoaGanMay(req.params.tid, Number(req.params.id));
  db.ghiNhatKy({ nhan_vien_id: Number(req.params.id), hanh_dong: 'GO_MAY', ket_qua: 'ok',
    chi_tiet: req.params.tid, nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true });
});

/** Gỡ toàn bộ máy — dùng khi người đó nghỉ việc. */
app.delete('/api/nhan-vien/:id/may', chanAdmin, (req, res) => {
  db.xoaMoiMayCua(Number(req.params.id));
  db.ghiNhatKy({ nhan_vien_id: Number(req.params.id), hanh_dong: 'GO_MAY', ket_qua: 'ok',
    chi_tiet: 'toàn bộ', nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true });
});

/** Mở khoá trong ngày, cho gắn Telegram khác ngay mà không phải đợi sang ngày mới. */
app.post('/api/nhan-vien/:id/mo-khoa-gan', chanAdmin, (req, res) => {
  db.capNhatNhanVien(req.params.id, { bind_ca_start: null, bind_may_id: null });
  db.ghiNhatKy({ nhan_vien_id: Number(req.params.id), hanh_dong: 'GAN_TELEGRAM', ket_qua: 'ok',
    chi_tiet: 'Jason mở khoá trong ngày', nguon: 'admin', ip: ipCua(req) });
  res.json({ ok: true });
});

/** Bắn tin thử để xác nhận đường Telegram thông. */
app.post('/api/kiem-thu/telegram', chanAdmin, async (req, res) => res.json(await bot.guiTinThu()));

/* ---------------- nhật ký, cảnh báo, duyệt ---------------- */
app.get('/api/nhat-ky', chanAdmin, (req, res) => res.json(db.docNhatKy({
  nhan_vien_id: req.query.nv ? Number(req.query.nv) : null,
  hanh_dong: req.query.hd || null,
  limit: Math.min(Number(req.query.limit || 200), 1000),
})));

app.get('/api/canh-bao', chanAdmin, (req, res) => res.json(db.docCanhBao(100)));
app.post('/api/canh-bao/da-xem', chanAdmin, (req, res) => { db.danhDauDaXem(); res.json({ ok: true }); });
app.get('/api/duyet', chanAdmin, (req, res) => res.json(db.dsYeuCauCho()));

app.post('/api/duyet/:id', chanAdmin, chanKhoa, async (req, res) => {
  const kq = await svc.quyet_dinh_duyet(Number(req.params.id), !!req.body?.dong_y, 'Jason (web)', 'admin');
  // Mã chỉ trả về nếu yêu cầu bắt nguồn từ trang kiểm thử; đường Telegram do bot trả.
  if (kq.trang_thai === 'ok' && kq.yeu_cau?.nguon !== 'kiem-thu') delete kq.ma;
  res.json(kq);
});

/* ---------------- kiểm thử: mô phỏng đúng luồng bot ---------------- */
app.post('/api/kiem-thu/xin-ma', chanAdmin, chanKhoa, async (req, res) => {
  const nv = db.getByBoAccount(String(req.body?.bo_account || ''));
  if (!nv) return res.status(404).json({ loi: 'Không có tài khoản BO này trong tủ.' });
  const kq = await svc.xin_ma({ nv, ccb: String(req.body?.ccb || ''), nguon: 'kiem-thu', ip: ipCua(req) });
  if (kq.trang_thai === 'can_duyet') await bot.hoiDuyet(kq.yeu_cau_id);
  res.json(kq);
});

app.post('/api/kiem-thu/pha-kinh', chanAdmin, chanKhoa, async (req, res) => {
  const nv = db.getByBoAccount(String(req.body?.bo_account || ''));
  if (!nv) return res.status(404).json({ loi: 'Không có tài khoản BO này trong tủ.' });
  res.json(await svc.pha_kinh({ nv, ma_giay: String(req.body?.ma || ''), nguon: 'kiem-thu', ip: ipCua(req) }));
});

/* ---------------- tĩnh ---------------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

svc.gan_kenh_bao_dong((loai, noiDung) => bot.baoDongChoJason(loai, noiDung));
svc.gan_kenh_bao_thuong((noiDung) => bot.tinChoJason(noiDung));
may.gan_kenh_hoi((mayId) => bot.hoiDuyetMay(mayId));
hengio.gan_kenh_bao((noiDung) => bot.tinChoJason(noiDung));
hengio.khoi_dong();
bot.khoiDong();

app.listen(PORT, () => console.log(`[tủ] http://localhost:${PORT}`));
