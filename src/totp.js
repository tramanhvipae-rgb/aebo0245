'use strict';
const { authenticator } = require('otplib');
const { unseal } = require('./crypto');

// otplib GỘP options chứ không thay. Gán epoch tạm rồi gán lại bộ cũ là không đủ —
// epoch dính lại và mọi mã sinh sau đó đều lệch một cửa sổ. Luôn resetOptions rồi đặt lại.
const CAU_HINH = { step: 30, digits: 6, window: 1 };
function datLai() {
  authenticator.resetOptions();
  authenticator.options = CAU_HINH;
}
datLai();

const NGUONG_DOI_CHU_KY = 8; // giây

const conLai = () => authenticator.timeRemaining();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chuẩn hoá chuỗi Base32 do BO trả về: bỏ khoảng trắng, viết hoa, bỏ dấu = */
function chuanHoaHatGiong(raw) {
  const s = String(raw || '').replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(s)) throw new Error('Hạt giống không đúng định dạng Base32.');
  if (s.length < 16) throw new Error('Hạt giống quá ngắn, kiểm tra lại chuỗi copy từ BO.');
  return s;
}

/** Nhận chuỗi Base32 trần HOẶC link otpauth:// và trả về hạt giống Base32. */
function tachHatGiong(input) {
  const s = String(input || '').trim();
  if (s.toLowerCase().startsWith('otpauth://')) {
    const secret = new URL(s).searchParams.get('secret');
    if (!secret) throw new Error('Link otpauth không có tham số secret.');
    return chuanHoaHatGiong(secret);
  }
  return chuanHoaHatGiong(s);
}

function kiemTraHatGiong(seed) {
  authenticator.generate(chuanHoaHatGiong(seed));
  return true;
}

/**
 * Sinh mã từ hạt giống đã mã hoá.
 * Nếu chu kỳ hiện tại còn dưới 8 giây thì đợi sang chu kỳ mới rồi mới sinh —
 * nếu không nhân viên nhập trượt sẽ bấm lại liên tục, hạn mức và cảnh báo dò mã thành nhiễu.
 */
async function sinhMa(seedEnc) {
  if (conLai() < NGUONG_DOI_CHU_KY) {
    await sleep((conLai() + 1) * 1000);
  }
  const seed = unseal(seedEnc);
  const ma = authenticator.generate(seed);
  return { ma, con_lai: conLai() };
}

/**
 * Sinh mã của các cửa sổ liền nhau để dò lệch đồng hồ.
 * BO chỉ nhận mã của cửa sổ -30 hoặc +30 nghĩa là đồng hồ máy chủ lệch,
 * chứ không phải hạt giống sai.
 */
function chan_doan_lech_gio(seedEnc, soCuaSo = 2) {
  const seed = unseal(seedEnc);
  const buoc = CAU_HINH.step * 1000;
  const nay = Date.now();
  const ds = [];
  try {
    for (let i = -soCuaSo; i <= soCuaSo; i++) {
      const t = nay + i * buoc;
      authenticator.options = { epoch: t };   // otplib lấy mốc từ options, không nhận tham số
      ds.push({
        lech_giay: i * (buoc / 1000),
        ma: authenticator.generate(seed),
        cua_so: new Date(t).toISOString().slice(11, 19),
      });
    }
  } finally {
    datLai();   // bắt buộc, nếu không epoch dính lại và cả tủ sinh mã sai
  }
  return { gio_may_chu_utc: new Date(nay).toISOString(), con_lai: conLai(), danh_sach: ds };
}

module.exports = { sinhMa, tachHatGiong, chuanHoaHatGiong, kiemTraHatGiong, conLai,
  chan_doan_lech_gio, NGUONG_DOI_CHU_KY };
