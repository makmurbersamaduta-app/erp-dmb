// ===================================================
// time-off.js
// Halaman ERP "Cuti": tabel + Search + Filter + modal Cuti (khusus Maintenance/Superadmin).
// WAJIB: jalankan time-off.sql di Supabase terlebih dulu.
// Semua keputusan penting (siapa boleh, status langsung Disetujui) dilakukan SERVER
// (fungsi hrd.ajukan_cuti_admin). Pengecekan role di file ini hanya untuk
// menyembunyikan/menampilkan tombol.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN
// Fungsi: nilai tetap yang mudah diubah.
// ===================================================
const sb = (typeof supabaseClient !== "undefined") ? supabaseClient : window.supabaseClient;  // koneksi Supabase dari supabase.js
const ROLE_PENGELOLA = [1, 2];        // role yang boleh membuka form Cuti & Approve/Reject (1 = maintenance, 2 = superadmin)
const ROLE_LIHAT = [1, 2, 3];         // role yang boleh melihat halaman ini (3 = admin)
const PAGE_SIZE = 20;                 // jumlah baris per halaman
const KET_MAX = 200;                  // batas karakter Keterangan
const KET_WAJIB_CUTI = /sakit/i;      // Keterangan wajib jika nama jenis cuti mengandung kata "sakit"
const STATUS_LIST = ["Diajukan", "Koreksi", "Disetujui", "Ditolak"];   // pilihan filter Status

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ===================================================
const S = {
    roleId: null,
    ref: { branches: [], costcenters: [], departments: [], areas: [], structures: [] },   // structures = isi cost_center_structures
    filters: { branch_id: [], costcenter_id: [], dept_id: [], area_id: [], status: [], from: null, to: null },
    q: "", page: 1, total: 0, rows: [], loadReq: 0,
    cal: { y: 0, m: 0, start: null, end: null },     // kalender filter tanggal (sebelum "Terapkan")
    form: { emp: null, jenis: [], saving: false }    // emp = karyawan terpilih, jenis = daftar jenis cuti karyawan itu
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU
// ===================================================
const $ = (id) => document.getElementById(id);
const hrd = () => sb.schema("hrd");

function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;                       // m = 0-11
function todayLocal() { const t = new Date(); return ymd(t.getFullYear(), t.getMonth(), t.getDate()); }
function fmtTgl(s) {                                                            // "2026-11-09" -> "09 Nov 2026"
    if (!s) return "-";
    const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
    return `${pad(d)} ${BULAN[m - 1]} ${y}`;
}
function toMenit(hhmm) { const [h, m] = String(hhmm || "00:00").split(":").map(Number); return h * 60 + m; }
function fmtMenit(m) {                                                          // 150 -> "2j 30m"
    if (!m) return "-";
    const h = Math.floor(m / 60), r = m % 60;
    return (h ? `${h}j ` : "") + (r ? `${r}m` : "").trim();
}
function shiftText(s) {
    if (!s) return "Tidak ada jadwal";
    return s.jam_masuk ? `${s.nama_shift} (${s.jam_masuk} - ${s.jam_pulang})` : String(s.nama_shift || s.kode_shift);
}
function showToast(text, type = "success") {
    const el = document.createElement("div");
    el.className = `toast align-items-center text-bg-${type === "success" ? "success" : "danger"} border-0`;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(text)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    $("toastContainer").appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 4000 });
    el.addEventListener("hidden.bs.toast", () => el.remove());
    t.show();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Membaca role dari erp_session (disimpan oleh auth.js). Mengembalikan angka atau null.
function getRoleId() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try {
        const n = Number(JSON.parse(raw).roleId);
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}
const isPengelola = () => ROLE_PENGELOLA.includes(S.roleId);

