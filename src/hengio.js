'use strict';
const db = require('./db');
const { seal, unseal } = require('./crypto');
const svc = require('./service');
const { moc_ca, gioDiaPhuong, gioNgayDiaPhuong } = require('./policy');

/**
 * Hết ca thì gọi một webhook do Jason cấu hình, để hệ thống bên ngoài đá phiên BO.
 *
 * Tủ cố ý KHÔNG tự gọi thẳng BO: nó không giữ phiên của nhân viên, và không nên giữ.
 * Việc chạm vào BO nằm ở phía Jason — có thể là Playwright đăng nhập tài khoản quản trị,
 * hoặc một endpoint quản trị của BO. Tủ chỉ chịu trách nhiệm bắn đúng người, đúng lúc,
 * đúng một lần cho mỗi ca, và ghi lại kết quả.
 */

const MAC_DINH = {
  webhook_bat: '0',
  webhook_url: '',
  webhook_method: 'PUT',
  webhook_headers: '{"Authorization":"{token}"}',
  webhook_body: '',
  webhook_tre_phut: '10',
  bo_token: '',
  bo_token_luc: '',
  bo_tu_dang_nhap: '0',
  bo_login_url: 'https://boapi.bo666st.com/vh7prod-ims/api/v1/login',
  bo_userid: '',
  bo_mat_khau_enc: '',       // hash SHA1 lấy từ DevTools, mã hoá bằng khoá chủ
  bo_dang_nhap_luc: '',
};

// Nơi có thể chứa token trong phản hồi đăng nhập. Mỗi BO một kiểu nên dò cả hai đường.
const TRUONG_TOKEN = ['token', 'accessToken', 'access_token', 'jwt', 'authorization', 'Authorization'];

// Header mà API trả về khi cấp token mới. Bắt được thì token không bao giờ hết hạn
// miễn là tủ còn gọi đều.
const HEADER_TOKEN_MOI = ['x-token-renew', 'x-new-token', 'x-auth-token'];

const doc = (khoa) => db.docCaiDat(khoa, MAC_DINH[khoa]);


function caTuDongLich(r, nowMs) {
  return { start: Number(r.bat_dau_luc), end: Number(r.ket_thuc_luc),
    trong_ca: nowMs >= Number(r.bat_dau_luc) && nowMs < Number(r.ket_thuc_luc),
    off: false, nguon_ca: 'lich_ngay', ngay_ca: r.ngay,
    ca_bat_dau: r.ca_bat_dau, ca_ket_thuc: r.ca_ket_thuc, tz_offset: r.tz_offset };
}
function caChoHenGio(nv, nowMs, treMs) {
  const hien = moc_ca(nv, nowMs);
  if (hien.trong_ca) return hien;
  const gan = db.lichVuaKetThuc(nv.id, nowMs - treMs - 3600000, nowMs);
  if (gan) return caTuDongLich(gan, nowMs);
  return hien;
}
function nvTheoCa(nv, ca) {
  return ca && !ca.off ? { ...nv, ca_bat_dau: ca.ca_bat_dau, ca_ket_thuc: ca.ca_ket_thuc,
    tz_offset: ca.tz_offset ?? nv.tz_offset } : nv;
}

function cau_hinh() {
  const c = {};
  for (const k of Object.keys(MAC_DINH)) c[k] = doc(k);
  return { ...c, webhook_bat: c.webhook_bat === '1', webhook_tre_phut: Number(c.webhook_tre_phut) };
}

function thay_the(mau, nv, token) {
  return String(mau)
    .replace(/\{token\}/g, token ?? doc('bo_token'))
    .replace(/\{bo_account\}/g, nv.bo_account)
    .replace(/\{bo_user_id\}/g, nv.bo_user_id || '')
    .replace(/\{ho_ten\}/g, nv.ho_ten)
    .replace(/\{nhan_vien_id\}/g, nv.id)
    .replace(/\{ca_bat_dau\}/g, nv.ca_bat_dau)
    .replace(/\{ca_ket_thuc\}/g, nv.ca_ket_thuc);
}

