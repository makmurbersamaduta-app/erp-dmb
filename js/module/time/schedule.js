// =====================================================================
// js/module/settings/schedule.js
// Halaman Jadwal Kerja (desktop): tabel, filter, kalender.
// Pola non-module (window.supabaseClient), sama dengan users.js.
// Logika Import ada di file terpisah: schedule-import.js
// (dimuat SETELAH file ini; berbagi variabel global dengan file ini).
// Semua aturan bisnis ada di database (schedule.sql), bukan di sini.
// =====================================================================

const supabaseClient = window.supabaseClient;

// ---------- 1. PENGATURAN ----------
const PAGE_SIZE = 50;     // karyawan per halaman tabel
const MAX_HARI = 31;      // batas rentang tanggal (1 bulan)
const CHUNK_TAMPIL = 50;  // karyawan per request saat membaca jadwal (maks 100 di database)
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// ---------- 2. STATE ----------
const S = {
    employees: [],            // semua karyawan aktif
    master: new Map(),        // kode shift -> jenis (kerja/libur)
    masterUpper: new Map(),   // KODE_HURUF_BESAR -> kode asli (untuk validasi upload)
    limit: 3000,              // batas sel per upload (dibaca dari database)
    start: '', end: '',       // periode tabel utama
    q: '', page: 1, tk: 0, list: [],
    imp: { ids: new Set(), start: '', end: '', rows: null },
};

// ---------- 3. HELPER UMUM ----------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const fmt = (s) => { const d = parse(s); return `${pad(d.getDate())} ${BULAN[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`; };
const listDays = (a, b) => { const out = []; for (let s = a; s <= b; s = addDays(s, 1)) out.push(s); return out; };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const openM = (id) => { $(id).hidden = false; };
const closeM = (id) => { $(id).hidden = true; };
const matchQ = (e, q) => !q || (e.nama || '').toLowerCase().includes(q) || (e.nik || '').toLowerCase().includes(q);

// Toast Bootstrap (sama dengan users.js)
function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type} border-0`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div>` +
        '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    $('toastContainer').appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 5000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
}

