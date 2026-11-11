// ===================================================
// laporan-inspeksi.js
// Halaman "Laporan Inspeksi" (sumber data: opr.inspeksi)
// Fitur: filter (cabang, departemen, area, kategori, rentang tanggal),
//        download Excel (mengikuti filter + hak akses role), tabel dengan
//        pagination 20 baris (terbaru di atas), klik baris untuk melihat
//        detail + foto + peta, dan pengaturan master kategori.
// Hak akses: Maintenance (1), Superadmin (2), Supervisor (4).
//            Supervisor hanya melihat data departemennya sendiri.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file. Jika nama tabel/schema
// berbeda di database Anda, cukup ubah di sini.
// ===================================================
let supabaseClient = window.supabaseClient;   // dibaca ulang saat halaman siap (lihat Kelompok 4)

const SCHEMA_OPR = "opr";                         // schema inspeksi, kategori, sub kategori
const SCHEMA_HRD = "hrd";                         // schema karyawan
const TABLE_INSPEKSI = "inspeksi";
const TABLE_KATEGORI = "kategori_inspeksi";
const TABLE_SUB = "sub_kategori_inspeksi";
const TABLE_EMPLOYEES = "employees";              // hrd.employees: id (uuid) -> nama
// Tabel di schema default (public), sama seperti halaman patroli memakai "areas".
// PERLU DICEK: jika branches / departments ada di schema lain, ubah cara query di loadLookups().
const TABLE_BRANCH = "branches";
const TABLE_DEPT = "departments";
const TABLE_AREA = "areas";

const PHOTO_BUCKET = "laporan-inspeksi";          // bucket Storage untuk foto
const PHOTO_COLUMNS = ["photo_path_1", "photo_path_2", "photo_path_3", "photo_path_4", "photo_path_5"];

const ROWS_PER_PAGE = 20;                         // baris per halaman di layar
const FETCH_CHUNK = 1000;                         // ambil data bertahap (batas Supabase = 1000)
const ID_CHUNK = 100;                             // jumlah id per sekali cari nama petugas
const SIGNED_URL_SECONDS = 3600;                  // masa berlaku link foto (bucket private)

// Sesi login & hak akses (sama seperti laporan-patroli.js)
const SESSION_KEY = "erp_session";
const ROLE_IDS_ALL = [1, 2];                      // 1 = Maintenance, 2 = Superadmin: melihat semua data + filter cabang/dept/area
const ROLE_SUPERVISOR = 4;                        // Supervisor: hanya departemen sendiri
const ROLE_IDS_ACCESS = [1, 2, 4];                // role yang boleh membuka halaman
const ROLE_IDS_MANAGE_KATEGORI = [1, 2, 4];       // role yang boleh membuka pengaturan Kategori
const ROLE_IDS_MANAGE_SUB = [1, 2];               // role yang boleh membuka pengaturan Sub Kategori
// PERLU DICEK: nama field di erp_session. Lihat Console (F12) jika halaman memberi pesan "tidak terdeteksi".
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];
const SESSION_DEPT_FIELDS = ["deptId", "dept_id", "departmentId", "department_id"];
// true  = Supervisor hanya melihat departemennya DI CABANGNYA SENDIRI
// false = Supervisor melihat departemennya di semua cabang (sesuai permintaan awal)
const SUPERVISOR_LIMIT_BY_BRANCH = false;

// Zona waktu per cabang (tanggal tiap baris mengikuti cabang datanya)
const DEFAULT_BRANCH = 1;
const BRANCH_TZ = {
    1: { zone: "Asia/Jakarta",  offset: "+07:00" },
    2: { zone: "Asia/Makassar", offset: "+08:00" }
};

// Peta (Leaflet + OpenStreetMap)
const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAP_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const MAP_ZOOM = 18;

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan kondisi halaman saat ini.
// ===================================================
const state = {
    roleId: null,
    isAll: false,             // true untuk Maintenance & Superadmin
    sessionBranch: null,
    sessionDept: null,
    page: 1,
    totalRows: 0,
    filters: { branchId: "", deptId: "", areaId: "", kategoriId: "", from: "", to: "" },
    branchMap: new Map(),     // id -> nama cabang
    deptMap: new Map(),       // id -> nama departemen
    areaList: [],             // semua area (untuk dropdown yang menyempit sesuai cabang)
    areaMap: new Map(),       // id -> nama area
    kategori: [],             // semua kategori (aktif & non aktif)
    kategoriMap: new Map(),   // id -> nama kategori
    sub: [],                  // semua sub kategori / temuan (aktif & non aktif)
    subMap: new Map(),        // id -> nama sub kategori (temuan)
    masterType: "kategori",   // modal pengaturan yang sedang dibuka: "kategori" atau "sub"
    nameCache: new Map(),     // id karyawan -> nama
    pageRows: new Map(),      // baris halaman aktif (id -> data mentah), dipakai saat baris diklik
    reqId: 0,                 // penanda permintaan terbaru supaya hasil lama tidak menimpa hasil baru
    detailReq: 0,             // penanda permintaan modal detail (untuk foto)
    katTab: "aktif",
    katEditId: null           // null = mode tambah, angka = mode edit
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// Fungsi: potongan kecil yang dipakai berulang.
// ===================================================
const $ = (id) => document.getElementById(id);

// Mengamankan teks sebelum dimasukkan ke HTML
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function tzOf(branchId) { return BRANCH_TZ[branchId] || BRANCH_TZ[DEFAULT_BRANCH]; }

// Zona waktu untuk batas tanggal filter: cabang yang dipilih di filter,
// jika tidak ada pakai cabang di sesi, jika tidak ada pakai default.
function filterTz() {
    return tzOf(state.filters.branchId || state.sessionBranch || DEFAULT_BRANCH);
}

// Memecah waktu UTC dari database menjadi tanggal & jam di zona waktu cabang data.
// Hasil: { tanggal: "21-10-2026", waktu: "15:00:05" }
function splitDateTime(iso, branchId) {
    if (!iso) return { tanggal: "", waktu: "" };
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tzOf(branchId).zone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(iso));
    const p = {};
    parts.forEach(x => { p[x.type] = x.value; });
    return { tanggal: `${p.day}-${p.month}-${p.year}`, waktu: `${p.hour}:${p.minute}:${p.second}` };
}