/** Moi token ra khỏi phản hồi đăng nhập, dù nó nằm ở header hay trong thân. */
function moiToken(headers, than) {
  for (const h of [...HEADER_TOKEN_MOI, 'authorization']) {
    const v = headers.get(h);
    if (v) return String(v).replace(/^Bearer\s+/i, '');
  }
  const dao = (o, sau = 0) => {
    if (!o || typeof o !== 'object' || sau > 3) return null;
    for (const k of TRUONG_TOKEN) {
      // Tên trường đã rõ ràng thì không cần đoán theo độ dài; chỉ loại chuỗi rỗng.
      if (typeof o[k] === 'string' && o[k].trim().length >= 8) return o[k].trim().replace(/^Bearer\s+/i, '');
    }
    for (const v of Object.values(o)) {
      const t = dao(v, sau + 1);
      if (t) return t;
    }
    return null;
  };
  try { return dao(JSON.parse(than)); } catch (e) { return null; }
}

/**
 * Tự đăng nhập BO để lấy token mới.
 * Tủ chỉ giữ chuỗi hash SHA1 mà trình duyệt gửi đi, không giữ mật khẩu gốc —
 * nên lộ tủ cũng không đăng nhập được vào chỗ khác bằng mật khẩu đó.
 */
async function dang_nhap_bo() {
  const c = cau_hinh();
  if (!c.bo_userid || !c.bo_mat_khau_enc) return { ok: false, chi_tiet: 'chưa cấu hình tài khoản BO' };

  let matKhau;
  try { matKhau = unseal(c.bo_mat_khau_enc); }
  catch (e) { return { ok: false, chi_tiet: 'không giải mã được mật khẩu đã lưu' }; }

  try {
    const r = await fetch(c.bo_login_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Origin: 'https://bo.bo666st.com',
        Referer: 'https://bo.bo666st.com/',
        'X-Currency': 'VND2',
      },
      body: JSON.stringify({ userid: c.bo_userid, password: matKhau }),
      signal: AbortSignal.timeout(20000),
    });
    const than = await r.text().catch(() => '');
    if (!r.ok) return { ok: false, chi_tiet: `đăng nhập BO trả HTTP ${r.status} · ${than.slice(0, 200)}` };

    const token = moiToken(r.headers, than);
    if (!token) return { ok: false, chi_tiet: 'đăng nhập được nhưng không tìm thấy token trong phản hồi' };

    db.datCaiDat('bo_token', token);
    db.datCaiDat('bo_token_luc', String(Date.now()));
    db.datCaiDat('bo_dang_nhap_luc', String(Date.now()));
    db.ghiNhatKy({ hanh_dong: 'DANG_NHAP_BO', ket_qua: 'ok', chi_tiet: c.bo_userid, nguon: 'he-thong' });
    return { ok: true, chi_tiet: 'đã lấy token mới' };
  } catch (e) {
    return { ok: false, chi_tiet: e.name === 'TimeoutError' ? 'quá 20 giây không phản hồi' : e.message };
  }
}

// Vài nguồn để hỏi IP outbound của máy chủ — dò lần lượt, cái nào sống thì dùng.
// Có vài cái vì Render/nhà cung cấp có thể chặn hoặc đổi một nguồn bất kỳ lúc nào.
const NGUON_IP = [
  { url: 'https://api.ipify.org?format=json', doc: (j) => j.ip },
  { url: 'https://ifconfig.me/ip', doc: (t) => t.trim() },
  { url: 'https://icanhazip.com', doc: (t) => t.trim() },
];

/**
 * Hỏi vài dịch vụ bên ngoài xem máy chủ đang gọi đi bằng IP nào.
 * Dùng để gửi cho IT mở ngoại lệ trên Cloudflare/BO — vì BO và Cloudflare thấy
 * đúng cái IP mà máy chủ gọi ra, chứ không phải IP máy của admin đang ngồi xem.
 */
