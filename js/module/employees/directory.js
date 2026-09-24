/**
 * ============================================================================
 * WEB ERP PT DUTA MAKMUR BERSAMA
 * Module: Employee Directory
 * File: directory.js
 * Deskripsi: Logika Utama Tabel Direktori, RBAC, Filter, Statistika, 
 * Modal Mutasi (Auto NIK), Modal Resign & Navigasi Rehire.
 * ============================================================================
 */

let directoryEmployees = [];
let directoryAssignments = [];
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
function getEmployeeAssignment(empId, empNik) {
    if (!directoryAssignments || directoryAssignments.length === 0) return null;
    
    // Prioritaskan penempatan yang sedang aktif (is_active = true)
    let found = directoryAssignments.find(a => 
        (String(a.employee_id) === String(empId) || (empNik && String(a.employee_id) === String(empNik))) && 
        a.is_active !== false
    );

    // Jika tidak ada assignment aktif (misal karyawan resign/non-aktif), ambil record penempatan terakhir
    if (!found) {
        found = directoryAssignments.find(a => 
            String(a.employee_id) === String(empId) || (empNik && String(a.employee_id) === String(empNik))
        );
    }

    return found;
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
            else if (col.key === "status_karyawan" || col.key === "status_data") { alignClass = "text-center"; }
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

function populateFilterDropdowns() {
    fillSelectOptions("filterBranch", masterCache.branches, "id", "branch_name", "-- Semua Cabang --");
    fillSelectOptions("filterCostCenter", masterCache.cost_centers, "id", "costcenter_name", "-- Semua Cost Center --");
    fillSelectOptions("filterDept", masterCache.departments, "id", "department_name", "-- Semua Departemen --");
    fillSelectOptions("filterArea", masterCache.areas, "id", "area_name", "-- Semua Area --");
    fillSelectOptions("filterJabatan", masterCache.jabatans, "id", "jabatan_name", "-- Semua Jabatan --");
    fillSelectOptions("filterBagian", masterCache.bagians, "id", "bagian_name", "-- Semua Bagian --");
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
        // Fetch data karyawan dari schema hrd.employees
        const { data: emps, error: errEmp } = await supabaseClient
            .schema('hrd')
            .from('employees')
            .select('*')
            .order('id', { ascending: true });
        
        if (errEmp) throw errEmp;

        // Fetch penempatan dari schema hrd.employee_assignments
        // Diurutkan secara DESCENDING berdasarkan ID agar record rehire/penempatan terbaru berada di paling atas
        const { data: assigns, error: errAssign } = await supabaseClient
            .schema('hrd')
            .from('employee_assignments')
            .select('*')
            .order('id', { ascending: false });
        
        if (errAssign) throw errAssign;

        directoryEmployees = emps || [];
        directoryAssignments = assigns || [];

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
function renderDirectoryTable() {
    renderTableHeader();

    const tbody = document.getElementById("tableBody");
    const recordInfo = document.getElementById("recordInfo");
    if (!tbody) return;

    const searchTerm = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
    const branchVal = document.getElementById("filterBranch")?.value;
    const ccVal = document.getElementById("filterCostCenter")?.value;
    const deptVal = document.getElementById("filterDept")?.value;
    const areaVal = document.getElementById("filterArea")?.value;
    const jabVal = document.getElementById("filterJabatan")?.value;
    const bagVal = document.getElementById("filterBagian")?.value;
    const statusVal = document.getElementById("filterStatusSelect")?.value || "active";

    const responsiveDiv = document.querySelector(".table-responsive");
    if (responsiveDiv) responsiveDiv.style.minHeight = "480px";

    // Filtering Data Utama
    const filtered = directoryEmployees.filter(emp => {
        const isActive = emp.is_active !== false;
        
        if (statusVal === "active" && !isActive) return false;
        if (statusVal === "inactive" && isActive) return false;

        if (searchTerm) {
            const nik = (emp.nik_karyawan || "").toLowerCase();
            const nama = (emp.nama || "").toLowerCase();
            if (!nik.includes(searchTerm) && !nama.includes(searchTerm)) return false;
        }

        const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

        if (branchVal && assign?.branch_id != branchVal) return false;
        if (ccVal && assign?.costcenter_id != ccVal) return false;
        if (deptVal && assign?.departemen_id != deptVal) return false;
        if (areaVal && assign?.area_id != areaVal) return false;
        if (jabVal && assign?.jabatan_id != jabVal) return false;
        if (bagVal && assign?.bagian_id != bagVal) return false;

        return true;
    });

    // Update Kartu Statistika Berdasarkan Data Terfilter
    updateStatisticsCardsFiltered(filtered);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="100%" class="text-center py-5 text-muted">Tidak ada data karyawan yang sesuai dengan kriteria filter.</td></tr>`;
        if (recordInfo) recordInfo.textContent = "Menampilkan 0 data";
        return;
    }

    let html = "";
    filtered.forEach((emp, index) => {
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
                else if (col.key === "status_data") html += `<td class="text-center">${statusBadge}</td>`;
                else if (col.key === "aksi") html += `<td class="text-center">${actionDropdown}</td>`;
            }
        });

        html += `</tr>`;
    });

    tbody.innerHTML = html;
    if (recordInfo) recordInfo.textContent = `Menampilkan ${filtered.length} dari ${directoryEmployees.length} total data`;
}

// PERHITUNGAN KARTU DASHBOARD STATISTIK DENGAN FILTER
function updateStatisticsCardsFiltered(filteredList) {
    const cardTotal = document.getElementById("cardTotalEmp");
    const cardNew = document.getElementById("cardNewThisMonth");
    const cardResign = document.getElementById("cardResignThisMonth");

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    let totalActive = 0;
    let countNewThisMonth = 0;
    let countResignThisMonth = 0;

    filteredList.forEach(emp => {
        if (emp.is_active !== false) totalActive++;

        const empAssigns = directoryAssignments.filter(a => String(a.employee_id) === String(emp.id) || String(a.employee_id) === String(emp.nik_karyawan));
        
        empAssigns.forEach(a => {
            if (a.start_date) {
                const sDate = new Date(a.start_date);
                if (sDate.getFullYear() === curYear && sDate.getMonth() === curMonth) {
                    countNewThisMonth++;
                }
            }
            if (a.end_date) {
                const eDate = new Date(a.end_date);
                if (eDate.getFullYear() === curYear && eDate.getMonth() === curMonth) {
                    countResignThisMonth++;
                }
            }
        });
    });

    if (cardTotal) cardTotal.textContent = totalActive;
    if (cardNew) cardNew.textContent = countNewThisMonth;
    if (cardResign) cardResign.textContent = countResignThisMonth;
}

// ============================================================================
// 5. EVENT LISTENERS SETUP & NAVIGASI
// ============================================================================
function setupEventListeners() {
    // --- FILTER DROPDOWNS ---
    const filterContainer = document.querySelector(".filter-dropdown-menu .row");
    if (filterContainer && !document.getElementById("filterStatusSelect")) {
        const statusHtml = `
            <div class="col-12 mb-2" id="statusFilterContainer">
                <label class="form-label mb-1 style-sub-label fw-bold">Status Karyawan</label>
                <select id="filterStatusSelect" class="form-select form-select-sm" onchange="renderDirectoryTable()">
                    <option value="active" selected>Aktif</option>
                    <option value="inactive">Non - Aktif</option>
                    <option value="all">Semua</option>
                </select>
            </div>`;
        filterContainer.insertAdjacentHTML("afterbegin", statusHtml);
    }

    const btnReset = document.getElementById("btnResetFilter");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            document.querySelectorAll(".filter-dropdown-menu select").forEach(s => s.value = "");
            const statusSel = document.getElementById("filterStatusSelect");
            if (statusSel) statusSel.value = "active";
            renderDirectoryTable();
        });
    }

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
// 8. LOGIKA DAN FORM MODAL MUTASI (DENGAN AUTO GENERATE NIK)
// ============================================================================
function openMutasiModal(empId) {
    const emp = directoryEmployees.find(e => String(e.id) === String(empId));
    if (!emp) return;

    const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

    document.getElementById("mut_emp_id").value = emp.id;
    document.getElementById("mut_emp_name").value = `${emp.nama} (${emp.nik_karyawan})`;
    document.getElementById("mut_prev_status").value = assign?.status_karyawan || "";

    fillSelectOptions("mut_branch", masterCache.branches, "id", "branch_name", "-- Pilih Cabang --");
    fillSelectOptions("mut_cc", masterCache.cost_centers, "id", "costcenter_name", "-- Pilih Cost Center --");
    fillSelectOptions("mut_dept", masterCache.departments, "id", "department_name", "-- Pilih Departemen --");
    fillSelectOptions("mut_area", masterCache.areas, "id", "area_name", "-- Pilih Area --");
    fillSelectOptions("mut_bagian", masterCache.bagians, "id", "bagian_name", "-- Pilih Bagian --");
    fillSelectOptions("mut_jabatan", masterCache.jabatans, "id", "jabatan_name", "-- Pilih Jabatan --");

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

    triggerAutoGenerateNik();
}

function triggerAutoGenerateNik() {
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
    const editedNik = document.getElementById("mut_nik_karyawan")?.value || null;

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

        bootstrap.Modal.getInstance(document.getElementById("modalResignKaryawan")).hide();
        alert("Karyawan berhasil di-set Resign / Non-Aktif.");
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
                                    <label class="form-label small fw-bold">NIK Karyawan Baru</label>
                                    <div class="input-group input-group-sm">
                                        <input type="text" id="mut_nik_karyawan" class="form-control form-control-sm">
                                        <button type="button" class="btn btn-outline-secondary" onclick="triggerAutoGenerateNik()"><i class="fa-solid fa-rotate me-1"></i>Auto</button>
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
                                    <input type="date" id="mut_start_date" class="form-control form-control-sm" onchange="triggerAutoGenerateNik()" required>
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
function exportDirectoryToExcel() {
    if (typeof XLSX === "undefined") {
        alert("Library SheetJS (XLSX) belum dimuat pada halaman!");
        return;
    }

    if (directoryEmployees.length === 0) {
        alert("Tidak ada data karyawan untuk di-export.");
        return;
    }

    const exportRows = directoryEmployees.map(emp => {
        const assign = getEmployeeAssignment(emp.id, emp.nik_karyawan);

        const deptObj = masterCache.departments.find(d => d.id == assign?.departemen_id);
        const jabObj = masterCache.jabatans.find(j => j.id == assign?.jabatan_id);
        const branchObj = masterCache.branches.find(b => b.id == assign?.branch_id);
        const ccObj = masterCache.cost_centers.find(c => c.id == assign?.costcenter_id);

        return {
            "NIK": emp.nik_karyawan || "-",
            "Nama": emp.nama || "-",
            "Departemen": deptObj?.department_name || "-",
            "Jabatan": jabObj?.jabatan_name || "-",
            "Cabang": branchObj?.branch_name || "-",
            "Cost Center": ccObj?.costcenter_name || "-",
            "Status Karyawan": assign?.status_karyawan || "-",
            "Status Data": emp.is_active !== false ? "Aktif" : "Non-Aktif"
        };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Data Karyawan");

    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Export_Direktori_Karyawan_${todayStr}.xlsx`);
}