'use strict';
const db = require('./db');
const svc = require('./service');
const { ca_hieu_luc, cua_so_gan, gioDiaPhuong, LUAT } = require('./policy');
const { dauVan } = require('./crypto');

/**
 * Đường lấy mã qua máy trạm (PowerShell), thay cho Telegram.
 * Luật giữ nguyên hệt bot: gắn theo ca, mỗi ca một máy, mở sớm 7 phút,
 * ngoài ca thì chờ Jason duyệt.
 *
 * Khác một điểm: định danh là MÁY THẬT, không phải tài khoản nhắn tin.
 * Dấu vân máy = băm của tên máy + MachineGuid + serial ổ C.
 * Chép tệp device.json sang máy khác thì dấu vân lệch, tủ từ chối ngay.
 */

const KHOA = (mayId) => 'may:' + mayId;

// Server gắn hai hàm này vào bot để bắn nút bấm về Telegram của Jason.
let hoiDuyetMay = async () => {};
function gan_kenh_hoi(fnMay) { if (fnMay) hoiDuyetMay = fnMay; }
const nhan = (tb) => `${tb.ten_may || 'không rõ tên'} (máy ${String(tb.may_id).slice(0, 8)}…)`;

/** Máy phải đã đăng ký, đã được duyệt, và dấu vân phải khớp. */
function kiem_may(mayId, vanTay) {
  const tb = db.getThietBi(mayId);
  if (!tb) return { loi: 'chua_dang_ky' };
  if (tb.trang_thai === 'cho') return { loi: 'cho_duyet', tb };
  if (tb.trang_thai !== 'duyet') return { loi: 'bi_tu_choi', tb };
  if (tb.van_tay !== vanTay) {
    svc.canhBao(null, 'VAN_TAY_LECH',
      `Máy ${nhan(tb)} gửi dấu vân không khớp với lúc đăng ký.\n` +
      `Dấu hiệu tệp device.json bị chép sang máy khác, hoặc máy vừa cài lại Windows / thay ổ cứng.`);
    return { loi: 'van_tay_lech', tb };
  }
  return { tb };
}

/**
 * Mã CCB của một tài khoản BO chỉ được dùng trên đúng một máy trong một ca.
 * Xuất hiện ở máy thứ hai nghĩa là mã đã ra khỏi tay chủ nó — coi là gian lận.
 * Trả về null nếu không có gì bất thường.
 */
function kiem_gian_lan(nv, mayId, tenMay) {
  const ca = ca_hieu_luc(nv);
  // Chưa gắn máy nào trong ca này thì không có gì để tranh.
  if (!ca.trong_ca || nv.bind_ca_start !== ca.start || !nv.bind_may_id) return null;
  // Quay lại đúng máy mình đã gắn ca này thì hợp lệ, kể cả khi đã bị người khác nhường mất.
  if (nv.bind_may_id === String(mayId)) return null;

  const dangCo = db.dsMayCua(nv.id);
  const dangGiu = dangCo.length
    ? dangCo.map((m) => m.nhan_dang || m.telegram_id).join(', ')
    : `máy ${String(nv.bind_may_id).slice(0, 8)}… (đã bị người khác ngồi vào)`;
  const nhanLa = tenMay ? `${tenMay} (máy ${String(mayId).slice(0, 8)}…)` : `máy ${String(mayId).slice(0, 8)}…`;
  svc.canhBao(nv, 'GIAN_LAN',
    `🚨 MÃ CCB DÙNG TRÊN THIẾT BỊ KHÁC\n` +
    `Tài khoản BO: ${nv.bo_account} (${nv.ho_ten})\n` +
    `Máy đã gắn trong ca này: ${dangGiu}\n` +
    `Máy lạ vừa thử: ${nhanLa}\n` +
    `Ca: ${ca.ca_bat_dau || 'OFF'}${ca.ca_ket_thuc ? '–' + ca.ca_ket_thuc : ''} · giờ bên họ ${gioDiaPhuong(nv)}\n` +
    `Đã chặn. Mã CCB có thể đã bị lộ — cân nhắc cấp mã mới.`);
  db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'GIAN_LAN',
    ket_qua: 'tu_choi', chi_tiet: `mã CCB dùng ở ${nhanLa}`, nguon: 'may', ip: nhanLa });
  return { trang_thai: 'gian_lan', ly_do: 'CẢNH BÁO ĐĂNG NHẬP GIAN LẬN ĐƯỢC GỬI VỀ QUẢN TRỊ' };
}

