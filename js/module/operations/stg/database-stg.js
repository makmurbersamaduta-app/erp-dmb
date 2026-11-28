/**
 * ============================================================================
 * WEB ERP PT DUTA MAKMUR BERSAMA
 * Module: Database STG
 * File: database-stg.js
 * Deskripsi: Tabel karyawan khusus STG (Cost Center 4, 5, 6) -- filter Status
 * Data / Cost Center / Bagian, kartu statistik (tanpa filter), pengaturan
 * kolom, dan export Excel. Semua logika export ada di file ini.
 * Dasar: duplikasi dari directory.js tanpa Aksi, Tambah Karyawan, Mutasi, Resign.
 * ============================================================================
 */

// ============================================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ============================================================================

// Hanya karyawan yang penempatan terakhirnya ada di Cost Center ini yang ditampilkan.
const STG_COST_CENTER_IDS = [4, 5, 6];

// PERLU DIISI (opsional): id halaman ini di tabel public.app_menus.
// Jika diisi, tombol Export hanya muncul untuk role yang can_view = true di role_permissions.
// Jika dibiarkan null, tombol Export tampil untuk semua yang bisa membuka halaman.
const MENU_DATABASE_STG_ID = null;

const STG_ROWS_PER_PAGE = 100;                         // baris maksimal per halaman
const COLUMN_STORAGE_KEY = "stg_visible_columns";      // simpan pengaturan kolom di browser (terpisah dari Directory)

// ============================================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ============================================================================
let stgEmployees = [];                       // karyawan yang masuk cakupan STG (Cost Center 4,5,6), TANPA filter
let allAssignments = [];                     // seluruh data hrd.employee_assignments
let assignmentsByEmp = new Map();            // employee_id -> daftar assignment (terbaru di atas)
let masterCache = { cost_centers: [], bagians: [] };

let currentUserProfile = null;
let canViewMenu = true;                      // dipakai untuk menampilkan/menyembunyikan tombol Export

let stgCurrentPage = 1;
let stgSortedFiltered = [];                  // hasil filter+sort TERAKHIR (dipakai tabel halaman & export)

// Daftar kolom tabel. Urutan di sini = urutan tampil.
const ALL_COLUMNS = [
    { key: "no", label: "No", default: true },
    { key: "nik", label: "NIK", default: true },
    { key: "nama", label: "Nama Karyawan", default: true },
    { key: "jenis_kelamin", label: "Jenis Kelamin", default: true },
    { key: "pendidikan", label: "Pendidikan", default: true },
    { key: "costcenter", label: "Cost Center", default: true },
    { key: "bagian", label: "Bagian", default: true },
    { key: "status_karyawan", label: "Status Karyawan", default: true },
    { key: "tgl_masuk", label: "Tanggal Masuk", default: true },
    { key: "tgl_keluar", label: "Tanggal Keluar", default: true },
    { key: "no_absen_stg", label: "No Absen STG", default: true },
    { key: "status_data", label: "Status Data", default: true }
];
let visibleColumnKeys = [];

// Daftar filter (id <select> di HTML)
const MULTI_FILTER_IDS = ["filterStatusData", "filterCostCenter", "filterBagian"];

// ============================================================================
// KELOMPOK 3: INISIALISASI HALAMAN
// Fungsi: dijalankan saat halaman selesai dimuat.
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();                                   // dari auth.js: tendang ke login jika belum login

    const userProfile = await loadHeaderUserProfile();
    await loadMenuPermission(userProfile);
    initColumnPreferences();
    setupEventListeners();

    await loadMasterData();
    await loadStgData();
});

