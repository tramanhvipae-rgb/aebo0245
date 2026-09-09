'use strict';
const crypto = require('crypto');

// Khoá chủ chỉ tồn tại trong RAM. Không ghi xuống đĩa, không đưa vào database.
let KEY = null;
const KDF_SALT = 'tu-phat-ma/v1/master';

function initMasterKey(secret) {
  const s = String(secret || '');
  if (s.length < 32) throw new Error('MASTER_KEY phải dài ít nhất 32 ký tự.');
  KEY = crypto.scryptSync(s, KDF_SALT, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function isUnlocked() {
  return KEY !== null;
}

function lock() {
  KEY = null;
}

/** Mã hoá hạt giống. Định dạng: base64(iv[12] | tag[16] | ciphertext) */
function seal(plain) {
  if (!KEY) throw new Error('Tủ chưa mở khoá.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/**
 * Giải mã hạt giống.
 * CHỈ src/totp.js được gọi hàm này. Không có route nào gọi tới, trực tiếp hay gián tiếp.
 * selftest.js kiểm tra lại điều đó sau mỗi lần sửa.
 */
function unseal(blob) {
  if (!KEY) throw new Error('Tủ chưa mở khoá.');
  const b = Buffer.from(String(blob), 'base64');
  if (b.length < 29) throw new Error('Dữ liệu hạt giống hỏng.');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

function hashSecretValue(value) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(value), salt, 32);
  return salt.toString('hex') + ':' + h.toString('hex');
}

function verifySecretValue(value, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const h = crypto.scryptSync(String(value), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

/**
 * Dấu vân tra cứu được của một bí mật, tính bằng HMAC với khoá chủ.
 * Dùng cho mã CCB: vừa tra ngược được để tìm chủ nhân, vừa không lưu chuỗi gốc.
 * Lộ database cũng không đọc ra CCB, vì khoá chủ không nằm trong đó.
 */
function dauVan(giaTri) {
  if (!KEY) throw new Error('Tủ chưa mở khoá.');
  return crypto.createHmac('sha256', KEY).update(String(giaTri)).digest('hex');
}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomDigits(n) {
  let out = '';
  while (out.length < n) out += crypto.randomInt(0, 10);
  return out;
}

module.exports = {
  initMasterKey, isUnlocked, lock,
  seal, unseal,
  hashSecretValue, verifySecretValue, dauVan,
  randomToken, randomDigits,
};
