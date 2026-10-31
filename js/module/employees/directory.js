/**
 * ============================================================================
 * WEB ERP PT DUTA MAKMUR BERSAMA
 * Module: Employee Directory
 * File: directory.js
 * Deskripsi: Logika Utama Tabel Direktori, RBAC, Filter, Statistika, 
 * Modal Mutasi (Generate NIK manual), Modal Resign & Navigasi Rehire.
 * ============================================================================
 */

let directoryEmployees = [];
let directoryAssignments = [];
let directoryAssignmentsByEmp = new Map(); // index: employee_id -> daftar assignment (terbaru di atas)
let masterCache = {
    branches: [],
    cost_centers: [],
    departments: [],
    areas: [],
    bagians: [],
    jabatans: []
};

// User Profile & Role Global
let currentUserProfile = null;

// Global Variable Permission Menu Saat Ini (Public Table role_permissions)
let currentMenuPermissions = {
    can_view: false,
    can_create: false,
    can_edit: false,
    can_delete: false
};

// ID Menu Data Karyawan dari tabel public.app_menus
const MENU_DIRECTORY_ID = 5; 

// Daftar Seluruh Kolom Tabel Utama yang Bisa Diatur
const ALL_COLUMNS = [
    { key: "no", label: "No", default: true },
    { key: "nik", label: "NIK", default: true },
    { key: "nama", label: "Nama Karyawan", default: true },
    { key: "dept", label: "Departemen", default: true },
    { key: "jabatan", label: "Jabatan", default: true },
    { key: "branch", label: "Cabang", default: false },
    { key: "costcenter", label: "Cost Center", default: false },
    { key: "area", label: "Area", default: false },
    { key: "bagian", label: "Bagian", default: false },
    { key: "status_karyawan", label: "Status Karyawan", default: true },
    { key: "tgl_masuk", label: "Tanggal Masuk", default: true },
    { key: "tgl_keluar", label: "Tanggal Keluar", default: true },
    { key: "status_data", label: "Status Data", default: true },
    { key: "aksi", label: "Aksi", default: true }
];

let visibleColumnKeys = [];

// ============================================================================
// INISIALISASI HALAMAN (DOM CONTENT LOADED - SINGLE FLOW)
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();

    // 1. Load Profile User & Header
    const userProfile = await loadHeaderUserProfile();

    // 2. Load Permissions dari Database berdasarkan role_id user (Murni DB)
    if (userProfile && userProfile.role_id) {
        await loadDirectoryPermissions(userProfile.role_id);
    }

    // 3. Proteksi RBAC Elemen UI
    applyRoleBasedAccessControl();

    // 4. Inisialisasi Pengaturan Kolom
    initColumnPreferences();

    // 5. Inject Modal Mutasi & Resign ke Body secara Otomatis
    injectActionModals();

    // 6. Setup Event Listeners
    setupEventListeners();

    // 7. Load Data Master & Data Karyawan
    await loadMasterData();
    await loadDirectoryData();
});

// ============================================================================
// HELPER PENCARIAN ASSIGNMENT TERBARU KARYAWAN
// ============================================================================
function buildAssignmentIndex() {
    directoryAssignmentsByEmp = new Map();
    directoryAssignments.forEach(a => {
        const key = String(a.employee_id);
        if (!directoryAssignmentsByEmp.has(key)) directoryAssignmentsByEmp.set(key, []);
        directoryAssignmentsByEmp.get(key).push(a);
    });
    // Urut terbaru di atas: start_date lalu created_at (BUKAN id, karena id = uuid acak)
    directoryAssignmentsByEmp.forEach(list => {
        list.sort((x, y) => {
            const sx = x.start_date || "", sy = y.start_date || "";
            if (sx !== sy) return sy.localeCompare(sx);
            return (y.created_at || "").localeCompare(x.created_at || "");
        });
    });
}

function getEmployeeAssignment(empId, empNik) {
    const list = directoryAssignmentsByEmp.get(String(empId));
    if (!list || list.length === 0) return null;
    // Prioritaskan assignment aktif; kalau tidak ada, ambil yang paling baru
    return list.find(a => a.is_active !== false) || list[0];
}

// ----------------------------------------------------------------------------
// TANGGAL MASUK / KELUAR
// Masuk  = start_date REHIRE terakhir; kalau tidak pernah rehire -> start_date
//          paling awal dari assignment BUKAN MUTATION; fallback: paling awal apa pun.
// Keluar = hanya untuk karyawan non-aktif: end_date paling akhir dari assignment.
// ----------------------------------------------------------------------------
function getTanggalMasuk(emp) {
    const list = directoryAssignmentsByEmp.get(String(emp.id)) || [];
    const type = a => String(a.action_type || "").toUpperCase();
    const dates = arr => arr.map(a => a.start_date).filter(Boolean).sort();

    const rehire = dates(list.filter(a => type(a) === "REHIRE"));
    if (rehire.length) return rehire[rehire.length - 1];

    const nonMut = dates(list.filter(a => type(a) !== "MUTATION"));
    if (nonMut.length) return nonMut[0];

    const all = dates(list);
    return all.length ? all[0] : "";
}

function getTanggalKeluar(emp) {
    if (emp.is_active !== false) return "";
    const list = directoryAssignmentsByEmp.get(String(emp.id)) || [];
    const ends = list.map(a => a.end_date).filter(Boolean).sort();
    return ends.length ? ends[ends.length - 1] : "";
}

// "2026-10-19" -> "19/10/2026" (hanya untuk tampilan tabel)
function formatTanggalDirectory(dateStr) {
    if (!dateStr) return "-";
    const p = String(dateStr).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : dateStr;
}