/** Bước một: máy mới xin đăng ký. Phải Jason duyệt mới dùng được. */
function dang_ky({ may_id, van_tay, ten_may, ma_bind }) {
  const nv = ma_bind ? db.getByBindHmac(dauVan(ma_bind)) : null;
  if (ma_bind && !nv) {
    svc.canhBao(null, 'DANG_KY_MAY_SAI', `Có người nhập sai mã CCB khi đăng ký máy "${ten_may || '?'}".`);
    return { trang_thai: 'tu_choi', ly_do: 'Mã CCB không đúng.' };
  }

  const cu = db.getThietBi(may_id);
  if (cu && cu.trang_thai === 'duyet' && cu.van_tay === van_tay) {
    return { trang_thai: 'ok', may_id, ly_do: 'Máy này đã đăng ký rồi.' };
  }

  // Máy vật lý được nhận ra bằng DẤU VÂN, không phải bằng tệp device.json.
  // Xoá tệp đó rồi chạy lại thì vẫn là đúng cái máy cũ — không bắt duyệt lại,
  // và không đẻ thêm một dòng trùng trong bảng máy trạm.
  const theoVanTay = db.getThietBiTheoVanTay(van_tay);
  if (theoVanTay && theoVanTay.trang_thai === 'duyet') {
    db.ghiNhatKy({ nhan_vien_id: nv ? nv.id : null, bo_account: nv ? nv.bo_account : null,
      hanh_dong: 'DANG_KY_MAY', ket_qua: 'ok',
      chi_tiet: `${theoVanTay.ten_may || may_id}: nhận lại máy cũ qua dấu vân`, nguon: 'may' });
    return { trang_thai: 'ok', may_id: theoVanTay.may_id,
      ly_do: 'Máy này đã đăng ký từ trước, nhận lại theo dấu vân máy.' };
  }
  if (theoVanTay && theoVanTay.trang_thai === 'cho') {
    return { trang_thai: 'cho_duyet', may_id: theoVanTay.may_id };
  }

  // Chốt gian lận phải nằm NGAY ĐÂY, không đợi tới bước gắn ca.
  // Máy lạ chưa đăng ký thì dừng ở bước này, nếu chỉ kiểm ở gắn ca thì
  // kẻ dùng mã trộm chỉ tạo ra một yêu cầu đăng ký trông rất vô hại.
  if (nv) {
    const gl = kiem_gian_lan(nv, may_id, ten_may);
    if (gl) return gl;
  }

  db.themThietBi(may_id, van_tay, ten_may, nv ? nv.id : null);
  db.ghiNhatKy({ nhan_vien_id: nv ? nv.id : null, bo_account: nv ? nv.bo_account : null,
    hanh_dong: 'DANG_KY_MAY', ket_qua: 'cho_duyet', chi_tiet: ten_may || may_id, nguon: 'may' });

  // Ghi cảnh báo để còn trong tab Dấu hiệu lạ, nhưng gửi Telegram bằng bản có nút bấm.
  const dangCo = nv ? db.dsMayCua(nv.id).map((m) => m.nhan_dang || m.telegram_id).join(', ') : '';
  db.themCanhBao(nv ? nv.id : null, 'DANG_KY_MAY',
    `Máy mới xin đăng ký: ${ten_may || 'không rõ tên'}\n` +
    (nv ? `Người xin: ${nv.ho_ten} (${nv.bo_account})\n` : '') +
    (dangCo ? `Máy đang gắn: ${dangCo}` : 'Chưa gắn máy nào.'));
  Promise.resolve(hoiDuyetMay(may_id)).catch(() => {});

  return { trang_thai: 'cho_duyet', may_id };
}