// Tampilkan error di halaman, supaya tidak "diam-diam" kosong
function showError(msg) {
    console.error(msg);
    const b = $('errorBanner');
    b.textContent = msg;
    b.classList.remove('d-none');
}
window.addEventListener('error', (e) => showError(`Error script: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`Error: ${e.reason?.message || e.reason}`));

// ---------- 4. AKSES DATA ----------
// Ambil semua baris dari RPC walau lebih dari 1000 baris (batas API)
async function rpcAll(fn) {
    let from = 0, all = [];
    for (;;) {
        const { data, error } = await supabaseClient.rpc(fn).range(from, from + 999);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < 1000) return all;
        from += 1000;
    }
}
// Baca jadwal banyak karyawan, dipecah per CHUNK_TAMPIL agar tidak timeout
async function fetchSchedule(ids, start, end) {
    const out = {};
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK_TAMPIL) chunks.push(ids.slice(i, i + CHUNK_TAMPIL));
    await Promise.all(chunks.map(async (c) => {
        const { data, error } = await supabaseClient.rpc('jadwal_tampil', { p_employee_ids: c, p_mulai: start, p_selesai: end });
        if (error) throw error;
        (data || []).forEach((r) => { out[r.employee_id] = r.jadwal; });
    }));
    return out;
}

// ---------- 5. FILTER (1 tombol, banyak dropdown, berantai) ----------
// Aturan sama dengan halaman Users dan struktur Cost Center
// (public.cost_center_structures: 1 baris = Cost Center + Area + Departemen + Jabatan):
//   Branch -> Cost Center -> Area -> Departemen -> Jabatan
// Tanpa centang di induk = daftar anak tidak dibatasi induk itu.
// Beberapa induk dicentang = gabungan.
const REF = { branches: [], costCenters: [], areas: [], departments: [], jabatans: [], structures: [] };

const FILTER_DEFS = [
    { key: 'branch', label: 'Branch',      field: 'branch_id',     name: 'branch_name' },
    { key: 'cc',     label: 'Cost Center', field: 'costcenter_id', name: 'costcenter_name' },
    { key: 'area',   label: 'Area',        field: 'area_id',       name: 'area_name' },
    { key: 'dept',   label: 'Departemen',  field: 'departemen_id', name: 'department_name' },
    { key: 'jab',    label: 'Jabatan',     field: 'jabatan_id',    name: 'jabatan_name' },
];
const refList = { branch: () => REF.branches, cc: () => REF.costCenters, area: () => REF.areas, dept: () => REF.departments, jab: () => REF.jabatans };

// Muat data master untuk isi filter (tabel public, sama dengan users.js)
async function loadReferenceData() {
    const q = (t, cols, order) => supabaseClient.from(t).select(cols).eq('is_active', true).order(order);
    const [br, cc, ar, dp, jb] = await Promise.all([
        q('branches', 'id, branch_name', 'branch_name'),
        q('cost_centers', 'id, costcenter_name, branch_id', 'costcenter_name'),
        q('areas', 'id, area_name', 'area_name'),
        q('departments', 'id, department_name', 'department_name'),
        q('jabatans', 'id, jabatan_name', 'jabatan_name'),
    ]);
    [br, cc, ar, dp, jb].forEach((r) => { if (r.error) throw r.error; });
    REF.branches = br.data; REF.costCenters = cc.data; REF.areas = ar.data; REF.departments = dp.data; REF.jabatans = jb.data;
    // cost_center_structures dibaca bertahap (batas 1000 baris per request)
    let all = [], from = 0;
    for (;;) {
        const { data, error } = await supabaseClient.from('cost_center_structures')
            .select('cost_center_id, area_id, dept_id, jabatan_id').order('id', { ascending: true }).range(from, from + 999);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < 1000) break;
        from += 1000;
    }
    REF.structures = all;
}

// Membuat tombol Filter + panel di dalam elemen `root`.
// inline = true: panel tampil menyatu (dipakai di dalam modal).
// Mengembalikan { match(karyawan), refresh() }.
function createFilterPanel(root, onApply, inline = false) {
    root.classList.add('users-filter-wrapper');
    root.innerHTML =
        '<button type="button" class="btn-filter" data-role="toggle"><i class="fa-solid fa-filter"></i><span>Filter</span>' +
        '<span class="filter-count-badge d-none" data-role="badge">0</span></button>' +
        '<div class="users-filter-panel d-none" data-role="panel">' +
        FILTER_DEFS.map((d) =>
            `<div class="filter-group"><button type="button" class="filter-group-header" data-head="${d.key}"><span>${d.label}</span><i class="fa-solid fa-chevron-down"></i></button>` +
            `<div class="filter-group-body" data-body="${d.key}"></div></div>`).join('') +
        '<div class="filter-panel-footer"><button type="button" class="btn-filter-reset" data-role="reset">Reset</button>' +
        '<button type="button" class="btn-filter-apply" data-role="apply">Terapkan</button></div></div>';

    const keys = FILTER_DEFS.map((d) => d.key);
    const panel = root.querySelector('[data-role="panel"]');
    const toggle = root.querySelector('[data-role="toggle"]');
    const body = (k) => root.querySelector(`[data-body="${k}"]`);
    const checked = (k) => [...body(k).querySelectorAll('input:checked')].map((c) => c.value);
    const active = {}; keys.forEach((k) => { active[k] = []; });

    function drawGroup(k, list, def, prevChecked = []) {
        body(k).innerHTML = list.length
            ? list.map((it) => `<label class="filter-checkbox-item"><input type="checkbox" value="${it.id}" ${prevChecked.includes(String(it.id)) ? 'checked' : ''}><span>${esc(it[def.name])}</span></label>`).join('')
            : '<span class="data-empty-cell">Tidak ada data</span>';
    }

    // changed = indeks grup yang baru diubah user; hanya grup DI BAWAHNYA yang digambar ulang.
    // Centang anak yang masih valid dipertahankan.
    function cascade(changed) {
        const prev = keys.map(checked); // dibaca sebelum ada yang digambar ulang
        const draw = (level, list) => { if (level > changed) drawGroup(keys[level], list, FILTER_DEFS[level], prev[level]); };
        const now = (level) => (level <= changed ? prev[level] : checked(keys[level]));
        const idsOf = (rows, f) => new Set(rows.map((r) => String(r[f])));

        // 1. Cost Center <- Branch (cost_centers.branch_id)
        const brSel = prev[0];
        const ccList = brSel.length ? REF.costCenters.filter((c) => brSel.includes(String(c.branch_id))) : REF.costCenters;
        draw(1, ccList);
        const ccNow = now(1);
        const ccSet = ccNow.length ? ccNow : (brSel.length ? ccList.map((c) => String(c.id)) : null);

        // 2. Area <- Cost Center (cost_center_structures)
        let rows = REF.structures;
        if (ccSet) rows = rows.filter((r) => ccSet.includes(String(r.cost_center_id)));
        const areaIds = idsOf(rows, 'area_id');
        draw(2, ccSet ? REF.areas.filter((a) => areaIds.has(String(a.id))) : REF.areas);
        const areaNow = now(2);
        if (areaNow.length) rows = rows.filter((r) => areaNow.includes(String(r.area_id)));

        // 3. Departemen <- Cost Center + Area
        const deptLimited = !!ccSet || areaNow.length > 0;
        const deptIds = idsOf(rows, 'dept_id');
        draw(3, deptLimited ? REF.departments.filter((d) => deptIds.has(String(d.id))) : REF.departments);
        const deptNow = now(3);
        if (deptNow.length) rows = rows.filter((r) => deptNow.includes(String(r.dept_id)));

        // 4. Jabatan <- Cost Center + Area + Departemen
        const jabLimited = deptLimited || deptNow.length > 0;
        const jabIds = idsOf(rows, 'jabatan_id');
        draw(4, jabLimited ? REF.jabatans.filter((j) => jabIds.has(String(j.id))) : REF.jabatans);
    }

    function badge() {
        const total = keys.reduce((n, k) => n + active[k].length, 0);
        const b = root.querySelector('[data-role="badge"]');
        b.textContent = total;
        b.classList.toggle('d-none', total === 0);
    }
    function render() { // gambar dari nol (awal dan saat Reset)
        drawGroup('branch', REF.branches, FILTER_DEFS[0]);
        keys.slice(1).forEach((k) => { body(k).innerHTML = ''; });
        cascade(0);
    }

    if (inline) panel.classList.remove('d-none');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('d-none'); });
    if (!inline) document.addEventListener('click', (e) => { if (!root.contains(e.target)) panel.classList.add('d-none'); });
    root.querySelectorAll('[data-head]').forEach((h) => h.addEventListener('click', () => {
        h.classList.toggle('expanded'); body(h.dataset.head).classList.toggle('expanded');
    }));
    root.addEventListener('change', (e) => {
        const g = e.target.closest('[data-body]'); if (g) cascade(keys.indexOf(g.dataset.body));
    });
    root.querySelector('[data-role="apply"]').addEventListener('click', () => {
        keys.forEach((k) => { active[k] = checked(k); });
        badge(); if (!inline) panel.classList.add('d-none'); onApply();
    });
    root.querySelector('[data-role="reset"]').addEventListener('click', () => {
        keys.forEach((k) => { active[k] = []; });
        render(); badge(); onApply();
    });

    return {
        refresh: render,
        match: (e) => FILTER_DEFS.every((d) => !active[d.key].length || active[d.key].includes(String(e[d.field]))),
    };
}

// ---------- 5b. PENGELOMPOKAN & URUTAN KARYAWAN ----------
// Urutan: Status Karyawan (PKWT/PKWTT sejajar, lalu Borongan, lalu lainnya) > Cost Center > Nama.
const STATUS_ORDER = { pkwt: 0, borong: 1, lain: 2 };
const STATUS_LABEL = { pkwt: 'PKWT / PKWTT', borong: 'Borongan', lain: 'Lainnya' };
function statusKey(e) {
    const s = String(e.status_karyawan || '').toUpperCase().replace(/[\s/_-]/g, '');
    if (s === 'PKWT' || s === 'PKWTT') return 'pkwt';
    if (s.includes('BORONG')) return 'borong';
    return 'lain';
}
function sortEmployees(list) {
    list.forEach((e) => { e._sk = statusKey(e); });
    return list.sort((a, b) =>
        STATUS_ORDER[a._sk] - STATUS_ORDER[b._sk]
        || String(a.costcenter_name || '').localeCompare(String(b.costcenter_name || ''))
        || (a.costcenter_id ?? 0) - (b.costcenter_id ?? 0)
        || String(a.nama || '').localeCompare(String(b.nama || '')));
}

// ---------- 6. KALENDER RENTANG (tarik atau klik awal lalu akhir) ----------
const cal = { start: null, end: null, anchor: null, hover: null, drag: false, y: 0, m: 0, onApply: null };

function openCalendar(start, end, onApply) {
    Object.assign(cal, { start: start || null, end: end || null, anchor: null, hover: null, drag: false, onApply });
    const d = start ? parse(start) : new Date();
    cal.y = d.getFullYear(); cal.m = d.getMonth();
    buildCal();
    openM('mCal');
}
function monthHtml(y, m) {
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // minggu dimulai Senin
    const n = new Date(y, m + 1, 0).getDate();
    let h = `<div class="sch-month"><div class="sch-mtitle">${BULAN_PANJANG[m]} ${y}</div><div class="sch-grid">` +
        ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((x) => `<span class="sch-dow">${x}</span>`).join('') +
        '<span></span>'.repeat(lead);
    for (let i = 1; i <= n; i++) h += `<button type="button" class="sch-d" data-d="${y}-${pad(m + 1)}-${pad(i)}">${i}</button>`;
    return h + '</div></div>';
}
function buildCal() {
    const nx = new Date(cal.y, cal.m + 1, 1);
    $('calBody').innerHTML = monthHtml(cal.y, cal.m) + monthHtml(nx.getFullYear(), nx.getMonth());
    paintCal();
}
// Batasi ujung rentang agar tidak lebih dari MAX_HARI
function clampEnd(a, h) {
    const d = diffDays(a, h);
    if (d > MAX_HARI - 1) return addDays(a, MAX_HARI - 1);
    if (d < -(MAX_HARI - 1)) return addDays(a, -(MAX_HARI - 1));
    return h;
}
function curSel() {
    if (cal.anchor) { const h = clampEnd(cal.anchor, cal.hover); return h < cal.anchor ? [h, cal.anchor] : [cal.anchor, h]; }
    return cal.start ? [cal.start, cal.end] : null;
}
// Warnai garis/pita dari tanggal awal sampai akhir
function paintCal() {
    const sel = curSel();
    document.querySelectorAll('#calBody .sch-d').forEach((b) => {
        const d = b.dataset.d;
        b.classList.toggle('in', !!sel && d >= sel[0] && d <= sel[1]);
        b.classList.toggle('s', !!sel && d === sel[0]);
        b.classList.toggle('e', !!sel && d === sel[1]);
    });
    $('calInfo').textContent = sel
        ? `${fmt(sel[0])} s/d ${fmt(sel[1])} (${diffDays(sel[0], sel[1]) + 1} hari)` + (cal.anchor ? ' - klik tanggal akhir' : '')
        : 'Belum ada tanggal dipilih';
    $('calApply').disabled = !(cal.start && !cal.anchor);
}
function finishCal(d) {
    const h = clampEnd(cal.anchor, d);
    [cal.start, cal.end] = h < cal.anchor ? [h, cal.anchor] : [cal.anchor, h];
    cal.anchor = null; cal.hover = null;
    paintCal();
}
function setupCalendar() {
    $('calBody').addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.sch-d'); if (!b) return;
        e.preventDefault();
        if (cal.anchor) finishCal(b.dataset.d);                 // cara klik: klik kedua
        else { cal.anchor = b.dataset.d; cal.hover = cal.anchor; cal.drag = true; paintCal(); } // mulai tarik
    });
    $('calBody').addEventListener('pointerover', (e) => {
        const b = e.target.closest('.sch-d');
        if (b && cal.anchor) { cal.hover = b.dataset.d; paintCal(); }
    });
    document.addEventListener('pointerup', () => {
        if (cal.drag) { cal.drag = false; if (cal.hover !== cal.anchor) finishCal(cal.hover); }
    });
    $('calPrev').onclick = () => { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } buildCal(); };
    $('calNext').onclick = () => { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } buildCal(); };
    $('calApply').onclick = () => { closeM('mCal'); cal.onApply(cal.start, cal.end); };
}

// ---------- 7. TABEL JADWAL UTAMA ----------
let main; // kelompok filter toolbar, dibuat saat init

function chip(c) {
    if (!c || !c.kode) return '<span class="sch-dash">-</span>';
    const jenis = S.master.get(c.kode);
    return `<span class="sch-chip ${jenis === 'libur' ? 'libur' : jenis === 'kerja' ? 'kerja' : ''}" title="Sumber: ${esc(c.sumber)}">${esc(c.kode)}</span>` + absLine(c);
}
// Baris clock in / out: "In : hh.mm | Out : hh.mm"
// Aturan warna dihitung di database (late, early, hari); di sini hanya tampilan.
//   merah bold  = terlambat (In) / pulang cepat (Out)
//   oranye bold = kosong ("-") pada tanggal yang sudah lewat
//   biasa       = "-" pada hari ini; tanggal mendatang & hari libur tidak ditampilkan
function absLine(c) {
    if (!c.kerja || c.hari === 'depan') return '';
    const seg = (label, val, bad) => {
        const cls = bad ? 'sch-late' : (!val && c.hari === 'lalu' ? 'sch-miss' : '');
        return `<span class="${cls}">${label} : ${val || '-'}</span>`;
    };
    return `<div class="sch-abs">${seg('In', c.in, c.late)} | ${seg('Out', c.out, c.early)}</div>`;
}
function renderHead() {
    $('thead').innerHTML = '<tr><th class="sch-stk">Nama<br><span style="font-weight:400;color:var(--sch-muted)">NIK | Jabatan</span></th>' +
        listDays(S.start, S.end).map((d) => `<th>${fmt(d)}</th>`).join('') + '</tr>';
}
function renderBody(slice, jd) {
    const days = listDays(S.start, S.end);
    const span = days.length + 1;
    if (!slice.length) {
        $('tbody').innerHTML = `<tr><td class="sch-empty" colspan="${span}">Tidak ada karyawan yang cocok dengan filter.</td></tr>`;
        return;
    }
    // Jumlah karyawan per grup dihitung dari SEMUA hasil filter (bukan hanya halaman ini)
    const cntG = {}, cntC = {};
    S.list.forEach((e) => { cntG[e._sk] = (cntG[e._sk] || 0) + 1; const k = `${e._sk}|${e.costcenter_id ?? 0}`; cntC[k] = (cntC[k] || 0) + 1; });
    let html = '', pSk = null, pCc = null;
    slice.forEach((e) => {
        const cc = e.costcenter_id ?? 0;
        if (e._sk !== pSk) {
            html += `<tr class="sch-g1"><td colspan="${span}"><div class="sch-gt">${STATUS_LABEL[e._sk]}<small>${cntG[e._sk]} karyawan</small></div></td></tr>`;
            pSk = e._sk; pCc = null;
        }
        if (cc !== pCc) {
            html += `<tr class="sch-g2"><td colspan="${span}"><div class="sch-gt">Cost Center: ${esc(e.costcenter_name || 'Tanpa Cost Center')}<small>${cntC[`${e._sk}|${cc}`]} karyawan</small></div></td></tr>`;
            pCc = cc;
        }
        html += `<tr><td class="sch-stk"><div class="sch-nm">${esc(e.nama)}</div><div class="sch-sub">${esc(e.nik)} | ${esc(e.jabatan_name)}</div></td>` +
            days.map((d) => `<td class="sch-day">${chip((jd[e.employee_id] || {})[d])}</td>`).join('') + '</tr>';
    });
    $('tbody').innerHTML = html;
}
function renderPager(total, pages) {
    const a = (S.page - 1) * PAGE_SIZE;
    $('pager').innerHTML =
        `<span class="sch-pginfo">${total ? `Menampilkan ${a + 1}-${Math.min(a + PAGE_SIZE, total)} dari ${total} karyawan` : '0 karyawan'}</span>` +
        `<button class="pagination-btn" id="pgPrev" ${S.page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>` +
        `<button class="pagination-btn active" disabled>${S.page} / ${pages}</button>` +
        `<button class="pagination-btn" id="pgNext" ${S.page >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
    $('pgPrev').onclick = () => { S.page--; refresh(); };
    $('pgNext').onclick = () => { S.page++; refresh(); };
}
async function refresh() {
    const tk = ++S.tk; // penanda agar hasil request lama tidak menimpa yang baru
    S.list = S.employees.filter((e) => main.match(e) && matchQ(e, S.q));
    const pages = Math.max(1, Math.ceil(S.list.length / PAGE_SIZE));
    S.page = Math.min(S.page, pages);
    const a = (S.page - 1) * PAGE_SIZE;
    const slice = S.list.slice(a, a + PAGE_SIZE);
    renderHead();
    renderPager(S.list.length, pages);
    $('tbody').innerHTML = `<tr><td class="sch-empty" colspan="${listDays(S.start, S.end).length + 1}"><i class="fa-solid fa-spinner fa-spin"></i> Memuat jadwal...</td></tr>`;
    try {
        const jd = await fetchSchedule(slice.map((e) => e.employee_id), S.start, S.end);
        if (tk === S.tk) renderBody(slice, jd);
    } catch (err) {
        if (tk === S.tk) {
            $('tbody').innerHTML = `<tr><td class="sch-empty" style="color:#b42318">Gagal memuat jadwal: ${esc(err.message)}</td></tr>`;
            showError(`Gagal memuat jadwal: ${err.message}`);
        }
    }
}
function setRange(s, e) { S.start = s; S.end = e; $('dateText').textContent = `${fmt(s)} - ${fmt(e)}`; }

// ---------- 8. INISIALISASI ----------
document.addEventListener('DOMContentLoaded', async () => {
    // Tombol Kembali -> index.html (path sama dengan users.js)
    $('btnBack').addEventListener('click', () => { window.location.href = '../../index.html'; });
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeM(b.dataset.close)));

    if (!supabaseClient) { showError('window.supabaseClient tidak ditemukan. Periksa path ../../js/supabase.js di schedule.html.'); return; }

    setupCalendar();
    main = createFilterPanel($('filterWrap'), () => { S.page = 1; refresh(); });
    $('dateBox').onclick = () => openCalendar(S.start, S.end, (s, e) => { setRange(s, e); S.page = 1; refresh(); });
    let tmr;
    $('fSearch').addEventListener('input', (e) => {
        clearTimeout(tmr);
        tmr = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); S.page = 1; refresh(); }, 250);
    });

    // Periode awal: tanggal 1 sampai akhir bulan berjalan
    const now = new Date();
    setRange(iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));

    if (typeof initImport === 'function') initImport(); // dari schedule-import.js

    try {
        const [shifts, lim, emps] = await Promise.all([
            supabaseClient.rpc('jadwal_master_shift'),
            supabaseClient.rpc('jadwal_import_limit'),
            rpcAll('jadwal_karyawan_list'),
            loadReferenceData(),
        ]);
        if (shifts.error) throw shifts.error;
        (shifts.data || []).forEach((s) => { S.master.set(s.kode, s.jenis); S.masterUpper.set(s.kode.toUpperCase(), s.kode); });
        if (!lim.error && Number(lim.data) > 0) S.limit = Number(lim.data);
        S.employees = sortEmployees(emps);
        main.refresh();
        if (typeof updateImportUI === 'function') updateImportUI();
        await refresh();
    } catch (err) {
        $('tbody').innerHTML = '<tr><td class="sch-empty" style="color:#b42318">Gagal memuat data.</td></tr>';
        showError(`Gagal memuat data: ${err.message}. Pastikan schedule.sql sudah dijalankan dan role Anda diizinkan.`);
    }
});