// ===================================================
// KELOMPOK 4: DATA REFERENSI (isi pilihan filter)
// ===================================================
async function loadReference() {
    const [br, cc, dp, ar] = await Promise.all([
        sb.from("branches").select("id, branch_name").eq("is_active", true).order("branch_name"),
        sb.from("cost_centers").select("id, costcenter_name, branch_id").eq("is_active", true).order("costcenter_name"),
        sb.from("departments").select("id, department_name").eq("is_active", true).order("department_name"),
        sb.from("areas").select("id, area_name, branch_id").eq("is_active", true).order("area_name")
    ]);
    S.ref.branches = br.data || [];
    S.ref.costcenters = cc.data || [];
    S.ref.departments = dp.data || [];
    S.ref.areas = ar.data || [];
    S.ref.structures = await fetchAllStructures();
}

// Ambil SEMUA baris struktur cost center (Supabase membatasi 1 request = 1000 baris).
// Dipakai untuk filter berantai di panel Filter (sama seperti halaman Users).
async function fetchAllStructures() {
    const all = [];
    let from = 0;
    while (true) {
        const { data, error } = await sb.from("cost_center_structures")
            .select("cost_center_id, area_id, dept_id")
            .order("id", { ascending: true }).range(from, from + 999);
        if (error) { console.error("Gagal mengambil cost_center_structures:", error); break; }
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
    }
    return all;
}

// ===================================================
// KELOMPOK 5: FILTER (checkbox + kalender rentang tanggal)
// ===================================================
function renderCheckGroup(elId, items, valueKey, labelKey, checked) {
    $(elId).innerHTML = items.map(it => `
        <label class="filter-checkbox-item">
            <input type="checkbox" value="${esc(it[valueKey])}" ${checked.includes(String(it[valueKey])) ? "checked" : ""}>
            <span>${esc(it[labelKey])}</span>
        </label>`).join("") || `<span class="data-empty-cell">Tidak ada data</span>`;
}
const checkedValues = (elId) => Array.from($(elId).querySelectorAll("input:checked")).map(i => i.value);

function buildFilterPanel() {
    const f = S.filters;
    renderCheckGroup("filterBranch", S.ref.branches, "id", "branch_name", f.branch_id.map(String));
    renderCheckGroup("filterStatus", STATUS_LIST.map(s => ({ id: s, nama: s })), "id", "nama", f.status);
    // Kelompok berantai dikosongkan dulu supaya centang lama tidak ikut terbawa (mis. saat Reset)
    CASCADE_GROUPS.slice(1).forEach(g => { $(g.id).innerHTML = ""; });
    refreshFilterCascade(0);
    S.cal.start = f.from; S.cal.end = f.to;
    const base = f.from ? new Date(f.from) : new Date();
    S.cal.y = base.getFullYear(); S.cal.m = base.getMonth();
    renderCalendar();
}

// Alur filter berantai (sama dengan halaman Users): Cabang -> Cost Center -> Area -> Departemen.
// Tanpa centang di induk = daftar anak tidak dibatasi oleh induk itu. Beberapa induk dicentang = gabungan.
// Area dan Departemen mengikuti tabel cost_center_structures.
const CASCADE_GROUPS = [
    { id: "filterBranch" },
    { id: "filterCostCenter", list: () => S.ref.costcenters, idField: "id", nameField: "costcenter_name" },
    { id: "filterArea", list: () => S.ref.areas, idField: "id", nameField: "area_name" },
    { id: "filterDepartemen", list: () => S.ref.departments, idField: "id", nameField: "department_name" }
];