/** Bước hai: gắn máy cho ca hiện tại. Cùng luật với /bind của bot. */
function gan_ca({ may_id, van_tay, ma_bind }) {
  // Mã CCB phải được kiểm TRƯỚC tình trạng đăng ký của máy.
  // Nếu kiểm đăng ký trước thì một máy lạ có device.json cũ sẽ bị chặn im lặng,
  // và việc mã CCB bị đem đi chỗ khác không ai biết.
  const nv = db.getByBindHmac(dauVan(ma_bind));
  if (!nv) {
    const tb0 = db.getThietBi(may_id);
    svc.canhBao(null, 'BIND_SAI',
      `Nhập sai mã CCB trên ${tb0 ? nhan(tb0) : `máy chưa đăng ký (${String(may_id).slice(0, 8)}…)`}.`);
    return { trang_thai: 'tu_choi', ly_do: 'Mã CCB không đúng.' };
  }

  const tenMay = (db.getThietBi(may_id) || {}).ten_may;
  const gl0 = kiem_gian_lan(nv, may_id, tenMay);
  if (gl0) return gl0;

  const k = kiem_may(may_id, van_tay);
  if (k.loi) {
    // Mã CCB đúng nhưng máy chưa được duyệt — vẫn phải báo, vì đây có thể là
    // mã bị đem sang máy lạ.
    db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'GAN_TELEGRAM',
      ket_qua: 'tu_choi', chi_tiet: k.loi, nguon: 'may',
      ip: k.tb ? nhan(k.tb) : `máy chưa đăng ký (${String(may_id).slice(0, 8)}…)` });
    svc.canhBao(nv, 'GAN_MAY_CHUA_DUYET',
      `${nv.ho_ten} (${nv.bo_account}) dùng mã CCB trên máy chưa dùng được.\n` +
      `Máy: ${k.tb ? nhan(k.tb) : `chưa đăng ký (${String(may_id).slice(0, 8)}…)`}\n` +
      `Lý do: ${mo_ta_loi(k.loi)}`);
    return { trang_thai: 'tu_choi', ly_do_ma: k.loi, ly_do: mo_ta_loi(k.loi) };
  }

  const tid = KHOA(may_id);
  const dangCo = db.dsMayCua(nv.id);
  const daGan = dangCo.some((m) => m.telegram_id === tid);

  // Lần gắn ĐẦU TIÊN của ca thì cho suốt ca — vào ca muộn vẫn làm việc được.
  // Đổi sang máy khác sau khi đã gắn thì rơi vào kiem_gian_lan ở trên, chặn ở đó.
  // Cửa sổ 7 phút chỉ còn chặn việc gắn quá sớm trước giờ vào ca.
  const ca = ca_hieu_luc(nv);
  const daGanCaNay = nv.bind_ca_start === ca.start;
  const hanChot = Number(db.docCaiDat('gan_han_chot_phut', '0'));
  const cua = cua_so_gan(nv, Date.now(), hanChot);
  const duocGan = ca.trong_ca || cua.trong_cua_so;

  if (!duocGan) {
    const som = LUAT.MO_SOM_MS / 60000;
    db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'GAN_TELEGRAM',
      ket_qua: 'tu_choi', chi_tiet: 'ngoài cửa sổ gắn máy', nguon: 'may', ip: nhan(k.tb) });
    svc.canhBao(nv, 'GAN_NGOAI_CA',
      `${nv.ho_ten} (${nv.bo_account}) thử gắn máy ngoài ca.\n` +
      `Máy: ${nhan(k.tb)}\nCa: ${ca.ca_bat_dau || 'OFF'}${ca.ca_ket_thuc ? '–' + ca.ca_ket_thuc : ''} (giờ máy họ ${gioDiaPhuong(nv)})\n` +
      `Cần cho gắn ngay thì bấm "Mở khoá gắn" trong tủ.`);
    return { trang_thai: 'tu_choi',
      ly_do: `Ngoài giờ ca nên không gắn máy được.\n` +
             `Ca của bạn ${ca.off ? 'OFF' : ca.ca_bat_dau + '-' + ca.ca_ket_thuc}, giờ hiện tại bên bạn ${gioDiaPhuong(nv)}.\n` +
             `Sớm nhất là ${som} phút trước giờ vào ca. Cần gấp thì liên hệ Jason.` };
  }

  void daGanCaNay;
  const biDa = nv.cho_nhieu_may
    ? (db.themGanMay(tid, nv.id, nhan(k.tb)), [])
    : db.ganMayDocQuyen(tid, nv.id, nhan(k.tb));

  // Một máy chỉ phục vụ một tài khoản BO tại một thời điểm — mỗi lúc chỉ một
  // người ngồi trước bàn phím. Nhờ vậy lúc xin mã không phải chọn tài khoản.
  const nhuong = nv.cho_nhieu_may ? [] : db.xoaGanMayKhacTren(tid, nv.id);
  db.capNhatNhanVien(nv.id, { bind_ca_start: ca.start, bind_may_id: String(may_id) });
  db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'GAN_TELEGRAM',
    ket_qua: 'ok', nguon: 'may', ip: nhan(k.tb),
    chi_tiet: biDa.length ? `${nhan(k.tb)} — gỡ ${biDa.length} máy cũ` : nhan(k.tb) });

  if (biDa.length) {
    svc.canhBao(nv, 'Đổi máy nhận mã',
      `${nv.ho_ten} (${nv.bo_account}) chuyển sang máy: ${nhan(k.tb)}\n` +
      `máy cũ bị gỡ: ${biDa.map((m) => m.nhan_dang || m.telegram_id).join(', ')}`);
  } else {
    svc.canhBao(nv, 'GAN_MAY_MOI', `${nv.ho_ten} (${nv.bo_account}) vừa gắn máy: ${nhan(k.tb)}`);
  }

  if (nhuong.length) {
    const ten = nhuong.map((m) => `${m.ho_ten} (${m.bo_account})`).join(', ');
    db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'NHUONG_MAY',
      ket_qua: 'ok', chi_tiet: `${nhan(k.tb)}: gỡ ${ten}`, nguon: 'may', ip: nhan(k.tb) });
    svc.canhBao(nv, 'NHUONG_MAY',
      `${nv.ho_ten} (${nv.bo_account}) vào máy ${nhan(k.tb)}.\n` +
      `Tài khoản đang giữ máy đó bị gỡ: ${ten}\n` +
      `Người cũ muốn dùng lại phải gắn máy lần nữa.`);
  }

  return { trang_thai: 'ok', ho_ten: nv.ho_ten, bo_account: nv.bo_account,
    ca: ca.off ? 'OFF' : `${ca.ca_bat_dau}-${ca.ca_ket_thuc}`, da_da: biDa.length,
    nhuong: nhuong.map((m) => m.bo_account) };
}

