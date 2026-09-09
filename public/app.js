'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gio = (ms) => new Date(ms).toLocaleString('vi-VN', { hour12: false });

async function api(url, opt = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opt,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.loi || 'Lỗi ' + r.status);
  return d;
}

/* ---------- vào tủ ---------- */
async function khoiDong() {
  const t = await api('/api/trang-thai');
  if (!t.dang_nhap) return;
  $('#cong').classList.add('an');
  if (!t.mo_khoa) { $('#mokhoa').classList.remove('an'); return; }
  $('#mokhoa').classList.add('an');
  $('#app').classList.remove('an');
  const den = $('#denBot');
  if (!t.co_bot) { den.className = 'den tat'; $('#tinhTrang').textContent = 'Hệ thống chưa cấu hình'; }
  else if (!t.co_admin_id) { den.className = 'den canh'; $('#tinhTrang').textContent = 'Thiếu ADMIN_TELEGRAM_ID'; }
  else { den.className = 'den'; $('#tinhTrang').textContent = 'Hệ thống đang chạy'; }
  if (t.phien_ban) $('#tinhTrang').textContent += ` · v${t.phien_ban}`;
  taiTatCa();
  setInterval(taiPhu, 15000);
}

async function dangNhap() {
  try {
    await api('/api/dang-nhap', { method: 'POST', body: { mat_khau: $('#mk').value } });
    location.reload();
  } catch (e) { $('#congloi').textContent = e.message; }
}
async function moKhoa() {
  try {
    await api('/api/mo-khoa', { method: 'POST', body: { khoa: $('#kc').value } });
    location.reload();
  } catch (e) { $('#mkloi').textContent = e.message; }
}
async function dangXuat() { await api('/api/dang-xuat', { method: 'POST' }); location.reload(); }

/* ---------- tab ---------- */
document.querySelectorAll('nav button[data-tab]').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button[data-tab]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    document.querySelectorAll('main section').forEach((s) => s.classList.add('an'));
    $('#tab-' + b.dataset.tab).classList.remove('an');
    if (b.dataset.tab === 'tu') workView('staff');
    taiTatCa();
  };
});

function taiTatCa() { taiTongQuan(); taiNV(); taiPhu(); taiNhatKy(); taiCaiDat(); taiHenGio(); taiLichNgay(); }
function taiPhu() { taiDuyet(); taiCanhBao(); taiMay(); }