function startOfDayIso(dateStr) { return new Date(`${dateStr}T00:00:00.000${filterTz().offset}`).toISOString(); }
function endOfDayIso(dateStr) { return new Date(`${dateStr}T23:59:59.999${filterTz().offset}`).toISOString(); }

function todayStr() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tzOf(DEFAULT_BRANCH).zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Membaca kolom lokasi berformat "latitude,longitude" (contoh: -7.25,112.75).
// Hasil: { lat, lng }, atau null jika kosong / bukan koordinat valid.
function parseLatLng(text) {
    if (!text) return null;
    const m = String(text).trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

// Mengambil SEMUA baris dari satu query secara bertahap per 1000 baris.
// buildQuery(from, to) harus mengembalikan query yang sudah memakai .range(from, to).
async function fetchAll(buildQuery) {
    const out = [];
    for (let from = 0; ; from += FETCH_CHUNK) {
        const { data, error } = await buildQuery(from, from + FETCH_CHUNK - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < FETCH_CHUNK) break;
    }
    return out;
}

function areaName(id) {
    if (id === null || id === undefined || id === "") return "";
    return state.areaMap.get(String(id)) || `Area ${id}`;
}

// ===================================================
// KELOMPOK 3B: SESI LOGIN & HAK AKSES
// Fungsi: membaca sesi login (erp_session). Hanya role 1, 2, dan 4 yang boleh
// membuka halaman. CATATAN KEAMANAN: ini hanya mengatur tampilan di browser.
// Pembatasan data yang sebenarnya harus dipasang di database (RLS).
// ===================================================
function getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (err) { console.error("Sesi login tidak bisa dibaca:", err); return null; }
}

function getSessionNumber(session, fields) {
    for (const f of fields) {
        const n = parseInt(session[f], 10);
        if (!isNaN(n)) return n;
    }
    return null;
}

// Menghentikan halaman dengan pesan jelas
function blockPage(message) {
    $("subTitle").textContent = "-";
    $("inspeksiTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">${esc(message)}</td></tr>`;
    ["btnFilter", "btnDownload", "btnKategori", "btnSubKategori"].forEach(id => { const el = $(id); if (el) el.disabled = true; });
}

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: dijalankan saat halaman selesai dimuat. Memeriksa login & role,
// menyesuaikan tampilan sesuai role, memuat data pendukung, lalu laporan.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    // Pastikan koneksi Supabase ada. Jika kosong, biasanya path js/supabase.js di HTML salah (404).
    supabaseClient = window.supabaseClient || supabaseClient;
    if (!supabaseClient) {
        console.error("window.supabaseClient kosong. Cek tab Network (F12): apakah supabase.js 404?");
        blockPage("Koneksi database tidak tersedia (supabase.js tidak termuat). Periksa path <script> js/supabase.js di laporan-inspeksi.html.");
        return;
    }
    const session = getSession();
    if (!session) { blockPage("Sesi login tidak ditemukan. Silakan login ulang."); return; }

    state.roleId = Number(session.roleId);
    state.isAll = ROLE_IDS_ALL.includes(state.roleId);
    state.sessionBranch = getSessionNumber(session, SESSION_BRANCH_FIELDS);
    state.sessionDept = getSessionNumber(session, SESSION_DEPT_FIELDS);

    // Diagnostik: lihat nilai ini di Console (F12) jika halaman terblokir / data tidak sesuai
    console.info("[Laporan Inspeksi] roleId:", state.roleId, "| cabang sesi:", state.sessionBranch, "| dept sesi:", state.sessionDept);

    if (!ROLE_IDS_ACCESS.includes(state.roleId)) {
        blockPage("Anda tidak memiliki akses ke halaman ini.");
        return;
    }
    if (!state.isAll && state.sessionDept === null) {
        blockPage("Departemen akun Anda tidak terdeteksi. Hubungi admin.");
        return;
    }

    // Filter Cabang / Departemen / Area hanya untuk Maintenance & Superadmin
    document.querySelectorAll(".li-admin-only").forEach(el => { el.hidden = !state.isAll; });
    $("btnKategori").hidden = !ROLE_IDS_MANAGE_KATEGORI.includes(state.roleId);
    $("btnSubKategori").hidden = !ROLE_IDS_MANAGE_SUB.includes(state.roleId);

    setupFilter();
    setupDownload();
    setupDetailModal();
    setupMaster();

    try {
        await loadLookups();
    } catch (err) {
        console.error("Gagal memuat data pendukung:", err);
        $("inspeksiTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data pendukung: ${esc(err.message)}</td></tr>`;
        return;
    }
    updateSubTitle();
    loadReport();
});

