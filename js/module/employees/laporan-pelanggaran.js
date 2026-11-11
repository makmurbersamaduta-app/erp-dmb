// ===================================================
// laporan-pelanggaran.js
// Halaman "Laporan Pelanggaran" (surat peringatan karyawan: opr.pelanggaran)
// Fitur: tabel per cabang (Makassar, Surabaya, Bekasi) dengan pagination 50 baris,
//        cari (NIK / nama / area), filter, pengaturan Jenis Pelanggaran,
//        dan tambah pelanggaran dengan saran SP berikutnya.
// WAJIB: jalankan laporan-pelanggaran.sql (grant, policy, trigger) terlebih dulu.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file. Jika nama tabel/schema
// berbeda di database Anda, cukup ubah di sini.
// ===================================================
let supabaseClient = window.supabaseClient;   // dibaca ulang saat halaman siap (Kelompok 4)

const SCHEMA_OPR = "opr";                     // pelanggaran, jenis_pelanggaran
const SCHEMA_HRD = "hrd";                     // karyawan
const TABLE_PELANGGARAN = "pelanggaran";
const TABLE_JENIS = "jenis_pelanggaran";
const TABLE_EMPLOYEES = "employees";          // hrd.employees (id, nik_karyawan, nama, is_active)
// PERLU DICEK: nama tabel penempatan karyawan (kolom employee_id, branch_id, departemen_id,
// area_id, bagian_id, start_date, is_active). Nama ini BELUM dikonfirmasi.
const SCHEMA_ASSIGNMENT = SCHEMA_HRD;
const TABLE_ASSIGNMENT = "employee_assignments";
const TABLE_BRANCH = "branches";              // schema default (public)
const TABLE_DEPT = "departments";
const TABLE_AREA = "areas";
// View yang dipakai TABEL & HITUNGAN laporan: hanya pelanggaran milik karyawan yang is_active = true
// (resign / nonaktif tidak tampil). Dibuat di laporan-pelanggaran.sql bagian 10. Input tetap ke tabel pelanggaran.
const REPORT_SOURCE = "pelanggaran_aktif";
// PERLU DICEK: tabel nama bagian (untuk baris "Bagian" di surat). Nama tabel ini BELUM dikonfirmasi.
const SCHEMA_BAGIAN = SCHEMA_HRD;
const TABLE_BAGIAN = "bagian";
const BAGIAN_NAME_FIELDS = ["bagian_name", "nama_bagian", "bagian", "name", "nama"];   // kolom nama dicari otomatis
// Alamat gambar kop surat. Dihitung relatif terhadap LOKASI FILE JS INI (bukan halaman HTML),
// jadi tidak tergantung di folder mana HTML berada. File JS ada di /js/module/employees/,
// maka "../../../" = akar proyek, dan gambar ada di /assets/images/ (sejajar folder js).
const SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
const KOP_BASE = "../../../assets/images/";
const KOP_FILE_NAMES = ["kop-dmb.JPG", "kop-dmb.jpg"];   // server Linux membedakan huruf besar/kecil ekstensi
const KOP_CANDIDATES = KOP_FILE_NAMES.map(n => new URL(KOP_BASE + n, SCRIPT_URL).href);
const COMPANY_NAME = "PT. Duta Makmur Bersama";
const LISAN_LABEL = "Peringatan Lisan";                 // opsi tambahan di filter Jenis Peringatan
const SP3_NEXT_TEXT = "Pemutusan Hubungan Kerja (PHK)"; // sanksi di surat SP-3 (tidak ada SP berikutnya)

const SESSION_KEY = "erp_session";
// Nama field di sesi. Skrip memakai field pertama yang ada. "username" dipakai sebagai NIK
// jika sesi tidak punya field nik (sama seperti PWA). PERLU DICEK dengan isi erp_session Anda.
const SESSION_FIELDS = {
    nik: ["nik", "nik_karyawan", "username"],
    branch: ["branchId", "branch_id"],
    department: ["depId", "deptId", "dept_id", "departmentId", "department_id"]
};

// Hak akses (role id)
const ROLE_IDS_BLOCKED = [5];                 // role yang TIDAK boleh membuka halaman (Employee)
const ROLE_IDS_ALL_BRANCH = [1, 2];           // melihat semua cabang + filter Branch (Maintenance, Superadmin)
const ROLE_IDS_ALL_DEPT = [1, 2, 3];          // melihat semua departemen + filter Department (+ Admin)
const ROLE_IDS_MANAGE_JENIS = [1, 2];         // boleh membuka Jenis Pelanggaran

const BRANCH_ORDER = [2, 1, 3];               // urutan kelompok: Makassar, Surabaya, Bekasi
const PAGE_SIZE = 50;                         // baris per halaman
const ID_CHUNK = 100;                         // jumlah id per sekali cari nama karyawan
const SEARCH_MAX_IDS = 200;                   // batas hasil pencarian karyawan (URL ada batas panjang)

// Surat Peringatan: label yang disimpan di kolom jenis_peringatan
const SP_LABELS = { 1: "Surat Peringatan - 1", 2: "Surat Peringatan - 2", 3: "Surat Peringatan - 3" };
const SP_MAX = 3;
const SP_VALID_MONTHS = 6;                    // End Date = Start Date + 6 bulan

const DEFAULT_TZ = "Asia/Jakarta";
const BRANCH_TZ = { 1: "Asia/Jakarta", 2: "Asia/Makassar", 3: "Asia/Jakarta" };

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ===================================================
const state = {
    roleId: null,
    restrictBranch: false,    // true jika role BUKAN 1/2: hanya cabang sendiri
    restrictDept: false,      // true jika role BUKAN 1/2/3: hanya departemen sendiri
    sessionBranch: null,
    sessionDept: null,
    employeeId: null,         // hrd.employees.id user login (isi kolom petugas)
    page: 1,
    totalRows: 0,
    search: "",
    filters: { branchId: "", deptId: "", areaId: "", sp: "", status: "" },
    branchMap: new Map(), deptMap: new Map(),
    areaList: [], areaMap: new Map(),
    jenis: [], jenisMap: new Map(),
    empCache: new Map(),      // id karyawan -> { nik, nama }
    deptList: [],             // semua departemen (id, nama, is_active)
    pageRows: new Map(),      // baris halaman aktif (id -> data), dipakai saat baris diklik
    detail: null,             // baris yang sedang tampil di modal detail
    reqId: 0,
    katTab: "aktif",
    editId: null,
    add: { employee: null, highest: 0, minStart: "", saving: false }
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// ===================================================
const $ = (id) => document.getElementById(id);

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function tzOf(branchId) { return BRANCH_TZ[branchId] || DEFAULT_TZ; }

// Tanggal hari ini "YYYY-MM-DD" di zona waktu cabang
function todayStr(branchId) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tzOf(branchId), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// "2026-11-09" -> "09-11-2026"
const BULAN_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Tampilan tabel & modal: "2026-11-09" -> "09 Nov 26"
function fmtDate(d) {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]} ${BULAN_SHORT[Number(m[2]) - 1]} ${m[1].slice(2)}` : String(d);
}

// Tanggal di surat: "2026-11-09" -> "9 November 2026"
function fmtDateLong(d) {
    const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${Number(m[3])} ${BULAN_LONG[Number(m[2]) - 1]} ${m[1]}` : String(d || "");
}

