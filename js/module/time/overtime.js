// ===================================================
// overtime.js
// Halaman ERP "Lembur": tabel + Search + Filter + modal Lembur (khusus Maintenance/Superadmin).
// WAJIB: jalankan overtime.sql di Supabase terlebih dulu.
// Semua keputusan penting (siapa boleh, status langsung Disetujui) dilakukan SERVER
// (fungsi hrd.ajukan_lembur_admin). Pengecekan role di file ini hanya untuk
// menyembunyikan/menampilkan tombol.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN
// Fungsi: nilai tetap yang mudah diubah.
// ===================================================
const sb = (typeof supabaseClient !== "undefined") ? supabaseClient : window.supabaseClient;  // koneksi Supabase dari supabase.js
const ROLE_PENGELOLA = [1, 2];        // role yang boleh membuka form Lembur & Approve/Reject (1 = maintenance, 2 = superadmin)
const ROLE_LIHAT = [1, 2, 3];         // role yang boleh melihat halaman ini (3 = admin)
const PAGE_SIZE = 20;                 // jumlah baris per halaman
const KET_MAX = 200;                  // batas karakter Keterangan
const OT_TIPE = ["Pengganti", "Casual", "Overtime"];   // pilihan Jenis Lembur
const OT_MAX_MENIT = 12 * 60;         // durasi lembur maksimum
const BREAK_MAX_MENIT = 3 * 60;       // durasi istirahat maksimum
const STATUS_LIST = ["Diajukan", "Koreksi", "Disetujui", "Ditolak"];   // pilihan filter Status

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ===================================================
const S = {
    roleId: null,
    ref: { branches: [], costcenters: [], departments: [], areas: [], structures: [] },   // structures = isi cost_center_structures (cost_center_id, area_id, dept_id)   // data pilihan filter
    filters: { branch_id: [], costcenter_id: [], dept_id: [], area_id: [], status: [], from: null, to: null },
    q: "", page: 1, total: 0, rows: [], loadReq: 0,
    cal: { y: 0, m: 0, start: null, end: null },     // kalender filter tanggal (sebelum "Terapkan")
    form: { emp: null, pengganti: null, shift: null, struct: [], saving: false }
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
async function loadTable() {
    const my = ++S.loadReq;
    $("otTableBody").innerHTML = `<tr class="row-loading"><td colspan="9"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    const f = S.filters;
    const { data, error } = await hrd().rpc("overtime_daftar", { p: {
        q: S.q, branch_id: f.branch_id, costcenter_id: f.costcenter_id, dept_id: f.dept_id,
        area_id: f.area_id, status: f.status, from: f.from, to: f.to,
        limit: PAGE_SIZE, offset: (S.page - 1) * PAGE_SIZE } });
    if (my !== S.loadReq) return;            // ada permintaan yang lebih baru, abaikan yang ini
    if (error) {
        $("otTableBody").innerHTML = `<tr class="row-empty"><td colspan="9">Gagal memuat data: ${esc(error.message)}</td></tr>`;
        return;
    }
    S.rows = data.rows || []; S.total = data.total || 0;
    renderTable(); renderPagination();
}

function renderTable() {
    if (!S.rows.length) {
        $("otTableBody").innerHTML = `<tr class="row-empty"><td colspan="9">Tidak ada data lembur.</td></tr>`;
        return;
    }
    $("otTableBody").innerHTML = S.rows.map(r => {
        const total = (r.menit_sebelum || 0) + (r.menit_sesudah || 0);
        const bisaPutus = isPengelola() && r.status === "Diajukan" && r.approval_id;
        return `<tr>
            <td class="sticky-left"><strong>${esc(r.nama)}</strong><span class="ot-sub">${esc(r.nik)} | ${esc(r.jabatan || "-")}</span></td>
            <td>${fmtTgl(r.tanggal)}</td>
            <td>${esc(r.departemen || "-")}</td>
            <td>${esc(r.area || "-")}</td>
            <td class="ot-num">${fmtMenit(r.menit_sebelum)}</td>
            <td class="ot-num">${fmtMenit(r.menit_sesudah)}</td>
            <td class="ot-num"><strong>${fmtMenit(total)}</strong></td>
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
    $("otPagination").innerHTML = html + `<span style="margin-left:12px;font-size:13px;color:var(--users-text-muted)">${S.total} data</span>`;
}

// ===================================================
// KELOMPOK 7: MODAL DETAIL (read-only)
// ===================================================
async function openDetail(id) {
    $("detailBody").innerHTML = `<div class="text-center p-4"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    bootstrap.Modal.getOrCreateInstance($("modalDetail")).show();
    const { data: d, error } = await hrd().rpc("overtime_detail", { p_id: id });
    if (error) { $("detailBody").innerHTML = `<div class="ot-msg">${esc(error.message)}</div>`; return; }

    const hm = (o, b) => (o && o !== "00:00") ? `${o} (istirahat ${b || "00:00"})` : "-";
    const rows = [
        ["Karyawan", `${d.nama} (${d.nik})`],
        ["Tanggal", fmtTgl(d.tanggal)],
        ["Departemen", d.departemen || "-"],
        ["Area", d.area || "-"],
        ["Shift", shiftText(d.shift)],
        ["Jenis Lembur", d.type_ot],
        d.type_ot === "Pengganti" ? ["Menggantikan", d.menggantikan || "-"] : null,
        d.type_ot === "Casual" ? ["Mitra", d.mitra || "-"] : null,
        d.type_ot === "Casual" ? ["Area Casual", d.area_casual || "-"] : null,
        ["Lembur Sebelum Shift", hm(d.ot_before, d.break_before)],
        ["Lembur Setelah Shift", hm(d.ot_after, d.break_after)],
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
    showToast(action === "Disetujui" ? "Lembur disetujui." : "Lembur ditolak.");
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
// KELOMPOK 9: MODAL FORM LEMBUR (khusus Maintenance/Superadmin)
// ===================================================
// Kolom pencarian karyawan. getParams() mengembalikan parameter tambahan untuk server;
// onPick(karyawan) dipanggil saat satu karyawan dipilih. Tampilan pilihan: "Nama" lalu "NIK | Area".
function makeCombo(boxId, getParams, onPick) {
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
        const { data, error } = await hrd().rpc("overtime_cari_karyawan", { p: { tanggal: $("fTgl").value, q: input.value, ...getParams() } });
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

function durasiBox(title, idOt, idBrk) {
    return `<div class="ot-subhead">${title}</div>
        <div class="row g-2">
            <div class="col-6"><label class="form-label" for="${idOt}">Durasi Lembur</label>
                <input type="time" step="900" class="form-control" id="${idOt}" value="00:00"></div>
            <div class="col-6"><label class="form-label" for="${idBrk}">Istirahat</label>
                <input type="time" step="900" class="form-control" id="${idBrk}" value="00:00"></div>
        </div>`;
}

function openForm() {
    S.form = { emp: null, pengganti: null, shift: null, struct: [], saving: false };
    $("formBody").innerHTML = `
        <div id="fMsg" class="ot-msg d-none"></div>
        <div class="mb-3"><label class="form-label" for="fTgl">Tanggal Lembur <span class="req">*</span></label>
            <input type="date" class="form-control" id="fTgl" value="${todayLocal()}"></div>
        <div class="mb-3"><label class="form-label">Karyawan <span class="req">*</span></label><div id="fEmpBox"></div>
            <div class="ot-hint">Hanya karyawan PKWT/PKWTT yang aktif pada tanggal lembur.</div></div>
        <div class="mb-3"><label class="form-label" for="fShift">Shift</label>
            <input type="text" class="form-control" id="fShift" value="-" readonly></div>
        <div class="mb-3"><label class="form-label" for="fTipe">Jenis Lembur <span class="req">*</span></label>
            <select class="form-select" id="fTipe">${OT_TIPE.map(t => `<option value="${t}">${t}</option>`).join("")}</select></div>
        <div id="fTipeExtra"></div>
        ${durasiBox("Lembur Sebelum Shift", "fObOt", "fObBrk")}
        ${durasiBox("Lembur Setelah Shift", "fOaOt", "fOaBrk")}
        <div class="ot-subhead">Informasi Tambahan</div>
        <div class="mb-2"><label class="form-label" for="fKet">Keterangan</label>
            <textarea class="form-control" id="fKet" rows="2" maxlength="${KET_MAX}"></textarea>
            <div class="ot-hint" id="fKetCnt">0/${KET_MAX}</div></div>`;

    makeCombo("fEmpBox", () => ({}), (k) => { S.form.emp = k; S.form.pengganti = null; renderTipeExtra(); loadShift(); });
    $("fTgl").addEventListener("change", () => {          // ganti tanggal: pilihan karyawan harus diulang
        S.form.emp = null; S.form.pengganti = null;
        makeCombo("fEmpBox", () => ({}), (k) => { S.form.emp = k; S.form.pengganti = null; renderTipeExtra(); loadShift(); });
        renderTipeExtra(); loadShift();
    });
    $("fTipe").addEventListener("change", renderTipeExtra);
    $("fKet").addEventListener("input", () => { $("fKetCnt").textContent = `${$("fKet").value.length}/${KET_MAX}`; });
    renderTipeExtra();
    bootstrap.Modal.getOrCreateInstance($("modalLembur")).show();
}

function formMsg(text) {
    const el = $("fMsg");
    el.textContent = text || ""; el.classList.toggle("d-none", !text);
    if (text) $("formBody").scrollTop = 0;
}

async function loadShift() {
    S.form.shift = null;
    if (!S.form.emp) { $("fShift").value = "-"; return; }
    $("fShift").value = "Memuat...";
    const { data, error } = await hrd().rpc("overtime_info", { p_emp: S.form.emp.id, p_tanggal: $("fTgl").value });
    if (!S.form.emp) return;
    if (error) { $("fShift").value = "-"; formMsg("Gagal memuat shift: " + error.message); return; }
    S.form.shift = data.shift;
    $("fShift").value = shiftText(data.shift);
}

// Isian tambahan sesuai Jenis Lembur
function renderTipeExtra() {
    const tipe = $("fTipe").value, box = $("fTipeExtra");
    if (tipe === "Pengganti") {
        box.innerHTML = `<div class="mb-3"><label class="form-label">Menggantikan <span class="req">*</span></label><div id="fGantiBox"></div>
            <div class="ot-hint">Karyawan PKWT/PKWTT yang aktif pada tanggal lembur (semua departemen dan cost center).</div></div>`;
        if (!S.form.emp) { $("fGantiBox").innerHTML = `<input class="form-control" disabled placeholder="Pilih karyawan yang lembur dulu">`; return; }
        makeCombo("fGantiBox",
            () => ({ exclude_id: S.form.emp.id }),      // semua karyawan PKWT/PKWTT aktif, kecuali orang yang lembur
            (k) => { S.form.pengganti = k; });
    } else if (tipe === "Casual") {
        if (!S.form.emp) { box.innerHTML = `<div class="ot-hint mb-3">Pilih karyawan yang lembur dulu untuk memilih Mitra, Area, dan Departemen.</div>`; return; }
        const cc = S.ref.costcenters.find(c => c.id === S.form.emp.costcenter_id);
        const branch = cc ? cc.branch_id : null;          // Mitra harus satu cabang dengan karyawan
        const mitra = S.ref.costcenters.filter(c => c.branch_id === branch);
        box.innerHTML = `
            <div class="mb-3"><label class="form-label" for="fMitra">Mitra <span class="req">*</span></label>
                <select class="form-select" id="fMitra"><option value="">Pilih Mitra</option>${mitra.map(c => `<option value="${c.id}">${esc(c.costcenter_name)}</option>`).join("")}</select></div>
            <div class="row g-2 mb-3">
                <div class="col-6"><label class="form-label" for="fArea">Area <span class="req">*</span></label>
                    <select class="form-select" id="fArea" disabled><option value="">Pilih Mitra dulu</option></select></div>
                <div class="col-6"><label class="form-label" for="fDept">Departemen <span class="req">*</span></label>
                    <select class="form-select" id="fDept" disabled><option value="">Pilih Area dulu</option></select></div></div>
            <div class="ot-hint mb-3">Area dan Departemen mengikuti struktur cost center Mitra yang dipilih.</div>`;
        $("fMitra").addEventListener("change", onMitraChange);
        $("fArea").addEventListener("change", onAreaChange);
    } else {
        box.innerHTML = "";      // Overtime: tanpa isian tambahan
    }
}

// Casual: setelah Mitra dipilih, ambil struktur (Area -> Departemen) milik Mitra itu
// dari tabel cost_center_structures, lalu isi dropdown Area. Departemen menyusul setelah Area dipilih.
async function onMitraChange() {
    const ccId = Number($("fMitra").value) || null;
    S.form.struct = [];
    $("fDept").innerHTML = `<option value="">Pilih Area dulu</option>`; $("fDept").disabled = true;
    if (!ccId) { $("fArea").innerHTML = `<option value="">Pilih Mitra dulu</option>`; $("fArea").disabled = true; return; }
    $("fArea").innerHTML = `<option value="">Memuat...</option>`; $("fArea").disabled = true;
    const { data, error } = await sb.from("cost_center_structures").select("area_id, dept_id").eq("cost_center_id", ccId);
    if (Number($("fMitra").value) !== ccId) return;          // Mitra sudah diganti lagi, abaikan hasil ini
    if (error) { $("fArea").innerHTML = `<option value="">Gagal memuat</option>`; formMsg("Gagal memuat struktur Mitra: " + error.message); return; }
    S.form.struct = data || [];
    const areaIds = [...new Set(S.form.struct.map(r => r.area_id))];
    const areas = S.ref.areas.filter(a => areaIds.includes(a.id));        // hanya area aktif
    $("fArea").innerHTML = areas.length
        ? `<option value="">Pilih Area</option>` + areas.map(a => `<option value="${a.id}">${esc(a.area_name)}</option>`).join("")
        : `<option value="">Mitra ini belum punya struktur area</option>`;
    $("fArea").disabled = !areas.length;
}
function onAreaChange() {
    const areaId = Number($("fArea").value) || null;
    if (!areaId) { $("fDept").innerHTML = `<option value="">Pilih Area dulu</option>`; $("fDept").disabled = true; return; }
    const deptIds = [...new Set(S.form.struct.filter(r => r.area_id === areaId).map(r => r.dept_id))];
    const depts = S.ref.departments.filter(d => deptIds.includes(d.id));
    $("fDept").innerHTML = depts.length
        ? `<option value="">Pilih Departemen</option>` + depts.map(d => `<option value="${d.id}">${esc(d.department_name)}</option>`).join("")
        : `<option value="">Area ini belum punya departemen</option>`;
    $("fDept").disabled = !depts.length;
}

// Mengumpulkan dan memeriksa isian form. Melempar Error berisi pesan jika ada yang salah.
// (Server memeriksa ulang semuanya; pemeriksaan di sini hanya agar pesan cepat muncul.)
function collectForm() {
    const tgl = $("fTgl").value;
    if (!tgl) throw new Error("Tanggal lembur wajib diisi.");
    if (!S.form.emp) throw new Error("Pilih karyawan yang lembur dari daftar.");
    const ob = $("fObOt").value || "00:00", bb = $("fObBrk").value || "00:00";
    const oa = $("fOaOt").value || "00:00", ba = $("fOaBrk").value || "00:00";
    if (toMenit(ob) === 0 && toMenit(oa) === 0) throw new Error("Isi durasi lembur sebelum atau setelah shift.");
    if (toMenit(ob) > OT_MAX_MENIT || toMenit(oa) > OT_MAX_MENIT) throw new Error(`Durasi lembur maksimal ${OT_MAX_MENIT / 60} jam.`);
    if (toMenit(bb) > BREAK_MAX_MENIT || toMenit(ba) > BREAK_MAX_MENIT) throw new Error(`Durasi istirahat maksimal ${BREAK_MAX_MENIT / 60} jam.`);
    if (toMenit(ob) === 0 && toMenit(bb) > 0) throw new Error("Istirahat sebelum shift tidak boleh diisi tanpa durasi lembur.");
    if (toMenit(oa) === 0 && toMenit(ba) > 0) throw new Error("Istirahat setelah shift tidak boleh diisi tanpa durasi lembur.");
    if (toMenit(bb) > 0 && toMenit(bb) >= toMenit(ob)) throw new Error("Istirahat sebelum shift harus lebih kecil dari durasi lembur.");
    if (toMenit(ba) > 0 && toMenit(ba) >= toMenit(oa)) throw new Error("Istirahat setelah shift harus lebih kecil dari durasi lembur.");

    const tipe = $("fTipe").value;
    const payload = { employee_id: S.form.emp.id, tanggal: tgl, type_ot: tipe,
        ot_before: ob, break_before: bb, ot_after: oa, break_after: ba,
        keterangan: $("fKet").value.trim() || null };
    if (tipe === "Pengganti") {
        if (!S.form.pengganti) throw new Error("Pilih karyawan yang digantikan dari daftar.");
        payload.karyawan_absen_id = S.form.pengganti.id;
    } else if (tipe === "Casual") {
        const mitra = $("fMitra") ? $("fMitra").value : "", area = $("fArea") ? $("fArea").value : "", dept = $("fDept") ? $("fDept").value : "";
        if (!mitra) throw new Error("Pilih Mitra.");
        if (!area) throw new Error("Pilih Area.");
        if (!dept) throw new Error("Pilih Departemen.");
        payload.absen_costcenter_id = Number(mitra); payload.absen_area_id = Number(area); payload.absen_dept_id = Number(dept);
    }
    if (tipe !== "Overtime" && !(S.form.shift && S.form.shift.kode_shift)) {
        throw new Error(`Lembur ${tipe} membutuhkan jadwal shift pada tanggal ini.`);
    }
    return payload;
}

async function simpanLembur() {
    if (S.form.saving) return;
    formMsg("");
    let payload;
    try { payload = collectForm(); } catch (err) { formMsg(err.message); return; }
    S.form.saving = true;
    const btn = $("btnSimpanLembur");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;
    const { data, error } = await hrd().rpc("ajukan_lembur_admin", { p: payload });
    S.form.saving = false; btn.disabled = false; btn.textContent = "Simpan";
    if (error) { formMsg(error.message); return; }
    bootstrap.Modal.getInstance($("modalLembur")).hide();
    showToast(`Lembur tersimpan (${data.status}).`);
    S.page = 1; loadTable();
}

// ===================================================
// KELOMPOK 10: INISIALISASI
// Memeriksa login & role, memasang semua tombol, lalu memuat data.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    S.roleId = getRoleId();
    if (!ROLE_LIHAT.includes(S.roleId)) {
        $("otTableBody").innerHTML = `<tr class="row-empty"><td colspan="9">Anda tidak memiliki akses ke halaman ini.</td></tr>`;
        return;
    }
    $("btnLembur").classList.toggle("d-none", !isPengelola());     // tombol Lembur hanya untuk role 1 & 2

    $("btnBack").addEventListener("click", () => history.back());
    $("btnLembur").addEventListener("click", openForm);
    $("btnSimpanLembur").addEventListener("click", simpanLembur);
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
    $("otTableBody").addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]"); if (!b) return;
        if (b.dataset.act === "detail") openDetail(b.dataset.id);
        else if (b.dataset.act === "approve") { if (confirm("Setujui lembur ini?")) decide(b.dataset.ap, "Disetujui"); }
        else if (b.dataset.act === "reject") openReject(b.dataset.ap);
    });
    $("otPagination").addEventListener("click", (e) => {
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