// changedLevel = indeks kelompok yang baru diubah user; hanya kelompok DI BAWAHNYA yang digambar ulang.
// Centang anak yang masih valid dipertahankan, yang tidak valid hilang.
function refreshFilterCascade(changedLevel) {
    const idsOf = (rows, f) => new Set(rows.map(r => String(r[f])));
    const prev = CASCADE_GROUPS.map(g => checkedValues(g.id));      // dibaca SEBELUM ada yang digambar ulang
    const draw = (level, list) => {
        if (level <= changedLevel) return;
        const g = CASCADE_GROUPS[level];
        renderCheckGroup(g.id, list, g.idField, g.nameField, prev[level]);
    };
    const now = level => (level <= changedLevel ? prev[level] : checkedValues(CASCADE_GROUPS[level].id));

    // 1. Cost Center <- Cabang (cost_centers.branch_id)
    const brSel = prev[0];
    const ccList = brSel.length ? S.ref.costcenters.filter(c => brSel.includes(String(c.branch_id))) : S.ref.costcenters;
    draw(1, ccList);
    const ccNow = now(1);
    const ccSet = ccNow.length ? ccNow : (brSel.length ? ccList.map(c => String(c.id)) : null);

    // 2. Area <- Cost Center (cost_center_structures; satu area tampil sekali)
    let rows = S.ref.structures;
    if (ccSet) rows = rows.filter(r => ccSet.includes(String(r.cost_center_id)));
    const areaIds = idsOf(rows, "area_id");
    draw(2, ccSet ? S.ref.areas.filter(a => areaIds.has(String(a.id))) : S.ref.areas);
    const areaNow = now(2);
    if (areaNow.length) rows = rows.filter(r => areaNow.includes(String(r.area_id)));

    // 3. Departemen <- Cost Center + Area
    const deptLimited = !!ccSet || areaNow.length > 0;
    const deptIds = idsOf(rows, "dept_id");
    draw(3, deptLimited ? S.ref.departments.filter(d => deptIds.has(String(d.id))) : S.ref.departments);
}

// Kalender: klik pertama = tanggal awal, klik kedua = tanggal akhir.
// Tanggal di antaranya diberi pita (garis) warna.
function renderCalendar() {
    const { y, m, start, end } = S.cal;
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;      // minggu dimulai Senin
    const days = new Date(y, m + 1, 0).getDate();
    let cells = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < offset; i++) cells += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= days; d++) {
        const key = ymd(y, m, d);
        let cls = "cal-day";
        if (start && key === start) cls += " range-start";
        if (end && key === end) cls += " range-end";
        if (start && end && key > start && key < end) cls += " in-range";
        if (start && !end && key === start) cls += " range-end";   // satu tanggal terpilih: tampil bulat
        cells += `<div class="${cls}" data-date="${key}">${d}</div>`;
    }
    const info = start ? (end ? `${fmtTgl(start)} - ${fmtTgl(end)}` : `${fmtTgl(start)} (pilih tanggal akhir)`) : "Pilih tanggal awal lalu tanggal akhir";
    $("filterTanggal").innerHTML = `
        <div class="cal">
            <div class="cal-head">
                <button type="button" class="cal-nav" data-nav="-1"><i class="fa-solid fa-chevron-left"></i></button>
                <span>${BULAN_PANJANG[m]} ${y}</span>
                <button type="button" class="cal-nav" data-nav="1"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="cal-grid">${cells}</div>
            <div class="cal-info">${info}</div>
        </div>`;
}
function onCalendarClick(e) {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
        S.cal.m += Number(nav.dataset.nav);
        if (S.cal.m < 0) { S.cal.m = 11; S.cal.y--; } else if (S.cal.m > 11) { S.cal.m = 0; S.cal.y++; }
        renderCalendar(); return;
    }
    const cell = e.target.closest(".cal-day[data-date]");
    if (!cell) return;
    const d = cell.dataset.date;
    if (!S.cal.start || (S.cal.start && S.cal.end)) { S.cal.start = d; S.cal.end = null; }     // mulai rentang baru
    else if (d < S.cal.start) { S.cal.end = S.cal.start; S.cal.start = d; }                    // klik mundur: tukar
    else { S.cal.end = d; }
    renderCalendar();
}