// Tambah bulan pada tanggal "YYYY-MM-DD". Jika tanggal tujuan tidak ada
// (mis. 31 Agu + 6 bulan), dipakai hari terakhir bulan itu.
function addMonths(dateStr, n) {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const idx = mo + n;
    const ty = y + Math.floor(idx / 12), tm = ((idx % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// Level SP dari teks jenis_peringatan (angka di akhir teks): "Surat Peringatan - 2" -> 2
function spLevel(text) {
    const m = String(text || "").match(/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
}

// Membersihkan kata kunci agar aman dipakai di filter (buang , ( ) * % \)
function sanitizeSearch(text) { return String(text || "").replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim(); }

let toastTimer = null;
function showToast(text) {
    const t = $("liToast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function fetchAll(buildQuery) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await buildQuery(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return out;
}

const oprFrom = (table) => supabaseClient.schema(SCHEMA_OPR).from(table);
const hrdFrom = (table) => supabaseClient.schema(SCHEMA_HRD).from(table);
const asgFrom = () => supabaseClient.schema(SCHEMA_ASSIGNMENT).from(TABLE_ASSIGNMENT);

// ===================================================
// KELOMPOK 3B: SESI LOGIN & HAK AKSES
// Fungsi: membaca erp_session. Role 5 (Employee) ditolak. CATATAN KEAMANAN:
// pembatasan ini hanya di browser; pembatasan data yang sebenarnya harus lewat RLS.
// ===================================================
function getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (err) { console.error("Sesi login tidak bisa dibaca:", err); return null; }
}

function findField(obj, names, depth = 2) {
    if (!obj || typeof obj !== "object") return null;
    for (const n of names) {
        if (obj[n] !== undefined && obj[n] !== null && obj[n] !== "") return obj[n];
    }
    if (depth > 0) {
        for (const v of Object.values(obj)) {
            if (v && typeof v === "object" && !Array.isArray(v)) {
                const r = findField(v, names, depth - 1);
                if (r !== null) return r;
            }
        }
    }
    return null;
}
function toInt(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }

function blockPage(message) {
    $("subTitle").textContent = "-";
    $("pelanggaranTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">${esc(message)}</td></tr>`;
    ["btnFilter", "btnTambah", "btnJenis", "btnSearch"].forEach(id => { const el = $(id); if (el) el.disabled = true; });
}

// NIK -> id karyawan (uuid). Kolom petugas dan employee_id berisi id ini.
async function resolveEmployeeId(nik) {
    const { data, error } = await hrdFrom(TABLE_EMPLOYEES).select("id").eq("nik_karyawan", nik).limit(1);
    if (error) throw error;
    return data && data.length ? data[0].id : null;
}

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: periksa koneksi, login, dan role; atur tampilan sesuai role;
// muat data pendukung; lalu muat laporan.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    supabaseClient = window.supabaseClient || supabaseClient;
    if (!supabaseClient) {
        console.error("window.supabaseClient kosong. Cek tab Network (F12): apakah supabase.js 404?");
        blockPage("Koneksi database tidak tersedia (supabase.js tidak termuat). Periksa path <script> di laporan-pelanggaran.html.");
        return;
    }
    const session = getSession();
    if (!session) { blockPage("Sesi login tidak ditemukan. Silakan login ulang."); return; }

    state.roleId = Number(session.roleId);
    state.sessionBranch = toInt(findField(session, SESSION_FIELDS.branch));
    state.sessionDept = toInt(findField(session, SESSION_FIELDS.department));
    const nik = findField(session, SESSION_FIELDS.nik);
    state.restrictBranch = !ROLE_IDS_ALL_BRANCH.includes(state.roleId);
    state.restrictDept = !ROLE_IDS_ALL_DEPT.includes(state.roleId);
    // Diagnostik: lihat di Console (F12) jika halaman terblokir / data tidak sesuai
    console.info("[Laporan Pelanggaran] roleId:", state.roleId, "| cabang:", state.sessionBranch, "| dept:", state.sessionDept, "| nik:", nik);

    if (ROLE_IDS_BLOCKED.includes(state.roleId)) { blockPage("Anda tidak memiliki akses ke halaman ini."); return; }
    if (state.restrictBranch && state.sessionBranch === null) { blockPage("Cabang akun Anda tidak terdeteksi. Hubungi admin."); return; }
    if (state.restrictDept && state.sessionDept === null) { blockPage("Departemen akun Anda tidak terdeteksi. Hubungi admin."); return; }

    document.querySelectorAll(".li-only-branch").forEach(el => { el.hidden = state.restrictBranch; });
    document.querySelectorAll(".li-only-dept").forEach(el => { el.hidden = state.restrictDept; });
    $("btnJenis").hidden = !ROLE_IDS_MANAGE_JENIS.includes(state.roleId);

    setupSearch();
    setupFilter();
    setupJenis();
    setupAdd();
    setupDetail();
    document.addEventListener("keydown", onEscape);

    try { await loadLookups(); }
    catch (err) {
        console.error("Gagal memuat data pendukung:", err);
        $("pelanggaranTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data pendukung: ${esc(err.message)}</td></tr>`;
        return;
    }
    updateSubTitle();
    loadReport();

    // id karyawan user login: hanya dibutuhkan untuk Tambah Pelanggaran (kolom petugas)
    try {
        if (nik) state.employeeId = await resolveEmployeeId(String(nik).trim());
    } catch (err) { console.error("Gagal membaca data karyawan user:", err); }
    if (!state.employeeId) {
        $("btnTambah").disabled = true;
        $("btnTambah").title = "Data karyawan akun Anda tidak ditemukan (NIK sesi tidak cocok dengan hrd.employees)";
    }
});

function onEscape(e) {
    if (e.key !== "Escape") return;
    if (!$("masterFormOverlay").hidden) closeJenisForm();
    else if (!$("masterOverlay").hidden) closeJenisModal();
    else if (!$("addOverlay").hidden) closeAdd();
    else if (!$("detailOverlay").hidden) closeDetail();
}

// ===================================================
// KELOMPOK 5: DATA PENDUKUNG
// Fungsi: tabel referensi kecil, dimuat sekali di awal untuk dropdown dan nama.
// ===================================================
async function loadLookups() {
    const [branches, depts, areas] = await Promise.all([
        fetchAll((f, t) => supabaseClient.from(TABLE_BRANCH).select("id, branch_name").order("id").range(f, t)),
        fetchAll((f, t) => supabaseClient.from(TABLE_DEPT).select("id, department_name, is_active").order("department_name").range(f, t)),
        fetchAll((f, t) => supabaseClient.from(TABLE_AREA).select("id, area_name, branch_id, is_active").order("area_name").range(f, t))
    ]);
    await loadJenis();

    state.branchMap = new Map(branches.map(b => [String(b.id), b.branch_name]));
    state.deptMap = new Map(depts.map(d => [String(d.id), d.department_name]));
    state.deptList = depts;
    state.areaList = areas;
    state.areaMap = new Map(areas.map(a => [String(a.id), a.area_name]));

    $("fBranch").innerHTML = `<option value="">Semua Branch</option>` +
        branches.map(b => `<option value="${esc(b.id)}">${esc(b.branch_name)}</option>`).join("");
    $("fDept").innerHTML = `<option value="">Semua Department</option>` +
        depts.filter(d => d.is_active !== false).map(d => `<option value="${esc(d.id)}">${esc(d.department_name)}</option>`).join("");   // departemen nonaktif tidak ditawarkan
    $("fSP").innerHTML = `<option value="">Semua Jenis</option>` +
        [LISAN_LABEL, ...Object.values(SP_LABELS)].map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
    fillAreaOptions();
}

async function loadJenis() {
    const rows = await fetchAll((f, t) => oprFrom(TABLE_JENIS)
        .select("id, jenis_pelanggaran, deskripsi, is_active")
        .order("jenis_pelanggaran").order("id").range(f, t));
    state.jenis = rows;
    state.jenisMap = new Map(rows.map(j => [String(j.id), j.jenis_pelanggaran]));
}

// Dropdown Area menyempit sesuai cabang (cabang akun, atau cabang yang dipilih di filter)
function fillAreaOptions() {
    const branch = state.restrictBranch ? state.sessionBranch : $("fBranch").value;
    // area nonaktif (is_active false) tidak ditawarkan; namanya tetap dikenali untuk tampilan data lama
    const list = state.areaList.filter(a => a.is_active !== false && (!branch || String(a.branch_id) === String(branch)));
    const current = $("fArea").value;
    $("fArea").innerHTML = `<option value="">Semua Area</option>` +
        list.map(a => `<option value="${esc(a.id)}">${esc(a.area_name)}</option>`).join("");
    $("fArea").value = current;
    if ($("fArea").selectedIndex < 0) $("fArea").selectedIndex = 0;
}

function updateSubTitle() {
    let text;
    if (state.restrictBranch) text = state.branchMap.get(String(state.sessionBranch)) || `Cabang ${state.sessionBranch}`;
    else text = state.filters.branchId ? (state.branchMap.get(String(state.filters.branchId)) || "-") : "Semua Cabang";
    if (state.restrictDept) text += ` - ${state.deptMap.get(String(state.sessionDept)) || `Dept ${state.sessionDept}`}`;
    $("subTitle").textContent = text;
}

// ===================================================
// KELOMPOK 6: CARI & FILTER
// Fungsi: cari (NIK, nama, atau area) dan panel filter. Berlaku setelah
// Enter / tombol cari / tombol Terapkan. Filter role (cabang & departemen
// akun) SELALU dipasang di applyFilters(), terlepas dari isi panel.
// ===================================================
function setupSearch() {
    const run = () => {
        state.search = $("searchInput").value.trim();
        $("btnSearchClear").hidden = !state.search;
        state.page = 1;
        loadReport();
    };
    $("btnSearch").addEventListener("click", run);
    $("searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    $("searchInput").addEventListener("input", () => { $("btnSearchClear").hidden = !$("searchInput").value; });
    $("btnSearchClear").addEventListener("click", () => {
        $("searchInput").value = "";
        if (state.search) run(); else $("btnSearchClear").hidden = true;
    });
}

function setupFilter() {
    $("btnFilter").addEventListener("click", (e) => { e.stopPropagation(); $("filterPanel").hidden = !$("filterPanel").hidden; });
    document.addEventListener("click", (e) => {
        if (!$("filterPanel").hidden && !e.target.closest(".li-filter-wrap")) $("filterPanel").hidden = true;
    });
    $("fBranch").addEventListener("change", fillAreaOptions);
    $("btnFilterApply").addEventListener("click", () => {
        state.filters = {
            branchId: state.restrictBranch ? "" : $("fBranch").value,
            deptId: state.restrictDept ? "" : $("fDept").value,
            areaId: $("fArea").value,
            sp: $("fSP").value,
            status: $("fStatus").value
        };
        afterFilterChange();
    });
    $("btnFilterReset").addEventListener("click", () => {
        state.filters = { branchId: "", deptId: "", areaId: "", sp: "", status: "" };
        ["fBranch", "fDept", "fArea", "fSP", "fStatus"].forEach(id => { $(id).value = ""; });
        fillAreaOptions();
        afterFilterChange();
    });
}

function afterFilterChange() {
    state.page = 1;
    $("filterPanel").hidden = true;
    const f = state.filters;
    const n = ["branchId", "deptId", "areaId", "sp", "status"].filter(k => f[k]).length;
    $("filterBadge").textContent = n;
    $("filterBadge").hidden = n === 0;
    updateSubTitle();
    loadReport();
}

// Kelompok cabang: urut Makassar, Surabaya, Bekasi, lalu cabang lain / kosong.
// Jika cabang dibatasi (role) atau dipilih di filter, hanya satu kelompok.
function reportGroups() {
    const sel = state.restrictBranch ? state.sessionBranch : state.filters.branchId;
    if (sel) return [{ type: "eq", id: Number(sel) }];
    return [...BRANCH_ORDER.map(id => ({ type: "eq", id })), { type: "other" }];
}

// Menempelkan syarat kelompok + role + filter + pencarian ke sebuah query pelanggaran
function applyFilters(query, group, search) {
    const f = state.filters;
    let q = query;
    q = group.type === "eq" ? q.eq("branch_id", group.id) : q.or(`branch_id.is.null,branch_id.not.in.(${BRANCH_ORDER.join(",")})`);
    if (state.restrictDept) q = q.eq("dept_id", state.sessionDept);
    else if (f.deptId) q = q.eq("dept_id", f.deptId);
    if (f.areaId) q = q.eq("area_id", f.areaId);
    if (f.sp) q = q.eq("jenis_peringatan", f.sp);
    if (f.status) {
        const today = todayStr(group.type === "eq" ? group.id : null);
        // Aktif = is_active true DAN belum lewat End Date. Non Aktif = sebaliknya.
        if (f.status === "aktif") q = q.eq("is_active", true).or(`end_date.is.null,end_date.gte.${today}`);
        else q = q.or(`is_active.is.null,is_active.eq.false,end_date.lt.${today}`);
    }
    if (search) {
        const parts = [];
        if (search.empIds.length) parts.push(`employee_id.in.(${search.empIds.join(",")})`);
        if (search.areaIds.length) parts.push(`area_id.in.(${search.areaIds.join(",")})`);
        q = q.or(parts.join(","));
    }
    return q;
}

// Pencarian: cari karyawan (NIK/nama) di hrd.employees dan area (nama) di daftar area.
// Hasil: { empIds, areaIds } | "EMPTY" (tidak ada yang cocok) | "TOO_BROAD" | null (tanpa pencarian)
async function buildSearchSpec() {
    const q = sanitizeSearch(state.search);
    if (!q) return null;
    const { data, error } = await hrdFrom(TABLE_EMPLOYEES).select("id")
        .or(`nama.ilike.*${q}*,nik_karyawan.ilike.*${q}*`).limit(SEARCH_MAX_IDS + 1);
    if (error) throw error;
    if ((data || []).length > SEARCH_MAX_IDS) return "TOO_BROAD";
    const empIds = (data || []).map(e => e.id);
    const needle = q.toLowerCase();
    const areaIds = state.areaList.filter(a => String(a.area_name || "").toLowerCase().includes(needle)).map(a => a.id);
    if (!empIds.length && !areaIds.length) return "EMPTY";
    return { empIds, areaIds };
}

// ===================================================
// KELOMPOK 7: MEMUAT LAPORAN (PER HALAMAN, PER KELOMPOK CABANG)
// Fungsi: urutan tampil = kelompok cabang (Makassar, Surabaya, Bekasi, lainnya),
// di tiap kelompok Start Date terbaru di atas. Agar pagination 50 baris tetap
// benar tanpa memuat semua data, jumlah baris tiap kelompok dihitung dulu,
// lalu hanya potongan yang dibutuhkan halaman ini yang diambil.
// ===================================================
const REPORT_COLUMNS = "id, branch_id, dept_id, area_id, bagian_id, petugas, employee_id, jenis_peringatan, jenis_pelanggaran_id, deskripsi, start_date, end_date, is_active";

async function loadReport() {
    const myReq = ++state.reqId;
    $("pelanggaranTableBody").innerHTML = `<tr class="row-loading"><td colspan="8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        const search = await buildSearchSpec();
        if (myReq !== state.reqId) return;
        if (search === "TOO_BROAD") {
            showToast("Kata kunci terlalu umum. Gunakan NIK, nama lengkap, atau area yang lebih spesifik.");
            renderTable([]); renderPagination(1);
            return;
        }
        if (search === "EMPTY") { state.totalRows = 0; renderTable([]); renderPagination(1); return; }

        const groups = reportGroups();
        const counts = await Promise.all(groups.map(async (g) => {
            const { count, error } = await applyFilters(oprFrom(REPORT_SOURCE).select("id", { count: "exact", head: true }), g, search);
            if (error) throw error;
            return count || 0;
        }));
        if (myReq !== state.reqId) return;

        state.totalRows = counts.reduce((a, b) => a + b, 0);
        const totalPages = Math.max(1, Math.ceil(state.totalRows / PAGE_SIZE));
        if (state.page > totalPages) state.page = totalPages;

        let skip = (state.page - 1) * PAGE_SIZE;
        let need = PAGE_SIZE;
        const rows = [];
        for (let i = 0; i < groups.length && need > 0; i++) {
            if (skip >= counts[i]) { skip -= counts[i]; continue; }
            const take = Math.min(need, counts[i] - skip);
            const { data, error } = await applyFilters(oprFrom(REPORT_SOURCE).select(REPORT_COLUMNS), groups[i], search)
                .order("start_date", { ascending: false, nullsFirst: false })
                .order("id", { ascending: false })
                .range(skip, skip + take - 1);
            if (error) throw error;
            rows.push(...(data || []));
            need -= take;
            skip = 0;
        }

        await resolveEmployees(rows.map(r => r.employee_id));
        if (myReq !== state.reqId) return;
        renderTable(rows);
        renderPagination(totalPages);
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat laporan pelanggaran:", err);
        $("pelanggaranTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data: ${esc(reportErrorHint(err))}</td></tr>`;
        $("pelanggaranPagination").innerHTML = "";
    }
}

// Pesan error: jika view laporan belum dibuat, beri petunjuk
function reportErrorHint(err) {
    const m = String(err && err.message || "");
    if ((err && (err.code === "PGRST205" || err.code === "42P01")) || m.includes(REPORT_SOURCE)) {
        return `${m} (View ${SCHEMA_OPR}.${REPORT_SOURCE} belum dibuat. Jalankan laporan-pelanggaran.sql bagian 10.)`;
    }
    return m;
}

// Mencari NIK dan nama karyawan berdasarkan employee_id (yang belum pernah dicari saja)
async function resolveEmployees(ids) {
    const need = [...new Set(ids.filter(n => n && !state.empCache.has(String(n))).map(String))];
    for (let i = 0; i < need.length; i += ID_CHUNK) {
        const chunk = need.slice(i, i + ID_CHUNK);
        const { data, error } = await hrdFrom(TABLE_EMPLOYEES).select("id, nik_karyawan, nama").in("id", chunk);
        if (error) throw error;
        (data || []).forEach(e => state.empCache.set(String(e.id), { nik: e.nik_karyawan, nama: e.nama }));
        chunk.forEach(n => { if (!state.empCache.has(n)) state.empCache.set(n, { nik: "", nama: "" }); });
    }
}

// Status tampilan: Aktif hanya jika is_active true DAN belum melewati End Date
function isAktif(r) {
    return r.is_active === true && (!r.end_date || String(r.end_date) >= todayStr(r.branch_id));
}

// ===================================================
// KELOMPOK 8: TAMPILAN TABEL + PAGINATION
// ===================================================
function renderTable(rows) {
    const tbody = $("pelanggaranTableBody");
    state.pageRows = new Map(rows.map(r => [String(r.id), r]));
    if (rows.length === 0) {
        const filtered = state.search || Object.values(state.filters).some(Boolean);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="8">${filtered ? "Tidak ada data yang cocok dengan pencarian / filter." : "Belum ada data pelanggaran."}</td></tr>`;
        return;
    }
    const dash = `<span class="data-empty-cell">-</span>`;
    const cell = (v) => v ? esc(v) : dash;
    tbody.innerHTML = rows.map(r => {
        const emp = state.empCache.get(String(r.employee_id)) || {};
        const aktif = isAktif(r);
        return `
            <tr class="li-row-click" data-id="${esc(r.id)}">
                <td>${cell(emp.nik)}</td>
                <td>${cell(emp.nama)}</td>
                <td>${cell(r.jenis_peringatan)}</td>
                <td>${cell(state.jenisMap.get(String(r.jenis_pelanggaran_id)))}</td>
                <td class="col-desc" title="${esc(r.deskripsi)}">${cell(r.deskripsi)}</td>
                <td>${cell(fmtDate(r.start_date))}</td>
                <td>${cell(fmtDate(r.end_date))}</td>
                <td><span class="li-pill ${aktif ? "on" : "off"}">${aktif ? "Aktif" : "Non Aktif"}</span></td>
            </tr>`;
    }).join("");
}

function renderPagination(totalPages) {
    const container = $("pelanggaranPagination");
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
// KELOMPOK 9: PENGATURAN JENIS PELANGGARAN (MODAL + SUB MODAL FORM)
// Fungsi: kelola opr.jenis_pelanggaran, modelnya sama dengan Kategori di laporan-inspeksi.
//  - Tab Aktif / Non Aktif. Tambah: is_active otomatis true.
//  - Hapus = nonaktifkan (is_active false), bukan menghapus baris, agar data
//    pelanggaran lama tetap punya nama jenis pelanggaran.
//  - Tab Non Aktif: klik baris membuka form edit dengan status sudah "Aktif".
// ===================================================
function setupJenis() {
    $("btnJenis").addEventListener("click", openJenisModal);
    $("btnMasterClose").addEventListener("click", closeJenisModal);
    $("btnMasterCloseFoot").addEventListener("click", closeJenisModal);
    $("masterOverlay").addEventListener("click", (e) => { if (e.target === $("masterOverlay")) closeJenisModal(); });

    document.querySelectorAll(".li-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            state.katTab = btn.dataset.tab;
            document.querySelectorAll(".li-tab").forEach(b => b.classList.toggle("active", b === btn));
            renderJenisTable();
        });
    });
    $("btnMasterAdd").addEventListener("click", () => openJenisForm(null));
    $("btnMasterFormClose").addEventListener("click", closeJenisForm);
    $("btnMasterFormCancel").addEventListener("click", closeJenisForm);
    $("btnMasterFormSave").addEventListener("click", saveJenis);

    $("masterTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (btn) {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === "edit") openJenisForm(id);
            else if (btn.dataset.action === "hapus") deactivateJenis(id);
            return;
        }
        const tr = e.target.closest("tr[data-row-id]");
        if (tr && state.katTab === "nonaktif") openJenisForm(Number(tr.dataset.rowId));
    });
}

function openJenisModal() {
    state.katTab = "aktif";
    document.querySelectorAll(".li-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === "aktif"));
    renderJenisTable();
    $("masterOverlay").hidden = false;
}
function closeJenisModal() { closeJenisForm(); $("masterOverlay").hidden = true; }

function renderJenisTable() {
    const isAktif = state.katTab === "aktif";
    const list = state.jenis.filter(j => (j.is_active === true) === isAktif);
    const tbody = $("masterTableBody");
    if (list.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="5">${isAktif ? "Belum ada jenis pelanggaran aktif." : "Tidak ada jenis pelanggaran non aktif."}</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map((j, i) => `
        <tr data-row-id="${esc(j.id)}" class="${isAktif ? "" : "li-row-click"}" ${isAktif ? "" : 'title="Klik untuk mengaktifkan kembali"'}>
            <td style="text-align:center">${i + 1}</td>
            <td>${esc(j.jenis_pelanggaran)}</td>
            <td>${j.deskripsi ? esc(j.deskripsi) : '<span class="data-empty-cell">-</span>'}</td>
            <td><span class="li-pill ${isAktif ? "on" : "off"}">${isAktif ? "Aktif" : "Non Aktif"}</span></td>
            <td><div class="li-act">
                <button type="button" data-action="edit" data-id="${esc(j.id)}">Edit</button>
                ${isAktif ? `<button type="button" class="danger" data-action="hapus" data-id="${esc(j.id)}">Hapus</button>` : ""}
            </div></td>
        </tr>`).join("");
}

// id = null -> tambah. id = angka -> edit (status default Aktif).
function openJenisForm(id) {
    state.editId = id;
    const isEdit = id !== null;
    const row = isEdit ? state.jenis.find(x => Number(x.id) === id) : null;
    if (isEdit && !row) return;
    $("masterFormTitle").textContent = isEdit ? "Edit Jenis Pelanggaran" : "Tambah Jenis Pelanggaran";
    $("mName").value = row ? (row.jenis_pelanggaran || "") : "";
    $("mDesc").value = row ? (row.deskripsi || "") : "";
    $("mStatusField").hidden = !isEdit;
    $("mStatus").value = "true";
    $("masterFormOverlay").hidden = false;
    $("mName").focus();
}
function closeJenisForm() { $("masterFormOverlay").hidden = true; state.editId = null; }

async function saveJenis() {
    const name = $("mName").value.trim();
    const desc = $("mDesc").value.trim();
    if (!name) { alert("Jenis Pelanggaran wajib diisi."); $("mName").focus(); return; }
    const dup = state.jenis.some(j => Number(j.id) !== state.editId
        && String(j.jenis_pelanggaran || "").trim().toLowerCase() === name.toLowerCase());
    if (dup) { alert(`Jenis pelanggaran "${name}" sudah ada (cek juga tab Non Aktif).`); return; }

    const btn = $("btnMasterFormSave");
    btn.disabled = true;
    try {
        const isEdit = state.editId !== null;
        const payload = { jenis_pelanggaran: name, deskripsi: desc || null };
        let result;
        if (isEdit) {
            payload.is_active = $("mStatus").value === "true";
            result = await oprFrom(TABLE_JENIS).update(payload).eq("id", state.editId).select("id");
        } else {
            payload.is_active = true;                  // data baru: otomatis aktif
            result = await oprFrom(TABLE_JENIS).insert(payload).select("id");
        }
        if (result.error) throw result.error;
        if (!result.data || result.data.length === 0) throw new Error("Tidak ada data yang tersimpan. Kemungkinan akun Anda tidak punya izin ubah di database.");
        await afterJenisChange(isEdit);
        closeJenisForm();
    } catch (err) {
        console.error("Gagal menyimpan jenis pelanggaran:", err);
        alert(`Gagal menyimpan: ${err.message}`);
    } finally { btn.disabled = false; }
}

async function deactivateJenis(id) {
    const row = state.jenis.find(x => Number(x.id) === id);
    if (!row) return;
    if (!confirm(`Nonaktifkan jenis pelanggaran "${row.jenis_pelanggaran}"?\nData akan pindah ke tab Non Aktif. Pelanggaran lama tetap menampilkan namanya.`)) return;
    try {
        const { data, error } = await oprFrom(TABLE_JENIS).update({ is_active: false }).eq("id", id).select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Tidak ada data yang berubah. Kemungkinan akun Anda tidak punya izin ubah di database.");
        await afterJenisChange(true);
    } catch (err) {
        console.error("Gagal menonaktifkan jenis pelanggaran:", err);
        alert(`Gagal menonaktifkan: ${err.message}`);
    }
}

async function afterJenisChange(refreshReport) {
    await loadJenis();
    renderJenisTable();
    if (refreshReport) loadReport();
}

// ===================================================
// KELOMPOK 10: TAMBAH PELANGGARAN - PEMILIHAN KARYAWAN
// Fungsi: kolom cari (nama atau NIK) menampilkan saran karyawan AKTIF.
// Role 1, 2, 3: semua karyawan aktif. Role lain: hanya yang penempatan
// aktifnya di departemen yang sama. Nilai yang disimpan = employee_id.
// Penempatan aktif (cabang, departemen, area, bagian) dibaca dari tabel penempatan
// dan dipakai untuk mengisi kolom di belakang layar.
// ===================================================
let empTimer = null;
let empReq = 0;
const empOptions = new Map();

function setupAdd() {
    $("btnTambah").addEventListener("click", openAdd);
    $("btnAddClose").addEventListener("click", closeAdd);
    $("btnAddCancel").addEventListener("click", closeAdd);
    $("btnAddSave").addEventListener("click", saveAdd);
    $("pEmpSearch").addEventListener("input", onEmpInput);
    $("btnEmpClear").addEventListener("click", clearEmployee);
    $("pStart").addEventListener("change", onStartChange);
    // pilihan saran karyawan (mousedown agar terpilih sebelum kolom kehilangan fokus)
    $("pEmpList").addEventListener("mousedown", (e) => {
        const item = e.target.closest(".li-suggest-item[data-id]");
        if (!item || item.classList.contains("disabled")) return;
        e.preventDefault();
        chooseEmployee(empOptions.get(item.dataset.id));
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".li-rel")) $("pEmpList").hidden = true; });
}

function showAddMsg(text, type) {
    const el = $("addMsg");
    if (!text) { el.hidden = true; el.textContent = ""; return; }
    el.className = `li-alert ${type || "danger"}`;
    el.textContent = text;
    el.hidden = false;
}

function openAdd() {
    state.add = { employee: null, highest: 0, minStart: "", saving: false };
    $("pStart").removeAttribute("min");
    $("pEmpSearch").value = "";
    $("pEmpSearch").hidden = false;
    $("pEmpChosen").hidden = true;
    $("pEmpList").hidden = true;
    $("pSpInfo").hidden = true;
    resetSpSelect("Pilih karyawan dulu");
    $("pJenis").innerHTML = `<option value="">Pilih Jenis Pelanggaran</option>` +
        state.jenis.filter(j => j.is_active === true).map(j => `<option value="${esc(j.id)}">${esc(j.jenis_pelanggaran)}</option>`).join("");
    $("pDesc").value = "";
    $("pStart").value = todayStr(state.sessionBranch);
    updateEndDate();
    showAddMsg("", "");
    $("addOverlay").hidden = false;
    $("pEmpSearch").focus();
}
function closeAdd() { $("addOverlay").hidden = true; $("pEmpList").hidden = true; }

function resetSpSelect(text) {
    $("pSp").innerHTML = `<option value="">${esc(text)}</option>`;
    $("pSp").disabled = true;
}

// Start Date tidak boleh lebih kecil dari Start Date Surat Peringatan sebelumnya karyawan yang sama
function onStartChange() {
    const min = state.add.minStart;
    if (min && $("pStart").value && $("pStart").value < min) {
        $("pStart").value = min;
        showAddMsg(`Start Date tidak boleh lebih kecil dari Start Date SP sebelumnya (${fmtDate(min)}). Tanggal dikembalikan ke ${fmtDate(min)}.`, "warn");
    }
    updateEndDate();
}

// End Date = Start Date + 6 bulan (otomatis, tidak bisa diketik)
function updateEndDate() { $("pEnd").value = addMonths($("pStart").value, SP_VALID_MONTHS); }

function onEmpInput() {
    clearTimeout(empTimer);
    const q = sanitizeSearch($("pEmpSearch").value);
    if (q.length < 2) { $("pEmpList").hidden = true; return; }
    empTimer = setTimeout(() => runEmpSearch(q), 300);
}

// Penempatan aktif terbaru tiap karyawan: Map(employee_id -> baris penempatan)
async function fetchAssignments(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const { data, error } = await asgFrom()
            .select("employee_id, branch_id, departemen_id, area_id, bagian_id, start_date")
            .in("employee_id", ids.slice(i, i + ID_CHUNK)).eq("is_active", true)
            .order("start_date", { ascending: false });
        if (error) throw error;
        (data || []).forEach(a => { if (!out.has(String(a.employee_id))) out.set(String(a.employee_id), a); });
    }
    return out;
}

async function runEmpSearch(q) {
    const my = ++empReq;
    const list = $("pEmpList");
    list.hidden = false;
    list.innerHTML = `<div class="li-suggest-item disabled">Mencari...</div>`;
    try {
        const { data, error } = await hrdFrom(TABLE_EMPLOYEES).select("id, nik_karyawan, nama")
            .eq("is_active", true).or(`nama.ilike.*${q}*,nik_karyawan.ilike.*${q}*`)
            .order("nama").limit(state.restrictDept ? 60 : 20);
        if (error) throw error;
        if (my !== empReq) return;
        const asg = await fetchAssignments((data || []).map(e => e.id));
        if (my !== empReq) return;

        let items = (data || []).map(e => ({ id: e.id, nik: e.nik_karyawan, nama: e.nama, asg: asg.get(String(e.id)) || null }));
        // Role di luar 1, 2, 3: hanya karyawan di departemen yang sama
        if (state.restrictDept) items = items.filter(e => e.asg && String(e.asg.departemen_id) === String(state.sessionDept));
        items = items.slice(0, 20);

        empOptions.clear();
        if (items.length === 0) { list.innerHTML = `<div class="li-suggest-item disabled">Karyawan aktif tidak ditemukan</div>`; return; }
        list.innerHTML = items.map(e => {
            empOptions.set(String(e.id), e);
            const dept = e.asg ? (state.deptMap.get(String(e.asg.departemen_id)) || "") : "";
            return e.asg
                ? `<div class="li-suggest-item" data-id="${esc(e.id)}">${esc(e.nama)}<small>${esc(e.nik)}${dept ? " - " + esc(dept) : ""}</small></div>`
                : `<div class="li-suggest-item disabled" data-id="${esc(e.id)}">${esc(e.nama)}<small>${esc(e.nik)} - penempatan aktif tidak ditemukan</small></div>`;
        }).join("");
    } catch (err) {
        if (my !== empReq) return;
        console.error("Gagal mencari karyawan:", err);
        list.innerHTML = `<div class="li-suggest-item disabled">Gagal mencari: ${esc(err.message)}</div>`;
    }
}

function clearEmployee() {
    state.add.employee = null;
    state.add.highest = 0;
    state.add.minStart = "";
    $("pStart").removeAttribute("min");
    $("pEmpChosen").hidden = true;
    $("pEmpSearch").hidden = false;
    $("pEmpSearch").value = "";
    $("pSpInfo").hidden = true;
    resetSpSelect("Pilih karyawan dulu");
    showAddMsg("", "");
    $("pEmpSearch").focus();
}

async function chooseEmployee(e) {
    if (!e) return;
    state.add.employee = e;
    $("pEmpList").hidden = true;
    $("pEmpSearch").hidden = true;
    $("pEmpChosen").hidden = false;
    $("pEmpChosenText").textContent = `${e.nik} - ${e.nama}`;
    // tanggal mulai default mengikuti zona waktu cabang karyawan
    $("pStart").value = todayStr(e.asg.branch_id);
    updateEndDate();
    await refreshSpOptions();
}

// ===================================================
// KELOMPOK 11: SARAN SP BERIKUTNYA
// Fungsi: membaca pelanggaran karyawan yang MASIH BERLAKU menurut End Date
// (end_date kosong atau belum lewat; kolom is_active TIDAK dipakai).
// SP tertinggi yang berlaku = level terakhir. Opsi yang tersedia hanya level di atasnya.
// Jika SP-3 masih berlaku: peringatan, tidak ada SP berikutnya (proses selanjutnya PHK).
// ===================================================
async function getActiveSp(employeeId, branchId) {
    const today = todayStr(branchId);
    // Semua SP karyawan ini (riwayat), terbaru dulu. Peringatan Lisan / teks tanpa angka tidak dihitung.
    const { data, error } = await oprFrom(TABLE_PELANGGARAN)
        .select("jenis_peringatan, start_date, end_date")
        .eq("employee_id", employeeId)
        .order("start_date", { ascending: false, nullsFirst: false })
        .limit(500);
    if (error) throw error;
    const all = (data || []).filter(r => spLevel(r.jenis_peringatan) > 0);
    // Masih berlaku menurut End Date (kolom is_active tidak dipakai)
    const rows = all.filter(r => !r.end_date || String(r.end_date) >= today);
    const highest = rows.reduce((m, r) => Math.max(m, spLevel(r.jenis_peringatan)), 0);
    // Start Date SP terakhir (dari seluruh riwayat) = batas terendah Start Date SP baru
    const lastStart = all.reduce((m, r) => (r.start_date && String(r.start_date) > m ? String(r.start_date) : m), "");
    return { highest, rows, lastStart };
}

async function refreshSpOptions() {
    const e = state.add.employee;
    if (!e) return;
    resetSpSelect("Memeriksa SP sebelumnya...");
    $("pSpInfo").hidden = true;
    $("pSpInfo").textContent = "";
    showAddMsg("", "");
    try {
        const { highest, rows, lastStart } = await getActiveSp(e.id, e.asg.branch_id);
        if (state.add.employee !== e) return;           // karyawan diganti saat memeriksa
        state.add.highest = highest;
        state.add.minStart = lastStart;
        if (lastStart) {
            $("pStart").min = lastStart;
            if ($("pStart").value < lastStart) { $("pStart").value = lastStart; updateEndDate(); }
        } else { $("pStart").removeAttribute("min"); }

        if (rows.length) {
            const info = rows.sort((a, b) => spLevel(a.jenis_peringatan) - spLevel(b.jenis_peringatan))
                .map(r => `${r.jenis_peringatan} (s.d. ${r.end_date ? fmtDate(r.end_date) : "tanpa batas"})`).join("\n");
            $("pSpInfo").textContent = `SP yang masih berlaku:\n${info}`;
            $("pSpInfo").hidden = false;
        }
        if (lastStart) {
            $("pSpInfo").textContent += `${rows.length ? "\n" : ""}Start Date tidak boleh lebih kecil dari ${fmtDate(lastStart)} (Start Date SP sebelumnya).`;
            $("pSpInfo").hidden = false;
        }
        if (highest >= SP_MAX) {
            resetSpSelect("Tidak ada SP berikutnya");
            showAddMsg(`${e.nama} sudah mendapat ${SP_LABELS[SP_MAX]} yang masih berlaku dan tidak ada SP berikutnya yang bisa diberikan. Proses selanjutnya adalah PHK.`, "warn");
            return;
        }
        const options = [];
        for (let lv = highest + 1; lv <= SP_MAX; lv++) options.push(`<option value="${esc(SP_LABELS[lv])}">${esc(SP_LABELS[lv])}</option>`);
        $("pSp").innerHTML = `<option value="">Pilih Jenis Peringatan</option>${options.join("")}`;
        $("pSp").disabled = false;
    } catch (err) {
        console.error("Gagal memeriksa SP karyawan:", err);
        resetSpSelect("Gagal memeriksa SP");
        showAddMsg(`Gagal memeriksa SP sebelumnya: ${err.message}`, "danger");
    }
}

// ===================================================
// KELOMPOK 12: SIMPAN PELANGGARAN
// Fungsi: validasi, periksa ulang SP (data bisa berubah sejak karyawan dipilih),
// lalu simpan. Di belakang layar: branch_id, dept_id, area_id, bagian_id dari
// penempatan aktif karyawan yang diberi peringatan; petugas = id karyawan user
// login; is_active = true. SP lama karyawan yang sama dinonaktifkan oleh trigger
// database (lihat laporan-pelanggaran.sql).
// ===================================================
async function saveAdd() {
    if (state.add.saving) return;
    showAddMsg("", "");
    const e = state.add.employee;
    const errs = [];
    if (!e) errs.push("Pilih karyawan.");
    if (e && state.add.highest >= SP_MAX) errs.push("Karyawan ini sudah mendapat SP-3 yang masih berlaku.");
    if (!$("pSp").value) errs.push("Pilih Jenis Peringatan.");
    if (!$("pJenis").value) errs.push("Pilih Jenis Pelanggaran.");
    if (!$("pDesc").value.trim()) errs.push("Isi Deskripsi Pelanggaran.");
    if (!$("pStart").value) errs.push("Isi Start Date.");
    if ($("pStart").value && state.add.minStart && $("pStart").value < state.add.minStart) errs.push(`Start Date tidak boleh lebih kecil dari ${fmtDate(state.add.minStart)} (Start Date SP sebelumnya).`);
    if (!state.employeeId) errs.push("Data karyawan akun Anda tidak ditemukan (kolom petugas tidak bisa diisi).");
    if (errs.length) { showAddMsg(`Belum bisa disimpan. Perbaiki dulu:\n${errs.join("\n")}`, "danger"); return; }

    const btn = $("btnAddSave");
    state.add.saving = true;
    btn.disabled = true;
    try {
        // periksa ulang SP yang berlaku
        const level = spLevel($("pSp").value);
        const { highest, lastStart } = await getActiveSp(e.id, e.asg.branch_id);
        if (lastStart && $("pStart").value < lastStart) {
            await refreshSpOptions();
            throw new Error(`Start Date tidak boleh lebih kecil dari ${fmtDate(lastStart)} (Start Date SP sebelumnya).`);
        }
        if (level <= highest) {
            await refreshSpOptions();
            throw new Error("Data SP karyawan ini berubah sejak dipilih. Pilih ulang Jenis Peringatan.");
        }

        const payload = {
            branch_id: e.asg.branch_id,
            dept_id: e.asg.departemen_id,
            area_id: e.asg.area_id,
            bagian_id: e.asg.bagian_id,
            petugas: state.employeeId,
            employee_id: e.id,
            nik_karyawan: e.nik,
            jenis_peringatan: $("pSp").value,
            jenis_pelanggaran_id: parseInt($("pJenis").value, 10),
            deskripsi: $("pDesc").value.trim(),
            start_date: $("pStart").value,
            end_date: $("pEnd").value || null,
            is_active: true
        };
        const { error } = await oprFrom(TABLE_PELANGGARAN).insert(payload);
        if (error) throw error;

        closeAdd();
        showToast("Pelanggaran tersimpan.");
        state.page = 1;
        loadReport();
    } catch (err) {
        console.error("Gagal menyimpan pelanggaran:", err);
        showAddMsg(`Tidak ada data yang tersimpan.\n${err.message}`, "danger");
    } finally {
        state.add.saving = false;
        btn.disabled = false;
    }
}

// ===================================================
// KELOMPOK 13: MODAL DETAIL PELANGGARAN
// Fungsi: klik baris tabel membuka data lengkap barisnya. Tombol
// "Print Surat Peringatan" hanya muncul untuk Surat Peringatan 1, 2, dan 3
// (bukan Peringatan Lisan atau jenis lain).
// ===================================================
function setupDetail() {
    $("pelanggaranTableBody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        if (window.getSelection && String(window.getSelection()).trim()) return;   // sedang menyalin teks
        const row = state.pageRows.get(tr.dataset.id);
        if (row) openDetail(row);
    });
    $("btnDetailClose").addEventListener("click", closeDetail);
    $("btnDetailCloseFoot").addEventListener("click", closeDetail);
    $("detailOverlay").addEventListener("click", (e) => { if (e.target === $("detailOverlay")) closeDetail(); });
    $("btnPrintSp").addEventListener("click", printSp);
}

function canPrintSp(r) {
    const lv = spLevel(r.jenis_peringatan);
    return lv >= 1 && lv <= SP_MAX && !/lisan/i.test(String(r.jenis_peringatan || ""));
}

function openDetail(r) {
    state.detail = r;
    const emp = state.empCache.get(String(r.employee_id)) || {};
    const set = (id, v) => { $(id).textContent = v || "-"; };
    set("dNik", emp.nik);
    set("dNama", emp.nama);
    set("dDept", state.deptMap.get(String(r.dept_id)));
    set("dArea", state.areaMap.get(String(r.area_id)));
    set("dSp", r.jenis_peringatan);
    set("dJenis", state.jenisMap.get(String(r.jenis_pelanggaran_id)));
    set("dDesc", r.deskripsi);
    set("dStart", fmtDate(r.start_date));
    set("dEnd", fmtDate(r.end_date));
    $("btnPrintSp").hidden = !canPrintSp(r);
    $("detailOverlay").hidden = false;
}

function closeDetail() { $("detailOverlay").hidden = true; state.detail = null; }

// ===================================================
// KELOMPOK 14: CETAK SURAT PERINGATAN (PDF)
// Fungsi: membuat PDF A4 mengikuti Master_Surat_Peringatan.docx, diisi dari baris
// yang dipilih. Kop surat dibaca dari KOP_CANDIDATES. Data tambahan (jenis kelamin,
// nama petugas, nama bagian) diambil saat tombol ditekan. Jika data wajib tidak
// bisa dibaca, pencetakan DIBATALKAN dengan pesan yang jelas (surat tidak
// dicetak dengan isian kosong atau salah).
// ===================================================
function honorific(jk) {
    const s = String(jk || "").trim().toLowerCase();
    if (/^(l|laki|pria|male|m)/.test(s)) return "Sdr";
    if (/^(p|perempuan|wanita|female|f)/.test(s)) return "Sdri";
    return null;
}

async function fetchBagianName(id) {
    const { data, error } = await supabaseClient.schema(SCHEMA_BAGIAN).from(TABLE_BAGIAN).select("*").eq("id", id).limit(1);
    if (error) throw new Error(`Nama bagian tidak bisa dibaca dari tabel ${SCHEMA_BAGIAN}.${TABLE_BAGIAN}: ${error.message}`);
    const row = data && data[0];
    if (!row) throw new Error(`Bagian dengan id ${id} tidak ditemukan di tabel ${SCHEMA_BAGIAN}.${TABLE_BAGIAN}.`);
    const key = BAGIAN_NAME_FIELDS.find(k => row[k]);
    if (!key) throw new Error(`Kolom nama bagian tidak dikenali di tabel ${SCHEMA_BAGIAN}.${TABLE_BAGIAN} (kolom: ${Object.keys(row).join(", ")}). Tambahkan nama kolom ke BAGIAN_NAME_FIELDS.`);
    return String(row[key]);
}

// Mengumpulkan semua isian surat dari baris yang dipilih
async function gatherLetterData(r) {
    const ids = [...new Set([r.employee_id, r.petugas].filter(Boolean).map(String))];
    const { data, error } = await hrdFrom(TABLE_EMPLOYEES).select("id, nik_karyawan, nama, jenis_kelamin").in("id", ids);
    if (error) throw new Error(`Data karyawan tidak bisa dibaca: ${error.message}`);
    const emp = (data || []).find(e => String(e.id) === String(r.employee_id));
    const pet = (data || []).find(e => String(e.id) === String(r.petugas));
    if (!emp) throw new Error("Data karyawan yang diberi peringatan tidak ditemukan.");
    if (!pet) throw new Error("Nama petugas pembuat surat (kolom petugas) tidak ditemukan.");

    const hon = honorific(emp.jenis_kelamin);
    if (!hon) throw new Error(`Jenis kelamin karyawan tidak terbaca (nilai: "${emp.jenis_kelamin ?? "kosong"}"). Lengkapi data karyawan atau sesuaikan fungsi honorific().`);

    let bagian = "";
    if (r.bagian_id !== null && r.bagian_id !== undefined) bagian = await fetchBagianName(r.bagian_id);   // kosong jika tidak punya bagian

    const level = spLevel(r.jenis_peringatan);
    const nextLevel = level + 1;
    return {
        level,
        nik: emp.nik_karyawan,
        nama: emp.nama,
        honor: hon,
        area: state.areaMap.get(String(r.area_id)) || "",
        bagian,
        jenisPelanggaran: state.jenisMap.get(String(r.jenis_pelanggaran_id)) || "",
        deskripsi: r.deskripsi || "",
        spText: String(r.jenis_peringatan || ""),
        nextLabel: nextLevel <= SP_MAX ? SP_LABELS[nextLevel] : null,
        nextLevel,
        branch: state.branchMap.get(String(r.branch_id)) || "",
        startLong: fmtDateLong(r.start_date),
        petugas: pet.nama
    };
}

// Membaca gambar kop surat lewat elemen gambar (tidak memakai fetch, jadi tidak terkena
// aturan connect-src / service worker). Mencoba tiap alamat di KOP_CANDIDATES.
// Hasil: { dataUrl, w, h, type } atau null. Alamat yang gagal dicatat di kopTried.
let kopTried = [];

function loadImageEl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("tidak ditemukan / tidak bisa dimuat"));
        img.src = url;
    });
}

async function loadKop() {
    kopTried = [];
    for (const url of KOP_CANDIDATES) {
        try {
            const img = await loadImageEl(url);
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";                         // latar putih (jaga-jaga gambar transparan)
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.92);   // gagal dengan SecurityError jika halaman dibuka dari file://
            return { dataUrl, w: img.naturalWidth, h: img.naturalHeight, type: "JPEG" };
        } catch (err) {
            kopTried.push(`${url}  (${err.message})`);
        }
    }
    console.warn("Kop surat tidak terbaca. Alamat yang dicoba:", kopTried);
    return null;
}

async function printSp() {
    const r = state.detail;
    if (!r || !canPrintSp(r)) return;
    if (!window.jspdf) { alert("Library PDF (jsPDF) tidak termuat. Periksa koneksi internet lalu muat ulang halaman."); return; }

    const btn = $("btnPrintSp");
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan PDF...`;
    try {
        const d = await gatherLetterData(r);
        const kop = await loadKop();
        if (!kop) {
            const hint = location.protocol === "file:"
                ? "\n\nHalaman ini dibuka dari file://. Browser memblokir pembacaan gambar dari file lokal. Buka lewat server (mis. Live Server atau http://localhost)."
                : "";
            if (!confirm(`Gambar kop surat tidak bisa dimuat. Alamat yang dicoba:\n${kopTried.join("\n")}${hint}\n\nBuat PDF tanpa kop surat?`)) return;
        }
        buildLetterPdf(d, kop);
    } catch (err) {
        console.error("Gagal membuat surat peringatan:", err);
        alert(`Surat tidak dibuat.\n${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

// Menulis paragraf rata kiri-kanan dengan campuran huruf biasa dan tebal.
// tokens: [{ t: "teks", b: true/false, glue: true }]  (glue = menempel pada kata sebelumnya, tanpa spasi)
function drawRich(doc, tokens, x, y, width, lineH, pageBottom, pageTop) {
    const units = [];
    tokens.forEach(tok => {
        String(tok.t).split(/\s+/).filter(Boolean).forEach((w, i) => {
            const seg = { w, b: !!tok.b };
            if (i === 0 && tok.glue && units.length) units[units.length - 1].segs.push(seg);
            else units.push({ segs: [seg] });
        });
    });
    const segW = (seg) => { doc.setFont("times", seg.b ? "bold" : "normal"); return doc.getTextWidth(seg.w); };
    units.forEach(u => { u.width = u.segs.reduce((a, sg) => a + segW(sg), 0); });
    doc.setFont("times", "normal");
    const spaceW = doc.getTextWidth(" ");

    const lines = [];
    let cur = [], curW = 0;
    units.forEach(u => {
        if (cur.length && curW + spaceW + u.width > width) { lines.push(cur); cur = []; curW = 0; }
        curW += (cur.length ? spaceW : 0) + u.width;
        cur.push(u);
    });
    if (cur.length) lines.push(cur);

    lines.forEach((line, li) => {
        if (y > pageBottom) { doc.addPage(); y = pageTop; }
        const last = li === lines.length - 1;
        const sum = line.reduce((a, u) => a + u.width, 0);
        const gap = (!last && line.length > 1) ? (width - sum) / (line.length - 1) : spaceW;   // baris terakhir tidak direnggangkan
        let cx = x;
        line.forEach(u => {
            u.segs.forEach(seg => { doc.setFont("times", seg.b ? "bold" : "normal"); doc.text(seg.w, cx, y); cx += doc.getTextWidth(seg.w); });
            cx += gap;
        });
        y += lineH;
    });
    return y;
}

function buildLetterPdf(d, kop) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const PAGE_W = 210, L = 25.4, R = PAGE_W - 25.4, W = R - L;
    const BODY = 11, LH = 6.4, BOTTOM = 270, TOP = 25;
    let y = 52;

    // --- Kop surat (lebar hampir penuh halaman, seperti template)
    if (kop) {
        const w = 190, h = w * kop.h / kop.w;
        doc.addImage(kop.dataUrl, kop.type, 10, 8, w, h);
        y = Math.max(y, 8 + h + 14);
    }

    // --- Judul
    doc.setFont("times", "bold"); doc.setFontSize(12);
    doc.text("SURAT PERINGATAN", PAGE_W / 2, y, { align: "center" });
    const tw = doc.getTextWidth("SURAT PERINGATAN");
    doc.setLineWidth(0.3);
    doc.line(PAGE_W / 2 - tw / 2, y + 1.1, PAGE_W / 2 + tw / 2, y + 1.1);
    y += 12;

    // --- Identitas penerima
    doc.setFont("times", "normal"); doc.setFontSize(BODY);
    doc.text("Surat peringatan ini ditujukan kepada :", L, y);
    y += 9.5;
    const ident = [["NIK", d.nik], ["N a m a", d.nama], ["Area", d.area]];
    if (d.bagian) ident.push(["Bagian", d.bagian]);           // baris Bagian dikosongkan jika tidak punya bagian_id
    ident.forEach(([k, v]) => {
        doc.setFont("times", "normal"); doc.text(k, L, y); doc.text(":", L + 38, y);
        doc.setFont("times", "bold");
        const lines = doc.splitTextToSize(String(v || "-"), W - 42);
        lines.forEach((ln, i) => doc.text(ln, L + 42, y + i * 5.6));
        y += 9.2 + (lines.length - 1) * 5.6;
    });
    y += 5;

    // --- Isi surat
    doc.setFontSize(BODY);
    y = drawRich(doc, [
        { t: `Sehubungan ${d.jenisPelanggaran}, yaitu ${d.deskripsi} yang dilakukan oleh ${d.honor} ${d.nama}.` }
    ], L, y, W, LH, BOTTOM, TOP);
    y += 4;

    const nextTokens = d.nextLabel
        ? [{ t: `${d.nextLabel} ` }, { t: `(SP-${d.nextLevel})`, b: true }, { t: ".", glue: true }]
        : [{ t: `${SP3_NEXT_TEXT}.` }];
    y = drawRich(doc, [
        { t: `Maka dengan ini perusahaan memberikan ${d.spText} ` },
        { t: `(SP-${d.level})`, b: true },
        { t: `. Dan apabila dalam kurun waktu ${SP_VALID_MONTHS} Bulan setelah di tanda tanganinya Surat Peringatan ini dan melakukan pelanggaran kembali maka akan dikenakan sanksi `, glue: true },
        ...nextTokens
    ], L, y, W, LH, BOTTOM, TOP);
    y += 4;

    y = drawRich(doc, [
        { t: "Demikian surat peringatan ini dibuat agar dapat diperhatikan dan ditaati sebaik mungkin oleh yang bersangkutan." }
    ], L, y, W, LH, BOTTOM, TOP);

    // --- Blok tanda tangan (dijaga tetap satu halaman)
    if (y + 82 > 285) { doc.addPage(); y = TOP; }
    y += 9;
    doc.setFont("times", "normal"); doc.setFontSize(BODY);
    doc.text(`${d.branch}, ${d.startLong}`, L, y);
    y += 7;
    doc.text("Dibuat Oleh", L, y);
    doc.text("Penerima SP", 149.5, y);
    y += 6;
    doc.setFont("times", "italic"); doc.setFontSize(8);
    doc.text("Tgl :", 146, y);
    y += 24;                                                    // ruang tanda tangan

    doc.setFont("times", "bold"); doc.setFontSize(BODY);
    const sigName = (name, x) => {                              // "( nama )" dengan nama bergaris bawah
        const open = "( ", close = " )";
        const wOpen = doc.getTextWidth(open), wName = doc.getTextWidth(name);
        doc.text(open, x, y);
        doc.text(name, x + wOpen, y);
        doc.setLineWidth(0.25);
        doc.line(x + wOpen, y + 0.9, x + wOpen + wName, y + 0.9);
        doc.text(close, x + wOpen + wName, y);
    };
    sigName(d.petugas, L);
    const rightW = doc.getTextWidth(`( ${d.nama} )`);
    sigName(d.nama, Math.min(132, R - rightW));
    y += 5.5;
    doc.setFont("times", "italic"); doc.setFontSize(9);
    doc.text(`Supervisor ${COMPANY_NAME}`, L + 7, y);

    // --- Tembusan
    y += 13;
    doc.setFont("times", "italic"); doc.setFontSize(8);
    doc.text("Tembusan :", L, y);
    [`HRD ${COMPANY_NAME}`, "PIC Mitra Kerja", "Arsip"].forEach((t, i) => {
        y += 4.2;
        doc.text(`${i + 1}.`, L + 8, y);
        doc.text(t, L + 16, y);
    });

    const safe = (t) => String(t || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    doc.save(`Surat_Peringatan_SP${d.level}_${safe(d.nik)}_${safe(d.nama)}.pdf`);
}