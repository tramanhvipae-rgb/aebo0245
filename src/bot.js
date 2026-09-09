'use strict';
const db = require('./db');
const svc = require('./service');

const { LUAT } = require('./policy');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || '');
const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

let offset = 0;
let dangChay = false;

async function goi(method, body) {
  const r = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false }));
}

const guiTin = (chat_id, text, extra = {}) =>
  goi('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });

const xoaTin = (chat_id, message_id) =>
  goi('deleteMessage', { chat_id, message_id }).catch(() => {});

/** Gửi mã rồi hẹn giờ tự xoá. */
async function guiMaRoiXoa(chatId, nv, ma, conLai) {
  const r = await guiTin(chatId,
    `<b>${nv.bo_account}</b>\n<code>${ma}</code>\nHết hạn sau ${conLai}s · tin này tự xoá sau ${LUAT.XOA_TIN_SAU_MS / 1000}s`);
  const mid = r?.result?.message_id;
  if (mid) setTimeout(() => xoaTin(chatId, mid), LUAT.XOA_TIN_SAU_MS);
}

async function baoDongChoJason(loai, noiDung) {
  if (!TOKEN || !ADMIN_ID) return;
  const nang = loai === 'GIAN_LAN';
  await guiTin(ADMIN_ID,
    nang ? `🚨🚨 <b>CẢNH BÁO GIAN LẬN</b> 🚨🚨\n<pre>${noiDung}</pre>`
         : `⚠️ <b>${loai}</b>\n${noiDung}`);
}

/** Báo hoạt động bình thường (mỗi lần phát mã). Không có biểu tượng cảnh báo. */
async function tinChoJason(noiDung) {
  if (!TOKEN || !ADMIN_ID) return;
  await guiTin(ADMIN_ID, noiDung);
}

/** Hỏi duyệt đăng ký máy mới, kèm nút bấm ngay trong Telegram. */
async function hoiDuyetMay(mayId) {
  if (!TOKEN || !ADMIN_ID) return;
  const tb = db.getThietBi(mayId);
  if (!tb) return;
  const nv = tb.nhan_vien_id ? db.getNhanVienFull(tb.nhan_vien_id) : null;
  const dangCo = nv ? db.dsMayCua(nv.id).map((m) => m.nhan_dang || m.telegram_id) : [];
  await guiTin(ADMIN_ID,
    `🖥 <b>ĐĂNG KÝ MÁY MỚI</b>\n` +
    `Máy: <b>${tb.ten_may || 'không rõ tên'}</b>\n` +
    (nv ? `Người xin: ${nv.ho_ten} · <code>${nv.bo_account}</code>\n` : '') +
    (dangCo.length ? `Máy đang gắn: ${dangCo.join(', ')}\n` : 'Chưa gắn máy nào.\n') +
    `Nhân viên đang đứng chờ.`,
    { reply_markup: { inline_keyboard: [[
      { text: '✅ Duyệt máy', callback_data: `mok:${mayId}` },
      { text: '⛔ Từ chối', callback_data: `mno:${mayId}` },
    ]] } });
}

async function hoiDuyet(yeuCauId) {
  if (!TOKEN || !ADMIN_ID) return;
  const yc = db.getYeuCau(yeuCauId);
  if (!yc) return;
  await guiTin(ADMIN_ID,
    `🔔 <b>${yc.ho_ten}</b> xin mã ngoài ca\nTài khoản BO: <code>${yc.bo_account}</code>\nLý do: ${yc.ly_do}\nHết hạn sau 2 phút.`,
    { reply_markup: { inline_keyboard: [[
      { text: '✅ Duyệt', callback_data: `ok:${yeuCauId}` },
      { text: '⛔ Từ chối', callback_data: `no:${yeuCauId}` },
    ]] } });
}

/**
 * Nhận dạng người gửi để đưa vào cảnh báo.
 * Ưu tiên @username vì m nhắn thẳng được; không có thì lấy tên hiển thị kèm ID.
 */
function nhanDang(from) {
  if (!from) return 'không rõ';
  const ten = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  if (from.username) return `@${from.username} (${ten || 'không tên'}, ID ${from.id})`;
  return `${ten || 'không tên'} — không đặt username, ID ${from.id}`;
}

const lanThuCuoi = new Map(); // tid -> mốc thời gian, để giãn cách các lần thử bind

/**
 * Bot chỉ còn là kênh cảnh báo và duyệt cho Jason.
 * Nhân viên lấy mã bằng bộ máy trạm PowerShell — mọi lệnh lấy mã ở đây đều
 * bị từ chối, nếu không thì cả lớp gắn máy coi như vô nghĩa.
 */
async function xuLyTinNhan(msg) {
  const chatId = msg.chat.id;
  const tid = String(msg.from.id);
  const text = String(msg.text || '').trim();

  if (msg.chat.type !== 'private') {
    svc.canhBao(null, 'GOI_TRONG_NHOM',
      `Bot bị gọi trong nhóm "${msg.chat.title}" bởi ${nhanDang(msg.from)}.`);
    return;
  }

  if (db.dangBiChan(tid)) return;

  // Jason: đây là kênh của m.
  if (tid === ADMIN_ID) {
    return guiTin(chatId,
      'Kênh này chỉ để nhận cảnh báo và bấm nút duyệt.\n' +
      'Quản trị tủ trên trang web.');
  }

  // Nhân viên gõ lệnh cũ: từ chối và ghi lại.
  if (/^\/(ma|bind|phakinh|toi)\b/i.test(text)) {
    const ai = nhanDang(msg.from);
    db.ghiNhatKy({ hanh_dong: 'LENH_TELEGRAM_CU', ket_qua: 'tu_choi',
      chi_tiet: tid, nguon: 'telegram', ip: ai });
    const soLan = db.demTheoChiTiet('LENH_TELEGRAM_CU', 'tu_choi', tid, Date.now() - LUAT.BIND_CUA_SO);
    if (soLan >= LUAT.BIND_SAI_NGUONG) {
      db.chanTelegram(tid, ai, `gõ lệnh lấy mã qua Telegram ${soLan} lần`, Date.now() + LUAT.CHAN_MS);
      svc.canhBao(null, 'CHAN_ID', `Đã chặn 24 giờ: ${ai}\nLý do: cố lấy mã qua Telegram ${soLan} lần.`);
      return;
    }
    svc.canhBao(null, 'LENH_TELEGRAM_CU',
      `${ai} gõ "${text.split(/\s+/)[0]}" trên Telegram (lần ${soLan}/${LUAT.BIND_SAI_NGUONG}).\n` +
      `Bot đã từ chối. Lấy mã chỉ qua bộ máy trạm.`);
    return guiTin(chatId,
      '⚠️ Telegram không còn cấp mã nữa.\n' +
      'Lấy mã bằng <b>LayMa.bat</b> trên máy trạm.\n\n' +
      'Jason đã được báo về lần thử này.');
  }

  return guiTin(chatId, 'Bot này không cấp mã. Lấy mã trên máy trạm.');
}

async function xuLyNutBam(cq) {
  const tid = String(cq.from.id);
  if (tid !== ADMIN_ID) {
    return goi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Không có quyền duyệt.' });
  }
  const [act, idStr] = String(cq.data || '').split(':');

  // Duyệt / từ chối đăng ký máy mới
  if (act === 'mok' || act === 'mno') {
    const tb = db.getThietBi(idStr);
    const dongY = act === 'mok';
    if (tb) {
      db.quyetThietBi(idStr, dongY ? 'duyet' : 'tu_choi');
      db.ghiNhatKy({ nhan_vien_id: tb.nhan_vien_id, hanh_dong: 'DANG_KY_MAY',
        ket_qua: dongY ? 'ok' : 'tu_choi', chi_tiet: tb.ten_may || idStr,
        nguon: 'telegram', nguoi_duyet: 'Jason' });
    }
    await goi('answerCallbackQuery', { callback_query_id: cq.id,
      text: !tb ? 'Không tìm thấy máy.' : dongY ? 'Đã duyệt máy.' : 'Đã từ chối.' });
    return goi('editMessageReplyMarkup', { chat_id: cq.message.chat.id,
      message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  }

  const kq = await svc.quyet_dinh_duyet(Number(idStr), act === 'ok', 'Jason', 'telegram');

  await goi('answerCallbackQuery', { callback_query_id: cq.id,
    text: kq.trang_thai === 'ok' ? 'Đã duyệt.' : kq.ly_do });
  await goi('editMessageReplyMarkup', { chat_id: cq.message.chat.id,
    message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });

  const yc = kq.yeu_cau;
  if (!yc || !yc.chat_id) return;
  if (kq.trang_thai === 'ok') await guiMaRoiXoa(yc.chat_id, kq.nhan_vien, kq.ma, kq.con_lai);
  else await guiTin(yc.chat_id, `Yêu cầu không được duyệt: ${kq.ly_do}`);
}

async function vongLap() {
  while (dangChay) {
    try {
      const r = await goi('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const u of r.result || []) {
        offset = u.update_id + 1;
        if (u.message) await xuLyTinNhan(u.message).catch(console.error);
        else if (u.callback_query) await xuLyNutBam(u.callback_query).catch(console.error);
      }
    } catch (e) {
      console.error('[bot]', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function khoiDong() {
  if (!TOKEN) {
    console.log('[bot] Chưa có TELEGRAM_BOT_TOKEN — chạy không có bot, dùng trang Kiểm thử để test.');
    return false;
  }
  dangChay = true;
  vongLap();
  console.log('[bot] Đang lắng nghe Telegram.');
  return true;
}

/** Bắn một tin thử về Telegram của Jason, trả về lỗi thật nếu hỏng. */
async function guiTinThu() {
  if (!TOKEN) return { ok: false, loi: 'Chưa đặt TELEGRAM_BOT_TOKEN.' };
  if (!ADMIN_ID) return { ok: false, loi: 'Chưa đặt ADMIN_TELEGRAM_ID — nên mọi cảnh báo đều rơi vào hư không.' };
  const r = await guiTin(ADMIN_ID, '✅ Tin thử từ tủ phát mã. Nhận được tin này nghĩa là cảnh báo sẽ tới đúng chỗ.');
  if (r?.ok) return { ok: true };
  return { ok: false, loi: `Telegram từ chối: ${r?.description || 'không rõ'}. Kiểm tra ADMIN_TELEGRAM_ID, và m phải bấm Start với bot ít nhất một lần.` };
}

/** Sinh mã CCB mới cho một nhân viên. Mã cũ mất hiệu lực ngay. */
function tao_ma_bind(nvId) {
  const { randomToken, dauVan } = require('./crypto');
  const token = randomToken(6);
  // Chỉ lưu dấu vân. Chuỗi gốc hiện đúng một lần cho Jason chép rồi biến mất.
  db.capNhatNhanVien(nvId, { bind_hmac: dauVan(token), bind_token: null });
  return token;
}

module.exports = { khoiDong, baoDongChoJason, tinChoJason, hoiDuyet, hoiDuyetMay, tao_ma_bind, guiTinThu,
  coBot: () => !!TOKEN, coAdminId: () => !!ADMIN_ID,
  // Chỉ dùng cho selftest: chạy thẳng bộ xử lý tin nhắn mà không cần Telegram thật.
  __xuLyTinNhan: xuLyTinNhan };
