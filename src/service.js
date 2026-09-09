'use strict';
const db = require('./db');
const { verifySecretValue, hashSecretValue, randomDigits, dauVan } = require('./crypto');
const { sinhMa } = require('./totp');
const { ca_hieu_luc, gioDiaPhuong, LUAT } = require('./policy');

let baoDong = async () => {}; // được server gắn hàm bắn Telegram cho Jason
let baoThuong = async () => {}; // báo hoạt động bình thường, có thể tắt

function gan_kenh_bao_dong(fn) { baoDong = fn; }
function gan_kenh_bao_thuong(fn) { baoThuong = fn; }

/** Báo cho Jason biết vừa có người lấy mã. Bật/tắt ở tab Cài đặt. */
function baoPhatMa(nv, chiTiet, may) {
  if (db.docCaiDat('bao_moi_lan_phat_ma', '1') !== '1') return;
  const gio = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  Promise.resolve(baoThuong(
    `🔑 ${gio} · <b>${nv.ho_ten}</b> lấy mã\n` +
    `<code>${nv.bo_account}</code> · ${nv.brand} · ${nv.vai_tro}\n` +
    `Xin từ: ${may || 'trang Kiểm thử'}\n${chiTiet}`
  )).catch(() => {});
}

function canhBao(nv, loai, noiDung) {
  db.themCanhBao(nv ? nv.id : null, loai, noiDung);
  Promise.resolve(baoDong(loai, noiDung, nv)).catch(() => {});
}

/**
 * Xin mã. Trả về một trong các trạng thái:
 *   ok            -> { ma, con_lai }
 *   can_duyet     -> { yeu_cau_id }  (ngoài giờ ca)
 *   tu_choi       -> { ly_do }
 */