function countActiveFilters() {
    const f = S.filters;
    return f.branch_id.length + f.costcenter_id.length + f.dept_id.length + f.area_id.length + f.status.length + (f.from ? 1 : 0);
}
function updateFilterBadge() {
    const n = countActiveFilters();
    $("filterCountBadge").textContent = n;
    $("filterCountBadge").classList.toggle("d-none", n === 0);
}
function applyFilters() {
    S.filters = {
        branch_id: checkedValues("filterBranch").map(Number),
        costcenter_id: checkedValues("filterCostCenter").map(Number),
        dept_id: checkedValues("filterDepartemen").map(Number),
        area_id: checkedValues("filterArea").map(Number),
        status: checkedValues("filterStatus"),
        from: S.cal.start || null,
        to: S.cal.start ? (S.cal.end || S.cal.start) : null      // satu tanggal saja = rentang 1 hari
    };
    S.page = 1;
    updateFilterBadge();
    $("filterPanel").classList.add("d-none");
    loadTable();
}
function resetFilters() {
    S.filters = { branch_id: [], costcenter_id: [], dept_id: [], area_id: [], status: [], from: null, to: null };
    buildFilterPanel(); updateFilterBadge(); S.page = 1; loadTable();
}

// ===================================================
// KELOMPOK 6: TABEL (muat data dari server, tampilkan, halaman)
// ===================================================
// Jumlah hari kalender antara dua tanggal, termasuk hari awal dan akhir ("2026-11-10" s.d. "2026-11-12" = 3)
function jumlahHari(a, b) {
    const utc = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((utc(b) - utc(a)) / 86400000) + 1;
}
// "10 Nov 2026 s.d. 12 Nov 2026 (3 Hari)"
const fmtRentangCuti = (a, b) => `${fmtTgl(a)} s.d. ${fmtTgl(b)} (${jumlahHari(a, b)} Hari)`;

async function loadTable() {
    const my = ++S.loadReq;
    $("cutiTableBody").innerHTML = `<tr class="row-loading"><td colspan="8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    const f = S.filters;
    const { data, error } = await hrd().rpc("cuti_daftar", { p: {
        q: S.q, branch_id: f.branch_id, costcenter_id: f.costcenter_id, dept_id: f.dept_id,
        area_id: f.area_id, status: f.status, from: f.from, to: f.to,
        limit: PAGE_SIZE, offset: (S.page - 1) * PAGE_SIZE } });
    if (my !== S.loadReq) return;            // ada permintaan yang lebih baru, abaikan yang ini
    if (error) {
        $("cutiTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data: ${esc(error.message)}</td></tr>`;
        return;
    }
    S.rows = data.rows || []; S.total = data.total || 0;
    renderTable(); renderPagination();
}