// ============================================================================
// 1. HEADER PROFIL PENGGUNA & RBAC CHECKER
// ============================================================================
async function loadHeaderUserProfile() {
    try {
        const nameEl = document.getElementById("headerUserName");
        const roleEl = document.getElementById("headerUserRole");
        
                // ============================================================
        // PERBAIKAN PROFIL TERTUKAR:
        // Prioritaskan sesi Supabase Auth (identitas asli yang login),
        // cache erp_user hanya sebagai pelengkap data (nama, role).
        // Sebelumnya cache dibaca lebih dulu -> jika login ulang pakai
        // user lain tanpa logout, header bisa menampilkan nama LAMA.
        // ============================================================
        let user = null;

        // LANGKAH 1: Cek sesi Supabase Auth terlebih dahulu (sumber kebenaran)
        let supabaseSessionUser = null;
        if (typeof supabaseClient !== "undefined") {
            const { data: authData } = await supabaseClient.auth.getUser();
            if (authData?.user) {
                supabaseSessionUser = authData.user;
            }
        }

        // LANGKAH 2: Baca cache lama sebagai data pelengkap
        const localData = localStorage.getItem("erp_user") || sessionStorage.getItem("erp_user");
        const cachedUser = localData ? JSON.parse(localData) : null;

        // LANGKAH 3: Tentukan user aktif
        if (supabaseSessionUser) {
            // Ada sesi auth yang valid -> gabungkan:
            // dasar = sesi auth (identitas benar), dilengkapi cache (nama, role, dll)
            user = { ...cachedUser, ...supabaseSessionUser };
        } else if (cachedUser) {
            // Tidak ada sesi auth aktif, fallback ke cache (perilaku lama)
            user = cachedUser;
        }


        if (user) {
            let displayName = user.nama || user.name || user.username || "";
            let displayNik = user.nik_karyawan || user.nik || "";
            let displayRole = user.role_name || user.role || "User";
            let roleId = user.role_id || user.roleId || null;

            // Jika role_id belum ada di session, query langsung dari public.users
            if ((!displayName || !displayNik || !roleId) && user.email) {
                const cleanNik = user.email.split("@")[0];

                if (!roleId) {
                    const { data: userData } = await supabaseClient
                        .from("users_safe")
                        .select("id, username, role_id")
                        .ilike("username", cleanNik)
                        .maybeSingle();

                    if (userData && userData.role_id) {
                        roleId = userData.role_id;
                    }
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

            // Ambil nama role dari public.roles berdasarkan role_id yang sudah ditemukan
            if (roleId) {
                const { data: roleData } = await supabaseClient
                    .from("roles")
                    .select("role_name")
                    .eq("id", roleId)
                    .maybeSingle();

                if (roleData && roleData.role_name) {
                    displayRole = roleData.role_name;
                }
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

function hasManageAccess() {
    return currentMenuPermissions.can_edit || currentMenuPermissions.can_delete || currentMenuPermissions.can_create;
}

async function loadDirectoryPermissions(roleId) {
    try {
        if (!roleId) return currentMenuPermissions;

        const { data, error } = await supabaseClient
            .from('role_permissions')
            .select('can_view, can_create, can_edit, can_delete')
            .eq('role_id', roleId)
            .eq('menu_id', MENU_DIRECTORY_ID)
            .maybeSingle();

        if (error) {
            console.error("Error fetching role_permissions:", error);
        }

        if (data) {
            currentMenuPermissions = {
                can_view: Boolean(data.can_view),
                can_create: Boolean(data.can_create),
                can_edit: Boolean(data.can_edit),
                can_delete: Boolean(data.can_delete)
            };
        } else {
            console.warn("Permission tidak ditemukan di role_permissions untuk role_id:", roleId, "menu_id:", MENU_DIRECTORY_ID);
        }
    } catch (err) {
        console.error("Gagal memuat permission:", err);
    }

    return currentMenuPermissions;
}

function applyRoleBasedAccessControl() {
    const btnTambah = document.getElementById("btnTambahKaryawan") || document.querySelector(".btn-tambah-karyawan");
    const btnDownloadTemp = document.getElementById("btnDownloadTemplate") || document.getElementById("btn-template-bulk");
    const btnBulk = document.getElementById("btnBulkData") || document.getElementById("btn-bulk-data");
    const btnExport = document.getElementById("btnExport") || document.getElementById("btn-export-excel");

    const displayCreate = currentMenuPermissions.can_create ? "inline-block" : "none";
    if (btnTambah) btnTambah.style.display = displayCreate;
    if (btnBulk) btnBulk.style.display = displayCreate;
    if (btnDownloadTemp) btnDownloadTemp.style.display = displayCreate;

    if (btnExport) btnExport.style.display = currentMenuPermissions.can_view ? "inline-block" : "none";
}

// ============================================================================
// 2. MANAGEMENT KOLOM DINAMIS
// ============================================================================
function initColumnPreferences() {
    const saved = localStorage.getItem("dir_visible_columns");
    if (saved) {
        try {
            visibleColumnKeys = JSON.parse(saved);
        } catch (e) {
            visibleColumnKeys = ALL_COLUMNS.filter(c => c.default).map(c => c.key);
        }
    } else {
        visibleColumnKeys = ALL_COLUMNS.filter(c => c.default).map(c => c.key);
    }

    // Kolom baru (Tanggal Masuk/Keluar): user yang sudah punya pengaturan kolom
    // tersimpan tidak akan melihatnya otomatis. Tambahkan SEKALI saja; setelah itu
    // pilihan user (centang/tidak) dihormati.
    if (!localStorage.getItem("dir_cols_v2")) {
        ["tgl_masuk", "tgl_keluar"].forEach(k => {
            if (!visibleColumnKeys.includes(k)) visibleColumnKeys.push(k);
        });
        localStorage.setItem("dir_visible_columns", JSON.stringify(visibleColumnKeys));
        localStorage.setItem("dir_cols_v2", "1");
    }

    const modalManage = document.getElementById("modalManageColumns");
    if (modalManage) {
        modalManage.addEventListener("show.bs.modal", renderColumnChecklist);
    }

    const btnSaveCols = document.getElementById("btnSaveColumns");
    if (btnSaveCols) {
        btnSaveCols.addEventListener("click", saveColumnPreferences);
    }
}

function renderColumnChecklist() {
    const container = document.getElementById("columnChecklistContainer");
    if (!container) return;

    let html = "";
    ALL_COLUMNS.forEach(col => {
        const isChecked = visibleColumnKeys.includes(col.key) ? "checked" : "";
        html += `
            <div class="col-6 mb-2">
                <div class="form-check">
                    <input class="form-check-input col-checkbox" type="checkbox" id="col_chk_${col.key}" value="${col.key}" ${isChecked}>
                    <label class="form-check-label small fw-semibold" for="col_chk_${col.key}">
                        ${col.label}
                    </label>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

function saveColumnPreferences() {
    const checkboxes = document.querySelectorAll(".col-checkbox:checked");
    const selectedKeys = Array.from(checkboxes).map(cb => cb.value);

    if (selectedKeys.length === 0) {
        alert("Minimal pilih 1 kolom untuk ditampilkan!");
        return;
    }

    visibleColumnKeys = selectedKeys;
    localStorage.setItem("dir_visible_columns", JSON.stringify(visibleColumnKeys));

    const modalEl = document.getElementById("modalManageColumns");
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();

    renderDirectoryTable();
}

function renderTableHeader() {
    const headerRow = document.getElementById("tableHeaderRow");
    if (!headerRow) return;

    let html = "";
    ALL_COLUMNS.forEach(col => {
        if (visibleColumnKeys.includes(col.key)) {
            let widthStyle = "";
            let alignClass = "text-start";

            if (col.key === "no") { widthStyle = 'style="width: 50px;"'; alignClass = "text-center"; }
            else if (col.key === "nik") { widthStyle = 'style="width: 120px;"'; alignClass = "text-center"; }
            else if (col.key === "status_karyawan" || col.key === "status_data" || col.key === "tgl_masuk" || col.key === "tgl_keluar") { alignClass = "text-center"; }
            else if (col.key === "aksi") { widthStyle = 'style="width: 100px;"'; alignClass = "text-center"; }

            html += `<th class="${alignClass}" ${widthStyle}>${col.label}</th>`;
        }
    });

    headerRow.innerHTML = html;
}

// ============================================================================
// 3. LOAD DATA MASTER & DATA KARYAWAN
// ============================================================================
async function loadMasterData() {
    try {
        const [b, cc, d, a, bg, j] = await Promise.all([
            supabaseClient.from("branches").select("*"),
            supabaseClient.from("cost_centers").select("*"),
            supabaseClient.from("departments").select("*"),
            supabaseClient.from("areas").select("*"),
            supabaseClient.from("bagians").select("*"),
            supabaseClient.from("jabatans").select("*")
        ]);

        masterCache.branches = b.data || [];
        masterCache.cost_centers = cc.data || [];
        masterCache.departments = d.data || [];
        masterCache.areas = a.data || [];
        masterCache.bagians = bg.data || [];
        masterCache.jabatans = j.data || [];

        populateFilterDropdowns();
    } catch (err) {
        console.warn("Gagal memuat master data:", err);
    }
}


// ============================================================================
// FILTER CHECKLIST (bisa memilih lebih dari satu)
// Setiap <select> filter diubah menjadi tombol + daftar checklist. <select> aslinya
// disembunyikan dan dijadikan penyimpan pilihan (multiple), jadi kode lain cukup membaca
// getMultiValues(id). Tidak ada centang = filter tidak dipakai (semua data).
// ============================================================================
const MULTI_FILTER_IDS = ["filterStatusData", "filterStatusKaryawan", "filterBranch", "filterCostCenter",
                          "filterDept", "filterArea", "filterJabatan", "filterBagian"];

function mfEsc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

    // teks "semua" diambil dari opsi pertama (mis. "-- Semua Cabang --") sebelum diubah
    if (!sel.dataset.allText) {
        sel.dataset.allText = sel.options[0] ? sel.options[0].text.replace(/^[-\s]+|[-\s]+$/g, "") : "Semua";
    }
    sel.dataset.mf = "1";
    // Pilihan bawaan = opsi yang ditandai "selected" di markup (mis. Aktif). Jangan pakai o.selected:
    // browser otomatis menganggap opsi PERTAMA terpilih pada <select> biasa.
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
            <div class="d-flex align-items-center gap-2 mb-2 mf-tools">
                <input type="text" class="form-control form-control-sm mf-search" placeholder="Cari..." autocomplete="off">
                <button type="button" class="btn btn-link btn-sm text-decoration-none p-0 text-nowrap mf-clear">Kosongkan</button>
            </div>
            <div class="mf-list" style="max-height:200px; overflow-y:auto;"></div>
        </div>`;
    sel.insertAdjacentElement("afterend", wrap);

    const btn = wrap.querySelector(".mf-btn");
    const textEl = wrap.querySelector(".mf-text");
    const panel = wrap.querySelector(".mf-panel");
    const tools = wrap.querySelector(".mf-tools");
    const search = wrap.querySelector(".mf-search");
    const list = wrap.querySelector(".mf-list");

    function updateSummary() {
        const chosen = Array.from(sel.options).filter(o => o.selected && o.value !== "");
        textEl.textContent = chosen.length === 0 ? sel.dataset.allText
                           : chosen.length === 1 ? chosen[0].text
                           : `${chosen.length} dipilih`;
        btn.classList.toggle("btn-outline-primary", chosen.length > 0);
        btn.classList.toggle("btn-outline-secondary", chosen.length === 0);
    }

    function renderList() {
        const opts = Array.from(sel.options).filter(o => o.value !== "");
        tools.querySelector(".mf-search").style.display = opts.length > 8 ? "" : "none";
        const q = search.value.trim().toLowerCase();
        const shown = opts.filter(o => !q || o.text.toLowerCase().includes(q));
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
    wrap.querySelector(".mf-clear").addEventListener("click", () => {
        Array.from(sel.options).forEach(o => { o.selected = false; });
        updateSummary(); renderList(); fireChange();
    });

    wrap._mfRefresh = () => { updateSummary(); if (panel.style.display !== "none") renderList(); };
    updateSummary();
}

function resetAllFilters() {
    MULTI_FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        // Status Data kembali ke bawaan (Aktif); filter lain dikosongkan
        Array.from(el.options).forEach(o => { o.selected = (id === "filterStatusData" && o.value === "active"); });
        refreshMultiFilter(id);
    });
    renderDirectoryTable();
}

// Angka kecil pada tombol "Filter Data": jumlah filter yang sedang dipakai (Status Data = Aktif saja tidak dihitung)
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

function populateFilterDropdowns() {
    fillSelectOptions("filterBranch", masterCache.branches, "id", "branch_name", "-- Semua Cabang --");
    fillSelectOptions("filterCostCenter", masterCache.cost_centers, "id", "costcenter_name", "-- Semua Cost Center --");
    fillSelectOptions("filterDept", masterCache.departments, "id", "department_name", "-- Semua Departemen --");
    fillSelectOptions("filterArea", masterCache.areas, "id", "area_name", "-- Semua Area --");
    fillSelectOptions("filterJabatan", masterCache.jabatans, "id", "jabatan_name", "-- Semua Jabatan --");
    fillSelectOptions("filterBagian", masterCache.bagians, "id", "bagian_name", "-- Semua Bagian --");
    MULTI_FILTER_IDS.forEach(refreshMultiFilter);   // tampilan checklist ikut data terbaru
}

// Daftar master untuk dropdown mutasi: hanya yang aktif (+ yang sedang dipakai penempatan saat ini, diberi "(nonaktif)")
function optListActive(list, usedId, nameKey) {
    return list
        .filter(m => m.is_active !== false || (usedId !== null && usedId !== undefined && String(m.id) === String(usedId)))
        .map(m => m.is_active === false ? { ...m, [nameKey]: `${m[nameKey]} (nonaktif)` } : m);
}

function fillSelectOptions(elementId, list, valKey, textKey, defaultText) {
    const el = document.getElementById(elementId);
    if (!el) return;
    let html = `<option value="">${defaultText}</option>`;
    list.forEach(item => {
        html += `<option value="${item[valKey]}">${item[textKey]}</option>`;
    });
    el.innerHTML = html;
}

async function fetchAllRows(table, orderCol) {
    let all = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
        const { data, error } = await supabaseClient
            .schema('hrd').from(table).select('*')
            .order(orderCol, { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        from += data.length; // maju sesuai jumlah yang benar-benar diterima
    }
    return all;
}

async function loadDirectoryData() {
    const tbody = document.getElementById("tableBody");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="100%" class="text-center py-5 text-muted">
                    <div class="spinner-border spinner-border-sm text-primary me-2"></div>
                    <span>Memuat data karyawan dan penempatan...</span>
                </td>
            </tr>`;
    }

    try {
        // Ambil SEMUA baris (Supabase membatasi 1 request = max 1000 baris)
        const emps = await fetchAllRows('employees', 'id');
        const assigns = await fetchAllRows('employee_assignments', 'id');
        console.log(`[Directory] employees: ${emps.length} baris, assignments: ${assigns.length} baris`);

        directoryEmployees = emps || [];
        directoryAssignments = assigns || [];
        buildAssignmentIndex();

        renderDirectoryTable();

    } catch (err) {
        console.error("Gagal memuat direktori:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="100%" class="text-center text-danger py-4">Gagal memuat data: ${err.message || err}</td></tr>`;
        }
    }
}

// ============================================================================
// 4. RENDER TABEL & PERHITUNGAN STATISTIK DENGAN FILTER & RBAC AKSI
// ============================================================================

// State pagination -- max 100 baris per halaman
const DIRECTORY_ROWS_PER_PAGE = 100;
let directoryCurrentPage = 1;
let directorySortedFiltered = []; // hasil filter+sort TERAKHIR, dipakai ulang saat pindah halaman (tanpa hitung ulang filter)

// Urutan prioritas Status Karyawan sesuai permintaan:
// PKWTT & PKWT paling atas (tier sama), lalu Borongan, lalu Reliver.
// Status lain (kosong/tidak dikenal) ditaruh paling bawah.
const STATUS_SORT_PRIORITY = {
    'pkwtt': 1,
    'pkwt': 1,
    'borongan': 2,
    'reliver': 3
};

function sortEmployeesForDisplay(list) {
    // Salin array dulu (jangan mutate langsung "filtered" asli)
    return [...list].sort((a, b) => {
        const assignA = getEmployeeAssignment(a.id, a.nik_karyawan);
        const assignB = getEmployeeAssignment(b.id, b.nik_karyawan);

        // 1. Prioritas Status Karyawan
        const prioA = STATUS_SORT_PRIORITY[(assignA?.status_karyawan || '').toLowerCase()] ?? 99;
        const prioB = STATUS_SORT_PRIORITY[(assignB?.status_karyawan || '').toLowerCase()] ?? 99;
        if (prioA !== prioB) return prioA - prioB;

        // 2. Branch (nama, bukan id -- supaya urutannya sesuai abjad nama cabang)
        const branchA = masterCache.branches.find(b => b.id == assignA?.branch_id)?.branch_name || '';
        const branchB = masterCache.branches.find(b => b.id == assignB?.branch_id)?.branch_name || '';
        const branchCompare = branchA.localeCompare(branchB);
        if (branchCompare !== 0) return branchCompare;

        // 3. Cost Center
        const ccA = masterCache.cost_centers.find(c => c.id == assignA?.costcenter_id)?.costcenter_name || '';
        const ccB = masterCache.cost_centers.find(c => c.id == assignB?.costcenter_id)?.costcenter_name || '';
        const ccCompare = ccA.localeCompare(ccB);
        if (ccCompare !== 0) return ccCompare;

        // 4. Jabatan
        const jabA = masterCache.jabatans.find(j => j.id == assignA?.jabatan_id)?.jabatan_name || '';
        const jabB = masterCache.jabatans.find(j => j.id == assignB?.jabatan_id)?.jabatan_name || '';
        return jabA.localeCompare(jabB);
    });
}

function renderDirectoryTable() {
    renderTableHeader();

    const tbody = document.getElementById("tableBody");
    const recordInfo = document.getElementById("recordInfo");
    if (!tbody) return;

    const searchTerm = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
    const branchVals = getMultiValues("filterBranch") || [];
    const ccVals = getMultiValues("filterCostCenter") || [];
    const deptVals = getMultiValues("filterDept") || [];
    const areaVals = getMultiValues("filterArea") || [];
    const jabVals = getMultiValues("filterJabatan") || [];
    const bagVals = getMultiValues("filterBagian") || [];
    const statusDataVals = getMultiValues("filterStatusData") || ["active"];   // sebelum filter siap: bawaan Aktif
    const statusKarVals = (getMultiValues("filterStatusKaryawan") || []).map(v => v.toUpperCase());
    updateFilterBadge();

    const responsiveDiv = document.querySelector(".table-responsive");
    if (responsiveDiv) responsiveDiv.style.minHeight = "480px";

    // Filtering Data Utama
    const filtered = directoryEmployees.filter(emp => {
        const isActive = emp.is_active !== false;
        if (statusDataVals.length && !statusDataVals.includes(isActive ? "active" : "inactive")) return false;

        if (searchTerm) {
            const nik = (emp.nik_karyawan || "").toLowerCase();
            const nama = (emp.nama || "").toLowerCase();
            if (!nik.includes(searchTerm) && !nama.includes(searchTerm)) return false;
        }

        const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

        if (statusKarVals.length && !statusKarVals.includes(String(assign?.status_karyawan || "").trim().toUpperCase())) return false;
        if (branchVals.length && !branchVals.includes(String(assign?.branch_id))) return false;
        if (ccVals.length && !ccVals.includes(String(assign?.costcenter_id))) return false;
        if (deptVals.length && !deptVals.includes(String(assign?.departemen_id))) return false;
        if (areaVals.length && !areaVals.includes(String(assign?.area_id))) return false;
        if (jabVals.length && !jabVals.includes(String(assign?.jabatan_id))) return false;
        if (bagVals.length && !bagVals.includes(String(assign?.bagian_id))) return false;

        return true;
    });

    // Update Kartu Statistika Berdasarkan Data Terfilter (SEBELUM dipaging --
    // statistik harus mencerminkan SEMUA hasil filter, bukan cuma 1 halaman)
    updateStatisticsCardsFiltered(filtered);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="100%" class="text-center py-5 text-muted">Tidak ada data karyawan yang sesuai dengan kriteria filter.</td></tr>`;
        if (recordInfo) recordInfo.textContent = "Menampilkan 0 data";
        renderDirectoryPagination(0);
        return;
    }

    // Urutkan sesuai Status Karyawan > Branch > Cost Center > Jabatan,
    // simpan hasilnya supaya navigasi halaman tidak perlu filter+sort ulang.
    directorySortedFiltered = sortEmployeesForDisplay(filtered);

    // Setiap kali filter/pencarian/data berubah, kembali ke halaman 1 --
    // supaya user tidak "nyasar" di halaman 5 saat hasil filter baru cuma 2 halaman.
    directoryCurrentPage = 1;

    renderDirectoryTableRows();
}

// ============================================================================
// RENDER BARIS TABEL UNTUK HALAMAN AKTIF SAJA (dipanggil dari
// renderDirectoryTable() maupun langsung dari tombol pindah halaman)
// ============================================================================
function renderDirectoryTableRows() {
    const tbody = document.getElementById("tableBody");
    const recordInfo = document.getElementById("recordInfo");
    if (!tbody) return;

    const totalRecords = directorySortedFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / DIRECTORY_ROWS_PER_PAGE));

    // Jaga-jaga: kalau currentPage kebablasan (mis. data berkurang), tarik balik ke batas valid
    if (directoryCurrentPage > totalPages) directoryCurrentPage = totalPages;
    if (directoryCurrentPage < 1) directoryCurrentPage = 1;

    const startIdx = (directoryCurrentPage - 1) * DIRECTORY_ROWS_PER_PAGE;
    const pageItems = directorySortedFiltered.slice(startIdx, startIdx + DIRECTORY_ROWS_PER_PAGE);

    let html = "";
    pageItems.forEach((emp, i) => {
        const index = startIdx + i; // nomor urut tetap berlanjut lintas halaman, bukan reset ke 1 tiap halaman
        const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

        const deptObj = masterCache.departments.find(d => d.id == assign?.departemen_id);
        const jabObj = masterCache.jabatans.find(j => j.id == assign?.jabatan_id);
        const branchObj = masterCache.branches.find(b => b.id == assign?.branch_id);
        const ccObj = masterCache.cost_centers.find(c => c.id == assign?.costcenter_id);
        const areaObj = masterCache.areas.find(a => a.id == assign?.area_id);
        const bagObj = masterCache.bagians.find(bg => bg.id == assign?.bagian_id);

        const isEmpActive = emp.is_active !== false;
        const statusBadge = isEmpActive 
            ? `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">Aktif</span>` 
            : `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1">Non-Aktif</span>`;

        // Modul RBAC Aksi (Detail, Mutasi, Resign, dan Rehire)
        let actionDropdown = "";
        if (currentMenuPermissions.can_view || currentMenuPermissions.can_edit || currentMenuPermissions.can_create || currentMenuPermissions.can_delete) {
            
            // Tombol Resign (Karyawan Aktif & Punya Akses Delete/Edit)
            const resignBtn = (isEmpActive && (currentMenuPermissions.can_delete || currentMenuPermissions.can_edit))
                ? `<li><a class="dropdown-item py-1 text-danger" href="#" onclick="openResignModal('${emp.id}')"><i class="fa-solid fa-user-slash me-2"></i>Resign</a></li>`
                : '';

            // Tombol Rehire (Karyawan Non-Aktif & Punya Akses Create/Edit) -> Terhubung ke employee_rehire.html
            const rehireBtn = (!isEmpActive && (currentMenuPermissions.can_create || currentMenuPermissions.can_edit))
                ? `<li><a class="dropdown-item py-1 text-success" href="#" onclick="navigateToRehire('${emp.id}')"><i class="fa-solid fa-user-plus me-2"></i>Rehire</a></li>`
                : '';

            // Tombol Mutasi (Karyawan Aktif & Punya Akses Edit)
            const mutasiBtn = (isEmpActive && currentMenuPermissions.can_edit)
                ? `<li><a class="dropdown-item py-1" href="#" onclick="openMutasiModal('${emp.id}')"><i class="fa-solid fa-right-left me-2 text-warning"></i>Mutasi</a></li>`
                : '';

            const hasExtraActions = mutasiBtn || resignBtn || rehireBtn;

            actionDropdown = `
                <div class="dropdown">
                    <button class="btn btn-sm btn-light border dropdown-toggle fw-semibold px-2 py-1" type="button" data-bs-toggle="dropdown" aria-expanded="false" data-bs-popper-config='{"strategy":"fixed"}'>
                        Aksi
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end shadow border-0 py-1" style="font-size: 0.85rem; z-index: 1050;">
                        <li><a class="dropdown-item py-1" href="#" onclick="openDetailKaryawan('${emp.id}', '${emp.nik_karyawan}')"><i class="fa-solid fa-address-card me-2 text-primary"></i>Detail Karyawan</a></li>
                        ${hasExtraActions ? `<li><hr class="dropdown-divider my-1"></li>` : ''}
                        ${mutasiBtn}
                        ${resignBtn}
                        ${rehireBtn}
                    </ul>
                </div>
            `;
        } else {
            actionDropdown = `<span class="text-muted small"><i class="fa-solid fa-lock me-1"></i>Akses Ditolak</span>`;
        }

        html += `<tr class="align-middle">`;

        ALL_COLUMNS.forEach(col => {
            if (visibleColumnKeys.includes(col.key)) {
                if (col.key === "no") html += `<td class="text-center fw-semibold text-secondary">${index + 1}</td>`;
                else if (col.key === "nik") html += `<td class="text-center"><strong>${emp.nik_karyawan || '-'}</strong></td>`;
                else if (col.key === "nama") html += `<td class="text-start">${emp.nama || '-'}</td>`;
                else if (col.key === "dept") html += `<td>${deptObj?.department_name || assign?.departemen_id || '-'}</td>`;
                else if (col.key === "jabatan") html += `<td>${jabObj?.jabatan_name || assign?.jabatan_id || '-'}</td>`;
                else if (col.key === "branch") html += `<td>${branchObj?.branch_name || '-'}</td>`;
                else if (col.key === "costcenter") html += `<td>${ccObj?.costcenter_name || '-'}</td>`;
                else if (col.key === "area") html += `<td>${areaObj?.area_name || '-'}</td>`;
                else if (col.key === "bagian") html += `<td>${bagObj?.bagian_name || '-'}</td>`;
                else if (col.key === "status_karyawan") html += `<td class="text-center">${assign?.status_karyawan || '-'}</td>`;
                else if (col.key === "tgl_masuk") html += `<td class="text-center">${formatTanggalDirectory(getTanggalMasuk(emp))}</td>`;
                else if (col.key === "tgl_keluar") html += `<td class="text-center">${formatTanggalDirectory(getTanggalKeluar(emp))}</td>`;
                else if (col.key === "status_data") html += `<td class="text-center">${statusBadge}</td>`;
                else if (col.key === "aksi") html += `<td class="text-center">${actionDropdown}</td>`;
            }
        });

        html += `</tr>`;
    });

    tbody.innerHTML = html;
    if (recordInfo) recordInfo.textContent = `Menampilkan ${pageItems.length} dari ${totalRecords} data terfilter (Halaman ${directoryCurrentPage}/${totalPages})`;

    renderDirectoryPagination(totalPages);
}

// ============================================================================
// KONTROL PAGINATION -- tombol Prev/Next + info halaman, max 100 baris/halaman
// ============================================================================
function renderDirectoryPagination(totalPages) {
    let paginationEl = document.getElementById("directoryPaginationControls");

    // Elemen pagination belum ada di HTML lama -- buat sekali, taruh di
    // card-footer, sejajar dengan info jumlah data.
    if (!paginationEl) {
        const footer = document.querySelector(".card-footer");
        if (!footer) return;
        paginationEl = document.createElement("div");
        paginationEl.id = "directoryPaginationControls";
        paginationEl.className = "d-flex align-items-center gap-2";
        footer.appendChild(paginationEl);
    }

    if (totalPages <= 1) {
        paginationEl.innerHTML = "";
        return;
    }

    paginationEl.innerHTML = `
        <button type="button" class="btn btn-sm btn-outline-secondary" ${directoryCurrentPage === 1 ? 'disabled' : ''} onclick="goToDirectoryPage(${directoryCurrentPage - 1})">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        <span class="small fw-semibold text-muted">Halaman ${directoryCurrentPage} / ${totalPages}</span>
        <button type="button" class="btn btn-sm btn-outline-secondary" ${directoryCurrentPage === totalPages ? 'disabled' : ''} onclick="goToDirectoryPage(${directoryCurrentPage + 1})">
            <i class="fa-solid fa-chevron-right"></i>
        </button>`;
}

// Dipanggil oleh tombol Prev/Next -- TIDAK filter+sort ulang, cukup slice
// ulang dari directorySortedFiltered yang sudah dihitung sebelumnya (cepat).
function goToDirectoryPage(page) {
    directoryCurrentPage = page;
    renderDirectoryTableRows();
}

// PERHITUNGAN KARTU DASHBOARD STATISTIK DENGAN FILTER
function updateStatisticsCardsFiltered(filteredList) {
    const cardTotal = document.getElementById("cardTotalEmp");
    const cardIn = document.getElementById("cardEmpIn");
    const cardOut = document.getElementById("cardEmpOut");

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let totalActive = 0, countIn = 0, countOut = 0;

    filteredList.forEach(emp => {
        if (emp.is_active !== false) totalActive++;
        const list = directoryAssignmentsByEmp.get(String(emp.id)) || [];

        // MASUK: ada assignment BUKAN mutasi (hire/rehire) dengan start_date bulan ini
        const masuk = list.some(a =>
            String(a.action_type || "").toUpperCase() !== "MUTATION" &&
            (a.start_date || "").startsWith(ym));
        if (masuk) countIn++;

        // KELUAR: karyawan non-aktif dengan end_date bulan ini
        if (emp.is_active === false) {
            const keluar = list.some(a => (a.end_date || "").startsWith(ym));
            if (keluar) countOut++;
        }
    });

    if (cardTotal) cardTotal.textContent = totalActive;
    if (cardIn) cardIn.textContent = countIn;
    if (cardOut) cardOut.textContent = countOut;
}

// ============================================================================
// 5. EVENT LISTENERS SETUP & NAVIGASI
// ============================================================================
function setupEventListeners() {
    // --- FILTER DROPDOWNS ---
    // Dua filter status (checklist) disisipkan paling atas pada panel filter:
    //  - "Status Data"     : Aktif / Non-Aktif (dulu bernama "Status Karyawan")
    //  - "Status Karyawan" : PKWT / PKWTT / Reliver / Borongan
    const filterContainer = document.querySelector(".filter-dropdown-menu .row");
    if (filterContainer && !document.getElementById("filterStatusData")) {
        filterContainer.insertAdjacentHTML("afterbegin", `
            <div class="col-12 mb-2" id="statusDataContainer">
                <label class="form-label mb-1 style-sub-label fw-bold">Status Data</label>
                <select id="filterStatusData" data-all-text="Semua (tanpa filter)">
                    <option value="active" selected>Aktif</option>
                    <option value="inactive">Non-Aktif</option>
                </select>
            </div>
            <div class="col-12 mb-2" id="statusKaryawanContainer">
                <label class="form-label mb-1 style-sub-label fw-bold">Status Karyawan</label>
                <select id="filterStatusKaryawan" data-all-text="Semua Status Karyawan">
                    <option value="PKWT">PKWT</option>
                    <option value="PKWTT">PKWTT</option>
                    <option value="Reliver">Reliver</option>
                    <option value="Borongan">Borongan</option>
                </select>
            </div>`);
    }

    // Semua filter diubah menjadi checklist (bisa pilih lebih dari satu)
    MULTI_FILTER_IDS.forEach(initMultiFilter);

    const btnReset = document.getElementById("btnResetFilter");
    if (btnReset) btnReset.addEventListener("click", resetAllFilters);

    // Menu filter ditutup -> tutup juga panel checklist yang sedang terbuka
    document.getElementById("dropdownFilterBtn")?.addEventListener("hide.bs.dropdown", () => {
        document.querySelectorAll(".mf-panel").forEach(p => { p.style.display = "none"; });
    });

    document.querySelectorAll(".filter-dropdown-menu select").forEach(s => {
        s.addEventListener("change", renderDirectoryTable);
    });

    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.addEventListener("input", renderDirectoryTable);

    // --- FUNGSI KLIK TOMBOL HEADER EXPORT ---
    const btnExport = document.getElementById("btnExport") || document.getElementById("btn-export-excel");
    if (btnExport) {
        btnExport.addEventListener("click", (e) => {
            e.preventDefault();
            exportDirectoryToExcel();
        });
    }
}

// ============================================================================
// NAVIGASI DENGAN REHIRE INTEGRATION
// ============================================================================
function openDetailKaryawan(id, nik) {
    window.location.href = `employee_edit.html?id=${id}&nik=${nik || ''}`;
}

// Navigasi Terhubung ke employee_rehire.html untuk Memproses Rehire Karyawan Non-Aktif
function navigateToRehire(empId) {
    if (!empId) {
        alert("ID Karyawan tidak valid untuk proses Rehire.");
        return;
    }
    window.location.href = `employee_rehire.html?id=${empId}`;
}

// ============================================================================
// 8. LOGIKA DAN FORM MODAL MUTASI (NIK DIGENERATE MANUAL VIA TOMBOL)
// ============================================================================
function openMutasiModal(empId) {
    const emp = directoryEmployees.find(e => String(e.id) === String(empId));
    if (!emp) return;

    const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

    // Cost Center & Area berupa dropdown pencarian (ketik untuk menyaring, atau klik panah)
    enhanceSearchableSelect("mut_cc");
    enhanceSearchableSelect("mut_area");
    enhanceSearchableSelect("mut_bagian");
    enhanceSearchableSelect("mut_jabatan");

    document.getElementById("mut_emp_id").value = emp.id;
    document.getElementById("mut_emp_name").value = `${emp.nama} (${emp.nik_karyawan})`;
    document.getElementById("mut_prev_status").value = assign?.status_karyawan || "";

    fillSelectOptions("mut_branch", optListActive(masterCache.branches, assign?.branch_id, "branch_name"), "id", "branch_name", "-- Pilih Cabang --");
    fillSelectOptions("mut_cc", optListActive(masterCache.cost_centers, assign?.costcenter_id, "costcenter_name"), "id", "costcenter_name", "-- Pilih Cost Center --");
    fillSelectOptions("mut_dept", optListActive(masterCache.departments, assign?.departemen_id, "department_name"), "id", "department_name", "-- Pilih Departemen --");
    fillSelectOptions("mut_area", optListActive(masterCache.areas, assign?.area_id, "area_name"), "id", "area_name", "-- Pilih Area --");
    fillSelectOptions("mut_bagian", optListActive(masterCache.bagians, assign?.bagian_id, "bagian_name"), "id", "bagian_name", "-- Pilih Bagian --");
    fillSelectOptions("mut_jabatan", optListActive(masterCache.jabatans, assign?.jabatan_id, "jabatan_name"), "id", "jabatan_name", "-- Pilih Jabatan --");

    if (assign) {
        if (document.getElementById("mut_branch")) document.getElementById("mut_branch").value = assign.branch_id || "";
        if (document.getElementById("mut_cc")) document.getElementById("mut_cc").value = assign.costcenter_id || "";
        if (document.getElementById("mut_dept")) document.getElementById("mut_dept").value = assign.departemen_id || "";
        if (document.getElementById("mut_area")) document.getElementById("mut_area").value = assign.area_id || "";
        if (document.getElementById("mut_bagian")) document.getElementById("mut_bagian").value = assign.bagian_id || "";
        if (document.getElementById("mut_jabatan")) document.getElementById("mut_jabatan").value = assign.jabatan_id || "";
        if (document.getElementById("mut_status_karyawan")) document.getElementById("mut_status_karyawan").value = assign.status_karyawan || "PKWT";
        if (document.getElementById("mut_no_absen_stg")) document.getElementById("mut_no_absen_stg").value = emp.no_absen_stg || "";
    }

    document.getElementById("mut_start_date").value = new Date().toISOString().split('T')[0];

    // NIK lama tetap ditampilkan; tidak digenerate otomatis.
    // Ganti hanya jika perlu, lewat tombol "Generate".
    const nikInput = document.getElementById("mut_nik_karyawan");
    if (nikInput) nikInput.value = emp.nik_karyawan || "";

    onMutasiStatusOrBranchChange();

    new bootstrap.Modal(document.getElementById("modalMutasiKaryawan")).show();
}

function onMutasiStatusOrBranchChange() {
    const prevStatus = (document.getElementById("mut_prev_status")?.value || "").toLowerCase();
    const newStatus = (document.getElementById("mut_status_karyawan")?.value || "").toLowerCase();
    
    const containerNik = document.getElementById("mut_nik_container");
    const containerBagian = document.getElementById("mut_bagian_container");
    const containerStg = document.getElementById("mut_stg_container");

    const isFromBoronganReliver = prevStatus.includes("borongan") || prevStatus.includes("reliver");
    const isToPkwtPkwtt = newStatus.includes("pkwt") || newStatus.includes("pkwtt");

    if (containerNik) {
        containerNik.style.display = (isFromBoronganReliver && isToPkwtPkwtt) ? "block" : "none";
    }

    const isBoronganActive = prevStatus.includes("borongan") || newStatus.includes("borongan");
    if (containerBagian) containerBagian.style.display = isBoronganActive ? "block" : "none";
    if (containerStg) containerStg.style.display = isBoronganActive ? "block" : "none";
}

// Dipanggil HANYA oleh tombol "Generate" di samping kolom NIK
function generateNikMutasi() {
    const statusVal = document.getElementById("mut_status_karyawan")?.value || "";
    const branchId = document.getElementById("mut_branch")?.value || "1";
    const deptId = document.getElementById("mut_dept")?.value || "1";
    const startDateVal = document.getElementById("mut_start_date")?.value || new Date().toISOString().split('T')[0];

    const inputNik = document.getElementById("mut_nik_karyawan");
    if (!inputNik) return;

    const generatedNik = calculateAutoNikCode(statusVal, branchId, deptId, startDateVal);
    inputNik.value = generatedNik;
}

function calculateAutoNikCode(status, branchId, deptId, startDateStr) {
    const statusLower = (status || "").toLowerCase();
    const dateObj = new Date(startDateStr);
    const year2Digits = String(dateObj.getFullYear()).slice(-2);
    const month2Digits = String(dateObj.getMonth() + 1).padStart(2, '0');

    const cleanBranch = String(branchId || "1");
    const cleanDept = String(deptId || "1");

    if (statusLower.includes("borongan")) {
        let maxLetterCode = 65; // 'A'
        let maxSeq = 0;

        directoryEmployees.forEach(e => {
            const nik = e.nik_karyawan || "";
            const match = nik.match(/^([A-Z])(\d{3})$/);
            if (match) {
                const letterCode = match[1].charCodeAt(0);
                const seq = parseInt(match[2], 10);
                if (letterCode > maxLetterCode || (letterCode === maxLetterCode && seq > maxSeq)) {
                    maxLetterCode = letterCode;
                    maxSeq = seq;
                }
            }
        });

        if (maxSeq >= 999) {
            maxLetterCode++;
            maxSeq = 1;
        } else {
            maxSeq++;
        }

        const letterChar = String.fromCharCode(maxLetterCode);
        return `${letterChar}${String(maxSeq).padStart(3, '0')}`;
    }

    if (statusLower.includes("reliver")) {
        const prefix = `DMBR${cleanBranch}${cleanDept}${year2Digits}${month2Digits}`;
        let maxSeq = 0;

        directoryEmployees.forEach(e => {
            const nik = e.nik_karyawan || "";
            if (nik.startsWith(prefix)) {
                const seqStr = nik.replace(prefix, "");
                const seq = parseInt(seqStr, 10);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            }
        });

        maxSeq = (maxSeq >= 999) ? 1 : maxSeq + 1;
        return `${prefix}${String(maxSeq).padStart(3, '0')}`;
    }

    const prefix = `DMB${cleanBranch}${cleanDept}${year2Digits}${month2Digits}`;
    let maxSeq = 0;

    directoryEmployees.forEach(e => {
        const nik = e.nik_karyawan || "";
        if (nik.startsWith(prefix)) {
            const seqStr = nik.replace(prefix, "");
            const seq = parseInt(seqStr, 10);
            if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
    });

    maxSeq = (maxSeq >= 999) ? 1 : maxSeq + 1;
    return `${prefix}${String(maxSeq).padStart(3, '0')}`;
}

async function handleSaveMutasi(e) {
    e.preventDefault();
    const empId = document.getElementById("mut_emp_id").value;
    const branchId = document.getElementById("mut_branch").value;
    const ccId = document.getElementById("mut_cc").value;
    const deptId = document.getElementById("mut_dept").value;
    const areaId = document.getElementById("mut_area").value;
    const bagId = document.getElementById("mut_bagian").value;
    const jabId = document.getElementById("mut_jabatan").value;
    const statusKaryawan = document.getElementById("mut_status_karyawan").value;
    const startDate = document.getElementById("mut_start_date").value;
    const noAbsenStg = document.getElementById("mut_no_absen_stg")?.value || null;
    // NIK hanya dipakai kalau kolom NIK sedang ditampilkan (Borongan/Reliver -> PKWT/PKWTT)
    const nikContainer = document.getElementById("mut_nik_container");
    const nikVisible = nikContainer && nikContainer.style.display !== "none";
    const empLama = directoryEmployees.find(x => String(x.id) === String(empId));
    const nikInputVal = nikVisible ? (document.getElementById("mut_nik_karyawan")?.value.trim() || null) : null;
    // Hanya dianggap "diganti" kalau BEDA dari NIK lama
    const editedNik = (nikInputVal && nikInputVal !== (empLama?.nik_karyawan || "")) ? nikInputVal : null;

    const btn = document.getElementById("btnSaveMutasi");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;

        try {
        // Gabungkan update ke hrd.employees: nik_karyawan (kalau diedit)
        // dan no_absen_stg (sekarang tersimpan di tabel employees, bukan
        // employee_assignments lagi)
        const employeesUpdatePayload = { no_absen_stg: noAbsenStg };
        if (editedNik) {
            employeesUpdatePayload.nik_karyawan = editedNik;
        }

        await supabaseClient.schema('hrd').from('employees')
            .update(employeesUpdatePayload)
            .eq('id', empId);

        await supabaseClient.schema('hrd').from('employee_assignments')
            .update({ is_active: false, end_date: startDate })
            .eq('employee_id', empId)
            .eq('is_active', true);

        const payload = {
            employee_id: empId,
            action_type: 'MUTATION',
            branch_id: branchId ? parseInt(branchId) : null,
            costcenter_id: ccId ? parseInt(ccId) : null,
            departemen_id: deptId ? parseInt(deptId) : null,
            area_id: areaId ? parseInt(areaId) : null,
            bagian_id: bagId ? parseInt(bagId) : null,
            jabatan_id: jabId ? parseInt(jabId) : null,
            status_karyawan: statusKaryawan,
            start_date: startDate,
            is_active: true
        };

        const { error } = await supabaseClient.schema('hrd').from('employee_assignments').insert([payload]);
        if (error) throw error;

        bootstrap.Modal.getInstance(document.getElementById("modalMutasiKaryawan")).hide();
        alert("Proses Mutasi Karyawan Berhasil!");
        await loadDirectoryData();

    } catch (err) {
        alert("Gagal memproses mutasi: " + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Simpan Mutasi";
    }
}

// ============================================================================
// 9. LOGIKA DAN FORM MODAL RESIGN
// ============================================================================
function openResignModal(empId) {
    const emp = directoryEmployees.find(e => String(e.id) === String(empId));
    if (!emp) return;

    const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

    const branchObj = masterCache.branches.find(b => b.id == assign?.branch_id);
    const deptObj = masterCache.departments.find(d => d.id == assign?.departemen_id);
    const ccObj = masterCache.cost_centers.find(c => c.id == assign?.costcenter_id);
    const jabObj = masterCache.jabatans.find(j => j.id == assign?.jabatan_id);

    document.getElementById("res_emp_id").value = emp.id;
    document.getElementById("res_nik").value = emp.nik_karyawan || "-";
    document.getElementById("res_nama").value = emp.nama || "-";
    document.getElementById("res_branch").value = branchObj?.branch_name || "-";
    document.getElementById("res_dept").value = deptObj?.department_name || "-";
    document.getElementById("res_cc").value = ccObj?.costcenter_name || "-";
    document.getElementById("res_jabatan").value = jabObj?.jabatan_name || "-";

    document.getElementById("res_end_date").value = new Date().toISOString().split('T')[0];
    document.getElementById("res_end_reason").value = "";

// Reset Blacklist ke default "No" dan sembunyikan field alasan
    document.getElementById("res_blacklist_no").checked = true;
    document.getElementById("res_blacklist_yes").checked = false;
    document.getElementById("res_blacklist_reason").value = "";
    document.getElementById("containerBlacklistReason").classList.add("d-none");

    new bootstrap.Modal(document.getElementById("modalResignKaryawan")).show();
}

// Tampil/sembunyi field Alasan Blacklist berdasarkan pilihan radio
function toggleBlacklistReason() {
    const isBlacklisted = document.getElementById("res_blacklist_yes").checked;
    const container = document.getElementById("containerBlacklistReason");
    const reasonInput = document.getElementById("res_blacklist_reason");

    if (isBlacklisted) {
        container.classList.remove("d-none");
        reasonInput.required = true;
    } else {
        container.classList.add("d-none");
        reasonInput.required = false;
        reasonInput.value = "";
    }
}

async function handleSaveResign(e) {
    e.preventDefault();
    const empId = document.getElementById("res_emp_id").value;
    const endDate = document.getElementById("res_end_date").value;
    const endReason = document.getElementById("res_end_reason").value;

    const btn = document.getElementById("btnSaveResign");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Memproses...`;

    const isBlacklisted = document.getElementById("res_blacklist_yes").checked;
    const blacklistReason = document.getElementById("res_blacklist_reason").value.trim();

    if (isBlacklisted && !blacklistReason) {
        alert("Alasan Blacklist wajib diisi kalau karyawan di-set Blacklist.");
        btn.disabled = false;
        btn.innerHTML = "Proses Resign";
        return;
    }

    try {
        const { error: errEmp } = await supabaseClient.schema('hrd').from('employees')
            .update({
                is_active: false,
                blacklist: isBlacklisted,
                blacklist_reason: isBlacklisted ? blacklistReason : null
            })
            .eq('id', empId);
        if (errEmp) throw errEmp;

        const { error: errAssign } = await supabaseClient.schema('hrd').from('employee_assignments')
            .update({ is_active: false, end_date: endDate, end_reason: endReason })
            .eq('employee_id', empId)
            .eq('is_active', true);
        if (errAssign) throw errAssign;

        // ===================================================
        // PERBAIKAN BUG: sebelumnya resign HANYA menonaktifkan data
        // kepegawaian (employees.is_active, employee_assignments),
        // tidak pernah menyentuh akun login (public.users.auth_uid).
        // Akibatnya ex-karyawan tetap bisa login tanpa batas waktu.
        // Sekarang: cari baris public.users utk employee ini, kalau
        // sudah punya akun auth, panggil Edge Function sync-auth
        // action "deactivate" (ban permanen) utk menutup aksesnya.
        //
        // Ini SENGAJA tidak menggagalkan proses resign kalau langkah
        // ini error -- data kepegawaian tetap harus tersimpan sebagai
        // resign walau akun login gagal dinonaktifkan (tidak ideal,
        // tapi lebih baik daripada resign batal total gara-gara
        // Edge Function down). Admin diberi tahu lewat alert terpisah.
        // ===================================================
        let authDeactivateWarning = "";
        try {
            const { data: userRow, error: userLookupErr } = await supabaseClient
                .from("users")
                .select("id, auth_uid")
                .eq("employee_id", empId)
                .maybeSingle();

            if (!userLookupErr && userRow?.auth_uid) {
                const { data: deactData, error: deactErr } = await supabaseClient.functions.invoke("sync-auth", {
                    body: { action: "deactivate", user_id: userRow.id }
                });
                if (deactErr || !deactData?.success) {
                    authDeactivateWarning = "\n\nPERINGATAN: akun login karyawan ini GAGAL dinonaktifkan otomatis -- nonaktifkan manual lewat halaman Users Account.";
                }
            }
        } catch {
            authDeactivateWarning = "\n\nPERINGATAN: akun login karyawan ini GAGAL dinonaktifkan otomatis -- nonaktifkan manual lewat halaman Users Account.";
        }

        bootstrap.Modal.getInstance(document.getElementById("modalResignKaryawan")).hide();
        alert("Karyawan berhasil di-set Resign / Non-Aktif." + authDeactivateWarning);
        await loadDirectoryData();

    } catch (err) {
        alert("Gagal memproses resign: " + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Proses Resign";
    }
}

// ============================================================================
// INJECT MODAL DYNAMIC TO BODY
// ============================================================================
function injectActionModals() {
    if (!document.getElementById("modalMutasiKaryawan")) {
        const mutasiModalHtml = `
        <div class="modal fade" id="modalMutasiKaryawan" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content border-0 shadow">
                    <form id="formMutasiKaryawan" onsubmit="handleSaveMutasi(event)">
                        <div class="modal-header border-bottom py-2 bg-warning bg-opacity-10">
                            <h6 class="modal-title fw-bold text-dark"><i class="fa-solid fa-right-left me-2 text-warning"></i>Form Mutasi Karyawan</h6>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <input type="hidden" id="mut_emp_id">
                            <input type="hidden" id="mut_prev_status">

                            <div class="mb-3">
                                <label class="form-label small fw-bold">Karyawan</label>
                                <input type="text" id="mut_emp_name" class="form-control form-control-sm bg-light" readonly>
                            </div>

                            <div class="row g-2 mb-2">
                                <div class="col-md-6">
                                    <label class="form-label small fw-bold">Status Karyawan Baru <span class="text-danger">*</span></label>
                                    <select id="mut_status_karyawan" class="form-select form-select-sm" onchange="onMutasiStatusOrBranchChange()" required>
                                        <option value="Tetap">Tetap</option>
                                        <option value="PKWT">PKWT</option>
                                        <option value="PKWTT">PKWTT</option>
                                        <option value="Borongan">Borongan</option>
                                        <option value="Reliver">Reliver</option>
                                    </select>
                                </div>
                                <div class="col-md-6" id="mut_nik_container" style="display: none;">
                                    <label class="form-label small fw-bold">NIK Karyawan</label>
                                    <div class="input-group input-group-sm">
                                        <input type="text" id="mut_nik_karyawan" class="form-control form-control-sm">
                                        <button type="button" class="btn btn-outline-secondary" onclick="generateNikMutasi()"><i class="fa-solid fa-wand-magic-sparkles me-1"></i>Generate</button>
                                    </div>
                                </div>
                            </div>

                            <div class="row g-2">
                                <div class="col-md-6 mb-2">
                                    <label class="form-label small fw-bold">Cabang Baru <span class="text-danger">*</span></label>
                                    <select id="mut_branch" class="form-select form-select-sm" onchange="onMutasiStatusOrBranchChange()" required></select>
                                </div>
                                <div class="col-md-6 mb-2">
                                    <label class="form-label small fw-bold">Cost Center Baru <span class="text-danger">*</span></label>
                                    <select id="mut_cc" class="form-select form-select-sm" required></select>
                                </div>
                                <div class="col-md-6 mb-2">
                                    <label class="form-label small fw-bold">Departemen Baru <span class="text-danger">*</span></label>
                                    <select id="mut_dept" class="form-select form-select-sm" onchange="onMutasiStatusOrBranchChange()" required></select>
                                </div>
                                <div class="col-md-6 mb-2">
                                    <label class="form-label small fw-bold">Area Baru <span class="text-danger">*</span></label>
                                    <select id="mut_area" class="form-select form-select-sm" required></select>
                                </div>
                                <div class="col-md-6 mb-2" id="mut_bagian_container" style="display: none;">
                                    <label class="form-label small fw-bold">Bagian Baru</label>
                                    <select id="mut_bagian" class="form-select form-select-sm"></select>
                                </div>
                                <div class="col-md-6 mb-2">
                                    <label class="form-label small fw-bold">Jabatan Baru <span class="text-danger">*</span></label>
                                    <select id="mut_jabatan" class="form-select form-select-sm" required></select>
                                </div>
                                <div class="col-md-6 mb-2" id="mut_stg_container" style="display: none;">
                                    <label class="form-label small fw-bold">No Absen STG</label>
                                    <input type="text" id="mut_no_absen_stg" class="form-control form-control-sm" placeholder="Masukkan No Absen STG">
                                </div>
                                <div class="col-md-6 mb-2">
                                    <label class="form-label small fw-bold">Tanggal Efektif Mutasi <span class="text-danger">*</span></label>
                                    <input type="date" id="mut_start_date" class="form-control form-control-sm" required>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer border-top py-2">
                            <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">Batal</button>
                            <button type="submit" id="btnSaveMutasi" class="btn btn-warning btn-sm fw-semibold">Simpan Mutasi</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML("beforeend", mutasiModalHtml);
    }

    if (!document.getElementById("modalResignKaryawan")) {
        const resignModalHtml = `
        <div class="modal fade" id="modalResignKaryawan" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content border-0 shadow">
                    <form id="formResignKaryawan" onsubmit="handleSaveResign(event)">
                        <div class="modal-header border-bottom py-2 bg-danger bg-opacity-10">
                            <h6 class="modal-title fw-bold text-danger"><i class="fa-solid fa-user-slash me-2"></i>Form Resign / Pemberhentian Karyawan</h6>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <input type="hidden" id="res_emp_id">
                            
                            <div class="row g-2 mb-3 bg-light p-2 rounded border">
                                <div class="col-md-6">
                                    <label class="form-label small text-muted mb-0">NIK Karyawan</label>
                                    <input type="text" id="res_nik" class="form-control form-control-sm bg-white" readonly>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label small text-muted mb-0">Nama Karyawan</label>
                                    <input type="text" id="res_nama" class="form-control form-control-sm bg-white" readonly>
                                </div>
                                <div class="col-md-3 mt-2">
                                    <label class="form-label small text-muted mb-0">Cabang</label>
                                    <input type="text" id="res_branch" class="form-control form-control-sm bg-white" readonly>
                                </div>
                                <div class="col-md-3 mt-2">
                                    <label class="form-label small text-muted mb-0">Cost Center</label>
                                    <input type="text" id="res_cc" class="form-control form-control-sm bg-white" readonly>
                                </div>
                                <div class="col-md-3 mt-2">
                                    <label class="form-label small text-muted mb-0">Departemen</label>
                                    <input type="text" id="res_dept" class="form-control form-control-sm bg-white" readonly>
                                </div>
                                <div class="col-md-3 mt-2">
                                    <label class="form-label small text-muted mb-0">Jabatan</label>
                                    <input type="text" id="res_jabatan" class="form-control form-control-sm bg-white" readonly>
                                </div>
                            </div>

                            <div class="mb-2">
                                <label class="form-label small fw-bold">Tanggal Terakhir Bekerja (End Date) <span class="text-danger">*</span></label>
                                <input type="date" id="res_end_date" class="form-control form-control-sm" required>
                            </div>
                            <div class="mb-2">
                                <label class="form-label small fw-bold">Alasan Keluar (End Reason) <span class="text-danger">*</span></label>
                                <textarea id="res_end_reason" class="form-control form-control-sm" rows="3" placeholder="Masukkan alasan resign / pemutusan hubungan kerja..." required></textarea>
                            </div>
                            <div class="mb-2">
                                <label class="form-label small fw-bold d-block">Blacklist</label>
                                <div class="form-check form-check-inline">
                                    <input class="form-check-input" type="radio" name="res_blacklist" id="res_blacklist_yes" value="yes" onchange="toggleBlacklistReason()">
                                    <label class="form-check-label small" for="res_blacklist_yes">Yes</label>
                                </div>
                                <div class="form-check form-check-inline">
                                    <input class="form-check-input" type="radio" name="res_blacklist" id="res_blacklist_no" value="no" checked onchange="toggleBlacklistReason()">
                                    <label class="form-check-label small" for="res_blacklist_no">No</label>
                                </div>
                            </div>
                            <div class="mb-2 d-none" id="containerBlacklistReason">
                                <label class="form-label small fw-bold">Alasan Blacklist <span class="text-danger">*</span></label>
                                <textarea id="res_blacklist_reason" class="form-control form-control-sm" rows="2" placeholder="Masukkan alasan blacklist..."></textarea>
                            </div>
                        </div>
                        <div class="modal-footer border-top py-2">
                            <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">Batal</button>
                            <button type="submit" id="btnSaveResign" class="btn btn-danger btn-sm fw-semibold">Proses Resign</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML("beforeend", resignModalHtml);
    }
}

// ============================================================================
// 10. EXPORT DATA DIREKTORI KARYAWAN KE EXCEL
// ============================================================================
// ============================================================================
// FORMAT TANGGAL EXPORT: dd/mm/yyyy
// Kolom tanggal diubah dari teks "2026-10-19" menjadi sel tanggal Excel dengan
// format tampilan dd/mm/yyyy (tetap bisa diurutkan/difilter sebagai tanggal,
// dan tampilannya tidak tergantung pengaturan regional komputer).
// ============================================================================
const EXPORT_DATE_HEADERS = ["Tanggal Lahir", "Tanggal Masuk", "Tanggal Keluar", "Tanggal Awal Mutasi", "Tanggal Akhir Mutasi"];

function formatDateColumns(ws, dateHeaders) {
    if (!ws || !ws["!ref"]) return;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cols = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
        const head = ws[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
        const isDateCol = !!head && dateHeaders.includes(String(head.v));
        cols[C] = { wpx: isDateCol ? 90 : 64 };   // lebar cukup agar tanggal tidak tampil "#####"
        if (!isDateCol) continue;
        for (let R = range.s.r + 1; R <= range.e.r; R++) {
            const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
            if (!cell || typeof cell.v !== "string") continue;
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(cell.v);
            if (!m) continue;                       // "-" atau kosong dibiarkan
            cell.t = "n";
            cell.v = Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569;  // nomor seri tanggal Excel
            cell.z = "dd/mm/yyyy";
            delete cell.w;
        }
    }
    ws["!cols"] = cols;
}

function exportDirectoryToExcel() {
    if (typeof XLSX === "undefined") {
        alert("Library SheetJS (XLSX) belum dimuat pada halaman!");
        return;
    }

    // PERBAIKAN: sebelumnya pakai "directoryEmployees" (SEMUA data,
    // mengabaikan filter yang sedang aktif). Sekarang pakai
    // "directorySortedFiltered" -- array yang sama yang dipakai untuk
    // render tabel, jadi PASTI konsisten dengan hasil filter/pencarian
    // yang sedang ditampilkan user, dan ikut terurut sama (Status
    // Karyawan > Branch > Cost Center > Jabatan).
    if (directorySortedFiltered.length === 0) {
        alert("Tidak ada data karyawan (sesuai filter saat ini) untuk di-export.");
        return;
    }

    const exportRows = directorySortedFiltered.map(emp => {
        const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

        const deptObj = masterCache.departments.find(d => d.id == assign?.departemen_id);
        const branchObj = masterCache.branches.find(b => b.id == assign?.branch_id);
        const ccObj = masterCache.cost_centers.find(c => c.id == assign?.costcenter_id);
        const areaObj = masterCache.areas.find(a => a.id == assign?.area_id);
        const bagObj = masterCache.bagians.find(bg => bg.id == assign?.bagian_id);
        const jabObj = masterCache.jabatans.find(j => j.id == assign?.jabatan_id);

        return {
            "NIK": emp.nik_karyawan || "-",
            "NIK KTP": emp.nik_ktp || "-",
            "Nama": emp.nama || "-",
            "Tempat Lahir": emp.tempat_lahir || "-",
            "Tanggal Lahir": emp.tanggal_lahir || "-",
            "Jenis Kelamin": emp.jenis_kelamin || "-",
            "Pendidikan": emp.pendidikan || "-",
            "Agama": emp.agama || "-",
            "Status Pernikahan": emp.status_pernikahan || "-",
            "Jumlah Anak": emp.anak ?? 0,
            "Ibu Kandung": emp.ibu_kandung || "-",
            "No Telp": emp.no_telp || "-",
            "Alamat KTP": emp.alamat_ktp || "-",
            "Alamat Domisili": emp.alamat_domisili || "-",
            "NPWP": emp.npwp || "-",
            "PTKP": emp.ptkp || "-",
            "Nama Bank": emp.bank || "-",
            "No Rekening": emp.no_rekening || "-",
            "BPJS Ketenagakerjaan": emp.bpjs_ketenagakerjaan || "-",
            "BPJS Kesehatan": emp.bpjs_kesehatan || "-",
            "Status Karyawan": assign?.status_karyawan || "-",
            "Tanggal Masuk": getTanggalMasuk(emp) || "-",
            "Tanggal Keluar": getTanggalKeluar(emp) || "",      // kosong kalau NULL, sesuai permintaan
            "Cabang": branchObj?.branch_name || "-",
            "Departemen": deptObj?.department_name || "-",
            "Cost Center": ccObj?.costcenter_name || "-",
            "Area": areaObj?.area_name || "-",
            "Bagian": bagObj?.bagian_name || "",            // kosong kalau NULL, sesuai permintaan
            "Jabatan": jabObj?.jabatan_name || "-"          // kosong kalau NULL, sesuai permintaan
        };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    formatDateColumns(ws, EXPORT_DATE_HEADERS);
    XLSX.utils.book_append_sheet(wb, ws, "Data Karyawan");

    // Sheet ke-2: Data Mutasi
    const mutRows = buildMutationExportRows(directorySortedFiltered);
    const wsMut = XLSX.utils.json_to_sheet(mutRows, { header: MUTATION_HEADERS });
    formatDateColumns(wsMut, EXPORT_DATE_HEADERS);
    XLSX.utils.book_append_sheet(wb, wsMut, "Data Mutasi");

    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Export_Direktori_Karyawan_${todayStr}.xlsx`);
}

// ============================================================================
// DATA MUTASI UNTUK SHEET KE-2 EXPORT
// Aturan: action_type = MUTATION, status_karyawan PKWT/PKWTT,
// dan kalau karyawan pernah REHIRE -> hanya mutasi pada/setelah tanggal REHIRE terakhir.
// ============================================================================
const MUTATION_HEADERS = ["NIK Karyawan", "Nama", "Cabang", "Cost Center", "Departemen", "Area", "Jabatan", "Tanggal Awal Mutasi", "Tanggal Akhir Mutasi"];

function buildMutationExportRows(employees) {
    const rows = [];
    employees.forEach(emp => {
        const list = directoryAssignmentsByEmp.get(String(emp.id)) || [];

        const rehireDates = list
            .filter(a => String(a.action_type || "").toUpperCase() === "REHIRE" && a.start_date)
            .map(a => a.start_date).sort();
        const lastRehire = rehireDates.length ? rehireDates[rehireDates.length - 1] : null;

        // Status karyawan = yang sama dengan kolom "Status Karyawan" di sheet Data Karyawan
        // (diambil dari assignment aktif/terbaru), bukan dari status di baris mutasi.
        const cur = getEmployeeAssignment(emp.id, emp.nik_karyawan);
        const st = String(cur?.status_karyawan || "").toUpperCase().trim();
        if (st !== "PKWT" && st !== "PKWTT") return;

        list.forEach(a => {
            if (String(a.action_type || "").toUpperCase() !== "MUTATION") return;
            if (lastRehire && (a.start_date || "") < lastRehire) return;

            rows.push({
                "NIK Karyawan": emp.nik_karyawan || "-",
                "Nama": emp.nama || "-",
                "Cabang": masterCache.branches.find(b => b.id == a.branch_id)?.branch_name || "-",
                "Cost Center": masterCache.cost_centers.find(c => c.id == a.costcenter_id)?.costcenter_name || "-",
                "Departemen": masterCache.departments.find(d => d.id == a.departemen_id)?.department_name || "-",
                "Area": masterCache.areas.find(x => x.id == a.area_id)?.area_name || "-",
                "Jabatan": masterCache.jabatans.find(j => j.id == a.jabatan_id)?.jabatan_name || "-",
                "Tanggal Awal Mutasi": a.start_date || "",
                "Tanggal Akhir Mutasi": a.end_date || ""
            });
        });
    });
    rows.sort((x, y) => String(x["NIK Karyawan"]).localeCompare(String(y["NIK Karyawan"])) ||
                        String(x["Tanggal Awal Mutasi"]).localeCompare(String(y["Tanggal Awal Mutasi"])));
    return rows;
}

// ==============================================================================
// DROPDOWN DENGAN PENCARIAN (Searchable Select)
// Mengubah <select> biasa menjadi kolom ketik + tombol panah:
//  - ketik sebagian nama (mis. "rama") -> daftar menyaring opsi yang mengandung teks itu
//  - klik tombol panah / klik kolom -> seluruh daftar tampil tanpa perlu mengetik
// <select> aslinya tetap ada (disembunyikan secara visual) sehingga semua kode lama
// (isi opsi, ambil nilai, validasi "required", event change) tetap bekerja.
// ==============================================================================
(function () {
    const SVG_CARET = '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.6 5l6.4 6.4L14.4 5z"/></svg>';
    const selValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

    function injectStyle() {
        if (document.getElementById("ssStyle")) return;
        const st = document.createElement("style");
        st.id = "ssStyle";
        st.textContent = `
            .ss-wrap { position: relative; }
            .ss-hidden-select { position: absolute !important; left: 0; bottom: 0; width: 100%; height: 1px;
                                opacity: 0; pointer-events: none; border: 0 !important; padding: 0 !important; }
            .ss-list { position: fixed; z-index: 3000; max-height: 240px; overflow-y: auto; background: #fff;
                       border: 1px solid #ced4da; border-radius: .375rem; box-shadow: 0 .5rem 1rem rgba(0,0,0,.15); }
            .ss-item { padding: .4rem .75rem; cursor: pointer; font-size: .875rem; }
            .ss-item:hover, .ss-item.active { background: #e7f1ff; }
            .ss-item.selected { font-weight: 600; }
            .ss-empty { padding: .5rem .75rem; color: #6c757d; font-size: .85rem; }`;
        document.head.appendChild(st);
    }

    function esc(v) {
        return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    window.enhanceSearchableSelect = function (selectId) {
        const sel = document.getElementById(selectId);
        if (!sel || sel.dataset.ss === "1") return;   // sudah pernah dipasang
        sel.dataset.ss = "1";
        injectStyle();

        const wrap = document.createElement("div");
        wrap.className = "ss-wrap";
        wrap.innerHTML = `<div class="input-group ${sel.classList.contains("form-select-sm") ? "input-group-sm" : ""}">
            <input type="text" class="form-control" autocomplete="off" spellcheck="false">
            <button type="button" class="btn btn-outline-secondary" tabindex="-1" aria-label="Buka daftar">${SVG_CARET}</button>
        </div>`;
        sel.parentNode.insertBefore(wrap, sel);
        wrap.appendChild(sel);
        sel.classList.add("ss-hidden-select");
        sel.tabIndex = -1;

        const input = wrap.querySelector("input");
        const btn = wrap.querySelector("button");
        let list = null, items = [], activeIdx = -1;

        const selectedText = () => {
            const o = sel.options[sel.selectedIndex];
            return o && o.value !== "" ? o.text : "";
        };
        const placeholderText = () => (sel.options.length && sel.options[0].value === "") ? sel.options[0].text : "";

        // Samakan tampilan kolom ketik dengan <select> (nilai, placeholder, status disabled)
        function sync() {
            input.value = selectedText();
            input.placeholder = placeholderText();
            input.disabled = sel.disabled;
            btn.disabled = sel.disabled;
        }

        function setValue(v) {
            selValueDesc.set.call(sel, v);
            sync();
            sel.dispatchEvent(new Event("change", { bubbles: true }));  // supaya filter bertingkat tetap jalan
        }

        // Kode lama mengisi nilai lewat "select.value = ..." -> ikut disinkronkan ke tampilan
        Object.defineProperty(sel, "value", {
            configurable: true,
            get() { return selValueDesc.get.call(this); },
            set(v) { selValueDesc.set.call(this, v); sync(); }
        });
        new MutationObserver(sync).observe(sel, { childList: true, attributes: true, attributeFilter: ["disabled"] });
        sel.addEventListener("change", sync);

        function place() {
            if (!list) return;
            const r = wrap.getBoundingClientRect();
            list.style.left = r.left + "px";
            list.style.width = r.width + "px";
            const spaceBelow = window.innerHeight - r.bottom;
            if (spaceBelow < Math.min(240, list.scrollHeight) + 8 && r.top > spaceBelow) {
                list.style.top = "auto";
                list.style.bottom = (window.innerHeight - r.top) + "px";
            } else {
                list.style.bottom = "auto";
                list.style.top = r.bottom + "px";
            }
        }

        function render(filterText) {
            const q = (filterText || "").trim().toLowerCase();
            items = Array.from(sel.options).filter(o => o.value !== "" && (!q || o.text.toLowerCase().includes(q)));
            list.innerHTML = items.length
                ? items.map((o, i) => `<div class="ss-item${o.value === sel.value ? " selected" : ""}" data-i="${i}">${esc(o.text)}</div>`).join("")
                : '<div class="ss-empty">Tidak ada hasil</div>';
            activeIdx = q ? (items.length ? 0 : -1) : items.findIndex(o => o.value === sel.value);
            highlight();
            place();
        }

        function highlight() {
            if (!list) return;
            list.querySelectorAll(".ss-item").forEach((el, i) => el.classList.toggle("active", i === activeIdx));
            const a = list.querySelector(".ss-item.active");
            if (a) a.scrollIntoView({ block: "nearest" });
        }

        function openList(filterText) {
            if (sel.disabled) return;
            if (!list) {
                list = document.createElement("div");
                list.className = "ss-list";
                list.addEventListener("mousedown", e => {
                    e.preventDefault();                       // jangan sampai kolom ketik kehilangan fokus
                    const it = e.target.closest(".ss-item");
                    if (it) choose(parseInt(it.dataset.i, 10));
                });
                document.body.appendChild(list);
            }
            render(filterText);
        }

        function closeList() {
            if (list) { list.remove(); list = null; }
            activeIdx = -1;
        }

        function choose(i) {
            const o = items[i];
            if (!o) return;
            if (sel.value !== o.value) setValue(o.value); else sync();
            closeList();
        }

        // Saat kolom ditinggalkan: teks kosong = kosongkan pilihan; teks cocok persis = pilih; selain itu kembalikan
        function commit() {
            closeList();
            const t = input.value.trim().toLowerCase();
            if (t === "") {
                if (sel.value !== "") setValue(""); else sync();
                return;
            }
            const exact = Array.from(sel.options).find(o => o.value !== "" && o.text.toLowerCase() === t);
            if (exact && sel.value !== exact.value) setValue(exact.value); else sync();
        }

        input.addEventListener("focus", () => { if (!list) { openList(""); input.select(); } });
        input.addEventListener("click", () => { if (!list) openList(""); });
        input.addEventListener("input", () => { if (!list) openList(input.value); else render(input.value); });
        input.addEventListener("blur", () => setTimeout(commit, 0));
        input.addEventListener("keydown", e => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!list) openList(""); else { activeIdx = Math.min(activeIdx + 1, items.length - 1); highlight(); }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (list) { activeIdx = Math.max(activeIdx - 1, 0); highlight(); }
            } else if (e.key === "Enter") {
                if (list) { e.preventDefault(); if (activeIdx >= 0) choose(activeIdx); else commit(); }
            } else if (e.key === "Escape") {
                if (list) { e.preventDefault(); e.stopPropagation(); closeList(); sync(); }
            }
        });

        btn.addEventListener("mousedown", e => e.preventDefault());
        btn.addEventListener("click", () => {
            if (list) { closeList(); sync(); } else { input.focus(); if (!list) openList(""); }
        });

        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);

        sync();
    };

})();