// ============================================================================
// KELOMPOK 4: HEADER PROFIL PENGGUNA & HAK AKSES MENU
// Fungsi: tampilkan nama/role user di header; cek can_view untuk tombol Export.
// ============================================================================
async function loadHeaderUserProfile() {
    try {
        const nameEl = document.getElementById("headerUserName");
        const roleEl = document.getElementById("headerUserRole");

        // Sesi Supabase Auth = sumber kebenaran identitas; cache erp_user hanya pelengkap
        let user = null;
        let supabaseSessionUser = null;
        if (typeof supabaseClient !== "undefined") {
            const { data: authData } = await supabaseClient.auth.getUser();
            if (authData?.user) supabaseSessionUser = authData.user;
        }

        const localData = localStorage.getItem("erp_user") || sessionStorage.getItem("erp_user");
        const cachedUser = localData ? JSON.parse(localData) : null;

        if (supabaseSessionUser) user = { ...cachedUser, ...supabaseSessionUser };
        else if (cachedUser) user = cachedUser;

        if (user) {
            let displayName = user.nama || user.name || user.username || "";
            let displayNik = user.nik_karyawan || user.nik || "";
            let displayRole = user.role_name || user.role || "User";
            let roleId = user.role_id || user.roleId || null;

            if ((!displayName || !displayNik || !roleId) && user.email) {
                const cleanNik = user.email.split("@")[0];

                if (!roleId) {
                    const { data: userData } = await supabaseClient
                        .from("users_safe")
                        .select("id, username, role_id")
                        .ilike("username", cleanNik)
                        .maybeSingle();
                    if (userData && userData.role_id) roleId = userData.role_id;
                }

                const { data: empData } = await supabaseClient.schema("hrd")
                    .from("employees")
                    .select("nama, nik_karyawan")
                    .ilike("nik_karyawan", cleanNik)
                    .maybeSingle();
                if (empData) {
                    displayName = displayName || empData.nama;
                    displayNik = displayNik || empData.nik_karyawan;
                }
            }

            if (roleId) {
                const { data: roleData } = await supabaseClient
                    .from("roles")
                    .select("role_name")
                    .eq("id", roleId)
                    .maybeSingle();
                if (roleData && roleData.role_name) displayRole = roleData.role_name;
            }

            currentUserProfile = {
                ...user,
                displayName: displayName || user.email || "Pengguna ERP",
                displayNik: displayNik,
                displayRole: displayRole,
                role_id: roleId
            };

            if (nameEl) nameEl.textContent = currentUserProfile.displayName;
            if (roleEl) roleEl.textContent = displayNik ? `${displayNik} • ${displayRole}` : displayRole;
        } else {
            if (nameEl) nameEl.textContent = "Pengguna ERP";
            if (roleEl) roleEl.textContent = "Administrator";
        }
    } catch (err) {
        console.warn("Gagal memuat profil header:", err);
    }
    return currentUserProfile;
}

// Membaca can_view halaman ini dari public.role_permissions (hanya jika MENU_DATABASE_STG_ID diisi)
async function loadMenuPermission(userProfile) {
    canViewMenu = true;
    if (MENU_DATABASE_STG_ID !== null && userProfile && userProfile.role_id) {
        try {
            const { data, error } = await supabaseClient
                .from("role_permissions")
                .select("can_view")
                .eq("role_id", userProfile.role_id)
                .eq("menu_id", MENU_DATABASE_STG_ID)
                .maybeSingle();
            if (error) console.error("Error fetching role_permissions:", error);
            canViewMenu = !!(data && data.can_view);
        } catch (err) {
            console.error("Gagal memuat permission:", err);
            canViewMenu = false;
        }
    }
    const btnExport = document.getElementById("btnExport");
    if (btnExport) btnExport.style.display = canViewMenu ? "" : "none";
}

// ============================================================================
// KELOMPOK 5: FUNGSI BANTU (HELPER)
// Fungsi: escape teks, format tanggal, cari penempatan terakhir, tanggal masuk/keluar.
// ============================================================================
function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "2026-10-19" -> "19/10/2026" (hanya untuk tampilan tabel)
function formatTanggalDirectory(dateStr) {
    if (!dateStr) return "-";
    const p = String(dateStr).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : dateStr;
}

function todayLocalIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildAssignmentIndex() {
    assignmentsByEmp = new Map();
    allAssignments.forEach(a => {
        const key = String(a.employee_id);
        if (!assignmentsByEmp.has(key)) assignmentsByEmp.set(key, []);
        assignmentsByEmp.get(key).push(a);
    });
    // Terbaru di atas: start_date lalu created_at
    assignmentsByEmp.forEach(list => {
        list.sort((x, y) => {
            const sx = x.start_date || "", sy = y.start_date || "";
            if (sx !== sy) return sy.localeCompare(sx);
            return (y.created_at || "").localeCompare(x.created_at || "");
        });
    });
}

// Penempatan saat ini: yang aktif; jika tidak ada (karyawan non-aktif), yang paling baru
function getEmployeeAssignment(empId) {
    const list = assignmentsByEmp.get(String(empId));
    if (!list || list.length === 0) return null;
    return list.find(a => a.is_active !== false) || list[0];
}

// Masuk  = start_date REHIRE terakhir; jika tidak pernah rehire -> start_date paling awal
//          dari assignment BUKAN MUTATION; fallback: paling awal apa pun.
function getTanggalMasuk(emp) {
    const list = assignmentsByEmp.get(String(emp.id)) || [];
    const type = a => String(a.action_type || "").toUpperCase();
    const dates = arr => arr.map(a => a.start_date).filter(Boolean).sort();

    const rehire = dates(list.filter(a => type(a) === "REHIRE"));
    if (rehire.length) return rehire[rehire.length - 1];

    const nonMut = dates(list.filter(a => type(a) !== "MUTATION"));
    if (nonMut.length) return nonMut[0];

    const all = dates(list);
    return all.length ? all[0] : "";
}