// ===================================================
// KELOMPOK 5: DATA PENDUKUNG (CABANG, DEPARTEMEN, AREA, KATEGORI, TEMUAN)
// Fungsi: mengambil tabel referensi yang kecil sekali di awal, dipakai untuk
// isi dropdown filter dan untuk mengubah id menjadi nama di tabel.
// ===================================================
async function loadLookups() {
    const [branches, depts, areas] = await Promise.all([
        fetchAll((f, t) => supabaseClient.from(TABLE_BRANCH).select("id, branch_name").order("id").range(f, t)),
        fetchAll((f, t) => supabaseClient.from(TABLE_DEPT).select("id, department_name").order("department_name").range(f, t)),
        fetchAll((f, t) => supabaseClient.from(TABLE_AREA).select("id, area_name, branch_id").order("area_name").range(f, t))
    ]);
    await Promise.all([loadKategori(), loadSub()]);

    state.branchMap = new Map(branches.map(b => [String(b.id), b.branch_name]));
    state.deptMap = new Map(depts.map(d => [String(d.id), d.department_name]));
    state.areaList = areas;
    state.areaMap = new Map(areas.map(a => [String(a.id), a.area_name]));

    $("fBranch").innerHTML = `<option value="">Semua Cabang</option>` +
        branches.map(b => `<option value="${esc(b.id)}">${esc(b.branch_name)}</option>`).join("");
    $("fDept").innerHTML = `<option value="">Semua Departemen</option>` +
        depts.map(d => `<option value="${esc(d.id)}">${esc(d.department_name)}</option>`).join("");
    fillAreaOptions("");
    fillKategoriOptions();
}

// Memuat ulang kategori (dipanggil saat awal dan setelah tambah/edit/hapus). Termasuk dept_id.
async function loadKategori() {
    const rows = await fetchAll((f, t) => supabaseClient.schema(SCHEMA_OPR).from(TABLE_KATEGORI)
        .select("id, kategori_inspeksi, deskripsi, is_active, dept_id")
        .order("kategori_inspeksi", { ascending: true }).order("id", { ascending: true }).range(f, t));
    state.kategori = rows;
    state.kategoriMap = new Map(rows.map(k => [String(k.id), k.kategori_inspeksi]));
}

// Memuat ulang sub kategori / temuan. Termasuk kategori induk dan dept_id.
async function loadSub() {
    const rows = await fetchAll((f, t) => supabaseClient.schema(SCHEMA_OPR).from(TABLE_SUB)
        .select("id, sub_kategori_inspeksi, deskripsi, is_active, kategori_inspeksi_id, dept_id")
        .order("sub_kategori_inspeksi", { ascending: true }).order("id", { ascending: true }).range(f, t));
    state.sub = rows;
    state.subMap = new Map(rows.map(x => [String(x.id), x.sub_kategori_inspeksi]));
}

// Dropdown Area menyempit sesuai cabang yang dipilih
function fillAreaOptions(branchId) {
    const list = state.areaList.filter(a => !branchId || String(a.branch_id) === String(branchId));
    $("fArea").innerHTML = `<option value="">Semua Area</option>` +
        list.map(a => `<option value="${esc(a.id)}">${esc(a.area_name)}</option>`).join("");
}

// Dropdown Kategori mengikuti departemen: Supervisor hanya kategori departemennya,
// Maintenance & Superadmin mengikuti pilihan Departemen di panel (kosong = semua,
// dengan nama departemen di belakang nama kategori). Kategori non aktif tetap tampil
// karena data lama mungkin masih memakainya.
function fillKategoriOptions() {
    const current = $("fKategori").value;
    const deptSel = state.isAll ? $("fDept").value : String(state.sessionDept);
    const showDept = state.isAll && !deptSel;
    const list = state.kategori.filter(k => !deptSel || String(k.dept_id) === String(deptSel));
    $("fKategori").innerHTML = `<option value="">Semua Kategori</option>` + list.map(k => {
        const dn = showDept && k.dept_id !== null && k.dept_id !== undefined ? ` - ${deptName(k.dept_id)}` : "";
        return `<option value="${esc(k.id)}">${esc(k.kategori_inspeksi)}${dn}${k.is_active ? "" : " (non aktif)"}</option>`;
    }).join("");
    $("fKategori").value = current;
    if ($("fKategori").selectedIndex < 0) $("fKategori").selectedIndex = 0;
}

// Baris di bawah judul: departemen (Supervisor) atau cabang yang difilter
function updateSubTitle() {
    if (!state.isAll) {
        $("subTitle").textContent = state.deptMap.get(String(state.sessionDept)) || `Departemen ${state.sessionDept}`;
        return;
    }
    const b = state.filters.branchId;
    $("subTitle").textContent = b ? (state.branchMap.get(String(b)) || `Cabang ${b}`) : "Semua Cabang";
}

// ===================================================
// KELOMPOK 6: FILTER
// Fungsi: panel filter. Filter baru berlaku setelah tombol "Terapkan" ditekan.
// applyFilters() dipakai bersama oleh tabel DAN download, jadi hasilnya sama.
// Filter role (Supervisor = departemen sendiri) SELALU dipasang, tidak
// bergantung pada isi panel.
// ===================================================
function setupFilter() {
    $("btnFilter").addEventListener("click", (e) => {
        e.stopPropagation();
        $("filterPanel").hidden = !$("filterPanel").hidden;
    });
    document.addEventListener("click", (e) => {
        if (!$("filterPanel").hidden && !e.target.closest(".li-filter-wrap")) closeFilterPanel();
    });
    $("fBranch").addEventListener("change", () => fillAreaOptions($("fBranch").value));
    $("fDept").addEventListener("change", fillKategoriOptions);
    $("btnFilterApply").addEventListener("click", applyFilter);
    $("btnFilterReset").addEventListener("click", resetFilter);
}

function closeFilterPanel() { $("filterPanel").hidden = true; }