async function lay_ip_may_chu() {
  const loi = [];
  for (const nguon of NGUON_IP) {
    try {
      const r = await fetch(nguon.url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) { loi.push(`${nguon.url} · HTTP ${r.status}`); continue; }
      const than = await r.text();
      let gt;
      try { gt = nguon.doc(JSON.parse(than)); } catch (e) { gt = nguon.doc(than); }
      if (gt && /^[0-9a-fA-F.:]+$/.test(gt)) return { ok: true, ip: gt, nguon: nguon.url };
      loi.push(`${nguon.url} · phản hồi lạ: ${than.slice(0, 100)}`);
    } catch (e) {
      loi.push(`${nguon.url} · ${e.name === 'TimeoutError' ? 'quá 8 giây' : e.message}`);
    }
  }
  return { ok: false, chi_tiet: 'không hỏi được nguồn nào: ' + loi.join(' | ') };
}

/** Bắn webhook cho một người. Trả về {ok, chi_tiet}. */
async function ban(nv, cauHinh, daThuLai = false) {
  const c = cauHinh || cau_hinh();
  if (!c.webhook_url) return { ok: false, chi_tiet: 'chưa cấu hình địa chỉ' };

  const token = c.bo_token || '';
  let headers = {};
  try { headers = JSON.parse(thay_the(c.webhook_headers || '{}', nv, token)); }
  catch (e) { return { ok: false, chi_tiet: 'Header không phải JSON hợp lệ' }; }

  const method = (c.webhook_method || 'PUT').toUpperCase();
  const than = thay_the(c.webhook_body || '', nv, token).trim();
  const opt = { method, headers, signal: AbortSignal.timeout(15000) };

  // Với PUT/POST/PATCH thì luôn gửi body, kể cả rỗng — như vậy mới có
  // Content-Length: 0. Một số API ném lỗi khi thiếu header đó.
  if (method !== 'GET' && method !== 'HEAD') {
    opt.body = than;
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
    }
  }

  try {
    const r = await fetch(thay_the(c.webhook_url, nv, token), opt);

    // API cấp token mới thì lưu lại ngay, nếu không token sẽ hết hạn và lệnh đá
    // phiên im lặng chết sau vài giờ.
    for (const h of HEADER_TOKEN_MOI) {
      const moi = r.headers.get(h);
      if (moi && moi !== token) {
        db.datCaiDat('bo_token', moi);
        db.datCaiDat('bo_token_luc', String(Date.now()));
        break;
      }
    }

    const doc = (await r.text().catch(() => '')).slice(0, 300);

    if (r.status === 401 || r.status === 403) {
      // Token chết thì tự đăng nhập lấy token mới rồi thử lại đúng một lần.
      if (!daThuLai && c.bo_tu_dang_nhap === '1') {
        const dn = await dang_nhap_bo();
        if (dn.ok) return ban(nv, cau_hinh(), true);
        return { ok: false, het_han: true,
          chi_tiet: `HTTP ${r.status} và tự đăng nhập lại cũng hỏng: ${dn.chi_tiet}` };
      }
      return { ok: false, het_han: true,
        chi_tiet: `HTTP ${r.status} — token BO đã hết hạn hoặc không đủ quyền` };
    }

    // BO trả "user not online" khi không có phiên nào để đá. Đây không phải lỗi —
    // người đó đã tự đăng xuất rồi. Coi là hỏng thì mỗi tối Jason nhận cả chục
    // cảnh báo giả và sẽ bỏ đọc luôn những cái thật.
    if (/not\s*(existed|exist|online|found)|no\s*session|khong\s*ton\s*tai/i.test(doc)) {
      return { ok: true, khong_online: true,
        chi_tiet: `Không có phiên nào đang mở (HTTP ${r.status})` };
    }

    return { ok: r.ok, chi_tiet: `HTTP ${r.status}${doc ? ' · ' + doc : ''}` };
  } catch (e) {
    return { ok: false, chi_tiet: e.name === 'TimeoutError' ? 'quá 15 giây không phản hồi' : e.message };
  }
}

