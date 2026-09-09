'use strict';

const PHUT = 60000;

/** Mốc bắt đầu/kết thúc ca hiện tại, theo múi giờ của nhân viên. Hỗ trợ ca qua đêm.
 *
 * Thứ tự ưu tiên:
 * 1) Có ca WORK cụ thể đang chạy / đúng ngày -> dùng lịch ngày.
 * 2) Tháng đã được upload/chốt lịch nhưng ngày đó không có ca -> OFF chính thức.
 * 3) Tháng chưa có lịch chính thức -> dùng ca mặc định cũ của nhân viên.
 */
function moc_ca(nv, nowMs = Date.now()) {
  const rows = Array.isArray(nv._lich_ngay) ? nv._lich_ngay : [];
  const thangApDung = new Set(Array.isArray(nv._lich_thang_ap_dung) ? nv._lich_thang_ap_dung : []);

  // Ca đêm của ngày hôm trước vẫn có hiệu lực sau 00:00 ngày kế tiếp.
  const dangChay = rows.find((r) => r.trang_thai === 'WORK'
    && Number(r.bat_dau_luc) <= nowMs && nowMs < Number(r.ket_thuc_luc));
  if (dangChay) return {
    start: Number(dangChay.bat_dau_luc), end: Number(dangChay.ket_thuc_luc), trong_ca: true,
    off: false, nguon_ca: 'lich_ngay', ngay_ca: dangChay.ngay,
    ca_bat_dau: dangChay.ca_bat_dau, ca_ket_thuc: dangChay.ca_ket_thuc,
    tz_offset: dangChay.tz_offset,
  };

  const hom = ngayDiaPhuong(nv, nowMs);
  const r = rows.find((x) => x.ngay === hom);
  if (r) {
    if (r.trang_thai === 'OFF') {
      const off = Number(r.tz_offset ?? nv.tz_offset ?? 0) * PHUT;
      const [y, m, d] = hom.split('-').map(Number);
      const dau = Date.UTC(y, m - 1, d) - off;
      return { start: dau, end: dau, trong_ca: false, off: true,
        nguon_ca: 'lich_ngay', ngay_ca: r.ngay, ca_bat_dau: null, ca_ket_thuc: null,
        tz_offset: r.tz_offset ?? nv.tz_offset };
    }
    return {
      start: Number(r.bat_dau_luc), end: Number(r.ket_thuc_luc),
      trong_ca: nowMs >= Number(r.bat_dau_luc) && nowMs < Number(r.ket_thuc_luc),
      off: false, nguon_ca: 'lich_ngay', ngay_ca: r.ngay,
      ca_bat_dau: r.ca_bat_dau, ca_ket_thuc: r.ca_ket_thuc, tz_offset: r.tz_offset,
    };
  }

  // Đây là điểm khác với bản cũ: tháng đã có lịch thì thiếu ca = OFF,
  // không được tự rơi về ca mặc định rồi mở BO nhầm ngày nghỉ.
  if (thangApDung.has(hom.slice(0, 7))) {
    const off = Number(nv.tz_offset || 0) * PHUT;
    const [y, m, d] = hom.split('-').map(Number);
    const dau = Date.UTC(y, m - 1, d) - off;
    return { start: dau, end: dau, trong_ca: false, off: true,
      nguon_ca: 'lich_thang', ngay_ca: hom, ca_bat_dau: null, ca_ket_thuc: null,
      tz_offset: nv.tz_offset };
  }

  // Chưa upload/chốt lịch tháng cho người này: giữ nguyên hành vi cũ.
  const off = (nv.tz_offset || 0) * PHUT;
  const local = new Date(nowMs + off);
  const [sh, sm] = String(nv.ca_bat_dau).split(':').map(Number);
  const [eh, em] = String(nv.ca_ket_thuc).split(':').map(Number);
  const batDau = sh * 60 + sm;
  const ketThuc = eh * 60 + em;
  const hienTai = local.getUTCHours() * 60 + local.getUTCMinutes();

  const dauNgay = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
  const NGAY = 24 * 60 * PHUT;

  let start, end;
  if (batDau <= ketThuc) {
    start = dauNgay + batDau * PHUT;
    end = dauNgay + ketThuc * PHUT;
  } else if (hienTai >= batDau) {
    start = dauNgay + batDau * PHUT;
    end = dauNgay + NGAY + ketThuc * PHUT;
  } else {
    start = dauNgay - NGAY + batDau * PHUT;
    end = dauNgay + ketThuc * PHUT;
  }
  return { start, end, trong_ca: nowMs >= start && nowMs < end, off: false,
    nguon_ca: 'mac_dinh', ngay_ca: ngayDiaPhuong(nv, start),
    ca_bat_dau: nv.ca_bat_dau, ca_ket_thuc: nv.ca_ket_thuc, tz_offset: nv.tz_offset };
}