function applyFilter() {
    const from = $("fFrom").value;
    const to = $("fTo").value;
    if (from && to && from > to) {
        alert("Tanggal \"sampai\" tidak boleh lebih awal dari tanggal \"dari\".");
        return;
    }
    state.filters = {
        branchId: state.isAll ? $("fBranch").value : "",
        deptId: state.isAll ? $("fDept").value : "",
        areaId: state.isAll ? $("fArea").value : "",
        kategoriId: $("fKategori").value,
        from, to
    };
    state.page = 1;
    closeFilterPanel();
    updateFilterBadge();
    updateSubTitle();
    loadReport();
}

function resetFilter() {
    state.filters = { branchId: "", deptId: "", areaId: "", kategoriId: "", from: "", to: "" };
    state.page = 1;
    ["fBranch", "fDept", "fArea", "fKategori", "fFrom", "fTo"].forEach(id => { $(id).value = ""; });
    fillAreaOptions("");
    fillKategoriOptions();
    closeFilterPanel();
    updateFilterBadge();
    updateSubTitle();
    loadReport();
}

function updateFilterBadge() {
    const f = state.filters;
    const n = (f.branchId ? 1 : 0) + (f.deptId ? 1 : 0) + (f.areaId ? 1 : 0) + (f.kategoriId ? 1 : 0) + ((f.from || f.to) ? 1 : 0);
    $("filterBadge").textContent = n;
    $("filterBadge").hidden = n === 0;
}

function activeFilterCount() { return Number($("filterBadge").textContent) || 0; }

// Menempelkan syarat role + filter aktif ke sebuah query inspeksi
function applyFilters(query) {
    const f = state.filters;
    let q = query;
    if (!state.isAll) {
        // Filter role Supervisor: wajib, tidak bisa diubah dari panel
        q = q.eq("dept_id", state.sessionDept);
        if (SUPERVISOR_LIMIT_BY_BRANCH && state.sessionBranch !== null) q = q.eq("branch_id", state.sessionBranch);
    } else {
        if (f.branchId) q = q.eq("branch_id", f.branchId);
        if (f.deptId) q = q.eq("dept_id", f.deptId);
        if (f.areaId) q = q.eq("area_id", f.areaId);
    }
    if (f.kategoriId) q = q.eq("kategori_inspeksi_id", f.kategoriId);
    if (f.from) q = q.gte("created_at", startOfDayIso(f.from));
    if (f.to) q = q.lte("created_at", endOfDayIso(f.to));
    return q;
}

// ===================================================
// KELOMPOK 7: MEMUAT LAPORAN (PER HALAMAN)
// Fungsi: mengambil 20 baris sesuai halaman aktif, terbaru di atas.
// count "exact" dipakai untuk mengetahui total baris.
// ===================================================
const INSPEKSI_COLUMNS = "id, created_at, branch_id, dept_id, area_id, petugas, kategori_inspeksi_id, sub_kategori_inspeksi_id, deskripsi, lokasi, " + PHOTO_COLUMNS.join(", ");

async function loadReport() {
    const myReq = ++state.reqId;
    const from = (state.page - 1) * ROWS_PER_PAGE;
    $("inspeksiTableBody").innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        const { data, error, count } = await applyFilters(
            supabaseClient.schema(SCHEMA_OPR).from(TABLE_INSPEKSI).select(INSPEKSI_COLUMNS, { count: "exact" })
        )
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + ROWS_PER_PAGE - 1);
        if (error) throw error;

        await resolveNames((data || []).map(r => r.petugas));
        if (myReq !== state.reqId) return;       // user sudah ganti filter / halaman

        state.totalRows = count || 0;
        const totalPages = Math.max(1, Math.ceil(state.totalRows / ROWS_PER_PAGE));
        if (state.page > totalPages) { state.page = totalPages; return loadReport(); }

        renderTable(data || [], from);
        renderPagination(totalPages);
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat laporan inspeksi:", err);
        $("inspeksiTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${esc(err.message)}</td></tr>`;
        $("inspeksiPagination").innerHTML = "";
    }
}

// Mencari nama petugas di hrd.employees berdasarkan id (uuid).
// Hanya id yang belum pernah dicari yang diambil dari database.
async function resolveNames(ids) {
    const need = [...new Set(ids.filter(n => n && !state.nameCache.has(String(n))).map(String))];
    for (let i = 0; i < need.length; i += ID_CHUNK) {
        const chunk = need.slice(i, i + ID_CHUNK);
        const { data, error } = await supabaseClient.schema(SCHEMA_HRD).from(TABLE_EMPLOYEES)
            .select("id, nama").in("id", chunk);
        if (error) throw error;
        (data || []).forEach(e => state.nameCache.set(String(e.id), e.nama));
        chunk.forEach(n => { if (!state.nameCache.has(n)) state.nameCache.set(n, null); });
    }
}

// Mengubah satu baris database menjadi baris siap tampil
function toDisplayRow(r) {
    const dt = splitDateTime(r.created_at, r.branch_id);
    return {
        tanggal: dt.tanggal,
        waktu: dt.waktu,
        petugas: (r.petugas && state.nameCache.get(String(r.petugas))) || "",
        kategori: state.kategoriMap.get(String(r.kategori_inspeksi_id)) || "",
        temuan: state.subMap.get(String(r.sub_kategori_inspeksi_id)) || "",
        deskripsi: r.deskripsi || "",
        area: areaName(r.area_id)
    };
}