async function xin_ma({ nv, ccb, nguon, ip, may = null, da_duyet = false, nguoi_duyet = null }) {
  const now = Date.now();
  // `may` = Telegram nào gửi lệnh. Ghế dùng chung nên đây là thông tin cần nhất trong nhật ký.
  const chung = { nhan_vien_id: nv.id, bo_account: nv.bo_account, nguon, ip: ip || may };

  if (nv.trang_thai !== 'hoat_dong') {
    db.ghiNhatKy({ ...chung, hanh_dong: 'XIN_MA', ket_qua: 'tu_choi', chi_tiet: 'tài khoản đã khoá' });
    return { trang_thai: 'tu_choi', ly_do: 'Tài khoản đã bị khoá. Liên hệ Jason.' };
  }

  if (nv.khoa_tam_den && now < nv.khoa_tam_den) {
    const con = Math.ceil((nv.khoa_tam_den - now) / 60000);
    return { trang_thai: 'tu_choi', ly_do: `Đang khoá tạm do nhập sai mã CCB. Thử lại sau ${con} phút.` };
  }

  if (!nv.bind_hmac || !nv.seed_enc) {
    return { trang_thai: 'tu_choi', ly_do: 'Tài khoản chưa được nạp đầy đủ. Liên hệ Jason.' };
  }

  // --- lớp 1: mã CCB ---
  // Từ khi bỏ mã cá nhân, CCB vừa là chìa gắn máy vừa là chìa lấy mã.
  if (!ccb || dauVan(ccb) !== nv.bind_hmac) {
    const lan = (nv.sai_pin_lien_tiep || 0) + 1;
    const patch = { sai_pin_lien_tiep: lan };
    if (lan >= LUAT.SAI_PIN_NGUONG) {
      patch.khoa_tam_den = now + LUAT.KHOA_TAM_MS;
      patch.sai_pin_lien_tiep = 0;
      canhBao(nv, 'SAI_CCB', `${nv.ho_ten} (${nv.bo_account}) nhập sai mã CCB ${LUAT.SAI_PIN_NGUONG} lần liên tiếp. Đã khoá tạm 10 phút.\nXin từ: ${may || 'trang Kiểm thử'}`);
    }
    db.capNhatNhanVien(nv.id, patch);
    db.ghiNhatKy({ ...chung, hanh_dong: 'XIN_MA', ket_qua: 'sai_ccb', chi_tiet: `lần thứ ${lan}` });
    return { trang_thai: 'tu_choi', ly_do: 'Mã CCB không đúng.' };
  }
  if (nv.sai_pin_lien_tiep) db.capNhatNhanVien(nv.id, { sai_pin_lien_tiep: 0, khoa_tam_den: null });

  // --- lớp 2: ca trực ---
  const ca = ca_hieu_luc(nv, now);
  // OFF theo lịch chính thức không phải là một ca ngoài giờ để xin duyệt.
  // Đây là ngày không được kích hoạt BO; muốn làm phát sinh phải sửa lịch trước.
  if (ca.off) {
    db.ghiNhatKy({ ...chung, hanh_dong: 'XIN_MA', ket_qua: 'tu_choi',
      chi_tiet: `OFF theo lịch ${ca.ngay_ca || ''}`, nguon });
    return { trang_thai: 'tu_choi',
      ly_do: `Hôm nay OFF theo lịch làm việc${ca.ngay_ca ? ' (' + ca.ngay_ca + ')' : ''}. Không thể lấy OTP cho BO.` };
  }
  if (!ca.trong_ca && !da_duyet) {
    const id = db.taoYeuCauDuyet(nv.id, `ngoài ca (giờ máy nhân viên ${gioDiaPhuong(nv, now)})`, nguon, LUAT.DUYET_TTL_MS);
    db.ghiNhatKy({ ...chung, hanh_dong: 'XIN_MA', ket_qua: 'cho_duyet', chi_tiet: `yêu cầu #${id}` });
    return { trang_thai: 'can_duyet', yeu_cau_id: id, ca };
  }

  // --- lớp 3: hạn mức trong ca ---
  // Đếm từ mốc mở sớm, không từ giờ lên ca — nếu không thì mã lấy trong 7 phút
  // mở sớm sẽ không tính vào hạn mức.
  const daLay = db.demTuLuc(nv.id, 'PHAT_MA', 'ok', ca.trong_ca ? ca.moc_dem : now - 12 * 3600000);
  if (ca.trong_ca && daLay >= nv.han_muc_ca) {
    canhBao(nv, 'VUOT_HAN_MUC', `${nv.ho_ten} (${nv.bo_account}) đã lấy ${daLay} mã trong ca, vượt hạn mức ${nv.han_muc_ca}.`);
    db.ghiNhatKy({ ...chung, hanh_dong: 'XIN_MA', ket_qua: 'tu_choi', chi_tiet: 'vượt hạn mức ca' });
    return { trang_thai: 'tu_choi', ly_do: `Đã lấy ${daLay} mã trong ca này, vượt hạn mức. Liên hệ Jason.` };
  }

  // --- phát mã ---
  const { ma, con_lai } = await sinhMa(nv.seed_enc);
  const ghiChu = da_duyet ? 'ngoài ca, đã duyệt' : `lần ${daLay + 1}/${nv.han_muc_ca} trong ca`;
  db.ghiNhatKy({ ...chung, hanh_dong: 'PHAT_MA', ket_qua: 'ok',
    chi_tiet: ghiChu, nguoi_duyet: nguoi_duyet });
  baoPhatMa(nv, ghiChu, may);

  // --- hậu kiểm: các dấu hiệu bất thường ---
  const burst = db.demTuLuc(nv.id, 'PHAT_MA', 'ok', now - LUAT.BURST_CUA_SO);
  if (burst >= LUAT.BURST_SO_LAN) {
    canhBao(nv, 'LAY_DON_DAP', `${nv.ho_ten} (${nv.bo_account}) lấy ${burst} mã trong 10 phút.`);
  }
  if (nv.muc === 'cao' && daLay + 1 >= LUAT.MUC_CAO_NGUONG) {
    canhBao(nv, 'QUYEN_CAO', `${nv.ho_ten} (${nv.bo_account}, ${nv.vai_tro}) lấy mã lần thứ ${daLay + 1} trong ca.`);
  }
  if (da_duyet) {
    canhBao(nv, 'NGOAI_CA', `${nv.ho_ten} (${nv.bo_account}) lấy mã ngoài ca, đã duyệt.`);
  }

  return { trang_thai: 'ok', ma, con_lai };
}