/** Bước ba: xin mã 6 số. */
async function xin_ma({ may_id, van_tay, bo_account, ccb }) {
  const k = kiem_may(may_id, van_tay);
  if (k.loi) {
    if (k.loi !== 'van_tay_lech') { // dấu vân lệch đã tự báo trong kiem_may
      db.ghiNhatKy({ hanh_dong: 'XIN_MA_MAY_LA', ket_qua: 'tu_choi', chi_tiet: String(may_id),
        nguon: 'may', ip: k.tb ? nhan(k.tb) : `máy chưa đăng ký (${String(may_id).slice(0, 8)}…)` });
      svc.canhBao(null, 'XIN_MA_MAY_LA',
        `Xin mã từ máy không dùng được: ${k.tb ? nhan(k.tb) : `chưa đăng ký (${String(may_id).slice(0, 8)}…)`}\n` +
        `Lý do: ${mo_ta_loi(k.loi)}`);
    }
    return { trang_thai: 'tu_choi', ly_do_ma: k.loi, ly_do: mo_ta_loi(k.loi) };
  }

  const ds = db.dsTheoTelegram(KHOA(may_id));
  if (!ds.length) {
    db.ghiNhatKy({ hanh_dong: 'XIN_MA_MAY_LA', ket_qua: 'tu_choi',
      chi_tiet: may_id, nguon: 'may', ip: nhan(k.tb) });
    svc.canhBao(null, 'XIN_MA_MAY_LA',
      `Xin mã từ máy CHƯA GẮN cho ca này: ${nhan(k.tb)}\nBot đã từ chối.`);
    return { trang_thai: 'tu_choi', ly_do: 'Máy này chưa gắn tài khoản nào cho ca hiện tại. Nhập mã CCB trước.' };
  }

  let nv = ds[0];
  if (ds.length > 1) {
    nv = ds.find((n) => n.bo_account.toLowerCase() === String(bo_account || '').toLowerCase());
    if (!nv) return { trang_thai: 'chon_tai_khoan', danh_sach: ds.map((n) => n.bo_account) };
  }

  const ca = ca_hieu_luc(nv);
  if (ca.trong_ca && nv.bind_ca_start !== ca.start) {
    db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'XIN_MA',
      ket_qua: 'tu_choi', chi_tiet: 'gắn máy đã hết hiệu lực', nguon: 'may', ip: nhan(k.tb) });
    return { trang_thai: 'tu_choi',
      ly_do: `Gắn máy cho ${nv.bo_account} đã hết hiệu lực từ lúc xuống ca. Nhập lại mã CCB.` };
  }

  const kq = await svc.xin_ma({ nv, ccb, nguon: 'may', may: nhan(k.tb) });
  if (kq.trang_thai === 'can_duyet') {
    db.capNhatYeuCau(kq.yeu_cau_id, 'cho', { nguon: `may · ${nhan(k.tb)}` });
  }
  return { ...kq, ho_ten: nv.ho_ten, bo_account: nv.bo_account };
}