// Keluar = hanya untuk karyawan non-aktif: end_date paling akhir dari assignment
function getTanggalKeluar(emp) {
    if (emp.is_active !== false) return "";
    const list = assignmentsByEmp.get(String(emp.id)) || [];
    const ends = list.map(a => a.end_date).filter(Boolean).sort();
    return ends.length ? ends[ends.length - 1] : "";
}

// ============================================================================
// KELOMPOK 6: PENGATURAN KOLOM TABEL
// Fungsi: user memilih kolom yang tampil; pilihan disimpan di browser (localStorage).
// ============================================================================
function initColumnPreferences() {
    const defaults = ALL_COLUMNS.filter(c => c.default).map(c => c.key);
    try {
        const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || "null");
        visibleColumnKeys = Array.isArray(saved)
            ? saved.filter(k => ALL_COLUMNS.some(c => c.key === k))   // buang kolom yang sudah tidak ada
            : defaults;
        if (visibleColumnKeys.length === 0) visibleColumnKeys = defaults;

        // Kolom baru (Jenis Kelamin, Pendidikan): tambahkan SEKALI untuk user yang sudah
        // punya pengaturan kolom tersimpan; setelah itu pilihan user dihormati.
        if (!localStorage.getItem("stg_cols_v2")) {
            ["jenis_kelamin", "pendidikan"].forEach(k => {
                if (!visibleColumnKeys.includes(k)) visibleColumnKeys.push(k);
            });
            localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumnKeys));
            localStorage.setItem("stg_cols_v2", "1");
        }
    } catch (e) {
        visibleColumnKeys = defaults;
    }

    const modalManage = document.getElementById("modalManageColumns");
    if (modalManage) modalManage.addEventListener("show.bs.modal", renderColumnChecklist);

    const btnSaveCols = document.getElementById("btnSaveColumns");
    if (btnSaveCols) btnSaveCols.addEventListener("click", saveColumnPreferences);
}

function renderColumnChecklist() {
    const container = document.getElementById("columnChecklistContainer");
    if (!container) return;
    container.innerHTML = ALL_COLUMNS.map(col => `
        <div class="col-6 mb-2">
            <div class="form-check">
                <input class="form-check-input col-checkbox" type="checkbox" id="col_chk_${col.key}" value="${col.key}" ${visibleColumnKeys.includes(col.key) ? "checked" : ""}>
                <label class="form-check-label small fw-semibold" for="col_chk_${col.key}">${col.label}</label>
            </div>
        </div>`).join("");
}

function saveColumnPreferences() {
    const selectedKeys = Array.from(document.querySelectorAll(".col-checkbox:checked")).map(cb => cb.value);
    if (selectedKeys.length === 0) {
        alert("Minimal pilih 1 kolom untuk ditampilkan!");
        return;
    }
    visibleColumnKeys = selectedKeys;
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumnKeys));

    const modalInstance = bootstrap.Modal.getInstance(document.getElementById("modalManageColumns"));
    if (modalInstance) modalInstance.hide();

    renderStgTable();
}

function renderTableHeader() {
    const headerRow = document.getElementById("tableHeaderRow");
    if (!headerRow) return;

    const centered = ["no", "nik", "jenis_kelamin", "status_karyawan", "tgl_masuk", "tgl_keluar", "no_absen_stg", "status_data"];
    headerRow.innerHTML = ALL_COLUMNS.filter(col => visibleColumnKeys.includes(col.key)).map(col => {
        const align = centered.includes(col.key) ? "text-center" : "text-start";
        const width = col.key === "no" ? 'style="width: 50px;"' : col.key === "nik" ? 'style="width: 120px;"' : "";
        return `<th class="${align}" ${width}>${col.label}</th>`;
    }).join("");
}

// ============================================================================
// KELOMPOK 7: LOAD DATA MASTER & DATA KARYAWAN
// Fungsi: ambil Cost Center (hanya 4,5,6), Bagian, karyawan, dan penempatan.
// Karyawan dibatasi ke cakupan STG berdasarkan penempatan TERAKHIR-nya.
// ============================================================================
async function loadMasterData() {
    try {
        const [cc, bg] = await Promise.all([
            supabaseClient.from("cost_centers").select("*"),
            supabaseClient.from("bagians").select("*")
        ]);
        masterCache.cost_centers = (cc.data || []).filter(c => STG_COST_CENTER_IDS.includes(Number(c.id)));
        masterCache.bagians = bg.data || [];
        populateFilterDropdowns();
    } catch (err) {
        console.warn("Gagal memuat master data:", err);
    }
}

