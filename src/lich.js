'use strict';

/* Lịch ca theo tháng — cùng triết lý với hệ thống Điểm danh:
   - Một dòng một người, mỗi ngày trong tháng một cột.
   - Ô ngày ghi giờ VÀO ca; giờ ra suy từ độ dài ca mặc định của người đó.
   - Nếu file có HH:MM-HH:MM thì chỉ lấy mốc đầu; giờ ra vẫn theo Độ dài ca.
   - DO / AL / OFF / nghỉ / trống = hôm đó nghỉ.
   - Khi tháng đã được áp cho nhân viên, ngày không có dòng ca = OFF chính thức.
*/

const XLSX = require('xlsx');

const norm = (h) => String(h ?? '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/\s+/g, '')
  .replace(/[^a-z0-9]/g, '');

const OFF_TOKENS = new Set(['do', 'al', 'off', 'nghi', 'nghiphep', 'x', '-', 'nn', 'null', 'p', 'kl']);
const pad = (n) => String(n).padStart(2, '0');

function headerDay(v, ym) {
  if (v == null || v === '') return null;
  const s = String(v).trim();

  let m = s.match(/^(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/);
  if (m) {
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    return `${ym.slice(0, 4)}-${pad(mo)}-${pad(d)}`;
  }

  // Header kiểu cũ chỉ ghi số ngày 1..31.
  if (/^\d{1,2}$/.test(s)) {
    const d = +s;
    if (d >= 1 && d <= 31) return `${ym}-${pad(d)}`;
  }

  // Excel serial date.
  const num = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
  if (Number.isFinite(num) && num > 40000 && num < 60000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(num) * 86400000);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const straight = `${y}-${pad(mo)}-${pad(d)}`;
    if (straight.startsWith(ym)) return straight;

    // Excel đôi lúc hiểu 01/09 thành Jan 9 theo locale Mỹ. Chỉ đảo khi đảo xong đúng tháng chọn.
    if (d >= 1 && d <= 12) {
      const swapped = `${y}-${pad(d)}-${pad(mo)}`;
      if (swapped.startsWith(ym)) return swapped;
    }
    return straight;
  }
  return null;
}

function withEnd(start, hours) {
  const [h, m] = start.split(':').map(Number);
  const total = (h * 60 + m + Math.round((Number(hours) || 8) * 60)) % 1440;
  return { off: false, start, end: `${pad(Math.floor(total / 60))}:${pad(total % 60)}`, tu_tinh_ket_thuc: 1 };
}

function parseCell(raw, hours) {
  if (raw == null || raw === '') return { off: true };

  if (typeof raw === 'number') {
    if (raw > 40000) return null;
    if (raw >= 0 && raw < 1) {
      const mins = Math.round(raw * 1440) % 1440;
      return withEnd(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`, hours);
    }
    if (raw >= 1 && raw <= 24) return withEnd(`${pad(Math.floor(raw))}:00`, hours);
    return null;
  }

  const s = String(raw).trim();
  if (!s) return { off: true };
  if (OFF_TOKENS.has(norm(s))) return { off: true };

  const cleaned = s.replace(/h/gi, ':').replace(/\s+/g, '');

  let m = cleaned.match(/^(\d{1,2}):(\d{2})\s*(?:-|–|—|→|to)\s*(\d{1,2}):(\d{2})$/i);
  if (m) {
    if (+m[1] > 23 || +m[2] > 59 || +m[3] > 23 || +m[4] > 59) return null;
    // File có ghi cả giờ vào-ra thì vẫn chỉ lấy GIỜ VÀO.
    // Giờ ra luôn tính theo Độ dài ca của nhân viên.
    return withEnd(`${pad(m[1])}:${m[2]}`, hours);
  }

  m = cleaned.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const h = +m[1], mi = +(m[2] || 0);
    if (h > 23 || mi > 59) return null;
    return withEnd(`${pad(h)}:${pad(mi)}`, hours);
  }
  return null;
}

function dateHeaderOf(row, ym) {
  const cols = [];
  (row || []).forEach((c, i) => {
    const d = headerDay(c, ym);
    if (d) cols.push({ index: i, day: d });
  });
  if (!cols.length) return null;
  if (cols.length >= 3) return cols;

  // File chỉ có 1–2 ngày: phải có cột định danh trước vùng ngày để tránh nhận nhầm dữ liệu.
  const first = cols[0].index;
  for (let i = 0; i < first; i++) {
    const n = norm(row[i]);
    if (['ten', 'hoten', 'name', 'taikhoanbo', 'boaccount', 'account', 'username', 'ma', 'manv'].includes(n)) return cols;
  }
  return null;
}

function findIdCols(row, dateCols) {
  const first = dateCols[0].index;
  let accCol = null, nameCol = null, codeCol = null, tzCol = null, roleCol = null;
  for (let i = 0; i < first; i++) {
    const n = norm(row[i]);
    if (accCol === null && ['taikhoanbo','taikhoan','boaccount','account','username','bo'].includes(n)) accCol = i;
    if (nameCol === null && ['ten','hoten','tennhanvien','name','fullname'].includes(n)) nameCol = i;
    if (codeCol === null && ['ma','manv','manhanvien','employeecode','empcode'].includes(n)) codeCol = i;
    if (tzCol === null && ['khuvuc','region','location','quocgia','nuoc','muigio','timezone'].includes(n)) tzCol = i;
    if (roleCol === null && ['bophan','phongban','vaitro','role','department','team'].includes(n)) roleCol = i;
  }
  return { accCol, nameCol, codeCol, tzCol, roleCol, firstDateCol: first };
}

function tzTu(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/arm|yerevan|armenia/i.test(s)) return 240;
  if (/vn|viet|hcm|hanoi|saigon|ho_?chi/i.test(s)) return 420;
  return undefined;
}

function parseScheduleFile(buffer, ym, hoursOf = () => 8) {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) {
    return { ym, rows: [], errors: ['Thiếu tháng áp dụng (dạng YYYY-MM).'], count: 0, headerMonths: {} };
  }

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const errors = [];
  const byPerson = new Map();
  const headerMonths = {};

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
    let dateCols = null, idCols = null;

    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      const hdr = dateHeaderOf(row, ym);
      if (hdr) {
        hdr.forEach(({ day }) => {
          const m = day.slice(0, 7);
          headerMonths[m] = (headerMonths[m] || 0) + 1;
        });
        dateCols = hdr;
        idCols = findIdCols(row, hdr);
        continue;
      }
      if (!dateCols || !idCols) continue;

      const get = (col) => (col !== null && col !== undefined) ? String(row[col] ?? '').trim() : '';
      const bo = get(idCols.accCol);
      const code = get(idCols.codeCol);
      let name = get(idCols.nameCol);

      if (!name) {
        const skip = new Set([idCols.accCol, idCols.codeCol, idCols.tzCol, idCols.roleCol]);
        for (let i = 0; i < idCols.firstDateCol; i++) {
          if (skip.has(i)) continue;
          const v = String(row[i] ?? '').trim();
          if (v && !/^\d+([.,]\d+)?$/.test(v)) { name = v; break; }
        }
      }

      if (!bo && !code && !name) continue;
      const identity = (bo || code || name).trim();
      const key = identity.toLowerCase();
      if (!byPerson.has(key)) {
        byPerson.set(key, {
          sheet: sheetName, row: r + 1, bo_account: bo, ma: code, name,
          tz_offset: null, vai_tro: '', days: {},
        });
      }
      const rec = byPerson.get(key);
      if (!rec.bo_account && bo) rec.bo_account = bo;
      if (!rec.ma && code) rec.ma = code;
      if (!rec.name && name) rec.name = name;

      const tzRaw = get(idCols.tzCol);
      const tz = tzTu(tzRaw);
      if (tz === undefined) errors.push(`${name || bo || code}: KhuVuc "${tzRaw}" không hiểu; giữ nguyên khu vực đang có.`);
      else if (tz !== null) rec.tz_offset = tz;
      const role = get(idCols.roleCol);
      if (role) rec.vai_tro = role.toUpperCase();

      const hours = Number(hoursOf(rec.bo_account || rec.ma, rec.name)) || 8;
      for (const { index, day } of dateCols) {
        if (!day.startsWith(ym)) continue;
        const parsed = parseCell(row[index], hours);
        if (parsed === null) {
          errors.push(`${name || bo || code}, ngày ${day.slice(8)}: không đọc được "${row[index]}"; đã coi là OFF.`);
          continue;
        }
        if (parsed.off) continue;
        rec.days[day] = { start: parsed.start, end: parsed.end,
          tu_tinh_ket_thuc: parsed.tu_tinh_ket_thuc ? 1 : 0 };
      }
    }
  }

  const rows = [...byPerson.values()];
  if (!rows.length) {
    errors.unshift('Không tìm thấy dòng tiêu đề chứa các ngày. Tiêu đề ngày viết dạng 01/09 hoặc số ngày 1, 2, 3...');
  }
  return { ym, rows, errors, count: rows.length, headerMonths };
}

module.exports = { parseScheduleFile, doc_file: parseScheduleFile, parseCell, headerDay, withEnd, norm, tzTu };