/** Mã phá kính: cố ý BỎ QUA kiểm tra đăng ký máy. */
async function pha_kinh({ may_id, bo_account, ma_giay }) {
  const nv = db.getByBoAccount(String(bo_account || ''));
  if (!nv) return { trang_thai: 'tu_choi', ly_do: 'Không có tài khoản BO này trong tủ.' };
  const tb = db.getThietBi(may_id);
  return svc.pha_kinh({ nv, ma_giay, nguon: 'may',
    may: tb ? nhan(tb) : `máy chưa đăng ký (${String(may_id).slice(0, 8)}…)` });
}

/** Script hỏi vòng kết quả duyệt. */
function trang_thai_duyet(id) {
  const yc = db.getYeuCau(Number(id));
  if (!yc) return { trang_thai: 'khong_thay' };
  if (yc.trang_thai === 'cho' && Date.now() > yc.het_han_luc) return { trang_thai: 'het_han' };
  return { trang_thai: yc.trang_thai };
}

/**
 * Máy này đang ở trạng thái nào cho ca hiện tại.
 * Script gọi lúc khởi động để biết cần gắn máy trước, hay hỏi thẳng CCB để lấy mã.
 */
function trang_thai_ca(mayId, vanTay) {
  const k = kiem_may(mayId, vanTay);
  if (k.loi) return { trang_thai: k.loi, ly_do: mo_ta_loi(k.loi) };

  const ds = db.dsTheoTelegram(KHOA(mayId));
  const conHieuLuc = ds.filter((nv) => {
    const ca = ca_hieu_luc(nv);
    return ca.trong_ca && nv.bind_ca_start === ca.start;
  });

  if (!conHieuLuc.length) return { trang_thai: 'chua_gan' };
  return { trang_thai: 'da_gan',
    tai_khoan: conHieuLuc.map((nv) => {
      const ca = ca_hieu_luc(nv);
      return { ho_ten: nv.ho_ten, bo_account: nv.bo_account,
        ca: ca.off ? 'OFF' : `${ca.ca_bat_dau}-${ca.ca_ket_thuc}`,
        gio_dia_phuong: gioDiaPhuong(nv),
        da_lay: db.demTuLuc(nv.id, 'PHAT_MA', 'ok', ca.moc_dem),
        han_muc: nv.han_muc_ca };
    }) };
}

function trang_thai_may(mayId) {
  const tb = db.getThietBi(mayId);
  return { trang_thai: tb ? tb.trang_thai : 'chua_dang_ky', ten_may: tb ? tb.ten_may : null };
}

function mo_ta_loi(ma) {
  return {
    chua_dang_ky: 'Máy này chưa đăng ký với tủ.',
    cho_duyet: 'Máy này đang chờ Jason duyệt đăng ký.',
    bi_tu_choi: 'Máy này đã bị từ chối. Liên hệ Jason.',
    van_tay_lech: 'Dấu vân máy không khớp với lúc đăng ký. Máy vừa cài lại Windows hoặc thay ổ cứng thì phải đăng ký lại. Jason đã được báo.',
  }[ma] || 'Không dùng được máy này.';
}

module.exports = { dang_ky, gan_ca, xin_ma, pha_kinh, trang_thai_duyet, trang_thai_may, trang_thai_ca,
  gan_kenh_hoi, KHOA, nhan };