// Ambil SEMUA baris (Supabase membatasi 1 request = max 1000 baris)
async function fetchAllRows(table, orderCol) {
    let all = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
        const { data, error } = await supabaseClient
            .schema("hrd").from(table).select("*")
            .order(orderCol, { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        from += data.length;
    }
    return all;
}

async function loadStgData() {
    const tbody = document.getElementById("tableBody");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="100%" class="text-center py-5 text-muted">
                    <div class="spinner-border spinner-border-sm text-primary me-2"></div>
                    <span>Memuat data karyawan...</span>
                </td>
            </tr>`;
    }

    try {
        const emps = await fetchAllRows("employees", "id");
        allAssignments = await fetchAllRows("employee_assignments", "id");
        buildAssignmentIndex();

        // Cakupan STG: penempatan terakhir karyawan ada di Cost Center 4, 5, atau 6
        stgEmployees = (emps || []).filter(emp => {
            const a = getEmployeeAssignment(emp.id);
            return a && STG_COST_CENTER_IDS.includes(Number(a.costcenter_id));
        });
        console.log(`[Database STG] employees: ${emps.length}, masuk cakupan STG: ${stgEmployees.length}`);

        updateStatisticsCards();    // kartu dihitung SEKALI dari seluruh data STG (tanpa filter)
        renderStgTable();
    } catch (err) {
        console.error("Gagal memuat Database STG:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="100%" class="text-center text-danger py-4">Gagal memuat data: ${esc(err.message || err)}</td></tr>`;
        }
    }
}

// ============================================================================
// KELOMPOK 8: FILTER CHECKLIST (bisa memilih lebih dari satu)
// Fungsi: setiap <select> filter diubah menjadi tombol + daftar centang.
// <select> aslinya disembunyikan dan jadi penyimpan pilihan; kode lain cukup
// membaca getMultiValues(id). Tidak ada centang = filter tidak dipakai.
// ============================================================================
function mfEsc(v) { return esc(v); }

// null = filter belum dibuat; [] = tidak ada yang dicentang
function getMultiValues(selectId) {
    const el = document.getElementById(selectId);
    if (!el || el.dataset.mf !== "1") return null;
    return Array.from(el.options).filter(o => o.selected && o.value !== "").map(o => o.value);
}

function refreshMultiFilter(selectId) {
    const el = document.getElementById(selectId);
    const wrap = el && el.nextElementSibling;
    if (wrap && wrap._mfRefresh) wrap._mfRefresh();
}