// ===================================================
// KELOMPOK 8: TAMPILAN TABEL + PAGINATION
// Fungsi: menampilkan baris halaman aktif dengan nomor urut yang berlanjut
// antar halaman, dan tombol halaman di bawah tabel.
// ===================================================
function renderTable(rows, offset) {
    const tbody = $("inspeksiTableBody");
    state.pageRows = new Map(rows.map(r => [String(r.id), r]));
    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">${activeFilterCount() ? "Tidak ada data yang cocok dengan filter." : "Belum ada data inspeksi."}</td></tr>`;
        return;
    }
    const dash = `<span class="data-empty-cell">-</span>`;
    const cell = (v) => v ? esc(v) : dash;
    tbody.innerHTML = rows.map((r, i) => {
        const d = toDisplayRow(r);
        return `
            <tr class="li-row-click" data-id="${esc(r.id)}">
                <td class="col-no">${offset + i + 1}</td>
                <td>${cell(d.tanggal)}</td>
                <td>${cell(d.petugas)}</td>
                <td>${cell(d.kategori)}</td>
                <td>${cell(d.temuan)}</td>
                <td class="col-desc" title="${esc(d.deskripsi)}">${cell(d.deskripsi)}</td>
                <td>${cell(d.area)}</td>
            </tr>`;
    }).join("");
}

function renderPagination(totalPages) {
    const container = $("inspeksiPagination");
    const totalRows = state.totalRows;
    if (totalPages <= 1) {
        container.innerHTML = totalRows > 0 ? `<span class="li-page-info">${totalRows} data</span>` : "";
        return;
    }
    let html = `<button class="pagination-btn" data-nav="prev" ${state.page === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>`;
    const maxVisible = 7;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === state.page ? "active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class="pagination-btn" data-nav="next" ${state.page === totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>`;
    html += `<span class="li-page-info">${totalRows} data</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); loadReport(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadReport(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadReport(); } };
}

// ===================================================
// KELOMPOK 9: DOWNLOAD EXCEL
// Fungsi: mengunduh SEMUA data yang lolos filter role dan filter panel
// (bukan hanya halaman yang tampil), bertahap per 1000 baris.
// Kolom: No, Tanggal, Petugas, Kategori Temuan, Temuan, Deskripsi.
// ===================================================
function setupDownload() { $("btnDownload").addEventListener("click", handleDownload); }

async function handleDownload() {
    const btn = $("btnDownload");
    const label = btn.querySelector("span");
    const oldText = label.textContent;
    btn.disabled = true;
    label.textContent = "Menyiapkan...";

    try {
        const rows = await fetchAll((from, to) => applyFilters(
            supabaseClient.schema(SCHEMA_OPR).from(TABLE_INSPEKSI).select(INSPEKSI_COLUMNS)
        )
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to));

        if (rows.length === 0) { alert("Tidak ada data untuk diunduh."); return; }
        await resolveNames(rows.map(r => r.petugas));

        const aoa = [["No", "Tanggal", "Petugas", "Kategori Temuan", "Temuan", "Deskripsi"]];
        rows.forEach((r, i) => {
            const d = toDisplayRow(r);
            aoa.push([i + 1, d.tanggal, d.petugas, d.kategori, d.temuan, d.deskripsi]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 28 }, { wch: 26 }, { wch: 30 }, { wch: 60 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inspeksi");
        XLSX.writeFile(wb, `Laporan_Inspeksi_${todayStr()}.xlsx`);
    } catch (err) {
        console.error("Gagal download laporan inspeksi:", err);
        alert(`Gagal mengunduh data: ${err.message}`);
    } finally {
        btn.disabled = false;
        label.textContent = oldText;
    }
}

// ===================================================
// KELOMPOK 10: MODAL DETAIL (DATA + FOTO + PETA)
// Fungsi: klik baris membuka modal berisi data baris tersebut, foto temuan
// dari bucket Storage, dan peta lokasi (kolom lokasi "latitude,longitude").
// Foto: mencoba signed URL (untuk bucket private), jika gagal memakai public URL.
// Peta dibuat sekali lalu dipakai ulang di setiap pembukaan.
// ===================================================
let leafletMap = null;
let leafletMarker = null;

function setupDetailModal() {
    $("inspeksiTableBody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr.li-row-click");
        if (!tr) return;
        if (window.getSelection && String(window.getSelection()).trim()) return;   // sedang menyalin teks
        const row = state.pageRows.get(tr.dataset.id);
        if (row) openDetail(row);
    });
    $("btnDetailClose").addEventListener("click", closeDetail);
    $("btnDetailCloseFoot").addEventListener("click", closeDetail);
    $("detailOverlay").addEventListener("click", (e) => { if (e.target === $("detailOverlay")) closeDetail(); });
    // Tombol Escape menutup modal paling atas
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!$("masterFormOverlay").hidden) closeMasterForm();
        else if (!$("masterOverlay").hidden) closeMasterModal();
        else closeDetail();
    });
}

function closeDetail() { state.detailReq++; $("detailOverlay").hidden = true; }

function openDetail(row) {
    const myReq = ++state.detailReq;
    const d = toDisplayRow(row);
    const loc = parseLatLng(row.lokasi);

    $("dTanggal").textContent = `${d.tanggal} ${d.waktu}`;
    $("dPetugas").textContent = d.petugas || "-";
    $("dKategori").textContent = d.kategori || "-";
    $("dTemuan").textContent = d.temuan || "-";
    $("dDeskripsi").textContent = d.deskripsi || "-";
    $("dArea").textContent = d.area || "-";
    $("dKoordinat").textContent = loc ? `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}` : "-";
    $("detailOverlay").hidden = false;           // modal harus tampil dulu agar peta punya ukuran

    showLocation(loc, row.lokasi);
    showPhotos(row, myReq);
}

// Peta lokasi (atau keterangan jika lokasi kosong / tidak valid)
function showLocation(loc, rawText) {
    const mapBox = $("liMap");
    const empty = $("mapEmpty");
    const google = $("btnMapGoogle");

    if (!loc) {
        mapBox.hidden = true;
        google.hidden = true;
        $("mapNote").hidden = true;
        empty.hidden = false;
        empty.textContent = rawText
            ? "Format lokasi tidak dikenali. Format yang benar: latitude,longitude (contoh: -7.25,112.75)."
            : "Lokasi tidak tercatat pada data ini.";
        return;
    }
    google.href = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    google.hidden = false;
    $("mapNote").hidden = false;

    if (typeof L === "undefined") {
        mapBox.hidden = true;
        empty.hidden = false;
        empty.textContent = "Library peta gagal dimuat (periksa koneksi internet). Lokasi tetap bisa dibuka lewat tombol Google Maps.";
        return;
    }
    empty.hidden = true;
    mapBox.hidden = false;

    if (!leafletMap) {
        leafletMap = L.map("liMap");
        L.tileLayer(MAP_TILE_URL, { maxZoom: 19, attribution: MAP_ATTRIBUTION }).addTo(leafletMap);
    }
    const icon = L.divIcon({ className: "li-map-pin", html: '<i class="fa-solid fa-location-dot"></i>', iconSize: [34, 40], iconAnchor: [17, 38] });
    if (!leafletMarker) leafletMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(leafletMap);
    else leafletMarker.setLatLng([loc.lat, loc.lng]);
    leafletMap.invalidateSize();
    leafletMap.setView([loc.lat, loc.lng], MAP_ZOOM);
}

// Foto temuan: dimuat setelah modal terbuka supaya modal tidak menunggu Storage
async function showPhotos(row, myReq) {
    const grid = $("photoGrid");
    const note = $("photoNote");
    const paths = PHOTO_COLUMNS.map(c => row[c]).filter(p => p && String(p).trim()).map(p => String(p).trim());

    grid.innerHTML = "";
    if (paths.length === 0) {
        note.hidden = false;
        note.textContent = "Tidak ada foto pada temuan ini.";
        return;
    }
    note.hidden = false;
    note.textContent = "Memuat foto...";

    let urls = [];
    try { urls = await resolvePhotoUrls(paths); }
    catch (err) { console.error("Gagal memuat foto:", err); }
    if (myReq !== state.detailReq) return;       // user sudah menutup / membuka baris lain

    const ok = urls.filter(Boolean);
    if (ok.length === 0) {
        note.textContent = "Foto gagal dimuat. Periksa nama bucket dan izin akses Storage.";
        return;
    }
    note.hidden = true;
    grid.innerHTML = ok.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto temuan" loading="lazy"></a>`).join("");
    grid.querySelectorAll("img").forEach(img => {
        img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "data-empty-cell", textContent: "Foto gagal dimuat" })); });
    });
}