/** Duyệt hoặc từ chối một yêu cầu ngoài ca. */
async function quyet_dinh_duyet(yeuCauId, dongY, nguoiDuyet, nguon) {
  const yc = db.getYeuCau(yeuCauId);
  if (!yc) return { trang_thai: 'tu_choi', ly_do: 'Không tìm thấy yêu cầu.' };
  if (yc.trang_thai !== 'cho') return { trang_thai: 'tu_choi', ly_do: `Yêu cầu đã ${yc.trang_thai}.` };
  if (Date.now() > yc.het_han_luc) {
    db.capNhatYeuCau(yeuCauId, 'het_han');
    return { trang_thai: 'tu_choi', ly_do: 'Yêu cầu đã hết hạn (quá 2 phút).' };
  }

  if (!dongY) {
    db.capNhatYeuCau(yeuCauId, 'tu_choi');
    db.ghiNhatKy({ nhan_vien_id: yc.nhan_vien_id, bo_account: yc.bo_account,
      hanh_dong: 'DUYET', ket_qua: 'tu_choi', nguoi_duyet: nguoiDuyet, nguon });
    return { trang_thai: 'tu_choi', ly_do: 'Jason đã từ chối.', yeu_cau: yc };
  }

  db.capNhatYeuCau(yeuCauId, 'duyet');
  const nv = db.getNhanVienFull(yc.nhan_vien_id);
  const { ma, con_lai } = await sinhMa(nv.seed_enc);
  db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'PHAT_MA',
    ket_qua: 'ok', chi_tiet: 'ngoài ca, đã duyệt', nguon: yc.nguon, nguoi_duyet: nguoiDuyet });
  canhBao(nv, 'NGOAI_CA', `${nv.ho_ten} (${nv.bo_account}) lấy mã ngoài ca, ${nguoiDuyet} duyệt.`);
  return { trang_thai: 'ok', ma, con_lai, yeu_cau: yc, nhan_vien: nv };
}

/** Dùng một mã phá kính. Mỗi mã chỉ dùng được một lần. */
async function pha_kinh({ nv, ma_giay, nguon, ip, may = null }) {
  const ds = db.dsMaPhaKinhChuaDung(nv.id);
  const hit = ds.find((r) => verifySecretValue(String(ma_giay).replace(/\s|-/g, ''), r.ma_hash));
  if (!hit) {
    db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'PHA_KINH',
      ket_qua: 'sai', nguon, ip: ip || may });
    canhBao(nv, 'PHA_KINH_SAI', `${nv.ho_ten} (${nv.bo_account}) nhập sai mã phá kính.\nXin từ: ${may || 'trang Kiểm thử'}`);
    return { trang_thai: 'tu_choi', ly_do: 'Mã phá kính không đúng hoặc đã dùng rồi.' };
  }
  db.danhDauDaDung(hit.id);
  const { ma, con_lai } = await sinhMa(nv.seed_enc);
  const con = db.demMaPhaKinh(nv.id);
  db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'PHA_KINH',
    ket_qua: 'ok', chi_tiet: `còn ${con} mã`, nguon, ip: ip || may });
  canhBao(nv, 'PHA_KINH', `${nv.ho_ten} (${nv.bo_account}) vừa dùng MÃ PHÁ KÍNH. Còn lại ${con} mã.\nXin từ: ${may || 'trang Kiểm thử'}`);
  return { trang_thai: 'ok', ma, con_lai, con_lai_pha_kinh: con };
}

/** Sinh lại bộ mã phá kính. Trả bản trần đúng một lần để in ra giấy. */
function tao_ma_pha_kinh(nvId, soLuong = 3) {
  db.xoaMaPhaKinh(nvId);
  const out = [];
  for (let i = 0; i < soLuong; i++) {
    const ma = randomDigits(4) + '-' + randomDigits(4);
    db.themMaPhaKinh(nvId, hashSecretValue(ma.replace('-', '')));
    out.push(ma);
  }
  const nv = db.getNhanVienFull(nvId);
  db.ghiNhatKy({ nhan_vien_id: nvId, bo_account: nv.bo_account, hanh_dong: 'TAO_PHA_KINH',
    ket_qua: 'ok', chi_tiet: `${soLuong} mã`, nguon: 'admin' });
  return out;
}

module.exports = { xin_ma, quyet_dinh_duyet, pha_kinh, tao_ma_pha_kinh,
  gan_kenh_bao_dong, gan_kenh_bao_thuong, canhBao };