function initMultiFilter(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel || sel.dataset.mf === "1") return;

    // teks "semua" diambil dari opsi pertama (mis. "-- Semua Bagian --") sebelum diubah
    if (!sel.dataset.allText) {
        sel.dataset.allText = sel.options[0] ? sel.options[0].text.replace(/^[-\s]+|[-\s]+$/g, "") : "Semua";
    }
    sel.dataset.mf = "1";
    // Pilihan bawaan = opsi bertanda "selected" di HTML (Status Data = Aktif)
    const keep = Array.from(sel.options).filter(o => o.defaultSelected && o.value !== "").map(o => o.value);
    sel.multiple = true;
    sel.style.display = "none";
    Array.from(sel.options).forEach(o => { o.selected = keep.includes(o.value); });

    const wrap = document.createElement("div");
    wrap.className = "mf-wrap";
    wrap.innerHTML = `
        <button type="button" class="btn btn-sm btn-outline-secondary w-100 d-flex justify-content-between align-items-center mf-btn">
            <span class="mf-text text-truncate"></span>
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" class="ms-2 flex-shrink-0"><path fill="currentColor" d="M1.6 5l6.4 6.4L14.4 5z"/></svg>
        </button>
        <div class="mf-panel border rounded bg-white mt-1 p-2" style="display:none;">
            <div class="mb-2 mf-tools">
                <input type="text" class="form-control form-control-sm mf-search mb-1" placeholder="Cari..." autocomplete="off">
                <div class="d-flex justify-content-between align-items-center">
                    <button type="button" class="btn btn-link btn-sm text-decoration-none p-0 mf-selall">Pilih Semua</button>
                    <button type="button" class="btn btn-link btn-sm text-decoration-none p-0 text-secondary mf-clear">Kosongkan</button>
                </div>
            </div>
            <div class="mf-list" style="max-height:200px; overflow-y:auto;"></div>
        </div>`;
    sel.insertAdjacentElement("afterend", wrap);

    const btn = wrap.querySelector(".mf-btn");
    const textEl = wrap.querySelector(".mf-text");
    const panel = wrap.querySelector(".mf-panel");
    const tools = wrap.querySelector(".mf-tools");
    const search = wrap.querySelector(".mf-search");
    const selAllBtn = wrap.querySelector(".mf-selall");
    const list = wrap.querySelector(".mf-list");
    // "Pilih Semua" tidak ditampilkan untuk Status Data (hanya 2 pilihan: Aktif / Non-Aktif)
    if (selectId === "filterStatusData") selAllBtn.style.display = "none";

    function updateSummary() {
        const chosen = Array.from(sel.options).filter(o => o.selected && o.value !== "");
        const total = Array.from(sel.options).filter(o => o.value !== "").length;
        textEl.textContent = chosen.length === 0 ? sel.dataset.allText
                           : chosen.length === 1 ? chosen[0].text
                           : chosen.length === total ? `Semua dipilih (${total})`
                           : `${chosen.length} dipilih`;
        btn.classList.toggle("btn-outline-primary", chosen.length > 0);
        btn.classList.toggle("btn-outline-secondary", chosen.length === 0);
    }

    function renderList() {
        const opts = Array.from(sel.options).filter(o => o.value !== "");
        search.style.display = opts.length > 8 ? "" : "none";
        const q = search.value.trim().toLowerCase();
        const shown = opts.filter(o => !q || o.text.toLowerCase().includes(q));
        selAllBtn.textContent = q ? "Pilih hasil pencarian" : "Pilih Semua";
        list.innerHTML = shown.length
            ? shown.map(o => `<label class="d-flex align-items-center gap-2 small px-1 py-1 mf-item" style="cursor:pointer;">
                    <input type="checkbox" class="form-check-input mt-0 flex-shrink-0" value="${mfEsc(o.value)}" ${o.selected ? "checked" : ""}>
                    <span>${mfEsc(o.text)}</span></label>`).join("")
            : '<div class="text-muted small px-1 py-2">Tidak ada hasil</div>';
    }

    function fireChange() { sel.dispatchEvent(new Event("change", { bubbles: true })); }

    btn.addEventListener("click", () => {
        const opening = panel.style.display === "none";
        document.querySelectorAll(".mf-panel").forEach(p => { p.style.display = "none"; });  // satu panel terbuka pada satu waktu
        if (opening) { search.value = ""; renderList(); panel.style.display = "block"; }
    });
    search.addEventListener("input", renderList);
    list.addEventListener("change", e => {
        const cb = e.target;
        if (!cb || cb.type !== "checkbox") return;
        const opt = Array.from(sel.options).find(o => o.value === cb.value);
        if (opt) opt.selected = cb.checked;
        updateSummary();
        fireChange();
    });
    selAllBtn.addEventListener("click", () => {
        const q = search.value.trim().toLowerCase();
        Array.from(sel.options).forEach(o => {
            if (o.value !== "" && (!q || o.text.toLowerCase().includes(q))) o.selected = true;
        });
        updateSummary(); renderList(); fireChange();
    });
    wrap.querySelector(".mf-clear").addEventListener("click", () => {
        Array.from(sel.options).forEach(o => { o.selected = false; });
        updateSummary(); renderList(); fireChange();
    });

    wrap._mfRefresh = () => { updateSummary(); if (panel.style.display !== "none") renderList(); };
    updateSummary();
}

function fillSelectOptions(elementId, list, valKey, textKey, defaultText) {
    const el = document.getElementById(elementId);
    if (!el) return;
    let html = `<option value="">${defaultText}</option>`;
    list.forEach(item => {
        html += `<option value="${esc(item[valKey])}">${esc(item[textKey])}</option>`;
    });
    el.innerHTML = html;
}

function populateFilterDropdowns() {
    fillSelectOptions("filterCostCenter", masterCache.cost_centers, "id", "costcenter_name", "-- Semua Cost Center --");
    fillSelectOptions("filterBagian", masterCache.bagians, "id", "bagian_name", "-- Semua Bagian --");
    MULTI_FILTER_IDS.forEach(refreshMultiFilter);
}

function resetAllFilters() {
    MULTI_FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        // Status Data kembali ke bawaan (Aktif); filter lain dikosongkan
        Array.from(el.options).forEach(o => { o.selected = (id === "filterStatusData" && o.value === "active"); });
        refreshMultiFilter(id);
    });
    renderStgTable();
}

// Angka kecil pada tombol "Filter Data": jumlah filter yang dipakai (Status Data = Aktif saja tidak dihitung)
function updateFilterBadge() {
    const badge = document.getElementById("filterBadge");
    if (!badge) return;
    let n = 0;
    MULTI_FILTER_IDS.forEach(id => {
        const v = getMultiValues(id);
        if (!v || v.length === 0) return;
        if (id === "filterStatusData" && v.length === 1 && v[0] === "active") return;
        n++;
    });
    badge.textContent = n;
    badge.classList.toggle("d-none", n === 0);
}