// Mengubah path Storage menjadi URL yang bisa ditampilkan
async function resolvePhotoUrls(paths) {
    const bucket = supabaseClient.storage.from(PHOTO_BUCKET);
    const clean = paths.map(p => /^https?:\/\//i.test(p) ? p : p.replace(/^\/+/, ""));
    const out = clean.map(p => /^https?:\/\//i.test(p) ? p : null);
    const need = clean.filter((p, i) => out[i] === null);

    if (need.length) {
        const signed = new Map();
        try {
            const { data, error } = await bucket.createSignedUrls(need, SIGNED_URL_SECONDS);
            if (!error) (data || []).forEach(x => { if (x.signedUrl) signed.set(x.path, x.signedUrl); });
        } catch (err) { console.warn("Signed URL gagal, memakai public URL:", err); }

        clean.forEach((p, i) => {
            if (out[i] !== null) return;
            out[i] = signed.get(p) || bucket.getPublicUrl(p).data.publicUrl || null;
        });
    }
    return out;
}

// ===================================================
// KELOMPOK 11: PENGATURAN KATEGORI & SUB KATEGORI (MODAL + SUB MODAL FORM)
// Fungsi: kelola opr.kategori_inspeksi dan opr.sub_kategori_inspeksi lewat SATU
// model modal yang sama (MASTER di bawah menentukan tabel dan kolomnya).
//  - Tab Aktif / Non Aktif.
//  - Tambah: is_active otomatis true. dept_id wajib diisi.
//  - Sub Kategori wajib punya Kategori induk (kolom kategori_inspeksi_id),
//    pilihan induk menyempit sesuai departemen yang dipilih.
//  - Edit: ubah isian dan status.
//  - Hapus: TIDAK menghapus baris, hanya mengubah is_active menjadi false
//    (baris pindah ke tab Non Aktif) agar temuan lama tetap punya nama.
//  - Tab Non Aktif: klik baris membuka form edit dengan status sudah "Aktif".
//  - Supervisor hanya melihat dan mengisi data departemennya sendiri.
// ===================================================
const MASTER = {
    kategori: { title: "Pengaturan Kategori", label: "Kategori", table: TABLE_KATEGORI, nameCol: "kategori_inspeksi", hasParent: false },
    sub:      { title: "Pengaturan Sub Kategori", label: "Sub Kategori", table: TABLE_SUB, nameCol: "sub_kategori_inspeksi", hasParent: true }
};

const masterCfg = () => MASTER[state.masterType];
const masterSource = () => (state.masterType === "sub" ? state.sub : state.kategori);
const deptName = (id) => (id === null || id === undefined ? "" : (state.deptMap.get(String(id)) || `Dept ${id}`));
const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Data yang boleh dilihat: Maintenance & Superadmin semua, Supervisor hanya departemennya
function masterVisibleRows() {
    const all = masterSource();
    return state.isAll ? all : all.filter(r => String(r.dept_id) === String(state.sessionDept));
}

function setupMaster() {
    $("btnKategori").addEventListener("click", () => openMasterModal("kategori"));
    $("btnSubKategori").addEventListener("click", () => openMasterModal("sub"));
    $("btnMasterClose").addEventListener("click", closeMasterModal);
    $("btnMasterCloseFoot").addEventListener("click", closeMasterModal);
    $("masterOverlay").addEventListener("click", (e) => { if (e.target === $("masterOverlay")) closeMasterModal(); });

    document.querySelectorAll(".li-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            state.katTab = btn.dataset.tab;
            document.querySelectorAll(".li-tab").forEach(b => b.classList.toggle("active", b === btn));
            renderMasterTable();
        });
    });

    $("btnMasterAdd").addEventListener("click", () => openMasterForm(null));
    $("btnMasterFormClose").addEventListener("click", closeMasterForm);
    $("btnMasterFormCancel").addEventListener("click", closeMasterForm);
    $("btnMasterFormSave").addEventListener("click", saveMaster);
    $("mDept").addEventListener("change", () => fillParentOptions(""));

    // Satu pendengar klik untuk tombol Edit / Hapus dan klik baris (tab Non Aktif)
    $("masterTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (btn) {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === "edit") openMasterForm(id);
            else if (btn.dataset.action === "hapus") deactivateMaster(id);
            return;
        }
        const tr = e.target.closest("tr[data-row-id]");
        if (tr && state.katTab === "nonaktif") openMasterForm(Number(tr.dataset.rowId));
    });
}