function renderTable() {
    if (!S.rows.length) {
        $("cutiTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">Tidak ada data cuti.</td></tr>`;
        return;
    }
    $("cutiTableBody").innerHTML = S.rows.map(r => {
        const bisaPutus = isPengelola() && r.status === "Diajukan" && r.approval_id;
        return `<tr>
            <td class="sticky-left"><strong>${esc(r.nama)}</strong><span class="ot-sub">${esc(r.nik)} | ${esc(r.jabatan || "-")}</span></td>
            <td>${fmtTgl(r.tgl_pengajuan)}</td>
            <td>${esc(r.departemen || "-")}</td>
            <td>${esc(r.area || "-")}</td>
            <td>${esc(r.jenis_cuti)}</td>
            <td>${fmtRentangCuti(r.start_date, r.end_date)}</td>
            <td><span class="badge-status badge-${esc(r.status)}">${esc(r.status)}</span></td>
            <td class="sticky-right">
                <button class="btn-aksi" data-act="detail" data-id="${r.id}">Detail</button>
                ${bisaPutus ? `<button class="btn-aksi approve" data-act="approve" data-ap="${esc(r.approval_id)}">Approve</button>
                              <button class="btn-aksi reject" data-act="reject" data-ap="${esc(r.approval_id)}">Reject</button>` : ""}
            </td></tr>`;
    }).join("");
}

function renderPagination() {
    const pages = Math.max(1, Math.ceil(S.total / PAGE_SIZE));
    const btn = (label, p, dis, act) => `<button class="pagination-btn ${act ? "active" : ""}" data-page="${p}" ${dis ? "disabled" : ""}>${label}</button>`;
    let html = btn("&lsaquo;", S.page - 1, S.page <= 1);
    const from = Math.max(1, S.page - 2), to = Math.min(pages, S.page + 2);
    for (let p = from; p <= to; p++) html += btn(p, p, false, p === S.page);
    html += btn("&rsaquo;", S.page + 1, S.page >= pages);
    $("cutiPagination").innerHTML = html + `<span style="margin-left:12px;font-size:13px;color:var(--users-text-muted)">${S.total} data</span>`;
}

// ===================================================
// KELOMPOK 7: MODAL DETAIL (read-only)
// ===================================================
async function openDetail(id) {
    $("detailBody").innerHTML = `<div class="text-center p-4"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    bootstrap.Modal.getOrCreateInstance($("modalDetail")).show();
    const { data: d, error } = await hrd().rpc("cuti_detail", { p_id: id });
    if (error) { $("detailBody").innerHTML = `<div class="ot-msg">${esc(error.message)}</div>`; return; }

    const rows = [
        ["Karyawan", `${d.nama} (${d.nik})`],
        ["Tanggal Pengajuan", fmtTgl(d.tgl_pengajuan)],
        ["Departemen", d.departemen || "-"],
        ["Area", d.area || "-"],
        ["Jenis Cuti", d.jenis_cuti],
        ["Tanggal Cuti", fmtRentangCuti(d.start_date, d.end_date)],
        ["Keterangan", d.keterangan || "-"],
        ["Sumber", d.source],
        ["Status", `<span class="badge-status badge-${esc(d.status)}">${esc(d.status)}</span>`, true],
        d.catatan ? ["Catatan Approver", d.catatan] : null
    ].filter(Boolean);
    let html = rows.map(([k, v, raw]) => `<div class="dt-row"><div class="k">${k}</div><div class="v">${raw ? v : esc(v)}</div></div>`).join("");
    if (d.attachment) html += `<div class="dt-row"><div class="k">Lampiran</div><div class="v"><a href="#" id="lnkLampiran" data-path="${esc(d.attachment)}">Buka lampiran</a></div></div>`;
    $("detailBody").innerHTML = html;
}
async function openLampiran(path) {
    const { data, error } = await sb.storage.from("hrd").createSignedUrl(path, 120);
    if (error) { showToast("Gagal membuka lampiran: " + error.message, "danger"); return; }
    window.open(data.signedUrl, "_blank");
}

// ===================================================
// KELOMPOK 8: APPROVE / REJECT (memakai fungsi pusat public.approval_decide)
// ===================================================
async function decide(approvalId, action, note) {
    const { error } = await sb.rpc("approval_decide", { p_approval_id: approvalId, p_action: action, p_note: note || null });
    if (error) { showToast(error.message, "danger"); return false; }
    showToast(action === "Disetujui" ? "Cuti disetujui." : "Cuti ditolak.");
    loadTable();
    return true;
}
let rejectTarget = null;
function openReject(approvalId) {
    rejectTarget = approvalId;
    $("rejectNote").value = "";
    bootstrap.Modal.getOrCreateInstance($("modalReject")).show();
}

// ===================================================
// KELOMPOK 9: MODAL FORM CUTI (khusus Maintenance/Superadmin)
// Urutan isian: Tanggal Mulai & Akhir -> Karyawan -> Jenis Cuti -> Keterangan.
// Karyawan dicari berdasarkan periode tanggal (PKWT/PKWTT yang aktif pada periode itu),
// Jenis Cuti mengikuti cost center karyawan terpilih. Tidak ada lampiran.
// ===================================================
// Kolom pencarian karyawan. Tampilan pilihan: "Nama" lalu "NIK | Area".
function makeEmpCombo(boxId, onPick) {
    const box = $(boxId);
    box.innerHTML = `<div class="combo">
        <input type="text" class="form-control" autocomplete="off" placeholder="Ketik nama atau NIK...">
        <div class="combo-list d-none"></div></div>`;
    const input = box.querySelector("input"), list = box.querySelector(".combo-list");
    let req = 0;
    const search = debounce(async () => {
        const my = ++req;
        list.classList.remove("d-none");
        list.innerHTML = `<div class="combo-empty">Mencari...</div>`;
        const { data, error } = await hrd().rpc("cuti_cari_karyawan", { p: { mulai: $("fMulai").value, akhir: $("fAkhir").value, q: input.value } });
        if (my !== req) return;
        if (error) { list.innerHTML = `<div class="combo-empty">${esc(error.message)}</div>`; return; }
        list.innerHTML = data.length ? data.map(k => `<div class="combo-item" data-k='${esc(JSON.stringify(k))}'>
            <div class="nm">${esc(k.nama)}</div><div class="sb">${esc(k.nik)} | ${esc(k.area || "-")}</div></div>`).join("")
            : `<div class="combo-empty">Tidak ada karyawan yang sesuai.</div>`;
    }, 250);
    input.addEventListener("focus", search);
    input.addEventListener("input", () => { onPick(null); search(); });   // mengetik ulang = batalkan pilihan
    list.addEventListener("mousedown", (e) => {
        const it = e.target.closest(".combo-item"); if (!it) return;
        const k = JSON.parse(it.dataset.k);
        input.value = `${k.nama} (${k.nik})`;
        list.classList.add("d-none");
        onPick(k);
    });
    input.addEventListener("blur", () => setTimeout(() => list.classList.add("d-none"), 150));
}

function formMsg(text) {
    const el = $("fMsg");
    el.textContent = text || ""; el.classList.toggle("d-none", !text);
    if (text) $("formBody").scrollTop = 0;
}

function pasangCombo() {
    makeEmpCombo("fEmpBox", (k) => { S.form.emp = k; loadJenis(); });
}

function openForm() {
    S.form = { emp: null, jenis: [], saving: false };
    $("formBody").innerHTML = `
        <div id="fMsg" class="ot-msg d-none"></div>
        <div class="row g-2 mb-1">
            <div class="col-6"><label class="form-label" for="fMulai">Tanggal Mulai <span class="req">*</span></label>
                <input type="date" class="form-control" id="fMulai" value="${todayLocal()}"></div>
            <div class="col-6"><label class="form-label" for="fAkhir">Tanggal Akhir <span class="req">*</span></label>
                <input type="date" class="form-control" id="fAkhir" value="${todayLocal()}"></div>
        </div>
        <div class="ot-hint mb-3" id="fHari"></div>
        <div class="mb-3"><label class="form-label">Karyawan <span class="req">*</span></label><div id="fEmpBox"></div>
            <div class="ot-hint">Hanya karyawan PKWT/PKWTT yang aktif pada periode cuti.</div></div>
        <div class="mb-3"><label class="form-label" for="fJenis">Jenis Cuti <span class="req">*</span></label>
            <select class="form-select" id="fJenis" disabled><option value="">Pilih karyawan dulu</option></select></div>
        <div class="mb-2"><label class="form-label" for="fKet">Keterangan <span class="req d-none" id="fKetWajib">*</span></label>
            <textarea class="form-control" id="fKet" rows="2" maxlength="${KET_MAX}"></textarea>
            <div class="ot-hint" id="fKetCnt">0/${KET_MAX}</div></div>`;

    pasangCombo();
    const onTanggal = () => {                       // ganti tanggal: pilihan karyawan dan jenis cuti harus diulang
        if ($("fAkhir").value < $("fMulai").value) $("fAkhir").value = $("fMulai").value;
        S.form.emp = null; S.form.jenis = [];
        pasangCombo(); resetJenis(); updateHari();
    };
    $("fMulai").addEventListener("change", onTanggal);
    $("fAkhir").addEventListener("change", onTanggal);
    $("fJenis").addEventListener("change", updateKetWajib);
    $("fKet").addEventListener("input", () => { $("fKetCnt").textContent = `${$("fKet").value.length}/${KET_MAX}`; });
    updateHari();
    bootstrap.Modal.getOrCreateInstance($("modalCuti")).show();
}

function updateHari() {
    const a = $("fMulai").value, b = $("fAkhir").value;
    $("fHari").textContent = (a && b && b >= a) ? `Lama cuti: ${jumlahHari(a, b)} hari kalender` : "";
}
function resetJenis() {
    $("fJenis").innerHTML = `<option value="">Pilih karyawan dulu</option>`; $("fJenis").disabled = true; updateKetWajib();
}
// Tanda * pada Keterangan muncul jika jenis cuti yang dipilih mengandung kata "sakit"
function updateKetWajib() {
    const j = S.form.jenis.find(x => String(x.id) === $("fJenis").value);
    $("fKetWajib").classList.toggle("d-none", !(j && KET_WAJIB_CUTI.test(j.nama)));
}

// Setelah karyawan dipilih: ambil jenis cuti yang berlaku untuk cost center karyawan itu
async function loadJenis() {
    S.form.jenis = [];
    if (!S.form.emp) { resetJenis(); return; }
    $("fJenis").innerHTML = `<option value="">Memuat...</option>`; $("fJenis").disabled = true;
    const emp = S.form.emp;
    const { data, error } = await hrd().rpc("cuti_jenis", { p_emp: emp.id, p_mulai: $("fMulai").value, p_akhir: $("fAkhir").value });
    if (S.form.emp !== emp) return;                  // karyawan sudah diganti, abaikan hasil ini
    if (error) { resetJenis(); formMsg("Gagal memuat jenis cuti: " + error.message); return; }
    S.form.jenis = data || [];
    $("fJenis").innerHTML = S.form.jenis.length
        ? `<option value="">Pilih Jenis Cuti</option>` + S.form.jenis.map(j => `<option value="${j.id}">${esc(j.nama)}</option>`).join("")
        : `<option value="">Tidak ada jenis cuti untuk karyawan ini</option>`;
    $("fJenis").disabled = !S.form.jenis.length;
}

// Mengumpulkan dan memeriksa isian form. Melempar Error berisi pesan jika ada yang salah.
// (Server memeriksa ulang semuanya; pemeriksaan di sini hanya agar pesan cepat muncul.)
function collectForm() {
    const a = $("fMulai").value, b = $("fAkhir").value;
    if (!a || !b) throw new Error("Tanggal cuti wajib dipilih.");
    if (b < a) throw new Error("Tanggal akhir tidak boleh sebelum tanggal awal.");
    if (!S.form.emp) throw new Error("Pilih karyawan yang cuti dari daftar.");
    const jenisId = $("fJenis").value;
    if (!jenisId) throw new Error("Pilih jenis cuti.");
    const j = S.form.jenis.find(x => String(x.id) === jenisId);
    const ket = $("fKet").value.trim();
    if (j && KET_WAJIB_CUTI.test(j.nama) && !ket) throw new Error(`Keterangan wajib diisi untuk cuti "${j.nama}".`);
    return { employee_id: S.form.emp.id, time_off_id: Number(jenisId), start_date: a, end_date: b, keterangan: ket || null };
}

async function simpanCuti() {
    if (S.form.saving) return;
    formMsg("");
    let payload;
    try { payload = collectForm(); } catch (err) { formMsg(err.message); return; }
    S.form.saving = true;
    const btn = $("btnSimpanCuti");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;
    const { data, error } = await hrd().rpc("ajukan_cuti_admin", { p: payload });
    S.form.saving = false; btn.disabled = false; btn.textContent = "Simpan";
    if (error) { formMsg(error.message); return; }
    bootstrap.Modal.getInstance($("modalCuti")).hide();
    showToast(`Cuti tersimpan (${data.status}).`);
    S.page = 1; loadTable();
}

// ===================================================
// KELOMPOK 10: INISIALISASI
// Memeriksa login & role, memasang semua tombol, lalu memuat data.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    S.roleId = getRoleId();
    if (!ROLE_LIHAT.includes(S.roleId)) {
        $("cutiTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">Anda tidak memiliki akses ke halaman ini.</td></tr>`;
        return;
    }
    $("btnCuti").classList.toggle("d-none", !isPengelola());     // tombol Cuti hanya untuk role 1 & 2

    $("btnBack").addEventListener("click", () => history.back());
    $("btnCuti").addEventListener("click", openForm);
    $("btnSimpanCuti").addEventListener("click", simpanCuti);
    $("inputSearch").addEventListener("input", debounce((e) => { S.q = e.target.value.trim(); S.page = 1; loadTable(); }, 350));

    // Filter: buka/tutup panel, grup lipat, kalender, terapkan, reset
    $("btnFilterToggle").addEventListener("click", () => $("filterPanel").classList.toggle("d-none"));
    // Tutup panel hanya jika klik terjadi DI LUAR panel. Memakai composedPath() (jalur elemen saat klik terjadi)
    // karena kalender digambar ulang setiap klik tanggal: elemen yang diklik sudah terlepas dari halaman
    // saat pengecekan ini berjalan, sehingga closest() salah mengira klik itu di luar panel.
    document.addEventListener("click", (e) => {
        const wrapper = document.querySelector(".users-filter-wrapper");
        if (!e.composedPath().includes(wrapper)) $("filterPanel").classList.add("d-none");
    });
    $("filterPanel").addEventListener("click", (e) => {
        const head = e.target.closest(".filter-group-header");
        if (head) { head.classList.toggle("expanded"); $(head.dataset.target).classList.toggle("expanded"); }
    });
    $("filterTanggal").addEventListener("click", onCalendarClick);
    // Setiap centang di Cabang/Cost Center/Area memperbarui daftar di bawahnya
    CASCADE_GROUPS.slice(0, 3).forEach((g, level) => {
        $(g.id).addEventListener("change", () => refreshFilterCascade(level));
    });
    $("btnFilterApply").addEventListener("click", applyFilters);
    $("btnFilterReset").addEventListener("click", resetFilters);

    // Tabel: tombol aksi (Detail / Approve / Reject) dan halaman
    $("cutiTableBody").addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]"); if (!b) return;
        if (b.dataset.act === "detail") openDetail(b.dataset.id);
        else if (b.dataset.act === "approve") { if (confirm("Setujui cuti ini?")) decide(b.dataset.ap, "Disetujui"); }
        else if (b.dataset.act === "reject") openReject(b.dataset.ap);
    });
    $("cutiPagination").addEventListener("click", (e) => {
        const b = e.target.closest("[data-page]"); if (!b || b.disabled) return;
        S.page = Number(b.dataset.page); loadTable();
    });
    $("detailBody").addEventListener("click", (e) => {
        const a = e.target.closest("#lnkLampiran"); if (!a) return;
        e.preventDefault(); openLampiran(a.dataset.path);
    });
    $("btnKonfirmasiReject").addEventListener("click", async () => {
        const note = $("rejectNote").value.trim();
        if (!note) { showToast("Alasan penolakan wajib diisi.", "danger"); return; }
        if (await decide(rejectTarget, "Ditolak", note)) bootstrap.Modal.getInstance($("modalReject")).hide();
    });

    await loadReference();
    buildFilterPanel();
    loadTable();
});