// ============================================================================
// KELOMPOK 9: RENDER TABEL (filter + urutan + halaman)
// Fungsi: terapkan pencarian & filter, urutkan, tampilkan 100 baris per halaman.
// ============================================================================
// Urutan Status Karyawan: PKWTT & PKWT paling atas, lalu Borongan, lalu Reliver, sisanya paling bawah
const STATUS_SORT_PRIORITY = { pkwtt: 1, pkwt: 1, borongan: 2, reliver: 3 };

// Urutan: Status Karyawan > Cost Center > Bagian > Nama
function sortEmployeesForDisplay(list) {
    const ccName = a => masterCache.cost_centers.find(c => c.id == a?.costcenter_id)?.costcenter_name || "";
    const bagName = a => masterCache.bagians.find(b => b.id == a?.bagian_id)?.bagian_name || "";
    return [...list].sort((a, b) => {
        const asA = getEmployeeAssignment(a.id), asB = getEmployeeAssignment(b.id);
        const prioA = STATUS_SORT_PRIORITY[(asA?.status_karyawan || "").toLowerCase()] ?? 99;
        const prioB = STATUS_SORT_PRIORITY[(asB?.status_karyawan || "").toLowerCase()] ?? 99;
        if (prioA !== prioB) return prioA - prioB;
        return ccName(asA).localeCompare(ccName(asB))
            || bagName(asA).localeCompare(bagName(asB))
            || String(a.nama || "").localeCompare(String(b.nama || ""));
    });
}

function renderStgTable() {
    renderTableHeader();

    const tbody = document.getElementById("tableBody");
    const recordInfo = document.getElementById("recordInfo");
    if (!tbody) return;

    const searchTerm = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
    const ccVals = getMultiValues("filterCostCenter") || [];
    const bagVals = getMultiValues("filterBagian") || [];
    const statusDataVals = getMultiValues("filterStatusData") || ["active"];   // sebelum filter siap: bawaan Aktif
    updateFilterBadge();

    const responsiveDiv = document.querySelector(".table-responsive");
    if (responsiveDiv) responsiveDiv.style.minHeight = "480px";

    const filtered = stgEmployees.filter(emp => {
        const isActive = emp.is_active !== false;
        if (statusDataVals.length && !statusDataVals.includes(isActive ? "active" : "inactive")) return false;

        if (searchTerm) {
            const nik = (emp.nik_karyawan || "").toLowerCase();
            const nama = (emp.nama || "").toLowerCase();
            if (!nik.includes(searchTerm) && !nama.includes(searchTerm)) return false;
        }

        const assign = getEmployeeAssignment(emp.id);
        if (ccVals.length && !ccVals.includes(String(assign?.costcenter_id))) return false;
        if (bagVals.length && !bagVals.includes(String(assign?.bagian_id))) return false;
        return true;
    });

    if (filtered.length === 0) {
        stgSortedFiltered = [];
        tbody.innerHTML = `<tr><td colspan="100%" class="text-center py-5 text-muted">Tidak ada data karyawan yang sesuai dengan kriteria filter.</td></tr>`;
        if (recordInfo) recordInfo.textContent = "Menampilkan 0 data";
        renderStgPagination(0);
        return;
    }

    stgSortedFiltered = sortEmployeesForDisplay(filtered);
    stgCurrentPage = 1;      // filter / pencarian berubah -> kembali ke halaman 1
    renderStgTableRows();
}