/* ---------- Hub Nhân sự & Lịch ---------- */
let WORK_VIEW = 'staff';
function workView(v) {
  WORK_VIEW = v === 'month' ? 'month' : 'staff';
  // Nút "Lịch ca" trên thanh trên cùng sáng theo chế độ đang xem, để biết mình đang ở đâu.
  const nutLich = document.querySelector('nav button[onclick*="workView"]');
  if (nutLich) nutLich.classList.toggle('on', WORK_VIEW === 'month');
  if ($('#workStaffView')) $('#workStaffView').hidden = WORK_VIEW !== 'staff';
  if ($('#workMonthView')) $('#workMonthView').hidden = WORK_VIEW !== 'month';
  if ($('#workTabStaff')) $('#workTabStaff').classList.toggle('on', WORK_VIEW === 'staff');
  if ($('#workTabMonth')) $('#workTabMonth').classList.toggle('on', WORK_VIEW === 'month');
  if (WORK_VIEW === 'month') taiLichNgay();
}
function toggleWorkPanel(k) {
  const panels = {
    staffimport: $('#workStaffImportPanel'),
    import: $('#workImportPanel'),
    bulk: $('#workBulkPanel'),
  };
  const target = panels[k] || panels.import;
  const willOpen = target ? target.hidden : false;
  Object.values(panels).forEach((p) => { if (p) p.hidden = true; });
  if (target && willOpen) {
    target.hidden = false;
    if (k === 'import' && $('#lich_thang_nhap') && !$('#lich_thang_nhap').value)
      $('#lich_thang_nhap').value = $('#lich_thang')?.value || thangHienTai();
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/* ---------- tổng quan ---------- */
const CHU_DAU = (s) => String(s || '?').trim().charAt(0).toUpperCase();
const MAU_AVA = ['i-tim', 'i-lam', 'i-den', 'i-xanh', 'i-do'];
const avaCua = (s) => MAU_AVA[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % MAU_AVA.length];

/** Biểu đồ vùng, vẽ thẳng bằng SVG cho khỏi kéo thư viện. */
function veBieuDo(gt) {
  const W = 640, H = 150, day = 24, tren = 12;
  const dinh = Math.max(1, ...gt);
  const buoc = W / (gt.length - 1);
  const y = (v) => tren + (H - day - tren) * (1 - v / dinh);
  const diem = gt.map((v, i) => [i * buoc, y(v)]);
  // đường cong trơn qua các điểm
  let d = `M ${diem[0][0]} ${diem[0][1]}`;
  for (let i = 0; i < diem.length - 1; i++) {
    const [x1, y1] = diem[i], [x2, y2] = diem[i + 1], xm = (x1 + x2) / 2;
    d += ` C ${xm} ${y1}, ${xm} ${y2}, ${x2} ${y2}`;
  }
  const gio = new Date().getHours();
  const nhan = [0, 6, 12, 18, 23].map((i) => `<span>${String((gio + 1 + i) % 24).padStart(2, '0')}h</span>`).join('');
  return `<svg class="bd" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6c4ee3" stop-opacity=".28"/>
      <stop offset="100%" stop-color="#6c4ee3" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" y1="${tren + (H - day - tren) * f}" x2="${W}" y2="${tren + (H - day - tren) * f}" stroke="#e6e9f2" stroke-width="1"/>`).join('')}
    <path d="${d} L ${W} ${H - day} L 0 ${H - day} Z" fill="url(#g1)"/>
    <path d="${d}" fill="none" stroke="#6c4ee3" stroke-width="2.5" stroke-linecap="round"/>
  </svg><div class="bd-nhan">${nhan}</div>`;
}

const theSo = (nhan, icon, mau, gt, ghi) => `<div class="so">
  <div class="nhan"><i class="${mau}">${icon}</i>${nhan}</div>
  <div class="gt">${gt}</div><div class="ghi">${ghi || ''}</div></div>`;

async function taiTongQuan() {
  if (!$('#tqSo')) return;
  const d = await api('/api/tong-quan');
  const chuaGan = Math.max(0, d.trong_ca - d.da_gan_ca_nay);
  const gl = d.gian_lan || [];

  $('#tqSo').innerHTML = [
    theSo('Đang trong ca', '◷', 'i-tim', `${d.trong_ca}<small> / ${d.dang_hoat_dong}</small>`,
      `${d.tong_nguoi} người trong tủ`),
    theSo('Đã gắn máy ca này', '⛓', 'i-lam', `${d.da_gan_ca_nay}<small> / ${d.trong_ca}</small>`,
      chuaGan ? `${chuaGan} người trong ca chưa gắn` : 'đủ cả'),
    theSo('Mã phát 24 giờ qua', '⌘', 'i-xanh', d.ma_24h, ''),
    theSo('Đá phiên BO 24 giờ', '🔒', (d.da_phien_24h?.hong ? 'i-do' : 'i-xanh'),
      d.da_phien_24h?.ok ?? 0,
      d.da_phien_24h?.hong ? `${d.da_phien_24h.hong} lần hỏng` : ''),
    theSo('Chờ m duyệt', '!', d.cho_duyet ? 'i-den' : 'i-tim', d.cho_duyet,
      d.cho_duyet ? 'hết hạn sau 2 phút' : 'không có gì'),
    theSo('Dấu hiệu lạ chưa xem', '⚠', d.canh_bao_chua_xem ? 'i-do' : 'i-tim', d.canh_bao_chua_xem,
      gl.length ? `trong đó ${gl.length} vụ gian lận` : ''),
  ].join('');

  $('#tqGianLan').innerHTML = gl.length ? `<div class="bao-do">
    <h4>🚨 CẢNH BÁO ĐĂNG NHẬP GIAN LẬN — ${gl.length} vụ chưa xem</h4>
    <div>Mã CCB của Quản lýột tài khoản BO bị dùng trên thiết bị khác trong cùng ca. Đã chặn tự động.</div>
    ${gl.slice(0, 3).map((c) => `<div class="ct">${esc(c.noi_dung)}\n\n${gio(c.luc)}</div>`).join('')}
    <button onclick="xoaCanhBao()">Đã xem</button>
  </div>` : '';

  $('#tqTong').textContent = `${d.ma_24h} mã`;
  $('#tqBieuDo').innerHTML = veBieuDo(d.ma_theo_gio);

  $('#tqHoatDong').innerHTML = d.hoat_dong.length ? d.hoat_dong.map((r) => `
    <div class="dong">
      <div class="ava ${avaCua(r.ho_ten)}">${esc(CHU_DAU(r.ho_ten))}</div>
      <div class="th"><b>${esc(r.ho_ten || '—')}</b>
        <div>${esc(r.bo_account || '')} · ${esc(r.chi_tiet || '')}${r.ip ? ' · ' + esc(r.ip) : ''}</div></div>
      <div class="gio">${new Date(r.luc).toLocaleTimeString('vi-VN', { hour12: false }).slice(0, 5)}</div>
    </div>`).join('') : '<div class="trong">Chưa có ai lấy mã.</div>';

  const viec = [];
  if (d.cho_duyet) viec.push(['i-den', `${d.cho_duyet} yêu cầu ngoài ca đang chờ duyệt`, 'Hết hạn sau 2 phút', 'duyet']);
  if (d.may_cho_duyet) viec.push(['i-lam', `${d.may_cho_duyet} máy mới chờ duyệt đăng ký`, 'Nhân viên đang đứng chờ', 'may']);
  if (d.canh_bao_chua_xem) viec.push(['i-do', `${d.canh_bao_chua_xem} dấu hiệu lạ chưa xem`, 'Sai mã, lấy dồn dập, gắn máy lạ', 'canhbao']);
  if (chuaGan) viec.push(['i-lam', `${chuaGan} người trong ca chưa gắn máy`, 'Họ chưa lấy được mã', 'tu']);
  if (d.thieu_setup) viec.push(['i-tim', `${d.thieu_setup} người thiếu thiết lập`, 'Chưa đủ hạt giống hoặc mã CCB', 'tu']);
  $('#tqViec').innerHTML = viec.length ? viec.map(([mau, tieu, phu, tab]) => `
    <div class="dong" style="cursor:pointer" onclick="moTab('${tab}')">
      <div class="ava ${mau}">•</div>
      <div class="th"><b>${esc(tieu)}</b><div>${esc(phu)}</div></div>
    </div>`).join('') : '<div class="trong">Không có việc nào đang chờ.</div>';

  $('#tqCanhBao').innerHTML = d.canh_bao_moi.length ? d.canh_bao_moi.map((c) => `
    <div class="dong">
      <div class="ava ${c.da_xem ? 'i-tim' : 'i-do'}">⚠</div>
      <div class="th"><b>${esc(c.loai)}</b><div>${esc(String(c.noi_dung).split('\n')[0])}</div></div>
      <div class="gio">${new Date(c.luc).toLocaleTimeString('vi-VN', { hour12: false }).slice(0, 5)}</div>
    </div>`).join('') : '<div class="trong">Chưa có dấu hiệu bất thường nào.</div>';
}

function moTab(ten) {
  const b = document.querySelector(`nav button[data-tab="${ten}"]`);
  if (b) b.click();
}

/* ---------- nhân viên ---------- */
let DS = [];
const BULK_SELECTED = new Set();

// Độ dài ca chỉ là cách nhập nhanh giờ kết thúc — đổi nó thì giờ kết thúc tự tính lại.
const DO_DAI = [[360, '6 tiếng'], [420, '7 tiếng'], [450, '7.5 tiếng'], [480, '8 tiếng'],
  [540, '9 tiếng'], [600, '10 tiếng'], [660, '11 tiếng'], [720, '12 tiếng']];
const nhanDoDai = (p) => (p % 60 ? (p / 60).toFixed(1) : p / 60) + ' tiếng';

async function taiNV() {
  DS = await api('/api/nhan-vien');
  // Nạp lựa chọn cho bộ lọc từ chính dữ liệu, khỏi phải khai cứng.
  for (const [id, khoa] of [['#l_role', 'vai_tro']]) {
    const o = $(id); if (!o) continue;
    const dangChon = o.value;
    const gt = [...new Set(DS.map((n) => n[khoa]).filter(Boolean))].sort();
    o.innerHTML = '<option value="">Tất cả</option>' + gt.map((v) => `<option>${esc(v)}</option>`).join('');
    o.value = dangChon;
  }
  veBangNV();
}

function xoaLoc() {
  ['#l_tim', '#l_role', '#l_tz'].forEach((s) => { if ($(s)) $(s).value = ''; });
  veBangNV();
}

function veBangNV() {
  const tim = ($('#l_tim')?.value || '').trim().toLowerCase();
  const loc = (n) =>
    (!tim || n.ho_ten.toLowerCase().includes(tim) || n.bo_account.toLowerCase().includes(tim))
    && (!$('#l_role')?.value || n.vai_tro === $('#l_role').value)
    && (!$('#l_tz')?.value || String(n.tz_offset) === $('#l_tz').value);

  const ds = DS.filter(loc);
  if ($('#demNV')) $('#demNV').textContent = `${ds.length}/${DS.length} người`;

  if (!DS.length) return ($('#bangNV').innerHTML = '<div class="trong">Tủ đang trống. Thêm người ở trên.</div>');
  if (!ds.length) return ($('#bangNV').innerHTML = '<div class="trong">Không có ai khớp bộ lọc.</div>');

  $('#bangNV').innerHTML = `<div class="cuon"><table><thead><tr>
    <th style="width:26px"><input type="checkbox" id="chonVisible" style="width:auto" onchange="chonTatCaHienThi(this.checked)" title="Chọn / bỏ chọn tất cả đang hiển thị"></th><th>Nhân viên</th><th>Tài khoản BO</th><th>Ca hôm nay</th>
    <th>Độ dài ca</th><th>Khu vực</th><th>Mã CCB</th><th>Máy trạm</th><th style="width:78px">Xử lý</th></tr></thead><tbody>${ds.map((n) => {
      const coLich = n.nguon_ca === 'lich_ngay' || n.nguon_ca === 'lich_thang';
      const caHienTai = n.off_hom_nay
        ? `<span class="shift-off">OFF</span>`
        : `<span class="shift-time">${esc(n.ca_hieu_luc_bat_dau || n.ca_bat_dau)} – ${esc(n.ca_hieu_luc_ket_thuc || n.ca_ket_thuc)}</span>`;
      const nguon = coLich ? '<span class="chip c-tim">lịch tháng</span>' : '<span class="chip c-mo">mặc định</span>';
      return `
    <tr>
      <td><input type="checkbox" class="chon" value="${n.id}" style="width:auto"${BULK_SELECTED.has(n.id) ? ' checked' : ''} onchange="toggleChon(${n.id},this.checked)"></td>
      <td><b>${esc(n.ho_ten)}</b><div style="margin-top:3px">
        <span class="chip c-mo">${esc(n.vai_tro)}</span>
        ${n.muc === 'cao' ? ' <span class="chip c-den">quyền cao</span>' : ''}
        ${n.trang_thai === 'khoa' ? ' <span class="chip c-do">đã khoá</span>' : ''}</div></td>

      <td class="acc">${esc(n.bo_account)}
        <div style="color:var(--nhat);font-size:11px;margin-top:3px;cursor:pointer"
          onclick="datBoUserId(${n.id})" title="ID nội bộ trong BO, dùng cho lệnh đá phiên">
          ID BO: ${n.bo_user_id ? esc(n.bo_user_id) : '<span style="color:var(--do)">chưa đặt</span>'}</div></td>

      <td>
        <div class="shift-main">${caHienTai} ${nguon}</div>
        <div class="shift-sub">
          ${coLich ? `Ngày ${esc(n.ngay_ca || '')}` : `${n.trong_ca ? 'đang trong ca' : 'ngoài ca'}`}
          · hạn mức ${n.da_lay_trong_ca}/${n.han_muc_ca}
        </div>
        <div class="shift-sub">
          Mặc định ${esc(n.ca_bat_dau)}–${esc(n.ca_ket_thuc)} · ${nhanDoDai(n.do_dai_ca_phut)}
          <button class="link-mini" onclick="suaCaMacDinh(${n.id})">đổi</button>
          <button class="link-mini" onclick="suaLichNhanh(${n.id})">sửa hôm nay</button>
        </div>
      </td>

      <td>
        <select style="width:auto;min-width:92px" onchange="setDoDaiCa(${n.id},this.value)">
          ${DO_DAI.map(([p, ten]) => `<option value="${p}"${Number(n.do_dai_ca_phut) === p ? ' selected' : ''}>${ten}</option>`).join('')}
        </select>
        <div style="color:var(--nhat);font-size:10.8px;margin-top:4px;line-height:1.35;max-width:125px">
          giờ ra của lịch luôn<br>tính theo độ dài này
        </div>
      </td>

      <td><select style="width:auto" onchange="suaNV(${n.id},'tz_offset',this.value)">
        <option value="420"${n.tz_offset === 420 ? ' selected' : ''}>VN</option>
        <option value="240"${n.tz_offset === 240 ? ' selected' : ''}>ARM</option>
        </select>
        <div style="color:var(--nhat);font-size:11px;margin-top:3px">giờ máy ${esc(n.gio_dia_phuong)}</div></td>

      <td>
        <div class="hang" style="gap:5px;flex-wrap:wrap;margin-bottom:5px">
          ${n.co_ma_bind ? '<span class="chip c-ok">CCB đã cấp</span>' : '<span class="chip c-do">chưa có CCB</span>'}
          ${n.co_hat_giong ? '<span class="chip c-ok">đã có hạt giống</span>' : '<span class="chip c-do">thiếu hạt giống</span>'}
        </div>
        <div class="hang" style="gap:6px;flex-wrap:wrap">
          <button class="b${n.co_ma_bind ? '' : ' chinh'}" onclick="maBind(${n.id})">${n.co_ma_bind ? 'Cấp lại mã' : 'Cấp mã'}</button>
          <button class="b${n.co_hat_giong ? '' : ' chinh'}" onclick="napHat(${n.id})">${n.co_hat_giong ? 'Đổi hạt giống' : 'Thêm hạt giống'}</button>
          ${n.co_hat_giong ? `<button class="b" onclick="chanDoanTotp(${n.id})" title="Mã vào BO báo sai thì bấm đây">Dò lệch giờ</button>` : ''}
        </div>
      </td>

      <td>${n.ca_start != null && n.bind_ca_start === n.ca_start
          ? '<span class="chip c-ok">gắn ca này</span>'
          : n.so_may ? '<span class="chip c-mo">hết hiệu lực</span>' : '<span class="chip c-mo">chưa gắn</span>'}
        <div style="margin-top:4px" class="hang">
          ${n.so_may ? `<button class="b" onclick="goMay(${n.id})">Gỡ (${n.so_may})</button>` : ''}
          ${n.ca_start != null && n.bind_ca_start === n.ca_start ? `<button class="b" onclick="moKhoaGan(${n.id})">Mở khoá</button>` : ''}
        </div></td>

      <td>
        <details class="row-menu">
          <summary>•••</summary>
          <div class="row-menu-box">
            <button class="b" onclick="phaKinh(${n.id})">Phá kính (${n.pha_kinh_con})</button>
            <button class="b" onclick="daPhien(${n.id})">Đá phiên BO</button>
            <button class="b" onclick="suaLichNhanh(${n.id})">Sửa lịch hôm nay</button>
            <button class="b nguy" onclick="doiKhoa(${n.id},'${n.trang_thai}')">${n.trang_thai === 'khoa' ? 'Mở tài khoản' : 'Khoá tài khoản'}</button>
            <button class="b nguy" onclick="xoaNV(${n.id})">Xoá nhân viên</button>
          </div>
        </details>
      </td>
    </tr>`}).join('')}</tbody></table></div>`;
  demChon();
}

function suaCaMacDinh(id) {
  const n = DS.find((x) => x.id === id);
  if (!n) return;
  const bd = prompt(`Ca mặc định của ${n.ho_ten}\n\nGiờ bắt đầu (HH:MM):`, n.ca_bat_dau);
  if (bd === null) return;
  if (!/^\d{2}:\d{2}$/.test(bd.trim())) return alert('Giờ bắt đầu phải dạng HH:MM.');
  const kt = prompt('Giờ kết thúc (HH:MM):', n.ca_ket_thuc);
  if (kt === null) return;
  if (!/^\d{2}:\d{2}$/.test(kt.trim())) return alert('Giờ kết thúc phải dạng HH:MM.');
  Promise.resolve(api('/api/nhan-vien/' + id, { method: 'PATCH',
    body: { ca_bat_dau: bd.trim(), ca_ket_thuc: kt.trim() } }))
    .then(() => { taiNV(); taiNhatKy(); })
    .catch((e) => alert(e.message));
}

function ngayLocalCuaNV(n) {
  const d = new Date(Date.now() + Number(n.tz_offset || 0) * 60000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function suaLichNhanh(id) {
  const n = DS.find((x) => x.id === id);
  if (!n) return;
  workView('month');
  const ngay = n.ngay_ca || ngayLocalCuaNV(n);
  moSuaLichNgay(n.bo_account, ngay,
    n.off_hom_nay ? 'OFF' : 'WORK',
    n.off_hom_nay ? '' : (n.ca_hieu_luc_bat_dau || n.ca_bat_dau),
    n.off_hom_nay ? '' : (n.ca_hieu_luc_ket_thuc || n.ca_ket_thuc),
    null, n.nguon_ca === 'lich_thang');
}

async function suaNV(id, khoa, giaTri) {
  await api('/api/nhan-vien/' + id, { method: 'PATCH', body: { [khoa]: Number(giaTri) } });
  taiNV();
}

async function setDoDaiCa(id, phut) {
  try {
    const p = Number(phut);
    if (!DO_DAI.some(([v]) => v === p)) throw new Error('Độ dài ca không hợp lệ.');
    const d = await api('/api/nhan-vien/' + id, { method: 'PATCH', body: { do_dai_ca_phut: p } });
    if (d.lich_da_dong_bo) console.info(`Đã đồng bộ ${d.lich_da_dong_bo} ca lịch theo độ dài mới.`);
    await taiNV();
    if (WORK_VIEW === 'month') taiLichNgay();
  } catch (e) {
    alert(e.message);
    await taiNV();
  }
}

async function suaCa(id, khoa, giaTri) {
  const v = String(giaTri).trim();
  if (!/^\d{2}:\d{2}$/.test(v)) { alert('Giờ ca phải dạng HH:MM, ví dụ 09:00.'); return taiNV(); }
  const body = { [khoa]: v };
  // Dời giờ vào ca thì giữ nguyên độ dài, giờ ra dịch theo — nếu không mỗi lần
  // đổi giờ vào lại phải sửa tay giờ ra.
  if (khoa === 'ca_bat_dau') {
    const n = DS.find((x) => x.id === id);
    if (n) body.do_dai_ca_phut = n.do_dai_ca_phut;
  }
  await api('/api/nhan-vien/' + id, { method: 'PATCH', body });
  taiNV();
}

async function themNV() {
  try {
    await api('/api/nhan-vien', { method: 'POST', body: {
      ho_ten: $('#f_ten').value.trim(), bo_account: $('#f_acc').value.trim(),
      vai_tro: $('#f_role').value, muc: $('#f_muc').value,
      tz_offset: Number($('#f_tz').value), han_muc_ca: Number($('#f_han').value),
      ca_bat_dau: $('#f_bd').value.trim(), ca_ket_thuc: $('#f_kt').value.trim(),
      do_dai_ca_phut: $('#f_dodai') ? Number($('#f_dodai').value) : undefined,
    } });
    $('#f_ten').value = ''; $('#f_acc').value = ''; $('#themLoi').textContent = '';
    taiNV();
  } catch (e) { $('#themLoi').textContent = e.message; }
}

async function nhapNhanSu(thu) {
  const f = $('#ns_file').files[0];
  if (!f) return ($('#nsLoi').textContent = 'Chưa chọn file.');
  $('#nsLoi').textContent = ''; $('#nsKq').innerHTML = 'Đang đọc file…';
  try {
    const b64 = await new Promise((ok, hong) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => hong(new Error('Không đọc được file.'));
      r.readAsDataURL(f);
    });
    const d = await api('/api/nhan-vien/nhap-file', { method: 'POST', body: {
      file: b64, thu,
      mac_dinh: {
        vai_tro: $('#ns_role').value, tz_offset: Number($('#ns_tz').value),
        ca_bat_dau: $('#ns_bd').value.trim(),
        do_dai_ca_phut: Number($('#ns_dodai').value),
        han_muc_ca: Number($('#ns_han').value),
      } } });

    const thieu = Object.entries({ 'Khu vực': d.cot.khu_vuc, 'Bộ phận': d.cot.bo_phan,
      'Ca': d.cot.gio_vao_ca })
      .filter(([, co]) => !co).map(([t]) => t);

    $('#nsKq').innerHTML = `<div style="color:var(--mo);font-size:12.5px;margin-bottom:10px">
      ${d.thu ? 'Kiểm tra thử — chưa ghi gì' : 'Đã nhập'}: ${d.thanh_cong}/${d.tong} dòng
      ${d.hong ? `· <span style="color:var(--do)">${d.hong} dòng lỗi</span>` : ''}
      ${thieu.length ? `<br>File không có cột ${thieu.join(' và ')} — lấy giá trị chung ở trên.` : ''}</div>
      <div class="cuon"><table><thead><tr><th>Tên</th><th>Tài khoản BO</th>
      <th>Bộ phận</th><th>Khu vực</th><th>Ca</th><th>Kết quả</th></tr></thead><tbody>
      ${d.dong.map((r) => {
        const n = r.se_them;
        return `<tr>
          <td>${esc(r.ho_ten || '—')}</td><td class="acc">${esc(r.bo_account || '—')}</td>
          <td>${n ? esc(n.vai_tro) : ''}</td>
          <td>${n ? (n.tz_offset === 240 ? 'ARM' : 'VN') : ''}</td>
          <td class="acc">${n ? esc(n.ca_bat_dau) + '–' + esc(n.ca_ket_thuc) : ''}</td>
          <td>${r.loi ? `<span class="chip c-do">${esc(r.loi)}</span>`
            : d.thu ? '<span class="chip c-den">sẵn sàng</span>' : '<span class="chip c-ok">đã thêm</span>'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

    if (!thu && d.thanh_cong) { $('#ns_file').value = ''; taiNV(); taiTongQuan(); taiNhatKy(); }
  } catch (e) { $('#nsKq').innerHTML = ''; $('#nsLoi').textContent = e.message; }
}

async function chanDoanTotp(id) {
  const n = DS.find((x) => x.id === id);
  const d = await api(`/api/nhan-vien/${id}/chan-doan-totp`, { method: 'POST' });
  const dong = d.danh_sach.map((x) =>
    `${x.lech_giay === 0 ? '→' : '  '} lệch ${String(x.lech_giay).padStart(4)}s   ${x.ma}`).join('\n');
  alert(
    `${n.ho_ten} · ${n.bo_account}\n` +
    `Giờ máy chủ (UTC): ${d.gio_may_chu_utc}\n\n${dong}\n\n` +
    `Thử lần lượt vào BO:\n` +
    `· Dòng "→" chạy được — hạt giống đúng, hệ thống bình thường.\n` +
    `· Chỉ dòng lệch -30 hoặc +30 chạy — đồng hồ máy chủ lệch.\n` +
    `· Không dòng nào chạy — hạt giống không khớp tài khoản BO này,\n` +
    `  vào BO admin reset 2FA rồi nạp lại chuỗi mới.`);
}

async function napHat(id) {
  const n = DS.find((x) => x.id === id);
  const v = prompt('Dán chuỗi Base32 lấy từ BO, hoặc cả link otpauth://\n\n' +
    'Nhân viên không được thấy chuỗi này ở bất kỳ bước nào.');
  if (!v) return;
  try {
    const d = await api(`/api/nhan-vien/${id}/hat-giong`, { method: 'POST', body: { hat_giong: v } });

    let canh = '';
    if (d.so_dong_trung > 1) {
      canh = `\n\n⚠️ CÓ ${d.so_dong_trung} DÒNG CÙNG TÀI KHOẢN BO "${n.bo_account}":\n` +
        d.dong_trung.map((x) => `   #${x.id} ${x.ho_ten} — ${x.co_hat_giong ? 'có hạt giống' : 'CHƯA có hạt giống'}`).join('\n') +
        `\n\nMáy trạm có thể gắn nhầm dòng khác và sinh mã sai. Xoá dòng thừa đi.`;
    }

    alert(
      `Đã nạp hạt giống cho ${n.ho_ten} · ${n.bo_account}\n\n` +
      `MÃ HIỆN TẠI:  ${d.ma_hien_tai}   (còn ${d.con_lai}s)\n\n` +
      `So ngay với Google Authenticator quét cùng QR đó.\n` +
      `· Trùng nhau  → hạt giống đúng, dùng được.\n` +
      `· Khác nhau   → chuỗi vừa dán không phải chuỗi BO đang dùng, nạp lại.` + canh);
    taiNV();
  } catch (e) { alert(e.message); }
}

async function maBind(id) {
  const n = DS.find((x) => x.id === id);
  if (n?.co_ma_bind && !confirm('Cấp mã CCB mới?\n\nMã cũ hết hiệu lực ngay, người đó sẽ không lấy được mã cho tới khi nhận mã mới.')) return;
  const d = await api(`/api/nhan-vien/${id}/ma-bind`, { method: 'POST' });
  prompt('MÃ CCB của người này. Chuỗi này chỉ hiện đúng một lần — tủ không lưu bản gốc.\n\n' +
    'Vừa dùng để gắn máy đầu ca, vừa dùng để lấy mã OTP. Gửi riêng, đừng gửi trong nhóm.',
    d.ma_bind);
  taiNV();
}

async function phaKinh(id) {
  if (!confirm('Sinh bộ mã phá kính mới? Bộ cũ sẽ mất hiệu lực ngay.')) return;
  const d = await api(`/api/nhan-vien/${id}/pha-kinh`, { method: 'POST', body: { so_luong: 3 } });
  prompt('In ra giấy, niêm phong, đưa người đó cất. Mỗi mã dùng một lần, bóc là bắn cảnh báo.', d.ma.join('   '));
  taiNV();
}

async function datBoUserId(id) {
  const n = DS.find((x) => x.id === id);
  const v = prompt(`ID nội bộ của ${n.bo_account} trong BO.\n\nLấy ở trang quản trị BO — thường nằm trong URL hoặc cột ID của bảng tài khoản. Dùng cho lệnh đá phiên. Để trống nếu BO nhận thẳng tên tài khoản.`, n.bo_user_id || '');
  if (v === null) return;
  await api('/api/nhan-vien/' + id, { method: 'PATCH', body: { bo_user_id: v.trim() } });
  taiNV();
}

async function daPhien(id) {
  const n = DS.find((x) => x.id === id);
  if (!confirm(`Đá phiên BO của ${n.ho_ten} ngay bây giờ?\n\nGọi địa chỉ đã cấu hình ở tab Cài đặt, và gỡ gắn máy của người này.`)) return;
  const d = await api(`/api/nhan-vien/${id}/da-phien`, { method: 'POST' });
  alert(d.khong_online
    ? `${n.ho_ten} không có phiên BO nào đang mở — không cần đá.\n\nLệnh đã gọi tới BO thành công, cấu hình đang chạy đúng.`
    : d.ok ? 'Đã đá phiên thành công.\n' + d.chi_tiet
    : 'Không gọi được.\n' + d.chi_tiet);
  taiNV(); taiNhatKy();
}

async function doiKhoa(id, tt) {
  await api(`/api/nhan-vien/${id}`, { method: 'PATCH', body: { trang_thai: tt === 'khoa' ? 'hoat_dong' : 'khoa' } });
  taiNV();
}

async function xoaNV(id) {
  const n = DS.find((x) => x.id === id);
  if (!n) return;
  const v = prompt(
    `Xoá ${n.ho_ten} khỏi tủ?\n\n` +
    `Hạt giống, mã CCB, gắn máy và mã phá kính của người này sẽ mất hẳn, không lấy lại được.\n` +
    `Nhật ký cũ vẫn giữ nguyên.\n\n` +
    `Nếu chỉ muốn tạm ngưng thì bấm Khoá, đừng xoá.\n\n` +
    `Gõ lại tài khoản BO để xác nhận:`, '');
  if (v == null) return;
  try {
    await api('/api/nhan-vien/' + id, { method: 'DELETE', body: { xac_nhan: v.trim() } });
    taiNV(); taiTongQuan(); taiNhatKy();
  } catch (e) { alert(e.message); }
}

async function goMay(id) {
  const n = DS.find((x) => x.id === id);
  const ds = n?.may || [];
  const nhan = ds.map((m, i) => `${i + 1}. ${m.nhan_dang || m.telegram_id}`).join('\n');
  const c = prompt(`Máy đang gắn với ${n.bo_account}:\n${nhan}\n\nGõ số thứ tự để gỡ một cái, hoặc ALL để gỡ hết (dùng khi nghỉ việc).`);
  if (!c) return;
  if (c.trim().toUpperCase() === 'ALL') await api(`/api/nhan-vien/${id}/may`, { method: 'DELETE' });
  else {
    const m = ds[Number(c) - 1];
    if (!m) return alert('Số không hợp lệ.');
    await api(`/api/nhan-vien/${id}/may/${m.telegram_id}`, { method: 'DELETE' });
  }
  taiNV(); taiNhatKy();
}

async function moKhoaGan(id) {
  if (!confirm('Cho phép gắn máy khác ngay trong ca này?\n\nBình thường phải đợi sang ca sau. Chỉ dùng khi đã xác minh máy cũ hỏng thật.')) return;
  await api(`/api/nhan-vien/${id}/mo-khoa-gan`, { method: 'POST' });
  taiNV(); taiNhatKy();
}

/* ---------- đổi ca hàng loạt ---------- */
const daChon = () => [...BULK_SELECTED];

function toggleChon(id, checked) {
  if (checked) BULK_SELECTED.add(Number(id));
  else BULK_SELECTED.delete(Number(id));
  demChon();
}

function idsDangHienThi() {
  return [...document.querySelectorAll('.chon')].map((c) => Number(c.value));
}

function demChon() {
  const n = BULK_SELECTED.size;
  if ($('#dcDem')) $('#dcDem').textContent = n ? `đã chọn ${n} người` : '';
  if ($('#bulkQuickCount')) $('#bulkQuickCount').textContent = `Đã chọn ${n} người`;
  if ($('#bulkQuick')) $('#bulkQuick').hidden = !n;

  const visible = idsDangHienThi();
  const allVisible = visible.length > 0 && visible.every((id) => BULK_SELECTED.has(id));
  if ($('#chonVisible')) {
    $('#chonVisible').checked = allVisible;
    $('#chonVisible').indeterminate = !allVisible && visible.some((id) => BULK_SELECTED.has(id));
  }
}

function chonTatCaHienThi(checked = true) {
  for (const id of idsDangHienThi()) {
    if (checked) BULK_SELECTED.add(id);
    else BULK_SELECTED.delete(id);
  }
  document.querySelectorAll('.chon').forEach((c) => { c.checked = !!checked; });
  demChon();
}

function chonTatCa() { chonTatCaHienThi(true); }

function boChon() {
  BULK_SELECTED.clear();
  document.querySelectorAll('.chon').forEach((c) => (c.checked = false));
  demChon();
}

async function apDoDaiDaChon(selectId = 'dc_dodai') {
  const ids = daChon();
  if (!ids.length) {
    if ($('#dcLoi')) $('#dcLoi').textContent = 'Chưa tích chọn nhân viên nào.';
    return;
  }
  const el = $('#' + selectId);
  const p = Number(el?.value || 0);
  if (!DO_DAI.some(([v]) => v === p)) return alert('Độ dài ca không hợp lệ.');

  const ten = DO_DAI.find(([v]) => v === p)?.[1] || `${p} phút`;
  if (!confirm(`Áp độ dài ca ${ten} cho ${ids.length} người đã chọn?\n\nGiờ bắt đầu của từng người được giữ nguyên; hệ thống tính lại giờ kết thúc của ca mặc định và lịch hôm nay/tương lai theo độ dài mới.`)) return;

  try {
    const kq = await Promise.allSettled(ids.map((id) =>
      api('/api/nhan-vien/' + id, { method: 'PATCH', body: { do_dai_ca_phut: p } })
    ));
    const ok = kq.filter((x) => x.status === 'fulfilled').length;
    const fail = kq.length - ok;
    const synced = kq.filter((x) => x.status === 'fulfilled')
      .reduce((s, x) => s + Number(x.value?.lich_da_dong_bo || 0), 0);
    if ($('#dcLoi')) {
      $('#dcLoi').style.color = fail ? 'var(--do)' : 'var(--xanh)';
      $('#dcLoi').textContent = fail
        ? `Đã cập nhật ${ok}/${ids.length} người, ${fail} người lỗi.`
        : `Đã cập nhật ${ok} người thành ${ten}${synced ? ` · đồng bộ ${synced} ca lịch` : ''}.`;
    }
    await taiNV();
    if (WORK_VIEW === 'month') taiLichNgay();
    taiNhatKy();
  } catch (e) {
    if ($('#dcLoi')) $('#dcLoi').textContent = e.message;
    else alert(e.message);
  }
}

async function doiCa() {
  const ids = daChon();
  if (!ids.length) return ($('#dcLoi').textContent = 'Chưa tích chọn ai ở bảng trên.');
  try {
    const d = await api('/api/doi-ca', { method: 'POST', body: {
      ids, ca_bat_dau: $('#dc_bd').value.trim(), ca_ket_thuc: $('#dc_kt').value.trim(),
      tz_offset: Number($('#dc_tz').value) } });
    $('#dcLoi').textContent = '';
    alert(`Đã đổi ca cho ${d.so_nguoi} người.`);
    taiNV(); taiNhatKy();
  } catch (e) { $('#dcLoi').textContent = e.message; }
}


/* ---------- lịch làm việc theo tháng / điều chỉnh từng ngày ---------- */
function thangHienTai() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
async function docFileBase64(f) {
  return new Promise((ok, hong) => { const r = new FileReader(); r.onload = () => ok(r.result);
    r.onerror = () => hong(new Error('Không đọc được file.')); r.readAsDataURL(f); });
}

async function nhapLichThang(mode) {
  const f = $('#lich_file')?.files?.[0];
  const thang = $('#lich_thang_nhap')?.value;
  if (!f) return ($('#lichLoi').textContent = 'Chưa chọn file lịch.');
  if (!thang) return ($('#lichLoi').textContent = 'Chưa chọn tháng áp dụng.');
  if (mode === 'replace' && !confirm(`Ghi đè toàn bộ lịch tháng ${thang}?\n\nLịch tháng này sẽ trở thành nguồn chính thức. Người/ngày không có ca trong file sẽ được xem là OFF.`)) return;

  $('#lichLoi').textContent = '';
  $('#lichKq').innerHTML = 'Đang đọc file…';
  try {
    const d = await api('/api/lich/nhap-file', { method: 'POST', body: {
      file: await docFileBase64(f), thang, mode } });

    const parts = [];
    if (d.preview) {
      parts.push(`<b>Xem trước tháng ${esc(d.thang)}:</b> ${d.count} người · ${d.dayCount} ngày làm.`);
      if (d.matched?.length) parts.push(`Khớp trong tủ: ${d.matched.slice(0, 12).map(esc).join(', ')}${d.matched.length > 12 ? '…' : ''}`);
      if (d.missing?.length) parts.push(`<span style="color:var(--do)"><b>Chưa khớp ${d.missing.length}:</b> ${d.missing.slice(0, 10).map(esc).join('<br>')}</span>`);
    } else {
      parts.push(`<b style="color:var(--xanh)">${esc(d.message || 'Đã áp lịch.')}</b>`);
      if (d.missing?.length) parts.push(`<span style="color:var(--den)">Bỏ qua ${d.missing.length} người không khớp: ${d.missing.slice(0,8).map(esc).join(', ')}</span>`);
    }
    if (d.warnings?.length) {
      parts.push(`<span style="color:var(--den)"><b>${d.warnings.length} cảnh báo khi đọc file:</b><br>${d.warnings.slice(0,8).map(esc).join('<br>')}${d.warnings.length > 8 ? '<br>…' : ''}</span>`);
    }
    $('#lichKq').innerHTML = parts.join('<br>');

    if (!d.preview) {
      $('#lich_file').value = '';
      $('#lich_thang').value = thang;
      workView('month');
      $('#workImportPanel').hidden = true;
      await taiLichNgay(); taiNV(); taiTongQuan(); taiHenGio(); taiNhatKy();
    }
  } catch (e) { $('#lichLoi').textContent = e.message; $('#lichKq').innerHTML = ''; }
}

// Giữ alias cũ để file HTML cũ nếu còn cache vẫn không văng lỗi.
async function nhapLichNgay(thu) { return nhapLichThang(thu ? 'preview' : 'merge'); }

async function luuLichNgayThuCong() {
  const o = $('#lichThuCongLoi'); o.textContent = '';
  try {
    const tt = $('#lich_trangthai').value;
    const d = await api('/api/lich/ngay', { method: 'PUT', body: {
      bo_account: $('#lich_acc').value.trim(), ngay: $('#lich_ngay').value,
      ca_bat_dau: tt === 'OFF' ? null : $('#lich_vao').value,
      trang_thai: tt } });
    o.style.color = 'var(--xanh)';
    o.textContent = d.lich_thang_chinh_thuc
      ? 'Đã cập nhật lịch chính thức của tháng này.'
      : 'Đã lưu override cho ngày này; tháng chưa được up lịch nên các ngày khác vẫn dùng ca mặc định.';
    LICH_EDIT_ID = d.row?.id || LICH_EDIT_ID;
    $('#lichDeleteBtn').hidden = !LICH_EDIT_ID;
    await taiLichNgay(); taiNV(); taiTongQuan(); taiHenGio(); taiNhatKy();
  } catch (e) { o.style.color = 'var(--do)'; o.textContent = e.message; }
}

let LICH_EDIT_ID = null;
let LICH_EDIT_OFFICIAL = false;

function soNgayTrongThang(ym) {
  const [y,m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function ngayHomNayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function cellLich(ym, day, row, official, acc) {
  const ymd = `${ym}-${String(day).padStart(2,'0')}`;
  const today = ymd === ngayHomNayYmd();
  const isWork = row && row.trang_thai !== 'OFF';
  const isOff = official && !isWork || (row && row.trang_thai === 'OFF');
  const cls = `daycell${isWork ? ' work' : ''}${isOff ? ' off' : ''}${today ? ' today' : ''}`;
  const tt = isWork ? `${esc(row.ca_bat_dau)}–${esc(row.ca_ket_thuc)}` : (isOff ? 'OFF' : 'mặc định');
  return `<button class="${cls}" onclick="moSuaLichNgay('${esc(acc)}','${ymd}','${isOff ? 'OFF' : 'WORK'}',
    '${isWork ? esc(row.ca_bat_dau) : ''}','${isWork ? esc(row.ca_ket_thuc) : ''}',${row ? row.id : 'null'},${official ? 'true' : 'false'})">
    <div class="daynum">${day}</div>
    ${isWork ? `<div class="daytime">${esc(row.ca_bat_dau)}–${esc(row.ca_ket_thuc)}</div>`
             : `<div class="dayoff">${isOff ? 'OFF' : 'mặc định'}</div>`}
  </button>`;
}

async function taiLichNgay() {
  if (!$('#lichBang')) return;
  const nowMonth = thangHienTai();
  if (!$('#lich_thang').value) $('#lich_thang').value = nowMonth;
  if ($('#lich_thang_nhap') && !$('#lich_thang_nhap').value) $('#lich_thang_nhap').value = $('#lich_thang').value || nowMonth;
  try {
    const thang = $('#lich_thang').value, q = ($('#lich_tim').value || '').trim();
    const d = await api('/api/lich?thang=' + encodeURIComponent(thang) + (q ? '&q=' + encodeURIComponent(q) : ''));
    const ap = d.ap_dung || [];
    const rows = d.dong || [];
    const byAcc = new Map();
    rows.forEach(r => {
      if (!byAcc.has(r.bo_account)) byAcc.set(r.bo_account, new Map());
      byAcc.get(r.bo_account).set(r.ngay, r);
    });

    // Lấy cả người đã áp lịch chính thức và người chỉ có override thủ công trong tháng.
    const people = new Map();
    ap.forEach(a => people.set(a.bo_account, { ...a, official: true }));
    rows.forEach(r => {
      if (!people.has(r.bo_account)) people.set(r.bo_account, {
        nhan_vien_id: r.nhan_vien_id, ho_ten: r.ho_ten, bo_account: r.bo_account,
        vai_tro: r.vai_tro, tz_offset: r.tz_offset, ngay_lam: 0, official: false
      });
    });

    const nDays = soNgayTrongThang(thang);
    const summary = ap.length
      ? `<div class="month-summary"><strong>${ap.length} nhân viên</strong> đang dùng lịch ${esc(thang)} làm nguồn chính thức.
         Mỗi người chỉ chiếm một dòng; bấm vào người để mở lịch cả tháng. Ngày xám = OFF, ngày tím = có ca.</div>`
      : `<div class="month-summary">Tháng ${esc(thang)} chưa có lịch chính thức. Các override thủ công (nếu có) vẫn được hiển thị bên dưới.</div>`;

    if (!people.size) {
      $('#lichBang').innerHTML = summary + '<div class="month-empty">Chưa có dữ liệu lịch cho tháng này.</div>';
      return;
    }

    const html = [...people.values()].map(p => {
      const map = byAcc.get(p.bo_account) || new Map();
      const official = !!p.official;
      let workCount = 0;
      for (const r of map.values()) if (r.trang_thai !== 'OFF') workCount++;
      const today = (() => {
        const d0 = new Date(Date.now() + Number(p.tz_offset || 0) * 60000);
        const ymd = `${d0.getUTCFullYear()}-${String(d0.getUTCMonth()+1).padStart(2,'0')}-${String(d0.getUTCDate()).padStart(2,'0')}`;
        if (!ymd.startsWith(thang)) return '—';
        const r = map.get(ymd);
        if (r && r.trang_thai !== 'OFF') return `${r.ca_bat_dau}–${r.ca_ket_thuc}`;
        return official ? 'OFF' : 'mặc định';
      })();
      const cells = Array.from({length:nDays}, (_,i) => {
        const day = i+1, ymd = `${thang}-${String(day).padStart(2,'0')}`;
        return cellLich(thang, day, map.get(ymd), official, p.bo_account);
      }).join('');
      return `<details class="emp-month">
        <summary>
          <div class="emp-month-name"><b>${esc(p.ho_ten)}</b><span>${esc(p.vai_tro || '')}</span></div>
          <div><span class="acc">${esc(p.bo_account)}</span><br><small>${Number(p.tz_offset) === 240 ? 'ARM' : 'VN'}</small></div>
          <div><b>${workCount}</b><small> ngày làm</small></div>
          <div class="emp-month-today">Hôm nay: ${esc(today)}</div>
          <div class="emp-month-arrow">›</div>
        </summary>
        <div class="month-grid-wrap">
          <div class="month-grid">${cells}</div>
        </div>
      </details>`;
    }).join('');

    $('#lichBang').innerHTML = summary + `<div class="month-list">${html}</div>`;
  } catch (e) {
    $('#lichBang').innerHTML = `<div class="trong" style="color:var(--do)">${esc(e.message)}</div>`;
  }
}

function phutDoDaiTheoAcc(acc) {
  const n = DS.find((x) => String(x.bo_account).toLowerCase() === String(acc || '').toLowerCase());
  return Number(n?.do_dai_ca_phut || 480);
}
function congPhutUi(hhmm, phut) {
  if (!/^\d{2}:\d{2}$/.test(String(hhmm || ''))) return '';
  const [h,m] = hhmm.split(':').map(Number);
  const t = (((h*60+m+Number(phut||0))%1440)+1440)%1440;
  return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
}
function capNhatGioRaTuTinh() {
  if (!$('#lich_ra')) return;
  if ($('#lich_trangthai')?.value === 'OFF') { $('#lich_ra').value = ''; return; }
  const phut = phutDoDaiTheoAcc($('#lich_acc')?.value);
  $('#lich_ra').value = congPhutUi($('#lich_vao')?.value, phut);
  if ($('#lichEditHint')) $('#lichEditHint').textContent =
    `Giờ ra tự tính theo Độ dài ca ${nhanDoDai(phut)}. Chỉ cần chỉnh giờ vào.`;
}

function moSuaLichNgay(acc, ngay, trangThai='WORK', vao='', ra='', id=null, official=false) {
  LICH_EDIT_ID = id == null ? null : Number(id);
  LICH_EDIT_OFFICIAL = !!official;
  $('#lich_acc').value = acc || '';
  $('#lich_ngay').value = ngay || '';
  $('#lich_trangthai').value = trangThai === 'OFF' ? 'OFF' : 'WORK';
  $('#lich_vao').value = vao || '';
  $('#lich_ra').value = '';
  capNhatGioRaTuTinh();
  $('#lichThuCongLoi').textContent = '';
  $('#lichEditHint').textContent = official
    ? 'Tháng này là lịch chính thức: OFF nghĩa là không mở BO.'
    : 'Tháng này chưa là lịch chính thức: ngày không override vẫn dùng ca mặc định.';
  $('#lichDeleteBtn').hidden = !LICH_EDIT_ID;
  $('#lichEditPanel').hidden = false;
  doiTrangThaiLichEdit();
  $('#lichEditPanel').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function dongSuaLichNgay() {
  $('#lichEditPanel').hidden = true;
  LICH_EDIT_ID = null;
  LICH_EDIT_OFFICIAL = false;
}
function doiTrangThaiLichEdit() {
  const off = $('#lich_trangthai').value === 'OFF';
  $('#lich_vao').disabled = off;
  if (off) { $('#lich_vao').value = ''; $('#lich_ra').value = ''; }
  else capNhatGioRaTuTinh();
}
async function xoaLichDangSua() {
  if (!LICH_EDIT_ID) return;
  await xoaLichNgay(LICH_EDIT_ID, LICH_EDIT_OFFICIAL);
  dongSuaLichNgay();
}

async function xoaLichNgay(id, official) {
  const msg = official
    ? 'Xóa ca của ngày này?\n\nVì tháng đã có lịch chính thức, ngày này sẽ thành OFF và BO sẽ không mở.'
    : 'Xóa lịch riêng của ngày này?\n\nTháng chưa có lịch chính thức nên ngày này sẽ quay về ca mặc định.';
  if (!confirm(msg)) return;
  const d = await api('/api/lich/' + id, { method: 'DELETE' });
  if (d.ngay_thanh_off) alert('Đã xóa ca. Ngày này hiện là OFF theo lịch tháng.');
  await taiLichNgay(); taiNV(); taiTongQuan(); taiHenGio(); taiNhatKy();
}

/* ---------- cài đặt ---------- */
const O_WEBHOOK = [['#wh_url', 'webhook_url'], ['#wh_method', 'webhook_method'],
  ['#wh_headers', 'webhook_headers'], ['#wh_body', 'webhook_body'],
  ['#wh_tre', 'webhook_tre_phut'], ['#wh_token', 'bo_token'],
  ['#cd_hanchot', 'gan_han_chot_phut'],
  ['#bo_url', 'bo_login_url'], ['#bo_uid', 'bo_userid']];

async function taiCaiDat() {
  if (!$('#cd_bao')) return;
  const c = await api('/api/cai-dat');
  $('#cd_bao').checked = !!c.bao_moi_lan_phat_ma;
  $('#wh_bat').checked = !!c.webhook_bat;
  if ($('#bo_tudn')) $('#bo_tudn').checked = c.bo_tu_dang_nhap === '1';
  if ($('#bo_mk')) $('#bo_mk').value = c.co_mat_khau_bo ? '••••••••••••' : '';
  if ($('#bo_dnKq')) $('#bo_dnKq').textContent = c.bo_dang_nhap_luc
    ? 'lần cuối ' + gio(Number(c.bo_dang_nhap_luc)) : '';
  for (const [sel, khoa] of O_WEBHOOK) if ($(sel)) $(sel).value = c[khoa] ?? '';
  if ($('#wh_tokenLuc')) {
    $('#wh_tokenLuc').textContent = c.bo_token_luc
      ? 'tủ tự cập nhật lúc ' + gio(Number(c.bo_token_luc))
      : (c.bo_token ? 'chưa tự cập nhật lần nào' : 'chưa dán token');
  }
}

async function luuCaiDat() {
  const body = {
    bao_moi_lan_phat_ma: $('#cd_bao').checked,
    webhook_bat: $('#wh_bat').checked,
  };
  for (const [sel, khoa] of O_WEBHOOK) if ($(sel)) body[khoa] = $(sel).value;
  if ($('#bo_tudn')) body.bo_tu_dang_nhap = $('#bo_tudn').checked;
  // Chỉ gửi mật khẩu khi thật sự gõ mới, không gửi lại chuỗi chấm giả.
  const mk = $('#bo_mk') ? $('#bo_mk').value.trim() : '';
  if (mk && !/^•+$/.test(mk)) body.bo_mat_khau = mk;
  await api('/api/cai-dat', { method: 'POST', body });
}

async function thuDangNhapBo() {
  const o = $('#bo_dnKq');
  o.textContent = 'đang thử…'; o.style.color = 'var(--mo)';
  try {
    const d = await api('/api/bo/dang-nhap', { method: 'POST' });
    o.textContent = d.chi_tiet;
    o.style.color = d.ok ? 'var(--xanh)' : 'var(--do)';
    if (d.ok) taiCaiDat();
  } catch (e) { o.textContent = e.message; o.style.color = 'var(--do)'; }
}

/* ---------- bộ hẹn giờ ---------- */
const NHAN_TT = {
  trong_ca: ['c-ok', 'đang trong ca'],
  cho: ['c-den', 'chờ tới giờ'],
  sap_da: ['c-den', 'sắp đá'],
  da_da: ['c-mo', 'ca này đã đá'],
  qua_han: ['c-do', 'quá hạn, bỏ qua'],
  bo_qua: ['c-mo', 'bỏ qua'],
  off: ['c-mo', 'OFF theo lịch'],
};

async function taiHenGio() {
  if (!$('#hgBang')) return;
  const d = await api('/api/hen-gio');
  const van_de = [];
  if (!d.dang_chay) van_de.push('bộ hẹn giờ chưa chạy — server cần khởi động lại');
  if (!d.bat) van_de.push('chưa tick ô "Bật đá phiên tự động khi hết ca"');
  if (!d.co_dia_chi) van_de.push('chưa điền địa chỉ');
  if (!d.co_token) van_de.push('chưa dán token BO');

  $('#hgTrangThai').innerHTML = van_de.length
    ? `<div class="ghi" style="color:var(--do)">Chưa chạy tự động được:<br>· ${van_de.join('<br>· ')}</div>`
    : `<div class="ghi" style="color:var(--xanh)">Đang chạy · đá sau khi hết ca ${d.tre_phut} phút · quét lần cuối ${d.quet_lan_cuoi ? gio(d.quet_lan_cuoi) : 'chưa lần nào'}</div>`;

  $('#hgBang').innerHTML = `<div class="cuon"><table><thead><tr>
    <th>Người</th><th>Ca</th><th>Bây giờ bên họ</th><th>Hết ca lúc</th><th>Sẽ đá lúc</th>
    <th>Trạng thái</th><th>Ghi chú</th>
    </tr></thead><tbody>${d.danh_sach.map((r) => {
      const [mau, ten] = NHAN_TT[r.trang_thai] || ['c-mo', r.trang_thai];
      return `<tr><td>${esc(r.ho_ten)}<div class="acc">${esc(r.bo_account)}</div></td>
        <td class="acc">${esc(r.ca)}<div style="color:var(--nhat);font-size:11px">${esc(r.khu_vuc)}</div></td>
        <td class="acc">${esc(r.gio_dia_phuong)}</td>
        <td class="acc" style="white-space:nowrap">${esc(r.het_ca_ho)}</td>
        <td class="acc" style="white-space:nowrap">${esc(r.da_luc_ho)}</td>
        <td><span class="chip ${mau}">${ten}</span></td>
        <td style="color:var(--mo)">${esc(r.ghi_chu)}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p style="color:var(--nhat);font-size:11.5px;margin:10px 0 0">
      Mọi mốc giờ trong bảng này là <b>giờ nơi người đó làm việc</b>, không phải giờ máy bạn.</p>`;
}

async function daNgay() {
  if (!confirm('Đá phiên ngay cho mọi người đã hết ca mà chưa được đá?')) return;
  const d = await api('/api/hen-gio/da-ngay', { method: 'POST' });
  alert(d.ket_qua.length
    ? d.ket_qua.map((r) => `${r.bo_account}: ${r.chi_tiet}`).join('\n')
    : 'Không có ai đang ở trạng thái cần đá.');
  taiHenGio(); taiNhatKy();
}

/* ---------- kiểm tra đường Telegram ---------- */
async function thuTelegram() {
  const o = $('#ttKq');
  o.textContent = 'đang gửi…'; o.style.color = 'var(--mo)';
  try {
    const d = await api('/api/kiem-thu/telegram', { method: 'POST' });
    o.textContent = d.ok ? 'Đã gửi — kiểm tra Telegram của Quản lý.' : d.loi;
    o.style.color = d.ok ? 'var(--xanh)' : 'var(--do)';
  } catch (e) { o.textContent = e.message; o.style.color = 'var(--do)'; }
}

/* ---------- duyệt ---------- */
async function taiDuyet() {
  const ds = await api('/api/duyet');
  $('#soDuyet').innerHTML = ds.length ? `<span class="dot">${ds.length}</span>` : '';
  $('#bangDuyet').innerHTML = ds.length ? `<table><thead><tr>
    <th>Người</th><th>Tài khoản BO</th><th>Lý do</th><th>Còn</th><th></th></tr></thead><tbody>${ds.map((y) => `
    <tr><td>${esc(y.ho_ten)}</td><td class="acc">${esc(y.bo_account)}</td>
      <td style="color:var(--mo)">${esc(y.ly_do)}</td>
      <td class="acc">${Math.max(0, Math.round((y.het_han_luc - Date.now()) / 1000))}s</td>
      <td><div class="hang">
        <button class="b chinh" onclick="quyet(${y.id},true)">Duyệt</button>
        <button class="b nguy" onclick="quyet(${y.id},false)">Từ chối</button>
      </div></td></tr>`).join('')}</tbody></table>`
    : '<div class="trong">Không có yêu cầu nào đang chờ.</div>';
}

async function quyet(id, dongY) {
  const kq = await api('/api/duyet/' + id, { method: 'POST', body: { dong_y: dongY } });
  if (kq.ma) hienMa(kq.ma, kq.con_lai, $('#ktKetQua'));
  else if (kq.trang_thai === 'ok') alert('Đã duyệt. Hệ thống đã gửi mã cho nhân viên.');
  else alert(kq.ly_do);
  taiPhu(); taiNhatKy();
}

/* ---------- máy trạm ---------- */
async function taiMay() {
  if (!$('#bangMay')) return;
  const ds = await api('/api/thiet-bi');
  const cho = ds.filter((t) => t.trang_thai === 'cho').length;
  $('#soMay').innerHTML = cho ? `<span class="dot">${cho}</span>` : '';
  $('#bangMay').innerHTML = ds.length ? `<div class="hop"><div class="cuon"><table><thead><tr>
    <th>Máy</th><th>Mã máy</th><th>Người đăng ký</th><th>Đang gắn</th>
    <th>Trạng thái</th><th>Lúc</th><th></th></tr></thead><tbody>${ds.map((t) => `
    <tr>
      <td><b>${esc(t.ten_may || 'không rõ tên')}</b></td>
      <td class="acc">${esc(String(t.may_id).slice(0, 12))}…</td>
      <td>${esc(t.ho_ten || '—')}${t.bo_account ? `<div class="acc">${esc(t.bo_account)}</div>` : ''}</td>
      <td class="acc">${t.dang_gan ? t.dang_gan + ' tài khoản' : '—'}</td>
      <td>${t.trang_thai === 'duyet' ? '<span class="chip c-ok">đã duyệt</span>'
        : t.trang_thai === 'cho' ? '<span class="chip c-den">chờ duyệt</span>'
        : '<span class="chip c-do">từ chối</span>'}</td>
      <td class="acc" style="white-space:nowrap">${gio(t.tao_luc)}</td>
      <td><div class="hang">
        ${t.trang_thai === 'cho'
          ? `<button class="b chinh" onclick="quyetMay('${esc(t.may_id)}',true)">Duyệt</button>
             <button class="b nguy" onclick="quyetMay('${esc(t.may_id)}',false)">Từ chối</button>`
          : `<button class="b nguy" onclick="xoaMay('${esc(t.may_id)}')">Xoá</button>`}
      </div></td>
    </tr>`).join('')}</tbody></table></div></div>`
    : '<div class="trong">Chưa có máy nào đăng ký.</div>';
}

async function quyetMay(id, dongY) {
  await api(`/api/thiet-bi/${id}/duyet`, { method: 'POST', body: { dong_y: dongY } });
  taiMay(); taiTongQuan(); taiNhatKy();
}

async function xoaMay(id) {
  if (!confirm('Xoá máy này khỏi tủ?\n\nMáy đó sẽ phải đăng ký lại từ đầu, và gắn ca hiện tại bị gỡ.')) return;
  await api('/api/thiet-bi/' + id, { method: 'DELETE' });
  taiMay(); taiTongQuan(); taiNhatKy();
}

/* ---------- cảnh báo ---------- */
async function taiCanhBao() {
  const ds = await api('/api/canh-bao');
  const chuaXem = ds.filter((c) => !c.da_xem).length;
  $('#soCanhBao').innerHTML = chuaXem ? `<span class="dot">${chuaXem}</span>` : '';
  $('#bangCanhBao').innerHTML = ds.length ? `<table><thead><tr>
    <th>Lúc</th><th>Loại</th><th>Nội dung</th></tr></thead><tbody>${ds.map((c) => `
    <tr><td class="acc" style="color:var(--mo);white-space:nowrap">${gio(c.luc)}</td>
      <td><span class="chip ${c.loai === 'GIAN_LAN' ? 'c-do' : c.da_xem ? 'c-mo' : 'c-den'}">${c.loai === 'GIAN_LAN' ? '🚨 GIAN LẬN' : esc(c.loai)}</span></td>
      <td style="white-space:pre-wrap${c.loai === 'GIAN_LAN' ? ';color:var(--do);font-weight:600' : ''}">${esc(c.noi_dung)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="trong">Chưa có dấu hiệu bất thường nào.</div>';
}
async function xoaCanhBao() {
  await api('/api/canh-bao/da-xem', { method: 'POST' });
  taiCanhBao(); taiTongQuan();
}

/* ---------- nhật ký ---------- */
const MAU = { ok: 'c-ok', tu_choi: 'c-do', sai_pin: 'c-do', sai: 'c-do',
  cho_duyet: 'c-den', hong: 'c-do', khong_online: 'c-mo' };
async function taiNhatKy() {
  const hd = $('#locHD') ? $('#locHD').value : '';
  const ds = await api('/api/nhat-ky?limit=200' + (hd ? '&hd=' + hd : ''));
  $('#bangNhatKy').innerHTML = ds.length ? `<table><thead><tr>
    <th>Lúc</th><th>Người</th><th>Tài khoản BO</th><th>Hành động</th><th>Kết quả</th>
    <th>Chi tiết</th><th>Nguồn</th><th>Xin từ máy / IP</th></tr></thead><tbody>${ds.map((r) => `
    <tr><td class="acc" style="color:var(--mo);white-space:nowrap">${gio(r.luc)}</td>
      <td>${esc(r.ho_ten || '—')}</td><td class="acc">${esc(r.bo_account || '—')}</td>
      <td class="acc">${esc(r.hanh_dong)}</td>
      <td><span class="chip ${MAU[r.ket_qua] || 'c-mo'}">${esc(r.ket_qua)}</span></td>
      <td style="color:var(--mo)">${esc(r.chi_tiet || '')}${r.nguoi_duyet ? ' · duyệt: ' + esc(r.nguoi_duyet) : ''}</td>
      <td class="acc" style="color:var(--nhat)">${esc(r.nguon || '')}</td>
      <td class="acc" style="color:var(--mo);font-size:12px">${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table>`
    : '<div class="trong">Nhật ký trống.</div>';
}

/* ---------- kiểm thử ---------- */
function hienMa(ma, conLai, hop) {
  hop.innerHTML = `<div class="ghi" style="text-align:center">
    <div style="color:var(--nhat);font-size:11.5px">Mã đăng nhập BO</div>
    <div class="mahien" id="mh">${esc(ma)}</div>
    <div class="thanh"><i id="tb" style="width:100%"></i></div>
    <div style="color:var(--nhat);font-size:11.5px" id="dem"></div></div>`;
  // Mã chỉ hiện 10 giây rồi tự che, dù chu kỳ TOTP còn dài hơn.
  let n = Math.min(10, conLai);
  const tick = setInterval(() => {
    n--;
    $('#tb').style.width = Math.max(0, (n / 10) * 100) + '%';
    $('#dem').textContent = n > 0 ? `tự ẩn sau ${n}s` : '';
    if (n <= 0) {
      clearInterval(tick);
      $('#mh').classList.add('che');
      $('#dem').textContent = 'đã ẩn — bấm Xin mã lần nữa nếu cần';
    }
  }, 1000);
}

async function ktXinMa() {
  const hop = $('#ktKetQua');
  hop.innerHTML = '<div class="ghi">Đang xử lý… (nếu chu kỳ còn dưới 8 giây, tủ đợi sang chu kỳ mới)</div>';
  try {
    const kq = await api('/api/kiem-thu/xin-ma', { method: 'POST', body: {
      bo_account: $('#kt_acc').value.trim(), ccb: $('#kt_ccb').value } });
    if (kq.trang_thai === 'ok') hienMa(kq.ma, kq.con_lai, hop);
    else if (kq.trang_thai === 'can_duyet') hop.innerHTML = '<div class="ghi">Ngoài giờ ca — đã tạo yêu cầu duyệt. Sang tab Chờ duyệt để bấm.</div>';
    else hop.innerHTML = `<div class="ghi" style="color:var(--do)">${esc(kq.ly_do)}</div>`;
  } catch (e) { hop.innerHTML = `<div class="ghi" style="color:var(--do)">${esc(e.message)}</div>`; }
  taiNV(); taiPhu(); taiNhatKy();
}

async function ktPhaKinh() {
  const ma = prompt('Nhập mã phá kính (dạng 1234-5678)');
  if (!ma) return;
  const hop = $('#ktKetQua');
  try {
    const kq = await api('/api/kiem-thu/pha-kinh', { method: 'POST', body: {
      bo_account: $('#kt_acc').value.trim(), ma } });
    if (kq.trang_thai === 'ok') hienMa(kq.ma, kq.con_lai, hop);
    else hop.innerHTML = `<div class="ghi" style="color:var(--do)">${esc(kq.ly_do)}</div>`;
  } catch (e) { hop.innerHTML = `<div class="ghi" style="color:var(--do)">${esc(e.message)}</div>`; }
  taiNV(); taiPhu(); taiNhatKy();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (document.activeElement === $('#mk')) dangNhap();
  if (document.activeElement === $('#kc')) moKhoa();
});

khoiDong();