function openMasterModal(type) {
    state.masterType = type;
    state.katTab = "aktif";
    document.querySelectorAll(".li-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === "aktif"));
    $("masterTitle").textContent = MASTER[type].title;
    $("masterAddLabel").textContent = `Tambah ${MASTER[type].label}`;
    renderMasterTable();
    $("masterOverlay").hidden = false;
}

function closeMasterModal() { closeMasterForm(); $("masterOverlay").hidden = true; }

// Kolom tabel: Sub Kategori punya kolom "Kategori" (induk); kolom Departemen hanya untuk
// Maintenance & Superadmin (Supervisor hanya melihat satu departemen).
function masterColumns() {
    const cfg = masterCfg();
    const cols = [{ label: "No", style: "width:50px;text-align:center" }, { label: cfg.label }];
    if (cfg.hasParent) cols.push({ label: "Kategori" });
    cols.push({ label: "Deskripsi" });
    if (state.isAll) cols.push({ label: "Departemen" });
    cols.push({ label: "Status" }, { label: "Aksi" });
    return cols;
}

function renderMasterTable() {
    const cfg = masterCfg();
    const isAktif = state.katTab === "aktif";
    const cols = masterColumns();
    const dash = `<span class="data-empty-cell">-</span>`;

    $("masterHead").innerHTML = cols.map(c => `<th ${c.style ? `style="${c.style}"` : ""}>${esc(c.label)}</th>`).join("");

    const list = masterVisibleRows()
        .filter(r => (r.is_active === true) === isAktif)
        .sort((a, b) => deptName(a.dept_id).localeCompare(deptName(b.dept_id), "id")
            || String(a[cfg.nameCol] || "").localeCompare(String(b[cfg.nameCol] || ""), "id"));

    const tbody = $("masterTableBody");
    if (list.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="${cols.length}">${isAktif ? `Belum ada ${cfg.label.toLowerCase()} aktif.` : `Tidak ada ${cfg.label.toLowerCase()} non aktif.`}</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map((r, i) => `
        <tr data-row-id="${esc(r.id)}" class="${isAktif ? "" : "li-row-click"}" ${isAktif ? "" : 'title="Klik untuk mengaktifkan kembali"'}>
            <td style="text-align:center">${i + 1}</td>
            <td>${esc(r[cfg.nameCol])}</td>
            ${cfg.hasParent ? `<td>${state.kategoriMap.get(String(r.kategori_inspeksi_id)) ? esc(state.kategoriMap.get(String(r.kategori_inspeksi_id))) : dash}</td>` : ""}
            <td>${r.deskripsi ? esc(r.deskripsi) : dash}</td>
            ${state.isAll ? `<td>${r.dept_id !== null && r.dept_id !== undefined ? esc(deptName(r.dept_id)) : '<span class="data-empty-cell">belum diisi</span>'}</td>` : ""}
            <td><span class="li-pill ${isAktif ? "on" : "off"}">${isAktif ? "Aktif" : "Non Aktif"}</span></td>
            <td><div class="li-act">
                <button type="button" data-action="edit" data-id="${esc(r.id)}">Edit</button>
                ${isAktif ? `<button type="button" class="danger" data-action="hapus" data-id="${esc(r.id)}">Hapus</button>` : ""}
            </div></td>
        </tr>`).join("");
}

// Pilihan Kategori induk (khusus Sub Kategori): hanya kategori aktif di departemen yang dipilih.
// Induk yang sedang dipakai baris yang diedit tetap ditampilkan walau sudah non aktif.
function fillParentOptions(selectedId) {
    const dept = $("mDept").value;
    let list = state.kategori.filter(k => k.is_active === true && dept && String(k.dept_id) === String(dept));
    const current = selectedId ? state.kategori.find(k => String(k.id) === String(selectedId)) : null;
    if (current && !list.includes(current)) list = [current, ...list];

    $("mParent").innerHTML = `<option value="">${dept ? "Pilih kategori" : "Pilih departemen dulu"}</option>` +
        list.map(k => `<option value="${esc(k.id)}">${esc(k.kategori_inspeksi)}${k.is_active ? "" : " (non aktif)"}</option>`).join("");
    $("mParent").value = selectedId ? String(selectedId) : "";
    if ($("mParent").selectedIndex < 0) $("mParent").selectedIndex = 0;
}

// id = null -> mode tambah. id = angka -> mode edit.
// Dari tab Non Aktif, status otomatis dipilih "Aktif".
function openMasterForm(id) {
    const cfg = masterCfg();
    state.katEditId = id;
    const isEdit = id !== null;
    const row = isEdit ? masterSource().find(x => Number(x.id) === id) : null;
    if (isEdit && !row) return;

    $("masterFormTitle").textContent = `${isEdit ? "Edit" : "Tambah"} ${cfg.label}`;
    $("mNameLabel").textContent = cfg.label;
    $("mName").value = row ? (row[cfg.nameCol] || "") : "";
    $("mDesc").value = row ? (row.deskripsi || "") : "";
    $("mStatusField").hidden = !isEdit;
    $("mStatus").value = "true";

    // Departemen: Maintenance & Superadmin memilih bebas, Supervisor terkunci ke departemennya
    const depts = [...state.deptMap].filter(([id2]) => state.isAll || String(id2) === String(state.sessionDept));
    $("mDept").innerHTML = (state.isAll ? `<option value="">Pilih departemen</option>` : "") +
        depts.map(([id2, name]) => `<option value="${esc(id2)}">${esc(name)}</option>`).join("");
    $("mDept").value = row && row.dept_id !== null && row.dept_id !== undefined ? String(row.dept_id) : (state.isAll ? "" : String(state.sessionDept));
    if ($("mDept").selectedIndex < 0) $("mDept").selectedIndex = 0;
    $("mDept").disabled = !state.isAll;

    $("mParentField").hidden = !cfg.hasParent;
    if (cfg.hasParent) fillParentOptions(row ? row.kategori_inspeksi_id : "");

    $("masterFormOverlay").hidden = false;
    $("mName").focus();
}

function closeMasterForm() { $("masterFormOverlay").hidden = true; state.katEditId = null; }

async function saveMaster() {
    const cfg = masterCfg();
    const name = $("mName").value.trim();
    const desc = $("mDesc").value.trim();
    // Supervisor: dept_id SELALU dipaksa ke departemennya, tidak membaca isi dropdown
    const deptId = state.isAll ? parseInt($("mDept").value, 10) : state.sessionDept;

    if (!deptId || isNaN(deptId)) { alert("Departemen wajib dipilih."); return; }
    let parentId = null;
    if (cfg.hasParent) {
        parentId = parseInt($("mParent").value, 10);
        if (isNaN(parentId)) { alert("Kategori wajib dipilih."); return; }
    }
    if (!name) { alert(`${cfg.label} wajib diisi.`); $("mName").focus(); return; }

    // Nama yang sama di departemen (dan kategori induk) yang sama dianggap duplikat
    const dup = masterSource().some(r => Number(r.id) !== state.katEditId
        && String(r.dept_id) === String(deptId)
        && (!cfg.hasParent || String(r.kategori_inspeksi_id) === String(parentId))
        && sameText(r[cfg.nameCol], name));
    if (dup) { alert(`${cfg.label} "${name}" sudah ada di departemen tersebut (cek juga tab Non Aktif).`); return; }

    const btn = $("btnMasterFormSave");
    btn.disabled = true;
    try {
        const payload = { [cfg.nameCol]: name, deskripsi: desc || null, dept_id: deptId };
        if (cfg.hasParent) payload.kategori_inspeksi_id = parentId;

        const table = () => supabaseClient.schema(SCHEMA_OPR).from(cfg.table);
        const isEdit = state.katEditId !== null;
        let result;
        if (isEdit) {
            payload.is_active = $("mStatus").value === "true";
            let q = table().update(payload).eq("id", state.katEditId);
            if (!state.isAll) q = q.eq("dept_id", state.sessionDept);
            result = await q.select("id");
        } else {
            payload.is_active = true;       // data baru: otomatis aktif
            result = await table().insert(payload).select("id");
        }
        if (result.error) throw result.error;
        // Jika izin (RLS) menolak, Supabase tidak memberi error tetapi tidak ada baris yang berubah
        if (!result.data || result.data.length === 0) throw new Error("Tidak ada data yang tersimpan. Kemungkinan akun Anda tidak punya izin ubah di database.");

        await afterMasterChange(isEdit);
        closeMasterForm();
    } catch (err) {
        console.error(`Gagal menyimpan ${cfg.label}:`, err);
        alert(`Gagal menyimpan: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}

// "Hapus" = nonaktifkan (soft delete)
async function deactivateMaster(id) {
    const cfg = masterCfg();
    const row = masterSource().find(x => Number(x.id) === id);
    if (!row) return;
    if (!confirm(`Nonaktifkan ${cfg.label.toLowerCase()} "${row[cfg.nameCol]}"?\nData akan pindah ke tab Non Aktif. Temuan lama tetap menampilkan namanya.`)) return;
    try {
        let q = supabaseClient.schema(SCHEMA_OPR).from(cfg.table).update({ is_active: false }).eq("id", id);
        if (!state.isAll) q = q.eq("dept_id", state.sessionDept);
        const { data, error } = await q.select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Tidak ada data yang berubah. Kemungkinan akun Anda tidak punya izin ubah di database.");
        await afterMasterChange(true);
    } catch (err) {
        console.error(`Gagal menonaktifkan ${cfg.label}:`, err);
        alert(`Gagal menonaktifkan: ${err.message}`);
    }
}

// Menyegarkan kategori & sub kategori, dropdown filter, dan (jika nama bisa berubah) tabel laporan
async function afterMasterChange(refreshReport) {
    await Promise.all([loadKategori(), loadSub()]);
    renderMasterTable();
    fillKategoriOptions();
    if (refreshReport) loadReport();
}