function renderStgTableRows() {
    const tbody = document.getElementById("tableBody");
    const recordInfo = document.getElementById("recordInfo");
    if (!tbody) return;

    const totalRecords = stgSortedFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / STG_ROWS_PER_PAGE));
    if (stgCurrentPage > totalPages) stgCurrentPage = totalPages;
    if (stgCurrentPage < 1) stgCurrentPage = 1;

    const startIdx = (stgCurrentPage - 1) * STG_ROWS_PER_PAGE;
    const pageItems = stgSortedFiltered.slice(startIdx, startIdx + STG_ROWS_PER_PAGE);

    let html = "";
    pageItems.forEach((emp, i) => {
        const index = startIdx + i;     // nomor urut berlanjut lintas halaman
        const assign = getEmployeeAssignment(emp.id);
        const ccObj = masterCache.cost_centers.find(c => c.id == assign?.costcenter_id);
        const bagObj = masterCache.bagians.find(bg => bg.id == assign?.bagian_id);

        const statusBadge = emp.is_active !== false
            ? `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">Aktif</span>`
            : `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1">Non-Aktif</span>`;

        html += `<tr class="align-middle">`;
        ALL_COLUMNS.forEach(col => {
            if (!visibleColumnKeys.includes(col.key)) return;
            if (col.key === "no") html += `<td class="text-center fw-semibold text-secondary">${index + 1}</td>`;
            else if (col.key === "nik") html += `<td class="text-center"><strong>${esc(emp.nik_karyawan || "-")}</strong></td>`;
            else if (col.key === "nama") html += `<td class="text-start">${esc(emp.nama || "-")}</td>`;
            else if (col.key === "jenis_kelamin") html += `<td class="text-center">${esc(emp.jenis_kelamin || "-")}</td>`;
            else if (col.key === "pendidikan") html += `<td class="text-center">${esc(emp.pendidikan || "-")}</td>`;
            else if (col.key === "costcenter") html += `<td>${esc(ccObj?.costcenter_name || "-")}</td>`;
            else if (col.key === "bagian") html += `<td>${esc(bagObj?.bagian_name || "-")}</td>`;
            else if (col.key === "status_karyawan") html += `<td class="text-center">${esc(assign?.status_karyawan || "-")}</td>`;
            else if (col.key === "tgl_masuk") html += `<td class="text-center">${formatTanggalDirectory(getTanggalMasuk(emp))}</td>`;
            else if (col.key === "tgl_keluar") html += `<td class="text-center">${formatTanggalDirectory(getTanggalKeluar(emp))}</td>`;
            else if (col.key === "no_absen_stg") html += `<td class="text-center">${esc(emp.no_absen_stg || "-")}</td>`;
            else if (col.key === "status_data") html += `<td class="text-center">${statusBadge}</td>`;
        });
        html += `</tr>`;
    });

    tbody.innerHTML = html;
    if (recordInfo) recordInfo.textContent = `Menampilkan ${pageItems.length} dari ${totalRecords} data terfilter (Halaman ${stgCurrentPage}/${totalPages})`;
    renderStgPagination(totalPages);
}

// Tombol Prev/Next + info halaman (dibuat sekali di card-footer)
function renderStgPagination(totalPages) {
    let el = document.getElementById("stgPaginationControls");
    if (!el) {
        const footer = document.querySelector(".card-footer");
        if (!footer) return;
        el = document.createElement("div");
        el.id = "stgPaginationControls";
        el.className = "d-flex align-items-center gap-2";
        footer.appendChild(el);
    }
    if (totalPages <= 1) { el.innerHTML = ""; return; }

    el.innerHTML = `
        <button type="button" class="btn btn-sm btn-outline-secondary" ${stgCurrentPage === 1 ? "disabled" : ""} onclick="goToStgPage(${stgCurrentPage - 1})">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        <span class="small fw-semibold text-muted">Halaman ${stgCurrentPage} / ${totalPages}</span>
        <button type="button" class="btn btn-sm btn-outline-secondary" ${stgCurrentPage === totalPages ? "disabled" : ""} onclick="goToStgPage(${stgCurrentPage + 1})">
            <i class="fa-solid fa-chevron-right"></i>
        </button>`;
}

function goToStgPage(page) {
    stgCurrentPage = page;
    renderStgTableRows();
}

// ============================================================================
// KELOMPOK 10: KARTU STATISTIK (TANPA FILTER)
// Fungsi: dihitung dari seluruh karyawan cakupan STG (Cost Center 4,5,6),
// TIDAK terpengaruh filter maupun pencarian.
//  - Total  : karyawan aktif
//  - Masuk  : ada assignment BUKAN mutasi (hire/rehire) dengan start_date bulan ini
//  - Keluar : karyawan non-aktif dengan end_date bulan ini
// ============================================================================
function updateStatisticsCards() {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let totalActive = 0, countIn = 0, countOut = 0;
    stgEmployees.forEach(emp => {
        if (emp.is_active !== false) totalActive++;
        const list = assignmentsByEmp.get(String(emp.id)) || [];

        const masuk = list.some(a =>
            String(a.action_type || "").toUpperCase() !== "MUTATION" &&
            (a.start_date || "").startsWith(ym));
        if (masuk) countIn++;

        if (emp.is_active === false) {
            if (list.some(a => (a.end_date || "").startsWith(ym))) countOut++;
        }
    });

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("cardTotalEmp", totalActive);
    set("cardEmpIn", countIn);
    set("cardEmpOut", countOut);
}