/** Gỡ gắn máy và ghi nhật ký cho một lần đá phiên. */
async function da_mot_nguoi(nv, cauHinh, nguon = 'hen-gio') {
  const kq = await ban(nv, cauHinh);
  db.xoaMoiMayCua(nv.id);
  db.capNhatNhanVien(nv.id, { bind_ca_start: null, bind_may_id: null });
  db.ghiNhatKy({ nhan_vien_id: nv.id, bo_account: nv.bo_account, hanh_dong: 'DA_PHIEN_BO',
    ket_qua: kq.khong_online ? 'khong_online' : kq.ok ? 'ok' : 'hong',
    chi_tiet: kq.chi_tiet, nguon });
  if (!kq.ok) {
    svc.canhBao(nv, kq.het_han ? 'TOKEN_BO_HET_HAN' : 'DA_PHIEN_HONG',
      `Không đá được phiên BO của ${nv.ho_ten} (${nv.bo_account}) sau khi hết ca.\n` +
      `Lý do: ${kq.chi_tiet}\n` +
      (kq.het_han
        ? 'Vào tủ, tab Cài đặt, dán token BO mới. Mọi lệnh đá phiên đang hỏng cho tới lúc đó.'
        : 'Phiên BO của người này có thể vẫn đang mở.'));
  }
  return kq;
}

/**
 * Vòng chạy mỗi phút. Tìm ai vừa hết ca đủ lâu và chưa bị đá cho ca đó.
 * Dùng mốc bắt đầu ca làm khoá chống trùng, nên khởi động lại server không bắn lại.
 */
async function quet() {
  quetLanCuoi = Date.now();
  const c = cau_hinh();
  if (!c.webhook_bat || !c.webhook_url) return;

  const now = Date.now();
  const tre = Math.max(0, c.webhook_tre_phut) * 60000;

  const daLam = [];
  for (const nvPublic of db.listNhanVien()) {
    if (nvPublic.trang_thai !== 'hoat_dong') continue;
    const nv = db.getNhanVienFull(nvPublic.id);
    const ca = caChoHenGio(nv, now, tre);

    if (ca.off) continue;
    // Chỉ xét ca vừa kết thúc, trong cửa sổ một tiếng để khỏi đá nhầm ca cũ.
    if (ca.trong_ca) continue;
    if (now < ca.end + tre) continue;
    if (now > ca.end + tre + 3600000) continue;
    if (nv.da_da_ca === ca.start) continue;

    db.capNhatNhanVien(nv.id, { da_da_ca: ca.start });
    const nvCa = nvTheoCa(nv, ca);
    const kq = await da_mot_nguoi(nvCa, c, 'hen-gio');
    daLam.push({ nv: nvCa, kq });
    console.log(`[hẹn giờ] đá phiên ${nv.bo_account} (hết ca ${ca.ca_ket_thuc}, giờ họ ${gioDiaPhuong(nvCa, now)}) — ${kq.chi_tiet}`);
  }

  // Một tin gộp cho cả đợt, không phải mỗi người một tin.
  if (daLam.length) {
    const dong = daLam.map(({ nv, kq }) => {
      const dau = kq.khong_online ? '·' : kq.ok ? '✅' : '❌';
      return `${dau} ${nv.bo_account} (${nv.ho_ten}) — ${kq.khong_online ? 'không có phiên nào mở' : kq.chi_tiet}`;
    });
    const hong = daLam.filter((x) => !x.kq.ok).length;
    Promise.resolve(baoThuong(
      `🔒 <b>ĐÃ ĐÁ PHIÊN BO</b> — hết ca ${c.webhook_tre_phut} phút\n` +
      dong.join('\n') + (hong ? `\n\n⚠️ ${hong} trường hợp hỏng, xem tab Nhật ký.` : '')
    )).catch(() => {});
  }
}

