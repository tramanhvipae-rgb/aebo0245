'use strict';
const XLSX = require('xlsx');
const db = require('./db');

/**
 * Đọc file danh sách nhân sự. Chỉ nhận đúng bốn cột:
 *   Tên · Tài khoản BO · Khu vực · Bộ phận
 *
 * Ca làm việc không nằm trong file — đặt trong bảng nhân sự sau khi nhập,
 * vì ca đổi theo tháng còn danh sách người thì không.
 */

const chuanHoa = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const COT = {
  ten: ['ten', 'hoten', 'tennhanvien', 'nhanvien', 'name', 'fullname'],
  acc: ['taikhoanbo', 'taikhoan', 'boaccount', 'account', 'manv', 'ma', 'mand', 'bo', 'username'],
  khu: ['khuvuc', 'khuvyc', 'region', 'quocgia', 'nuoc', 'muigio', 'timezone'],
  bop: ['bophan', 'phongban', 'vaitro', 'chucvu', 'role', 'department', 'team'],
  gio: ['ca', 'gio', 'giovao', 'giovaoca', 'cabatdau', 'batdau', 'giolamviec', 'gioca', 'shift', 'starttime'],
};

const TZ = [
  [/arm|yerevan|armenia/i, 240],
  [/vn|viet|hcm|hanoi|saigon|ho_?chi/i, 420],
];

/**
 * Ô giờ vào ca -> 'HH:MM' kiểu Việt Nam (24 giờ).
 * Nhận '9:00', '09:00', '9h', '9h30', '22:00', và cả số thập phân mà Excel
 * tự đổi khi ô được định dạng là Time (0.375 = 09:00).
 */
function gioTu(v) {
  if (v == null || v === '') return null;
  const p = (n) => String(n).padStart(2, '0');

  if (v instanceof Date) return `${p(v.getHours())}:${p(v.getMinutes())}`;

  if (typeof v === 'number' && v > 0 && v < 1) {
    const phut = Math.round(v * 24 * 60);
    return `${p(Math.floor(phut / 60))}:${p(phut % 60)}`;
  }

  const s = String(v).trim();
  if (/^(do|al|off|nghi|-)$/i.test(s)) return null;

  const m = s.match(/^(\d{1,2})\s*[:hg.]\s*(\d{1,2})?/i);
  if (m) {
    const h = Number(m[1]), ph = Number(m[2] || 0);
    if (h > 23 || ph > 59) return null;
    return `${p(h)}:${p(ph)}`;
  }
  if (/^\d{1,2}$/.test(s)) {
    const h = Number(s);
    return h <= 23 ? `${p(h)}:00` : null;
  }
  return null;
}

/** Chuẩn hoá tên bộ phận về đúng bộ đang dùng. */
function chuanBoPhan(v) {
  const k = chuanHoa(v);
  if (!k) return null;
  if (k === 'cs') return 'CS';
  if (k === 'csonl' || k === 'csonline') return 'CS ONL';
  if (k === 'vip') return 'VIP';
  if (k === 'risk') return 'RISK';
  if (k === 'riskonl' || k === 'riskonline') return 'RISK_ONLINE';
  return String(v).trim().toUpperCase();
}

function tzTu(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  for (const [re, off] of TZ) if (re.test(s)) return off;
  return undefined; // có ghi nhưng không hiểu
}

/** Tìm dòng tiêu đề và vị trí bốn cột. */
function doTieuDe(bang) {
  for (let r = 0; r < Math.min(bang.length, 12); r++) {
    const vt = { ten: -1, acc: -1, khu: -1, bop: -1, gio: -1 };
    bang[r].forEach((h, i) => {
      const k = chuanHoa(h);
      for (const [ten, ds] of Object.entries(COT)) {
        if (vt[ten] < 0 && ds.includes(k)) vt[ten] = i;
      }
    });
    if (vt.ten >= 0 && vt.acc >= 0) return { dong: r, vt };
  }
  return null;
}

/**
 * @returns {{cot: object, dong: Array}} — dong[] đã đối chiếu với tủ.
 */
function doc_file(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('File không có sheet nào.');
  const bang = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!bang.length) throw new Error('File trống.');

  const td = doTieuDe(bang);
  if (!td) {
    throw new Error('Không tìm thấy tiêu đề. File cần ít nhất hai cột: Ten (hoặc HoTen) và TaiKhoanBO (hoặc MaNV).');
  }

  const daCo = new Set(db.listNhanVien().map((n) => n.bo_account.toLowerCase()));
  const trongFile = new Set();
  const dong = [];

  for (let r = td.dong + 1; r < bang.length; r++) {
    const h = bang[r];
    if (!h || !h.length) continue;
    const lay = (i) => (i >= 0 ? String(h[i] ?? '').trim() : '');
    const ho_ten = lay(td.vt.ten);
    const bo_account = lay(td.vt.acc);
    if (!ho_ten && !bo_account) continue;

    const r0 = { ho_ten, bo_account,
      khu_vuc_goc: lay(td.vt.khu), bo_phan_goc: lay(td.vt.bop),
      gio_goc: lay(td.vt.gio) };

    if (!ho_ten || !bo_account) { r0.loi = 'Thiếu tên hoặc tài khoản BO'; dong.push(r0); continue; }
    const khoa = bo_account.toLowerCase();
    if (daCo.has(khoa)) { r0.loi = 'Tài khoản BO đã có trong tủ'; dong.push(r0); continue; }
    if (trongFile.has(khoa)) { r0.loi = 'Trùng với dòng khác trong file'; dong.push(r0); continue; }

    const tz = tzTu(r0.khu_vuc_goc);
    if (tz === undefined) {
      r0.loi = `Khu vực "${r0.khu_vuc_goc}" không hiểu, chỉ nhận VN hoặc ARM`;
      dong.push(r0); continue;
    }

    // Giờ vào ca: có ghi mà không hiểu thì báo lỗi, đừng âm thầm lấy mặc định.
    let ca_bat_dau = null;
    if (r0.gio_goc) {
      ca_bat_dau = gioTu(r0.gio_goc);
      if (!ca_bat_dau) {
        r0.loi = `Giờ vào ca "${r0.gio_goc}" không đọc được, cần dạng HH:MM (ví dụ 09:00 hoặc 22:00)`;
        dong.push(r0); continue;
      }
    }

    trongFile.add(khoa);
    r0.se_them = {
      ho_ten, bo_account,
      vai_tro: chuanBoPhan(r0.bo_phan_goc),
      tz_offset: tz,
      ca_bat_dau,
    };
    dong.push(r0);
  }

  if (!dong.length) throw new Error('Không đọc được dòng nhân sự nào dưới tiêu đề.');
  return {
    cot: {
      ten: td.vt.ten >= 0, tai_khoan_bo: td.vt.acc >= 0,
      khu_vuc: td.vt.khu >= 0, bo_phan: td.vt.bop >= 0,
      gio_vao_ca: td.vt.gio >= 0,
    },
    dong,
  };
}

module.exports = { doc_file, chuanBoPhan, gioTu };
