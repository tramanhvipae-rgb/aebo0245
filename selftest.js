'use strict';
/**
 * Chạy: npm test
 * Ba câu hỏi cần trả lời được bằng máy, không bằng niềm tin:
 *   1. Mã tủ sinh ra có giống Google Authenticator không?
 *   2. Có API nào rò hạt giống ra ngoài không?
 *   3. Mã cá nhân có bị lưu trần không?
 */
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'tu-selftest-' + Date.now());
process.env.MASTER_KEY = 'khoa-chu-chi-dung-de-chay-thu-nghiem-1234567890';
process.env.ADMIN_PASSWORD = 'matkhau-thu';
process.env.PORT = '39117';

const assert = require('assert');
const { authenticator } = require('otplib');

let pass = 0, fail = 0;
function ok(ten, fn) {
  try { fn(); console.log('  ✓ ' + ten); pass++; }
  catch (e) { console.log('  ✗ ' + ten + '\n      ' + e.message); fail++; }
}
async function okAsync(ten, fn) {
  try { await fn(); console.log('  ✓ ' + ten); pass++; }
  catch (e) { console.log('  ✗ ' + ten + '\n      ' + e.message); fail++; }
}

(async () => {
  const crypto = require('./src/crypto');
  const db = require('./src/db');
  const totp = require('./src/totp');
  const policy = require('./src/policy');
  crypto.initMasterKey(process.env.MASTER_KEY);

  const HAT_GIONG = 'JBSWY3DPEHPK3PXP';
  const CCB1 = 'ccb-cua-nguoi-mot';

  console.log('\n1. Sinh mã');
  ok('mã tủ sinh giống otplib/Google Authenticator', () => {
    const enc = crypto.seal(HAT_GIONG);
    assert.strictEqual(authenticator.generate(crypto.unseal(enc)), authenticator.generate(HAT_GIONG));
  });
  ok('nhận được cả link otpauth:// lẫn chuỗi trần', () => {
    assert.strictEqual(totp.tachHatGiong(`otpauth://totp/BO:nv01?secret=${HAT_GIONG}&issuer=BO`), HAT_GIONG);
    assert.strictEqual(totp.tachHatGiong(' jbswy3dp ehpk3pxp '), HAT_GIONG);
  });
  ok('chuỗi hỏng bị chặn ngay lúc nạp', () => {
    assert.throws(() => totp.tachHatGiong('KHONG-PHAI-BASE32-01889'));
    assert.throws(() => totp.tachHatGiong('JBSW'));
  });

  console.log('\n2. Mã hoá');
  ok('hạt giống không nằm trong bản mã hoá', () => {
    const enc = crypto.seal(HAT_GIONG);
    assert.ok(!enc.includes(HAT_GIONG));
    assert.ok(!Buffer.from(enc, 'base64').toString('latin1').includes(HAT_GIONG));
  });
  ok('sai khoá chủ thì không giải được', () => {
    const enc = crypto.seal(HAT_GIONG);
    crypto.initMasterKey('mot-khoa-chu-hoan-toan-khac-1234567890abc');
    assert.throws(() => crypto.unseal(enc));
    crypto.initMasterKey(process.env.MASTER_KEY);
  });
  ok('sửa một byte trong bản mã là hỏng xác thực (AES-GCM)', () => {
    const b = Buffer.from(crypto.seal(HAT_GIONG), 'base64');
    b[b.length - 1] ^= 0xff;
    assert.throws(() => crypto.unseal(b.toString('base64')));
  });
  ok('mã CCB lưu dạng dấu vân HMAC, không lưu trần', () => {
    const v = crypto.dauVan('ccb-bi-mat');
    assert.ok(!v.includes('ccb-bi-mat'));
    assert.strictEqual(v, crypto.dauVan('ccb-bi-mat'), 'cùng chuỗi phải ra cùng dấu vân');
    assert.notStrictEqual(v, crypto.dauVan('ccb-bi-met'));
  });

  console.log('\n3. Ca trực');
  const caNgay = { ca_bat_dau: '09:00', ca_ket_thuc: '21:00', tz_offset: 420 };
  const caDem = { ca_bat_dau: '22:00', ca_ket_thuc: '06:00', tz_offset: 420 };
  const luc = (hUTC7) => Date.UTC(2026, 0, 15, hUTC7 - 7, 30);
  ok('ca ngày 09–21 nhận đúng trong/ngoài ca', () => {
    assert.ok(policy.moc_ca(caNgay, luc(14)).trong_ca);
    assert.ok(!policy.moc_ca(caNgay, luc(3)).trong_ca);
    assert.ok(!policy.moc_ca(caNgay, luc(22)).trong_ca);
  });
  ok('ca đêm 22–06 qua nửa đêm vẫn đúng', () => {
    assert.ok(policy.moc_ca(caDem, luc(23)).trong_ca);
    assert.ok(policy.moc_ca(caDem, luc(2)).trong_ca);
    assert.ok(!policy.moc_ca(caDem, luc(14)).trong_ca);
  });
  ok('mốc bắt đầu ca đêm lùi về hôm trước khi đang là 2h sáng', () => {
    const m = policy.moc_ca(caDem, luc(2));
    assert.ok(m.start < luc(2) && m.end > luc(2));
    assert.ok((m.end - m.start) === 8 * 3600000);
  });

  console.log('\n4. Không có đường rò hạt giống ra HTTP');
  require('./server');
  await new Promise((r) => setTimeout(r, 700));

  const B = 'http://127.0.0.1:' + process.env.PORT;
  let cookie = '';
  const goi = async (p, opt = {}) => {
    const r = await fetch(B + p, {
      headers: { 'Content-Type': 'application/json', cookie },
      ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, text: await r.text() };
  };

  await goi('/api/dang-nhap', { method: 'POST', body: { mat_khau: 'matkhau-thu' } });
  await goi('/api/nhan-vien', { method: 'POST', body: {
    ho_ten: 'Nguyễn Test', bo_account: 'st666_test01', brand: 'ST666', vai_tro: 'CS',
    muc: 'thuong', ca_bat_dau: '00:00', ca_ket_thuc: '23:59', tz_offset: 420, han_muc_ca: 20 } });
  const nv = db.getByBoAccount('st666_test01');
  await goi(`/api/nhan-vien/${nv.id}/hat-giong`, { method: 'POST', body: { hat_giong: HAT_GIONG } });
  db.capNhatNhanVien(nv.id, { bind_hmac: crypto.dauVan(CCB1), bind_token: null });

  const duong = ['/api/nhan-vien', '/api/nhat-ky?limit=500', '/api/canh-bao', '/api/duyet', '/api/trang-thai'];
  for (const p of duong) {
    const r = await goi(p);
    await okAsync(`${p} không chứa hạt giống`, () => {
      assert.ok(!r.text.includes(HAT_GIONG), 'lộ hạt giống trần');
      assert.ok(!/seed_enc/.test(r.text), 'lộ cả bản mã hoá của hạt giống');
      assert.ok(!/bind_hmac|bind_token|telegram_id/.test(r.text), 'lộ mã CCB hoặc định danh máy');
    });
  }

  console.log('\n5. Luồng xin mã');
  await okAsync('sai mã CCB bị từ chối', async () => {
    const r = await goi('/api/kiem-thu/xin-ma', { method: 'POST', body: { bo_account: 'st666_test01', ccb: 'sai-be-bet' } });
    assert.match(r.text, /Mã CCB không đúng/);
  });
  await okAsync('đúng mã CCB trong ca thì phát mã, và mã khớp Authenticator', async () => {
    const r = await goi('/api/kiem-thu/xin-ma', { method: 'POST', body: { bo_account: 'st666_test01', ccb: CCB1 } });
    const d = JSON.parse(r.text);
    assert.strictEqual(d.trang_thai, 'ok');
    assert.match(d.ma, /^\d{6}$/);
    assert.strictEqual(d.ma, authenticator.generate(HAT_GIONG));
    assert.ok(d.con_lai >= totp.NGUONG_DOI_CHU_KY, 'phải luôn còn ít nhất 8 giây khi trả mã');
  });
  await okAsync('sai mã CCB 3 lần thì khoá tạm', async () => {
    for (let i = 0; i < 3; i++) await goi('/api/kiem-thu/xin-ma', { method: 'POST', body: { bo_account: 'st666_test01', ccb: 'sai-be-bet' } });
    const r = await goi('/api/kiem-thu/xin-ma', { method: 'POST', body: { bo_account: 'st666_test01', ccb: CCB1 } });
    assert.match(r.text, /khoá tạm|Đang khoá/i);
    assert.ok(db.docCanhBao(10).some((c) => c.loai === 'SAI_CCB'));
  });
  await okAsync('mã phá kính dùng được đúng một lần', async () => {
    db.capNhatNhanVien(nv.id, { khoa_tam_den: null, sai_pin_lien_tiep: 0 });
    const ds = require('./src/service').tao_ma_pha_kinh(nv.id, 3);
    const r1 = JSON.parse((await goi('/api/kiem-thu/pha-kinh', { method: 'POST', body: { bo_account: 'st666_test01', ma: ds[0] } })).text);
    assert.strictEqual(r1.trang_thai, 'ok');
    const r2 = JSON.parse((await goi('/api/kiem-thu/pha-kinh', { method: 'POST', body: { bo_account: 'st666_test01', ma: ds[0] } })).text);
    assert.strictEqual(r2.trang_thai, 'tu_choi');
  });
  await okAsync('ngoài ca thì chuyển sang chờ Jason duyệt', async () => {
    db.capNhatNhanVien(nv.id, { ca_bat_dau: '03:00', ca_ket_thuc: '03:01', tz_offset: 420 });
    const r = JSON.parse((await goi('/api/kiem-thu/xin-ma', { method: 'POST', body: { bo_account: 'st666_test01', ccb: CCB1 } })).text);
    assert.strictEqual(r.trang_thai, 'can_duyet');
    const kq = JSON.parse((await goi('/api/duyet/' + r.yeu_cau_id, { method: 'POST', body: { dong_y: true } })).text);
    assert.strictEqual(kq.trang_thai, 'ok');
    assert.strictEqual(kq.ma, authenticator.generate(HAT_GIONG));
  });
  await okAsync('yêu cầu đã duyệt không duyệt lại được', async () => {
    const r = JSON.parse((await goi('/api/kiem-thu/xin-ma', { method: 'POST', body: { bo_account: 'st666_test01', ccb: CCB1 } })).text);
    await goi('/api/duyet/' + r.yeu_cau_id, { method: 'POST', body: { dong_y: true } });
    const lai = JSON.parse((await goi('/api/duyet/' + r.yeu_cau_id, { method: 'POST', body: { dong_y: true } })).text);
    assert.strictEqual(lai.trang_thai, 'tu_choi');
  });
  await okAsync('chưa đăng nhập thì mọi API quản trị đều đóng', async () => {
    const luu = cookie; cookie = '';
    for (const p of duong.filter((x) => x !== '/api/trang-thai')) {
      assert.strictEqual((await goi(p)).status, 401, p + ' không chặn');
    }
    cookie = luu;
  });

  console.log('\n6. Bot Telegram — chỉ còn là kênh của Jason');
  process.env.TELEGRAM_BOT_TOKEN = 'test:token';
  process.env.ADMIN_TELEGRAM_ID = '900001';
  delete require.cache[require.resolve('./src/bot')];
  const bot = require('./src/bot');

  const daGui = [];
  const fetchThat = global.fetch;
  global.fetch = async (url, opt) => {
    daGui.push({ method: String(url).split('/').pop(), ...JSON.parse(opt.body) });
    return { json: async () => ({ ok: true, result: { message_id: daGui.length } }) };
  };
  const chay = async (tid, text) => {
    daGui.length = 0;
    await bot.__xuLyTinNhan({ message_id: 1, text,
      chat: { id: tid, type: 'private' },
      from: { id: tid, username: 'nv' + tid, first_name: 'NV' } });
    return daGui.map((d) => d.text || '').join(' | ');
  };

  await okAsync('/ma trên Telegram bị từ chối', async () => {
    const r = await chay('700001', '/ma 4821');
    assert.match(r, /không còn cấp mã|máy trạm/i);
    assert.ok(!/\d{6}/.test(r), 'KHÔNG được trả mã 6 số qua Telegram');
  });
  await okAsync('/bind trên Telegram bị từ chối', async () => {
    assert.match(await chay('700002', '/bind gi-do'), /không còn cấp mã|máy trạm/i);
  });
  await okAsync('gõ lệnh cũ 5 lần thì bị chặn', async () => {
    for (let i = 0; i < 5; i++) await chay('700003', '/ma 1111');
    assert.ok(db.dangBiChan('700003'), 'chưa chặn');
    assert.strictEqual(await chay('700003', '/ma 1111'), '', 'bị chặn rồi mà vẫn trả lời');
  });
  await okAsync('bot im khi bị gọi trong nhóm', async () => {
    daGui.length = 0;
    await bot.__xuLyTinNhan({ message_id: 1, text: '/ma 4821',
      chat: { id: '-100', type: 'group', title: 'Nhóm CS' }, from: { id: '700004', first_name: 'X' } });
    assert.ok(db.docCanhBao(30).some((c) => c.loai === 'GOI_TRONG_NHOM'));
  });
  global.fetch = fetchThat;

  console.log('\n7. Luồng máy trạm');
  const may = require('./src/may');
  const { cua_so_gan } = require('./src/policy');
  const VT1 = 'vantay-may-1', VT2 = 'vantay-may-2';

  // Các phép kiểm dưới đây xét những luật KHÁC cửa sổ gắn máy, nên nới cửa sổ ra
  // cả ngày. Bản thân cửa sổ được kiểm riêng ở mục 8.
  db.datCaiDat('gan_han_chot_phut', '1440');

  db.capNhatNhanVien(nv.id, { ca_bat_dau: '00:00', ca_ket_thuc: '23:59',
    khoa_tam_den: null, sai_pin_lien_tiep: 0, bind_ca_start: null, han_muc_ca: 20 });

  await okAsync('máy chưa đăng ký thì không xin được mã', async () => {
    const r = await may.xin_ma({ may_id: 'm1', van_tay: VT1, ccb: CCB1 });
    assert.strictEqual(r.trang_thai, 'tu_choi');
    assert.match(r.ly_do, /chưa đăng ký/i);
  });
  await okAsync('đăng ký máy phải chờ duyệt', () => {
    const r = may.dang_ky({ may_id: 'm1', van_tay: VT1, ten_may: 'PC-01', ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'cho_duyet');
    assert.strictEqual(db.getThietBi('m1').trang_thai, 'cho');
  });
  await okAsync('chưa duyệt thì chưa gắn ca được', () => {
    const r = may.gan_ca({ may_id: 'm1', van_tay: VT1, ma_bind: CCB1 });
    assert.match(r.ly_do, /chờ Jason duyệt/i);
  });
  await okAsync('duyệt xong thì gắn ca được', () => {
    db.quyetThietBi('m1', 'duyet');
    const r = may.gan_ca({ may_id: 'm1', van_tay: VT1, ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'ok');
    assert.strictEqual(r.bo_account, nv.bo_account);
  });
  await okAsync('xin mã trả đúng mã Authenticator', async () => {
    const r = await may.xin_ma({ may_id: 'm1', van_tay: VT1, ccb: CCB1 });
    assert.strictEqual(r.trang_thai, 'ok');
    assert.strictEqual(r.ma, authenticator.generate(HAT_GIONG));
  });
  await okAsync('chép device.json sang máy khác -> dấu vân lệch', async () => {
    const r = await may.xin_ma({ may_id: 'm1', van_tay: 'vantay-gia', ccb: CCB1 });
    assert.strictEqual(r.trang_thai, 'tu_choi');
    assert.ok(db.docCanhBao(30).some((c) => c.loai === 'VAN_TAY_LECH'));
  });
  await okAsync('MÁY LẠ dùng cùng mã CCB -> báo gian lận ngay ở bước ĐĂNG KÝ', () => {
    const r = may.dang_ky({ may_id: 'm2', van_tay: VT2, ten_may: 'PC-02',
      ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'gian_lan');
    assert.strictEqual(r.ly_do, 'CẢNH BÁO ĐĂNG NHẬP GIAN LẬN ĐƯỢC GỬI VỀ QUẢN TRỊ');
    assert.strictEqual(db.getThietBi('m2'), undefined, 'máy lạ KHÔNG được lọt vào bảng chờ duyệt');
    assert.ok(db.docCanhBao(30).some((c) => c.loai === 'GIAN_LAN'));
  });
  await okAsync('máy hợp lệ vẫn chạy bình thường sau vụ đó', async () => {
    const r = await may.xin_ma({ may_id: 'm1', van_tay: VT1, ccb: CCB1 });
    assert.strictEqual(r.trang_thai, 'ok');
  });
  await okAsync('máy lạ đã duyệt sẵn cũng bị chặn ở bước gắn ca', () => {
    db.themThietBi('m3', 'vt3', 'PC-03', nv.id);
    db.quyetThietBi('m3', 'duyet');
    const r = may.gan_ca({ may_id: 'm3', van_tay: 'vt3', ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'gian_lan');
  });
  await okAsync('mã CCB dùng ở máy CHƯA ĐĂNG KÝ vẫn báo gian lận', () => {
    // Máy còn device.json cũ nhưng đã bị xoá khỏi tủ: nếu kiểm đăng ký trước thì
    // vụ này bị chặn im lặng và không ai biết mã CCB đã đi đâu.
    const truoc = db.docCanhBao(50).filter((c) => c.loai === 'GIAN_LAN').length;
    const r = may.gan_ca({ may_id: 'm-chua-dang-ky', van_tay: 'vt-la',
      ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'gian_lan');
    assert.strictEqual(db.docCanhBao(50).filter((c) => c.loai === 'GIAN_LAN').length, truoc + 1,
      'không sinh cảnh báo gian lận');
  });
  await okAsync('xin mã từ máy chưa đăng ký cũng sinh cảnh báo', async () => {
    const truoc = db.docCanhBao(50).filter((c) => c.loai === 'XIN_MA_MAY_LA').length;
    const r = await may.xin_ma({ may_id: 'm-chua-dang-ky', van_tay: 'vt-la', ccb: CCB1 });
    assert.strictEqual(r.trang_thai, 'tu_choi');
    assert.ok(db.docCanhBao(50).filter((c) => c.loai === 'XIN_MA_MAY_LA').length > truoc);
  });
  await okAsync('một máy chỉ phục vụ một tài khoản BO tại một thời điểm', async () => {
    const nv2 = db.getNhanVienFull(db.themNhanVien({
      ho_ten: 'Người thứ hai', bo_account: 'st666_test02', brand: 'ST666', vai_tro: 'CS',
      muc: 'thuong', ca_bat_dau: '00:00', ca_ket_thuc: '23:59', tz_offset: 420, han_muc_ca: 20 }));
    db.capNhatNhanVien(nv2.id, { seed_enc: crypto.seal(HAT_GIONG),
      bind_hmac: crypto.dauVan('tk-nguoi-hai') });

    const g = may.gan_ca({ may_id: 'm1', van_tay: VT1, ma_bind: 'tk-nguoi-hai' });
    assert.strictEqual(g.trang_thai, 'ok');
    assert.deepStrictEqual(g.nhuong, [nv.bo_account], 'chưa gỡ tài khoản của người ngồi trước');

    const tren = db.dsTheoTelegram('may:m1');
    assert.strictEqual(tren.length, 1, 'máy vẫn giữ nhiều tài khoản cùng lúc');

    // Không phải chọn tài khoản nữa
    const r = await may.xin_ma({ may_id: 'm1', van_tay: VT1, ccb: 'tk-nguoi-hai' });
    assert.strictEqual(r.trang_thai, 'ok');
    assert.strictEqual(r.bo_account, 'st666_test02');
  });
  await okAsync('bị nhường máy KHÔNG mở đường sang máy khác trong cùng ca', () => {
    // Lỗ từng có: chốt gian lận dựa vào số máy đang giữ, mà nhường máy đưa số đó về 0.
    // Hai người dùng chung một mã CCB chỉ cần nhờ ai đó ngồi vào máy thứ nhất.
    db.themThietBi('mA', 'vtA', 'PC-A', nv.id); db.quyetThietBi('mA', 'duyet');
    db.themThietBi('mB', 'vtB', 'PC-B', nv.id); db.quyetThietBi('mB', 'duyet');
    db.capNhatNhanVien(nv.id, { bind_ca_start: null, bind_may_id: null });

    const tk = CCB1;
    assert.strictEqual(may.gan_ca({ may_id: 'mA', van_tay: 'vtA', ma_bind: tk }).trang_thai, 'ok');

    // người khác ngồi vào mA -> tài khoản này bị gỡ khỏi mA
    const nv2 = db.getByBoAccount('st666_test02');
    db.capNhatNhanVien(nv2.id, { bind_ca_start: null, bind_may_id: null });
    const g2 = may.gan_ca({ may_id: 'mA', van_tay: 'vtA', ma_bind: 'tk-nguoi-hai' });
    assert.strictEqual(g2.trang_thai, 'ok', 'người thứ hai chưa ngồi vào được: ' + (g2.ly_do || ''));
    assert.strictEqual(db.dsMayCua(nv.id).length, 0, 'chưa bị nhường');

    // vẫn không được nhảy sang máy khác
    assert.strictEqual(may.gan_ca({ may_id: 'mB', van_tay: 'vtB', ma_bind: tk }).trang_thai, 'gian_lan');
    // nhưng quay lại đúng máy cũ thì hợp lệ
    assert.strictEqual(may.gan_ca({ may_id: 'mA', van_tay: 'vtA', ma_bind: tk }).trang_thai, 'ok');
  });
  await okAsync('nhận máy do người khác nhường KHÔNG cho đi máy thứ hai', () => {
    // MAYA gắn m1 -> DOPE gắn m1 (nhường) -> DOPE đem mã sang m2 phải bị chặn.
    db.themThietBi('mX', 'vtX', 'PC-X', nv.id); db.quyetThietBi('mX', 'duyet');
    db.themThietBi('mY', 'vtY', 'PC-Y', nv.id); db.quyetThietBi('mY', 'duyet');
    const nv2 = db.getByBoAccount('st666_test02');
    for (const x of [nv.id, nv2.id]) db.capNhatNhanVien(x, { bind_ca_start: null, bind_may_id: null });

    const tk1 = CCB1;
    assert.strictEqual(may.gan_ca({ may_id: 'mX', van_tay: 'vtX', ma_bind: tk1 }).trang_thai, 'ok');
    // người thứ hai nhận máy đó
    assert.strictEqual(may.gan_ca({ may_id: 'mX', van_tay: 'vtX', ma_bind: 'tk-nguoi-hai' }).trang_thai, 'ok');
    assert.strictEqual(db.getNhanVienFull(nv2.id).bind_may_id, 'mX');
    // và không được đem mã của mình sang máy khác
    assert.strictEqual(may.gan_ca({ may_id: 'mY', van_tay: 'vtY', ma_bind: 'tk-nguoi-hai' }).trang_thai, 'gian_lan');
  });
  ok('xoá device.json rồi chạy lại vẫn là đúng máy cũ, không đẻ dòng trùng', () => {
    const truoc = db.dsThietBi().length;
    const r = may.dang_ky({ may_id: 'may-id-hoan-toan-moi', van_tay: VT1,
      ten_may: 'PC-01', ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'ok', 'phải nhận lại máy cũ, không bắt duyệt lại');
    assert.strictEqual(r.may_id, 'm1', 'phải trả về mã máy cũ để script lưu lại');
    assert.strictEqual(db.dsThietBi().length, truoc, 'không được thêm dòng máy trùng');
  });
  await okAsync('trạng thái ca cho script biết cần hỏi gì', () => {
    db.capNhatNhanVien(nv.id, { bind_ca_start: null, bind_may_id: null });
    may.gan_ca({ may_id: 'm1', van_tay: VT1, ma_bind: CCB1 });
    assert.strictEqual(may.trang_thai_ca('m1', VT1).trang_thai, 'da_gan');
    assert.strictEqual(may.trang_thai_ca('m1', 'sai').trang_thai, 'van_tay_lech');
  });
  await okAsync('ngoài ca thì chuyển sang chờ duyệt, không tự cấp', async () => {
    db.capNhatNhanVien(nv.id, { ca_bat_dau: '03:00', ca_ket_thuc: '03:01' });
    const r = await may.xin_ma({ may_id: 'm1', van_tay: VT1, ccb: CCB1 });
    assert.ok(r.trang_thai === 'can_duyet' || r.trang_thai === 'tu_choi');
    assert.ok(!r.ma, 'ngoài ca KHÔNG được tự trả mã');
  });

  console.log('\n8. Cửa sổ gắn máy — chỉ 7 phút trước giờ vào ca');
  db.datCaiDat('gan_han_chot_phut', '0');

  const nvCa = { ca_bat_dau: '09:00', ca_ket_thuc: '21:00', tz_offset: 420 };
  const gioVN = (h, m) => Date.UTC(2026, 8, 2, h - 7, m);

  ok('mở đúng 7 phút trước giờ vào ca', () => {
    assert.ok(!cua_so_gan(nvCa, gioVN(8, 50), 0).trong_cua_so, '08:50 không được mở');
    assert.ok(cua_so_gan(nvCa, gioVN(8, 53), 0).trong_cua_so, '08:53 phải mở');
    assert.ok(cua_so_gan(nvCa, gioVN(9, 0), 0).trong_cua_so, '09:00 phải mở');
  });
  ok('đóng ngay sau giờ vào ca', () => {
    assert.ok(!cua_so_gan(nvCa, gioVN(9, 1), 0).trong_cua_so, '09:01 phải đóng');
    assert.ok(!cua_so_gan(nvCa, gioVN(14, 0), 0).trong_cua_so, 'giữa ca phải đóng');
    assert.ok(!cua_so_gan(nvCa, gioVN(21, 30), 0).trong_cua_so, 'sau ca phải đóng');
  });
  ok('nới hạn chót thì mở thêm đúng bấy nhiêu phút', () => {
    assert.ok(cua_so_gan(nvCa, gioVN(9, 20), 30).trong_cua_so, 'nới 30 phút thì 09:20 phải mở');
    assert.ok(!cua_so_gan(nvCa, gioVN(9, 40), 30).trong_cua_so, 'nới 30 phút thì 09:40 phải đóng');
  });
  ok('ca đêm qua nửa đêm cũng đúng', () => {
    const dem = { ca_bat_dau: '22:00', ca_ket_thuc: '06:00', tz_offset: 420 };
    assert.ok(!cua_so_gan(dem, gioVN(21, 50), 0).trong_cua_so, '21:50 chưa mở');
    assert.ok(cua_so_gan(dem, gioVN(21, 55), 0).trong_cua_so, '21:55 phải mở');
    assert.ok(!cua_so_gan(dem, gioVN(23, 0), 0).trong_cua_so, '23:00 đã đóng');
  });
  await okAsync('vào ca muộn vẫn gắn máy được — không được khoá người ta ngoài BO', () => {
    db.capNhatNhanVien(nv.id, { ca_bat_dau: '00:00', ca_ket_thuc: '23:59',
      bind_ca_start: null, bind_may_id: null });
    const r = may.gan_ca({ may_id: 'm1', van_tay: VT1, ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'ok', 'giữa ca mà chưa gắn thì phải cho gắn: ' + (r.ly_do || ''));
  });
  await okAsync('nhưng ĐỔI sang máy khác giữa ca vẫn là gian lận', () => {
    db.themThietBi('mZ', 'vtZ', 'PC-Z', nv.id); db.quyetThietBi('mZ', 'duyet');
    const r = may.gan_ca({ may_id: 'mZ', van_tay: 'vtZ', ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'gian_lan');
  });
  await okAsync('ngoài ca hẳn thì vẫn không gắn được', () => {
    db.capNhatNhanVien(nv.id, { ca_bat_dau: '03:00', ca_ket_thuc: '03:01',
      bind_ca_start: null, bind_may_id: null });
    const r = may.gan_ca({ may_id: 'm1', van_tay: VT1, ma_bind: CCB1 });
    assert.strictEqual(r.trang_thai, 'tu_choi');
    assert.match(r.ly_do, /Ngoài giờ ca/i);
    db.capNhatNhanVien(nv.id, { ca_bat_dau: '00:00', ca_ket_thuc: '23:59',
      bind_ca_start: null, bind_may_id: null });
  });
  await okAsync('đã gắn từ đầu ca thì giữa ca vẫn lấy mã bình thường', async () => {
    db.datCaiDat('gan_han_chot_phut', '1440');
    db.capNhatNhanVien(nv.id, { bind_ca_start: null, bind_may_id: null, khoa_tam_den: null });
    assert.strictEqual(may.gan_ca({ may_id: 'm1', van_tay: VT1,
      ma_bind: CCB1 }).trang_thai, 'ok');
    db.datCaiDat('gan_han_chot_phut', '0');   // đóng cửa sổ lại
    const r = await may.xin_ma({ may_id: 'm1', van_tay: VT1, ccb: CCB1 });
    assert.strictEqual(r.trang_thai, 'ok', 'lấy mã giữa ca phải chạy: ' + (r.ly_do || ''));
  });

  console.log('\n9. Độ dài ca và giờ vào ca');
  const { congGio, doDaiPhut } = require('./src/policy');
  const nhansu = require('./src/nhansu');

  ok('cộng giờ vòng qua nửa đêm', () => {
    assert.strictEqual(congGio('09:00', 480), '17:00');
    assert.strictEqual(congGio('22:00', 480), '06:00');
    assert.strictEqual(congGio('20:00', 600), '06:00');
  });
  ok('đo độ dài ca, kể cả ca đêm', () => {
    assert.strictEqual(doDaiPhut('09:00', '21:00'), 720);
    assert.strictEqual(doDaiPhut('22:00', '06:00'), 480);
    assert.strictEqual(doDaiPhut('14:30', '22:00'), 450);
  });
  ok('đọc giờ vào ca kiểu Việt Nam từ file', () => {
    assert.strictEqual(nhansu.gioTu('09:00'), '09:00');
    assert.strictEqual(nhansu.gioTu('9:00'), '09:00');
    assert.strictEqual(nhansu.gioTu('9h30'), '09:30');
    assert.strictEqual(nhansu.gioTu('22:00'), '22:00');
    assert.strictEqual(nhansu.gioTu(0.375), '09:00', 'ô Excel định dạng Time');
    assert.strictEqual(nhansu.gioTu('sáng sớm'), null, 'chữ không phải giờ phải trả null');
    assert.strictEqual(nhansu.gioTu('25:00'), null, 'giờ quá 23 phải trả null');
  });

  console.log('\n10. Tự đăng nhập BO khi token hết hạn');
  const hengio = require('./src/hengio');
  const httpNode = require('http');

  await okAsync('token chết -> tự đăng nhập -> thử lại thành công', async () => {
    let tokenThat = 'TOKEN_DUNG';
    const daGoi = [];
    const srv = httpNode.createServer((q, r) => {
      let b = '';
      q.on('data', (c) => (b += c));
      q.on('end', () => {
        if (q.url.endsWith('/login')) {
          const j = JSON.parse(b);
          daGoi.push('login:' + j.userid);
          // Mật khẩu gửi đi phải là chuỗi hash, không phải mật khẩu gốc.
          assert.match(j.password, /^[0-9a-f]{40}$/, 'phải gửi hash SHA1');
          tokenThat = 'TOKEN_MOI';
          r.writeHead(200, { 'Content-Type': 'application/json' });
          return r.end(JSON.stringify({ code: 0, data: { token: tokenThat } }));
        }
        daGoi.push('kick:' + q.headers.authorization);
        if (q.headers.authorization !== tokenThat) { r.writeHead(401); return r.end('{}'); }
        r.writeHead(204); r.end();
      });
    });
    await new Promise((ok2) => srv.listen(39555, ok2));

    db.datCaiDat('webhook_url', 'http://127.0.0.1:39555/users/{bo_account}/kick');
    db.datCaiDat('webhook_method', 'PUT');
    db.datCaiDat('webhook_body', '');
    db.datCaiDat('webhook_headers', '{"Authorization":"{token}"}');
    db.datCaiDat('bo_token', 'TOKEN_DA_CHET');
    db.datCaiDat('bo_login_url', 'http://127.0.0.1:39555/api/v1/login');
    db.datCaiDat('bo_userid', 'soso1688');
    db.datCaiDat('bo_mat_khau_enc', crypto.seal('52fd842eea22f638711aa31a7bd316da48fb4eaa'));
    db.datCaiDat('bo_tu_dang_nhap', '1');

    const kq = await hengio.ban(db.getNhanVienFull(nv.id));
    assert.ok(kq.ok, 'phải thành công sau khi tự đăng nhập: ' + kq.chi_tiet);
    assert.deepStrictEqual(daGoi, ['kick:TOKEN_DA_CHET', 'login:soso1688', 'kick:TOKEN_MOI']);
    assert.strictEqual(db.docCaiDat('bo_token'), 'TOKEN_MOI', 'phải lưu token mới');
    srv.close();
  });

  await okAsync('mật khẩu BO không bao giờ trả ra API cài đặt', async () => {
    const r = await goi('/api/cai-dat');
    assert.ok(!/bo_mat_khau_enc|52fd842eea/.test(r.text), 'lộ mật khẩu BO');
    assert.match(r.text, /co_mat_khau_bo/);
  });


  console.log('\n11. Lịch tháng chính thức');
  const lich = require('./src/lich');
  const { moc_ca: mocCaLich } = require('./src/policy');

  ok('chưa upload lịch tháng thì vẫn dùng ca mặc định', () => {
    db.capNhatNhanVien(nv.id, { ca_bat_dau: '09:00', ca_ket_thuc: '21:00', tz_offset: 420 });
    db.xoaDanhDauLichThang(nv.id, '2026-09');
    db.xoaLichThangCua(nv.id, '2026-09');
    const luc = Date.UTC(2026, 8, 10, 10 - 7, 0);
    const ca = mocCaLich(db.ganLichRuntime(db.db.prepare('SELECT * FROM nhan_vien WHERE id=?').get(nv.id), luc), luc);
    assert.strictEqual(ca.nguon_ca, 'mac_dinh'); assert.strictEqual(ca.trong_ca, true);
  });

  ok('tháng đã upload: ngày không có ca = OFF, không fallback ca mặc định', () => {
    db.danhDauLichThang(nv.id, '2026-09', 'TEST');
    const luc = Date.UTC(2026, 8, 10, 10 - 7, 0);
    const ca = mocCaLich(db.ganLichRuntime(db.db.prepare('SELECT * FROM nhan_vien WHERE id=?').get(nv.id), luc), luc);
    assert.ok(ca.off); assert.strictEqual(ca.trong_ca, false); assert.strictEqual(ca.nguon_ca, 'lich_thang');
  });

  ok('ngày có ca trong lịch tháng dùng đúng giờ đã xếp', () => {
    db.upsertLichNgay({ nhan_vien_id: nv.id, ngay: '2026-09-10', ca_bat_dau: '14:00', ca_ket_thuc: '22:00',
      tz_offset: 420, trang_thai: 'WORK', nguon: 'TEST' });
    const luc13 = Date.UTC(2026, 8, 10, 13 - 7, 0);
    const luc15 = Date.UTC(2026, 8, 10, 15 - 7, 0);
    const a = mocCaLich(db.ganLichRuntime(db.db.prepare('SELECT * FROM nhan_vien WHERE id=?').get(nv.id), luc13), luc13);
    const b = mocCaLich(db.ganLichRuntime(db.db.prepare('SELECT * FROM nhan_vien WHERE id=?').get(nv.id), luc15), luc15);
    assert.strictEqual(a.nguon_ca, 'lich_ngay'); assert.strictEqual(a.trong_ca, false);
    assert.strictEqual(a.ca_bat_dau, '14:00'); assert.strictEqual(b.trong_ca, true);
  });

  ok('lịch ca đêm theo tháng vẫn hiệu lực sau nửa đêm', () => {
    db.upsertLichNgay({ nhan_vien_id: nv.id, ngay: '2026-09-12', ca_bat_dau: '22:00', ca_ket_thuc: '06:00',
      tz_offset: 420, trang_thai: 'WORK', nguon: 'TEST' });
    const luc = Date.UTC(2026, 8, 13, 2 - 7, 0);
    const ca = mocCaLich(db.ganLichRuntime(db.db.prepare('SELECT * FROM nhan_vien WHERE id=?').get(nv.id), luc), luc);
    assert.strictEqual(ca.ngay_ca, '2026-09-12'); assert.strictEqual(ca.trong_ca, true);
    assert.strictEqual(ca.ca_bat_dau, '22:00'); assert.strictEqual(ca.ca_ket_thuc, '06:00');
  });

  ok('parser nhận đúng file tháng kiểu Điểm danh: một dòng/người, mỗi ngày một cột', () => {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['TaiKhoanBO','Ten','KhuVuc','01/09','02/09','03/09','04/09'],
      ['st666_test01','Nguyễn Test','VN','09:00','14:00','OFF','22:00-04:00'],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'CS');
    const kq = lich.parseScheduleFile(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }), '2026-09', () => 8);
    assert.strictEqual(kq.count, 1);
    // So từng trường, đừng deepStrictEqual cả object — parser còn kèm cờ
    // tu_tinh_ket_thuc để biết giờ ra do người xếp ghi hay hệ thống tự tính.
    const ngay = (k) => kq.rows[0].days[k];
    assert.strictEqual(ngay('2026-09-01').start, '09:00');
    assert.strictEqual(ngay('2026-09-01').end, '17:00');
    assert.strictEqual(ngay('2026-09-02').start, '14:00');
    assert.strictEqual(ngay('2026-09-02').end, '22:00');
    assert.ok(!ngay('2026-09-03'), 'OFF phải không tạo ca WORK');
    // Ô ghi cả khoảng '22:00-04:00' nhưng giờ ra trong file bị BỎ QUA có chủ đích:
    // giờ ra luôn tính theo Độ dài ca (8 tiếng) nên phải ra 06:00, không phải 04:00.
    assert.strictEqual(ngay('2026-09-04').start, '22:00');
    assert.strictEqual(ngay('2026-09-04').end, '06:00',
      'giờ ra phải tính từ độ dài ca, không lấy giờ ra ghi trong file');
    assert.ok(ngay('2026-09-04').tu_tinh_ket_thuc, 'giờ ra luôn là tự tính');
    assert.ok(ngay('2026-09-01').tu_tinh_ket_thuc, 'ô một mốc giờ cũng tự tính');
  });

  console.log(`\n${fail ? '✗' : '✓'} ${pass} đạt, ${fail} hỏng\n`);
  process.exit(fail ? 1 : 0);
})();