function gioDiaPhuong(nv, nowMs = Date.now()) {
  const d = new Date(nowMs + (nv.tz_offset || 0) * PHUT);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Ngày theo lịch ở nơi người đó làm việc, không phải ngày của máy chủ.
 * VN (UTC+7) và ARM (UTC+4) lệch nhau 3 tiếng nên sang ngày mới ở hai thời điểm khác nhau.
 */
function ngayDiaPhuong(nv, nowMs = Date.now()) {
  const d = new Date(nowMs + (nv.tz_offset || 0) * PHUT);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 'HH:MM' + số phút -> 'HH:MM', tự vòng qua nửa đêm. */
function congGio(hhmm, phut) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const t = (((h * 60 + m + phut) % 1440) + 1440) % 1440;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 60))}:${p(t % 60)}`;
}

/** Độ dài ca tính bằng phút, hỗ trợ ca qua đêm (22:00-06:00 = 480). */
function doDaiPhut(batDau, ketThuc) {
  const [h1, m1] = String(batDau).split(':').map(Number);
  const [h2, m2] = String(ketThuc).split(':').map(Number);
  const a = h1 * 60 + m1, b = h2 * 60 + m2;
  return b > a ? b - a : 1440 - a + b;
}

/** Mốc thời gian dạng 'HH:MM DD/MM' theo giờ nơi người đó làm việc. */
function gioNgayDiaPhuong(nv, msEpoch) {
  const d = new Date(msEpoch + (nv.tz_offset || 0) * PHUT);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

/** Còn bao nhiêu phút nữa sang ngày mới ở nơi người đó làm việc. */
function conToiNgayMoi(nv, nowMs = Date.now()) {
  const d = new Date(nowMs + (nv.tz_offset || 0) * PHUT);
  return Math.ceil((24 * 60) - (d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60));
}

/**
 * Ca đang có hiệu lực, tính cả cửa sổ mở sớm trước giờ lên ca.
 * Trả về `som: true` nếu đang trong cửa sổ mở sớm.
 * Xử lý được cả ca qua đêm: 21:53 với ca 22:00–06:00 phải ra ca của đêm nay,
 * không phải ca của đêm hôm qua.
 */
function ca_hieu_luc(nv, nowMs = Date.now(), somMs = null) {
  const som = somMs == null ? LUAT.MO_SOM_MS : somMs;
  const ca = moc_ca(nv, nowMs);
  if (ca.trong_ca) return { ...ca, som: false, moc_dem: ca.start - som };
  const sap = moc_ca(nv, nowMs + som);
  if (sap.trong_ca) return { ...sap, trong_ca: true, som: true, moc_dem: sap.start - som };
  return { ...ca, som: false, moc_dem: ca.start - som };
}

/**
 * Cửa sổ được phép GẮN MÁY bằng mã CCB.
 * Mở 7 phút trước giờ vào ca, đóng lại đúng giờ vào ca (nới được bằng han_chot_phut).
 * Cố ý hẹp: vào ca rồi không gắn máy mới được nữa, nên không có đường cướp máy giữa ca.
 * Lấy mã OTP thì vẫn suốt ca — đó là việc khác.
 */
function cua_so_gan(nv, nowMs = Date.now(), hanChotPhut = 0) {
  const ca = ca_hieu_luc(nv, nowMs);
  if (ca.off) return { ca, mo: null, dong: null, trong_cua_so: false };
  const mo = ca.start - LUAT.MO_SOM_MS;
  const dong = ca.start + Math.max(0, hanChotPhut) * 60000;
  return { ca, mo, dong, trong_cua_so: nowMs >= mo && nowMs <= dong };
}

const LUAT = {
  MO_SOM_MS: 7 * 60000,          // được dùng mã CCB từ 7 phút trước giờ lên ca
  BURST_SO_LAN: 5,          // 5 lần trong 10 phút -> cảnh báo
  BURST_CUA_SO: 10 * PHUT,
  MUC_CAO_NGUONG: 3,        // tài khoản quyền cao, từ lần thứ 3 trong ca -> cảnh báo
  SAI_PIN_NGUONG: 3,        // sai mã CCB 3 lần -> khoá tạm + cảnh báo
  KHOA_TAM_MS: 10 * PHUT,
  DUYET_TTL_MS: 2 * PHUT,
  BIND_SAI_NGUONG: 5,            // sai mã CCB 5 lần trong 10 phút -> chặn ID
  BIND_CUA_SO: 10 * PHUT,
  BIND_GIAN_CACH_MS: 3000,       // tối thiểu 3 giây giữa hai lần thử bind
  CHAN_MS: 24 * 60 * PHUT,       // chặn 24 giờ


  XOA_TIN_SAU_MS: 10000,          // tin chứa mã sống 10 giây
  XOA_TIN_NV_MS: 500,             // tin của nhân viên xoá gần như ngay
};

module.exports = { moc_ca, ca_hieu_luc, cua_so_gan, gioDiaPhuong, gioNgayDiaPhuong, ngayDiaPhuong,
  conToiNgayMoi, congGio, doDaiPhut, LUAT, PHUT };