// ============================================================================
// KELOMPOK 11: EVENT LISTENERS
// Fungsi: pasang filter checklist, tombol Reset, pencarian, dan tombol Export.
// ============================================================================
function setupEventListeners() {
    MULTI_FILTER_IDS.forEach(initMultiFilter);

    const btnReset = document.getElementById("btnResetFilter");
    if (btnReset) btnReset.addEventListener("click", resetAllFilters);

    // Menu filter ditutup -> tutup juga panel checklist yang sedang terbuka
    document.getElementById("dropdownFilterBtn")?.addEventListener("hide.bs.dropdown", () => {
        document.querySelectorAll(".mf-panel").forEach(p => { p.style.display = "none"; });
    });

    // Setiap perubahan filter -> tabel dirender ulang
    document.querySelectorAll(".filter-dropdown-menu select").forEach(s => {
        s.addEventListener("change", renderStgTable);
    });

    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.addEventListener("input", renderStgTable);

    const btnExport = document.getElementById("btnExport");
    if (btnExport) {
        btnExport.addEventListener("click", (e) => {
            e.preventDefault();
            exportDatabaseStgToExcel();
        });
    }
}

// ============================================================================
// KELOMPOK 12: EXPORT KE EXCEL
// Fungsi: download data yang sedang tampil (sesuai filter & pencarian) ke .xlsx.
// Kolom: NIK, Nama, Tempat Lahir, Tanggal Lahir, Jenis Kelamin, Pendidikan, Agama,
// Status Pernikahan, Jumlah Anak, No Telp, Alamat (alamat KTP), Tanggal Masuk,
// Tanggal Keluar, No Absen STG, Bagian.
// ============================================================================
const EXPORT_DATE_HEADERS = ["Tanggal Lahir", "Tanggal Masuk", "Tanggal Keluar"];

// Kolom tanggal diubah dari teks "2026-10-19" menjadi sel tanggal Excel berformat dd/mm/yyyy
// (tetap bisa diurutkan sebagai tanggal). Lebar kolom disesuaikan isi agar tidak terpotong.
function formatExportSheet(ws, dateHeaders) {
    if (!ws || !ws["!ref"]) return;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cols = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
        const head = ws[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
        const isDateCol = !!head && dateHeaders.includes(String(head.v));
        let maxLen = head ? String(head.v).length : 8;

        for (let R = range.s.r + 1; R <= range.e.r; R++) {
            const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
            if (!cell) continue;
            if (isDateCol && typeof cell.v === "string") {
                const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(cell.v);
                if (m) {                                   // "-" atau kosong dibiarkan
                    cell.t = "n";
                    cell.v = Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569;  // nomor seri tanggal Excel
                    cell.z = "dd/mm/yyyy";
                    delete cell.w;
                }
                maxLen = Math.max(maxLen, 10);
            } else {
                maxLen = Math.max(maxLen, String(cell.v ?? "").length);
            }
        }
        cols[C] = { wpx: isDateCol ? 90 : Math.min(300, Math.max(64, maxLen * 7 + 12)) };
    }
    ws["!cols"] = cols;
}

function exportDatabaseStgToExcel() {
    if (typeof XLSX === "undefined") {
        alert("Library SheetJS (XLSX) belum dimuat pada halaman!");
        return;
    }
    if (stgSortedFiltered.length === 0) {
        alert("Tidak ada data karyawan (sesuai filter saat ini) untuk di-export.");
        return;
    }

    const exportRows = stgSortedFiltered.map(emp => {
        const assign = getEmployeeAssignment(emp.id);
        const bagObj = masterCache.bagians.find(bg => bg.id == assign?.bagian_id);

        return {
            "NIK": emp.nik_karyawan || "-",
            "Nama": emp.nama || "-",
            "Tempat Lahir": emp.tempat_lahir || "-",
            "Tanggal Lahir": emp.tanggal_lahir || "-",
            "Jenis Kelamin": emp.jenis_kelamin || "-",
            "Pendidikan": emp.pendidikan || "-",
            "Agama": emp.agama || "-",
            "Status Pernikahan": emp.status_pernikahan || "-",
            "Jumlah Anak": emp.anak ?? 0,
            "No Telp": emp.no_telp || "-",
            "Alamat": emp.alamat_ktp || "-",
            "Tanggal Masuk": getTanggalMasuk(emp) || "-",
            "Tanggal Keluar": getTanggalKeluar(emp) || "",     // kosong jika belum keluar
            "No Absen STG": emp.no_absen_stg || "-",
            "Bagian": bagObj?.bagian_name || ""
        };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    formatExportSheet(ws, EXPORT_DATE_HEADERS);
    XLSX.utils.book_append_sheet(wb, ws, "Database STG");
    XLSX.writeFile(wb, `Export_Database_STG_${todayLocalIso()}.xlsx`);
}