/** Vì sao một người chưa bị đá — để nhìn ra ngay thay vì đoán. */
function chan_doan() {
  const c = cau_hinh();
  const now = Date.now();
  const tre = Math.max(0, c.webhook_tre_phut) * 60000;

  const ds = db.listNhanVien().map((nvPublic) => {
    const nv = db.getNhanVienFull(nvPublic.id);
    const ca = caChoHenGio(nv, now, tre);
    const mocDa = ca.off ? null : ca.end + tre;
    let trang_thai, ghi_chu;

    // Mọi mốc thời gian hiện theo giờ NƠI NGƯỜI ĐÓ LÀM, không phải giờ máy chủ
    // cũng không phải giờ trình duyệt của Jason. In ISO/UTC ra đây là gây hiểu nhầm.
    const nvCa = nvTheoCa(nv, ca);
    const daLucHo = ca.off ? '—' : gioNgayDiaPhuong(nvCa, mocDa);
    if (nv.trang_thai !== 'hoat_dong') { trang_thai = 'bo_qua'; ghi_chu = 'tài khoản đang khoá'; }
    else if (ca.off) { trang_thai = 'off'; ghi_chu = 'OFF theo lịch tháng'; }
    else if (ca.trong_ca) { trang_thai = 'trong_ca'; ghi_chu = `còn ${Math.ceil((mocDa - now) / 60000)} phút nữa`; }
    else if (nv.da_da_ca === ca.start) { trang_thai = 'da_da'; ghi_chu = 'ca này đã đá rồi'; }
    else if (now < mocDa) { trang_thai = 'cho'; ghi_chu = `còn ${Math.ceil((mocDa - now) / 60000)} phút`; }
    else if (now > mocDa + 3600000) { trang_thai = 'qua_han'; ghi_chu = 'hết ca quá 1 tiếng, tủ bỏ qua'; }
    else { trang_thai = 'sap_da'; ghi_chu = 'vòng quét tới sẽ đá'; }

    return { id: nv.id, ho_ten: nv.ho_ten, bo_account: nv.bo_account,
      ca: ca.off ? 'OFF' : `${ca.ca_bat_dau}-${ca.ca_ket_thuc}`, gio_dia_phuong: gioDiaPhuong(nvCa, now),
      khu_vuc: (ca.tz_offset ?? nv.tz_offset) === 240 ? 'ARM' : 'VN', nguon_ca: ca.nguon_ca, ngay_ca: ca.ngay_ca,
      het_ca_luc: ca.off ? null : ca.end, da_luc: mocDa,
      da_luc_ho: daLucHo, het_ca_ho: ca.off ? '—' : gioNgayDiaPhuong(nvCa, ca.end),
      trang_thai, ghi_chu };
  });

  return {
    bat: c.webhook_bat, co_dia_chi: !!c.webhook_url, co_token: !!c.bo_token,
    tre_phut: c.webhook_tre_phut, quet_lan_cuoi: quetLanCuoi, dang_chay: !!dongHo,
    danh_sach: ds,
  };
}

/** Đá ngay mọi người đã hết ca mà chưa được đá. Dùng khi vừa bật hoặc vừa sửa cấu hình. */
async function da_nhung_nguoi_het_ca() {
  const c = cau_hinh();
  const now = Date.now();
  const tre = Math.max(0, c.webhook_tre_phut) * 60000;
  const kq = [];
  for (const nvPublic of db.listNhanVien()) {
    if (nvPublic.trang_thai !== 'hoat_dong') continue;
    const nv = db.getNhanVienFull(nvPublic.id);
    const ca = caChoHenGio(nv, now, tre);
    if (ca.off || ca.trong_ca || now < ca.end + tre) continue;
    db.capNhatNhanVien(nv.id, { da_da_ca: ca.start });
    const r = await da_mot_nguoi(nvTheoCa(nv, ca), c, 'admin');
    kq.push({ bo_account: nv.bo_account, ...r });
  }
  return kq;
}

// Server gắn hàm bắn tin thường (không phải cảnh báo) cho Jason.
let baoThuong = async () => {};
function gan_kenh_bao(fn) { if (fn) baoThuong = fn; }

let quetLanCuoi = null;
let dongHo = null;
function khoi_dong() {
  if (dongHo) return;
  dongHo = setInterval(() => quet().catch((e) => console.error('[hẹn giờ]', e.message)), 60000);
  if (dongHo.unref) dongHo.unref();
  console.log('[hẹn giờ] Đang theo dõi giờ xuống ca.');
}

module.exports = { khoi_dong, quet, ban, da_mot_nguoi, cau_hinh, chan_doan, da_nhung_nguoi_het_ca,
  dang_nhap_bo, lay_ip_may_chu, gan_kenh_bao, MAC_DINH };
