// ===================================================
// js/module/settings/users.js
// Halaman pengaturan Users Account
// Pola non-module (window.supabaseClient), konsisten
// dengan auth.js. Server-side pagination via .range()
// ke public.users_directory_view.
// ===================================================

const supabaseClient = window.supabaseClient;

// ===================================================
// 1. STATE GLOBAL
// ===================================================
let pendingChanges = new Map(); // key: user_id, value: role_id baru
let pendingAuthActions = new Map(); // key: user_id, value: "create" | "resync"

let referenceData = {
    roles: [],
    branches: [],
    costCenters: [],
    departments: [],
    jabatans: [],
    areas: [],
    bagians: [],
    structures: []   // cost_center_structures: cost_center_id, area_id, dept_id, jabatan_id (acuan filter berantai)
};

let activeFilters = {
    branch_id: [],
    costcenter_id: [],
    departemen_id: [],
    jabatan_id: [],
    area_id: [],
    bagian_id: [],
    role_id: []
};

let searchKeyword = "";
let currentPage = 1;
let totalRows = 0;
const ROWS_PER_PAGE = 50;

// Menyimpan data baris yang SEDANG ditampilkan di halaman aktif saja
// (bukan semua data -- karena sekarang server-side pagination)
let currentPageData = [];

// Karyawan AKTIF yang akun login-nya masih di-BAN (mis. sisa dari proses resign sebelum rehire).
// key: user_id (public.users.id), value: username. Diisi oleh refreshBannedBanner().
let bannedActiveMap = new Map();
let showOnlyBanned = false;   // true = tabel hanya menampilkan baris di atas

// ===================================================
// 2. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupBackButton();
    setupSearchInput();
    setupFilterToggle();
    setupFilterCascade();
    setupSaveButton();
    setupCreateAuthButton();

    await loadReferenceData();
    renderFilterPanel();

    setupBannedBanner();
    await refreshBannedBanner();

    await loadUsersPage();
});

// ===================================================
// 3. TOMBOL KEMBALI
// ===================================================
function setupBackButton() {
    const btnBack = document.getElementById("btnBack");
    btnBack.addEventListener("click", () => {
        if (pendingChanges.size > 0) {
            const konfirmasi = confirm("Ada perubahan yang belum disimpan. Yakin ingin kembali?");
            if (!konfirmasi) return;
        }
        window.location.href = "../../index.html";
    });
}

// ===================================================
// PEMBATASAN ROLE YANG BISA DI-ASSIGN
// Berdasarkan role user yang sedang login (dari erp_session).
// ===================================================
const ROLE_ASSIGN_RESTRICTION = {
    "maintenance": [],                       // Maintenance boleh assign role apa saja
    "superadmin": ["maintenance"],           // Superadmin tidak boleh assign Maintenance
    "admin": ["maintenance", "superadmin"]   // Admin tidak boleh assign Maintenance & Superadmin
};

// Hierarki tingkat/rank role, dipakai untuk menentukan apakah
// dropdown suatu baris HARUS readonly total (bukan cuma exclude opsi).
// Semakin besar angka, semakin tinggi levelnya.
const ROLE_RANK = {
    "maintenance": 3,
    "superadmin": 2,
    "admin": 1
};
// Role yang tidak terdaftar (Employee, Supervisor, dst) dianggap rank 0 (paling rendah)

function getCurrentUserRoleName() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try {
        const session = JSON.parse(raw);
        return (session.roleName || "").toLowerCase();
    } catch {
        return null;
    }
}

// Mengembalikan daftar role_name (lowercase) yang TIDAK BOLEH dipilih
// oleh user yang sedang login. Role yang tidak terdaftar di
// ROLE_ASSIGN_RESTRICTION dianggap paling terbatas (default aman),
// supaya tidak ada celah kalau ada role lain yang entah bagaimana
// bisa membuka halaman ini.
function getExcludedRoles() {
    const currentRole = getCurrentUserRoleName();
    if (currentRole && ROLE_ASSIGN_RESTRICTION.hasOwnProperty(currentRole)) {
        return ROLE_ASSIGN_RESTRICTION[currentRole];
    }
    return ["maintenance", "superadmin"]; // default paling ketat
}

function getCurrentUserRank() {
    const role = getCurrentUserRoleName();
    return ROLE_RANK[role] ?? 0;
}

// TRUE kalau baris user ini rolenya LEBIH TINGGI dari rank user yang
// sedang login -> dropdown baris ini harus readonly TOTAL, tidak bisa
// diubah ke apapun (bukan cuma dibatasi opsinya).
function isRowReadonly(rowRoleName) {
    const rowRank = ROLE_RANK[(rowRoleName || "").toLowerCase()] ?? 0;
    return rowRank > getCurrentUserRank();
}

// ===================================================
// 4. DATA REFERENSI (untuk isi filter & dropdown role)
// ===================================================
async function loadReferenceData() {
    const [rolesRes, branchesRes, ccRes, deptRes, jabatanRes, areaRes, bagianRes] = await Promise.all([
        supabaseClient.from("roles").select("id, role_name").order("id"),
        supabaseClient.from("branches").select("id, branch_name").eq("is_active", true).order("branch_name"),
        supabaseClient.from("cost_centers").select("id, costcenter_name, branch_id").eq("is_active", true).order("costcenter_name"),
        supabaseClient.from("departments").select("id, department_name").eq("is_active", true).order("department_name"),
        supabaseClient.from("jabatans").select("id, jabatan_name").eq("is_active", true).order("jabatan_name"),
        supabaseClient.from("areas").select("id, area_name").eq("is_active", true).order("area_name"),
        supabaseClient.from("bagians").select("id, bagian_name").eq("is_active", true).order("bagian_name")
    ]);

    referenceData.roles = rolesRes.data || [];
    referenceData.branches = branchesRes.data || [];
    referenceData.costCenters = ccRes.data || [];
    referenceData.departments = deptRes.data || [];
    referenceData.jabatans = jabatanRes.data || [];
    referenceData.areas = areaRes.data || [];
    referenceData.bagians = bagianRes.data || [];
    referenceData.structures = await fetchAllStructures();
}

// Ambil SEMUA baris struktur cost center (Supabase membatasi 1 request = 1000 baris)
async function fetchAllStructures() {
    const all = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabaseClient.from("cost_center_structures")
            .select("cost_center_id, area_id, dept_id, jabatan_id")
            .order("id", { ascending: true }).range(from, from + 999);
        if (error) { console.error("Gagal mengambil cost_center_structures:", error); break; }
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
    }
    return all;
}

// ===================================================
// 5. AMBIL DATA HALAMAN AKTIF (SERVER-SIDE PAGINATION)
//    Query ke users_directory_view, dengan search + filter
//    diterapkan di level query (bukan di JS), lalu dipotong
//    per halaman pakai .range()
// ===================================================
// ---------------------------------------------------
// 5A. ATURAN URUTAN (tanpa baris sub-judul; hanya mengurutkan)
// Urutan: (1) Perlu Penanganan -> Akun Normal
//         (2) Role (Employee paling bawah)
//         (3) Branch  (4) Cost Center
// ---------------------------------------------------

// role_id Employee -- selalu diletakkan paling bawah. Ubah angka ini kalau id-nya berbeda.
const EMPLOYEE_ROLE_ID = 5;

// Cache urutan lengkap (data ringan) supaya pindah halaman tidak query ulang semuanya.
// null = belum dimuat / perlu dimuat ulang.
let sortedUserRows = null;

// "Perlu Penanganan" = admin harus bertindak:
//   - must_change_password = 'open' (karyawan mengajukan reset, menunggu admin)
//   - belum punya akun login (auth_uid kosong)
//   - NIK berubah, perlu sinkron ulang (auth_sync_pending)
// 'progress' TIDAK dihitung: itu menunggu karyawan, bukan admin.
function getGroupInfo(r) {
    const handling = r.must_change_password === "open" || !r.auth_uid || r.auth_sync_pending === true;
    return { handling };
}

// Role: urut role_id naik, kecuali Employee yang dipaksa paling bawah
function roleOrder(roleId) {
    if (roleId === EMPLOYEE_ROLE_ID) return 2000000000;
    if (roleId === null || roleId === undefined) return 1000000000;
    return roleId;
}

function nullLast(v) {
    return v === null || v === undefined ? Number.MAX_SAFE_INTEGER : v;
}

function compareUserRows(a, b) {
    const pa = getGroupInfo(a).handling ? 0 : 1;
    const pb = getGroupInfo(b).handling ? 0 : 1;
    if (pa !== pb) return pa - pb;

    const ra = roleOrder(a.role_id), rb = roleOrder(b.role_id);
    if (ra !== rb) return ra - rb;

    const ba = nullLast(a.branch_id), bb = nullLast(b.branch_id);
    if (ba !== bb) return ba - bb;

    const ca = nullLast(a.costcenter_id), cb = nullLast(b.costcenter_id);
    if (ca !== cb) return ca - cb;

    const ja = nullLast(a.jabatan_id), jb = nullLast(b.jabatan_id);
    if (ja !== jb) return ja - jb;

    return String(a.username || "").localeCompare(String(b.username || ""), undefined, { numeric: true });
}

// ---------------------------------------------------
// 5B. QUERY: search + filter dipasang di server (sama seperti sebelumnya)
// ---------------------------------------------------
function applyUserFilters(query) {
    if (searchKeyword) {
        query = query.or(`username.ilike.%${searchKeyword}%,nama_karyawan.ilike.%${searchKeyword}%`);
    }
    if (activeFilters.branch_id.length > 0) query = query.in("branch_id", activeFilters.branch_id);
    if (activeFilters.costcenter_id.length > 0) query = query.in("costcenter_id", activeFilters.costcenter_id);
    if (activeFilters.departemen_id.length > 0) query = query.in("departemen_id", activeFilters.departemen_id);
    if (activeFilters.jabatan_id.length > 0) query = query.in("jabatan_id", activeFilters.jabatan_id);
    if (activeFilters.area_id.length > 0) query = query.in("area_id", activeFilters.area_id);
    if (activeFilters.bagian_id.length > 0) query = query.in("bagian_id", activeFilters.bagian_id);
    if (activeFilters.role_id.length > 0) query = query.in("role_id", activeFilters.role_id);
    return query;
}

// Ambil kolom RINGAN (hanya kunci pengurutan) untuk SEMUA baris yang lolos
// search/filter. Diambil bertahap karena Supabase membatasi jumlah baris per request.
async function fetchAllUserSortKeys() {
    let all = [];
    let from = 0;
    let total = null;

    while (true) {
        let query = supabaseClient
            .from("users_directory_view")
            .select("user_id, username, role_id, branch_id, costcenter_id, jabatan_id, auth_uid, auth_sync_pending, must_change_password", { count: "exact" });

        query = applyUserFilters(query)
            .order("user_id", { ascending: true })   // urutan tetap supaya antar-potongan tidak tumpang tindih
            .range(from, from + 999);

        const { data, error, count } = await query;
        if (error) throw error;

        if (total === null) total = count || 0;
        if (!data || data.length === 0) break;

        all = all.concat(data);
        from += data.length;
        if (all.length >= total) break;
    }
    return all;
}

// ---------------------------------------------------
// 5C. MUAT HALAMAN AKTIF
// Langkah: (a) ambil kunci ringan semua baris -> urutkan di JS,
//          (b) potong 50 baris untuk halaman aktif,
//          (c) ambil data LENGKAP hanya untuk 50 baris itu.
// opts.keepOrder = true  -> pakai urutan cache (dipakai saat pindah halaman)
// ---------------------------------------------------
async function loadUsersPage(opts = {}) {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="10"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        if (!opts.keepOrder || sortedUserRows === null) {
            const rows = await fetchAllUserSortKeys();
            rows.sort(compareUserRows);
            sortedUserRows = rows;
            totalRows = rows.length;
        }

        // Kalau data berkurang (mis. setelah simpan) dan halaman aktif sudah tidak ada
        const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;

        const start = (currentPage - 1) * ROWS_PER_PAGE;
        const pageIds = sortedUserRows.slice(start, start + ROWS_PER_PAGE).map(r => r.user_id);

        if (pageIds.length === 0) {
            currentPageData = [];
        } else {
            const { data, error } = await supabaseClient
                .from("users_directory_view")
                .select("*")
                .in("user_id", pageIds);
            if (error) throw error;

            // .in() tidak menjamin urutan -> susun ulang sesuai urutan hasil pengurutan
            const byId = new Map((data || []).map(u => [u.user_id, u]));
            currentPageData = pageIds.map(id => byId.get(id)).filter(Boolean);
        }

        renderTable();
        renderPagination();

    } catch (err) {
        console.error("Gagal memuat data users:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 6. SEARCH (debounce, reset ke halaman 1 tiap ketik)
// ===================================================
function setupSearchInput() {
    const input = document.getElementById("inputSearch");
    let debounceTimer;

    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchKeyword = input.value.trim();
            currentPage = 1;
            loadUsersPage();
        }, 350);
    });
}

// ===================================================
// 7. FILTER PANEL
// ===================================================
function setupFilterToggle() {
    const btnToggle = document.getElementById("btnFilterToggle");
    const panel = document.getElementById("filterPanel");

    btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("d-none");
    });

    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && e.target !== btnToggle) {
            panel.classList.add("d-none");
        }
    });

    document.querySelectorAll(".filter-group-header").forEach(header => {
        header.addEventListener("click", () => {
            const targetId = header.getAttribute("data-target");
            const body = document.getElementById(targetId);
            header.classList.toggle("expanded");
            body.classList.toggle("expanded");
        });
    });

    document.getElementById("btnFilterReset").addEventListener("click", () => {
        activeFilters = { branch_id: [], costcenter_id: [], departemen_id: [], jabatan_id: [], area_id: [], bagian_id: [], role_id: [] };
        renderFilterPanel();
        currentPage = 1;
        loadUsersPage();
        updateFilterBadge();
    });

    document.getElementById("btnFilterApply").addEventListener("click", () => {
        activeFilters.branch_id = getCheckedValues("filterBranch");
        activeFilters.costcenter_id = getCheckedValues("filterCostCenter");
        activeFilters.departemen_id = getCheckedValues("filterDepartemen");
        activeFilters.jabatan_id = getCheckedValues("filterJabatan");
        activeFilters.area_id = getCheckedValues("filterArea");
        activeFilters.bagian_id = getCheckedValues("filterBagian");
        activeFilters.role_id = getCheckedValues("filterRole");

        currentPage = 1;
        loadUsersPage();
        document.getElementById("filterPanel").classList.add("d-none");
        updateFilterBadge();
    });
}

function getCheckedValues(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return [];
    const checkboxes = el.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function updateFilterBadge() {
    const total = Object.values(activeFilters).reduce((sum, arr) => sum + arr.length, 0);
    const badge = document.getElementById("filterCountBadge");
    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

function renderFilterPanel() {
    renderFilterGroup("filterBranch", referenceData.branches, "id", "branch_name");
    renderFilterGroup("filterBagian", referenceData.bagians, "id", "bagian_name");
    renderFilterGroup("filterRole", referenceData.roles, "id", "role_name");

    // Kelompok berantai dikosongkan dulu supaya centang lama tidak ikut terbawa (mis. saat Reset)
    CASCADE_GROUPS.slice(1).forEach(g => { const el = document.getElementById(g.id); if (el) el.innerHTML = ""; });
    refreshFilterCascade(0);
}

// Alur filter berantai: Cabang -> Cost Center -> Area -> Departemen -> Jabatan.
// Tanpa centang di induk = daftar anak tidak dibatasi oleh induk itu. Beberapa induk dicentang = gabungan.
const CASCADE_GROUPS = [
    { id: "filterBranch" },
    { id: "filterCostCenter", list: () => referenceData.costCenters, idField: "id", nameField: "costcenter_name" },
    { id: "filterArea", list: () => referenceData.areas, idField: "id", nameField: "area_name" },
    { id: "filterDepartemen", list: () => referenceData.departments, idField: "id", nameField: "department_name" },
    { id: "filterJabatan", list: () => referenceData.jabatans, idField: "id", nameField: "jabatan_name" }
];

// changedLevel = indeks kelompok yang baru diubah user; hanya kelompok DI BAWAHNYA yang digambar ulang.
// Centang anak yang masih valid dipertahankan, yang tidak valid hilang.
function refreshFilterCascade(changedLevel) {
    const checked = id => getCheckedValues(id);
    const idsOf = (rows, f) => new Set(rows.map(r => String(r[f])));
    const prev = CASCADE_GROUPS.map(g => checked(g.id));   // dibaca SEBELUM ada yang digambar ulang
    const draw = (level, list) => {
        if (level <= changedLevel) return;
        const g = CASCADE_GROUPS[level];
        renderFilterGroup(g.id, list, g.idField, g.nameField, prev[level]);
    };
    const now = level => (level <= changedLevel ? prev[level] : (checked(CASCADE_GROUPS[level].id)));

    // 1. Cost Center <- Cabang (cost_centers.branch_id)
    const brSel = prev[0];
    const ccList = brSel.length ? referenceData.costCenters.filter(c => brSel.includes(String(c.branch_id))) : referenceData.costCenters;
    draw(1, ccList);
    const ccNow = now(1);
    const ccSet = ccNow.length ? ccNow : (brSel.length ? ccList.map(c => String(c.id)) : null);

    // 2. Area <- Cost Center (cost_center_structures; satu area tampil sekali)
    let rows = referenceData.structures;
    if (ccSet) rows = rows.filter(r => ccSet.includes(String(r.cost_center_id)));
    const areaIds = idsOf(rows, "area_id");
    draw(2, ccSet ? referenceData.areas.filter(a => areaIds.has(String(a.id))) : referenceData.areas);
    const areaNow = now(2);
    if (areaNow.length) rows = rows.filter(r => areaNow.includes(String(r.area_id)));

    // 3. Departemen <- Cost Center + Area
    const deptLimited = !!ccSet || areaNow.length > 0;
    const deptIds = idsOf(rows, "dept_id");
    draw(3, deptLimited ? referenceData.departments.filter(d => deptIds.has(String(d.id))) : referenceData.departments);
    const deptNow = now(3);
    if (deptNow.length) rows = rows.filter(r => deptNow.includes(String(r.dept_id)));

    // 4. Jabatan <- Cost Center + Area + Departemen
    const jabLimited = deptLimited || deptNow.length > 0;
    const jabIds = idsOf(rows, "jabatan_id");
    draw(4, jabLimited ? referenceData.jabatans.filter(j => jabIds.has(String(j.id))) : referenceData.jabatans);
}

// Setiap centang di Cabang/Cost Center/Area/Departemen memperbarui daftar di bawahnya
function setupFilterCascade() {
    CASCADE_GROUPS.slice(0, 4).forEach((g, level) => {
        document.getElementById(g.id)?.addEventListener("change", () => refreshFilterCascade(level));
    });
}

function renderFilterGroup(containerId, list, idField, nameField, checkedIds = []) {
    const container = document.getElementById(containerId);
    if (!container) return; // jaga-jaga kalau HTML belum ditambah grup Area/Bagian
    if (list.length === 0) {
        container.innerHTML = `<span class="data-empty-cell">Tidak ada data</span>`;
        return;
    }
    container.innerHTML = list.map(item => `
        <label class="filter-checkbox-item">
            <input type="checkbox" value="${item[idField]}" ${checkedIds.includes(String(item[idField])) ? "checked" : ""}>
            <span>${item[nameField]}</span>
        </label>
    `).join("");
}

// ===================================================
// 8. RENDER TABEL (data halaman aktif dari server)
// ===================================================
function renderTable() {
    const tbody = document.getElementById("usersTableBody");

    if (currentPageData.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (currentPage - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = currentPageData.map((u, index) => {
        const nomorUrut = start + index + 1;
        const isChanged = pendingChanges.has(u.user_id);
        const currentRoleId = isChanged ? pendingChanges.get(u.user_id) : u.role_id;

        return `
            <tr class="${isChanged ? 'row-changed' : ''}" data-user-id="${u.user_id}">
                <td class="col-no">${nomorUrut}</td>
                <td>${u.username}</td>
                <td>${u.nama_karyawan || '<span class="data-empty-cell">-</span>'}</td>
                <td>${u.branch_name || '<span class="data-empty-cell">-</span>'}</td>
                <td>${u.costcenter_name || '<span class="data-empty-cell">-</span>'}</td>
                <td>${u.department_name || '<span class="data-empty-cell">-</span>'}</td>
                <td>${u.jabatan_name || '<span class="data-empty-cell">-</span>'}</td>
                <td>
                    ${(() => {
    const readonly = isRowReadonly(u.role_name);

    if (readonly) {
        // Dropdown readonly total: tampilkan nilai saat ini saja,
        // tidak render <select> yang bisa diklik/diubah sama sekali.
        return `
            <select class="role-select role-select-readonly" data-user-id="${u.user_id}" disabled title="Anda tidak memiliki hak untuk mengubah role ini">
                <option selected>${u.role_name || '-'}</option>
            </select>
        `;
    }

    return `
        <select class="role-select" data-user-id="${u.user_id}">
            ${referenceData.roles.map(r => {
                const isExcluded = getExcludedRoles().includes(r.role_name.toLowerCase());
                const isCurrentValue = r.id === currentRoleId;
                if (isExcluded && !isCurrentValue) return "";
                return `
                    <option value="${r.id}" ${isCurrentValue ? 'selected' : ''} ${isExcluded ? 'disabled' : ''}>
                        ${r.role_name}${isExcluded ? ' (dibatasi)' : ''}
                    </option>
                `;
            }).join("")}
        </select>
    `;
})()}
                     </td>
<td class="col-akun">
    ${(() => {
        if (!u.auth_uid) {
            return `<input type="checkbox" class="auth-checkbox" data-user-id="${u.user_id}" data-mode="create" ${pendingAuthActions.has(u.user_id) ? 'checked' : ''} title="Buat akun login baru">`;
        }
        if (u.auth_sync_pending) {
            return `<input type="checkbox" class="auth-checkbox" data-user-id="${u.user_id}" data-mode="resync" ${pendingAuthActions.has(u.user_id) ? 'checked' : ''} title="Sinkron ulang (NIK berubah)${bannedActiveMap.has(u.user_id) ? ' -- akun juga akan diaktifkan kembali karena diblokir' : ''}">`;
        }
        if (bannedActiveMap.has(u.user_id)) {
            return `<input type="checkbox" class="auth-checkbox" data-user-id="${u.user_id}" data-mode="reactivate" ${pendingAuthActions.has(u.user_id) ? 'checked' : ''} title="Karyawan AKTIF tetapi akun login DIBLOKIR. Centang lalu klik 'Proses Akun Login' untuk mengaktifkan kembali.">
                    <i class="fa-solid fa-user-lock ms-1" style="color: #d97706;" title="Akun login diblokir (ban)"></i>`;
        }
        return `<i class="fa-solid fa-circle-check" style="color: var(--users-success);" title="Akun login aktif & tersinkron"></i>`;
    })()}
</td>
                <td class="col-reset-pw">
                    ${(() => {
                        // must_change_password sekarang text 3-status, bukan boolean:
                        // 'open'     -> karyawan mengajukan, MENUNGGU admin -> tombol aktif merah
                        // 'progress' -> admin sudah approve, MENUNGGU karyawan ganti password -> disabled, info beda
                        // 'close'    -> normal, tidak ada permintaan -> disabled
                        if (u.must_change_password === "open") {
                            return `<button type="button" class="btn btn-sm btn-danger fw-bold reset-pw-btn" data-user-id="${u.user_id}" data-username="${u.username}" title="Karyawan mengajukan reset password! Klik untuk menyetujui.">
                                        <i class="fa-solid fa-key me-1"></i> Reset Password
                                    </button>`;
                        }
                        if (u.must_change_password === "progress") {
                            return `<button type="button" class="btn btn-sm btn-warning disabled" disabled title="Sudah direset admin, menunggu karyawan membuat password baru">
                                        <i class="fa-solid fa-hourglass-half me-1"></i> Menunggu User
                                    </button>`;
                        }
                        return `<button type="button" class="btn btn-sm btn-secondary disabled" disabled title="Tidak ada permintaan reset password">
                                    <i class="fa-solid fa-key me-1"></i> Reset Password
                                </button>`;
                    })()}
                </td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".role-select").forEach(select => {
        select.addEventListener("change", handleRoleChange);
    });

        tbody.querySelectorAll(".reset-pw-btn").forEach(btn => {
        btn.addEventListener("click", () => handleAdminResetPassword(btn.dataset.userId, btn.dataset.username));
    });

    tbody.querySelectorAll(".auth-checkbox").forEach(cb => {
    cb.addEventListener("change", (e) => {
        const userId = parseInt(e.target.getAttribute("data-user-id"));
        const mode = e.target.getAttribute("data-mode");
        if (e.target.checked) {
            pendingAuthActions.set(userId, mode);
        } else {
            pendingAuthActions.delete(userId);
        }
        updateCreateAuthButtonState();
    });
});
}

// ===================================================
// 9. HANDLE PERUBAHAN ROLE (belum disimpan)
// ===================================================
function handleRoleChange(e) {
    const userId = parseInt(e.target.getAttribute("data-user-id"));
    const newRoleId = parseInt(e.target.value);

    const original = currentPageData.find(u => u.user_id === userId);

    if (original && original.role_id === newRoleId) {
        pendingChanges.delete(userId);
    } else {
        pendingChanges.set(userId, newRoleId);
    }

    const row = e.target.closest("tr");
    row.classList.toggle("row-changed", pendingChanges.has(userId));
    updateSaveButtonState();
}

// ===================================================
// 10. SAVE CHANGES (panggil RPC batch)
// ===================================================
function setupSaveButton() {
    document.getElementById("btnSaveChanges").addEventListener("click", saveAllChanges);
}

function updateSaveButtonState() {
    const btnSave = document.getElementById("btnSaveChanges");
    const info = document.getElementById("pendingChangeInfo");

    if (pendingChanges.size > 0) {
        btnSave.disabled = false;
        info.textContent = `${pendingChanges.size} perubahan belum disimpan`;
    } else {
        btnSave.disabled = true;
        info.textContent = "";
    }
}

async function saveAllChanges() {
    const btnSave = document.getElementById("btnSaveChanges");
    btnSave.disabled = true;
    btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    // Susun payload sesuai format yang diharapkan RPC:
    // [{ "user_id": ..., "role_id": ... }, ...]
    const payload = Array.from(pendingChanges.entries()).map(([userId, roleId]) => ({
        user_id: userId,
        role_id: roleId
    }));

    try {
        const { data, error } = await supabaseClient.rpc("save_user_roles_batch", {
            changes: payload
        });

        if (error) throw error;

        const gagal = (data || []).filter(r => !r.success);

        if (gagal.length === 0) {
            showToast(`Berhasil menyimpan ${payload.length} perubahan.`, "success");
            pendingChanges.clear();
        } else {
            showToast(`${payload.length - gagal.length} berhasil, ${gagal.length} gagal.`, "danger");
            // Hapus dari pendingChanges yang berhasil saja
            const gagalIds = new Set(gagal.map(g => g.user_id));
            payload.forEach(p => {
                if (!gagalIds.has(p.user_id)) pendingChanges.delete(p.user_id);
            });
        }

    } catch (err) {
        console.error("Gagal simpan perubahan:", err);
        showToast(`Gagal menyimpan perubahan: ${err.message}`, "danger");
    }

    btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Changes`;
    updateSaveButtonState();
    await loadUsersPage(); // reload dari server supaya data & highlight konsisten
}

function setupCreateAuthButton() {
    document.getElementById("btnCreateAuth").addEventListener("click", executeBulkAuthCreate);
}

function updateCreateAuthButtonState() {
    const btn = document.getElementById("btnCreateAuth");
    if (pendingAuthActions.size > 0) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Proses Akun Login (${pendingAuthActions.size})`;
    } else {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Proses Akun Login`;
    }
}

// ===================================================
// PERBAIKAN: ketika Edge Function balas status non-2xx, supabase-js
// HANYA memberi error.message = "Edge Function returned a non-2xx
// status code" -- pesan JSON asli yang dikirim function (mis. "Gagal
// membuat akun auth: email sudah terdaftar") ada di error.context
// (Response object), tidak pernah dibaca sebelumnya. Akibatnya alasan
// kegagalan SEBENARNYA tidak pernah terlihat, baik di toast maupun
// console.error. Helper ini membaca context-nya kalau ada.
// ===================================================
async function extractEdgeFunctionMessage(error, data, fallback = "Gagal memproses.") {
    if (data?.message) return data.message;
    if (error?.context && typeof error.context.json === "function") {
        try {
            // Response body hanya bisa dibaca SEKALI -- clone supaya
            // tidak bentrok kalau supabase-js/kode lain juga membacanya.
            const body = await error.context.clone().json();
            if (body?.message) return body.message;
        } catch {
            // context bukan JSON valid (mis. error gateway/HTML) -- abaikan, pakai fallback
        }
    }
    return error?.message || fallback;
}

async function executeBulkAuthCreate() {
    const btn = document.getElementById("btnCreateAuth");
    const entries = Array.from(pendingAuthActions.entries()); // [userId, mode]

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`;

    let sukses = 0;
    let gagal = [];

    for (const [userId, mode] of entries) {
        try {
            // mode "create" -> "create", "resync" -> "resync", "reactivate" -> "reactivate"
            let hasil = await invokeSyncAuth(mode, userId);

            // Akun yang NIK-nya berubah DAN sedang diblokir: setelah sinkron ulang, aktifkan juga
            // (resync hanya mengganti email & password, tidak mencabut blokir).
            if (hasil.ok && mode === "resync" && bannedActiveMap.has(userId)) {
                hasil = await invokeSyncAuth("reactivate", userId);
            }

            if (!hasil.ok) {
                gagal.push({ userId, message: hasil.message });
            } else {
                sukses++;
            }
        } catch (err) {
            gagal.push({ userId, message: err.message });
        }
    }

    pendingAuthActions.clear();

    if (gagal.length === 0) {
        showToast(`Berhasil memproses ${sukses} akun.`, "success");
    } else {
        console.error("Detail kegagalan proses akun:", gagal);
        showToast(`${sukses} berhasil, ${gagal.length} gagal. Lihat console untuk detail.`, "danger");
    }

    updateCreateAuthButtonState();
    await refreshBannedBanner();
    await loadUsersPage();
}

// Panggil Edge Function sync-auth; hasil seragam { ok, message }
async function invokeSyncAuth(action, userId) {
    const { data, error } = await supabaseClient.functions.invoke("sync-auth", {
        body: { action, user_id: userId }
    });
    if (error || !data?.success) {
        return { ok: false, message: await extractEdgeFunctionMessage(error, data, "Gagal") };
    }
    return { ok: true, message: data.message || "OK" };
}

// ===================================================
// AKUN LOGIN TERBLOKIR PADA KARYAWAN AKTIF
// Fungsi database public.list_active_but_banned_users() mengembalikan karyawan yang
// is_active = true tetapi akun auth-nya masih di-ban. Banner di atas tabel menampilkan
// jumlahnya, dengan tombol untuk menyaring tabel dan mengaktifkan semuanya sekaligus.
// Jika fungsi belum dibuat / pengguna tidak berwenang, banner disembunyikan (halaman tetap jalan).
// ===================================================
function setupBannedBanner() {
    if (document.getElementById("bannedBanner")) return;
    const anchor = document.querySelector(".users-table-wrapper");
    if (!anchor) return;
    anchor.insertAdjacentHTML("beforebegin", `
        <div id="bannedBanner" class="alert alert-warning d-none d-flex flex-wrap align-items-center gap-2 py-2 px-3 mb-2" role="alert">
            <i class="fa-solid fa-user-lock"></i>
            <span id="bannedBannerText" class="flex-grow-1"></span>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btnShowBanned">Tampilkan</button>
            <button type="button" class="btn btn-sm btn-warning fw-semibold" id="btnReactivateAll">Aktifkan Semua</button>
        </div>`);

    document.getElementById("btnShowBanned").addEventListener("click", () => {
        showOnlyBanned = !showOnlyBanned;
        currentPage = 1;
        updateBannedBannerUI();
        loadUsersPage();
    });
    document.getElementById("btnReactivateAll").addEventListener("click", reactivateAllBanned);
}

function updateBannedBannerUI() {
    const banner = document.getElementById("bannedBanner");
    if (!banner) return;
    const n = bannedActiveMap.size;
    banner.classList.toggle("d-none", n === 0);
    document.getElementById("bannedBannerText").textContent =
        `${n} karyawan aktif tetapi akun login-nya diblokir (tidak bisa login).`;
    document.getElementById("btnShowBanned").textContent = showOnlyBanned ? "Tampilkan Semua" : "Tampilkan";
}

async function refreshBannedBanner() {
    try {
        const { data, error } = await supabaseClient.rpc("list_active_but_banned_users");
        if (error) throw error;
        bannedActiveMap = new Map((data || []).map(r => [Number(r.user_id), r.username]));
    } catch (err) {
        console.warn("Daftar akun terblokir tidak dapat dimuat:", err.message || err);
        bannedActiveMap = new Map();
    }
    if (bannedActiveMap.size === 0) showOnlyBanned = false;
    updateBannedBannerUI();
}

async function reactivateAllBanned() {
    const ids = Array.from(bannedActiveMap.keys());
    if (ids.length === 0) return;
    if (!confirm(`Aktifkan kembali ${ids.length} akun login karyawan aktif yang sedang diblokir?`)) return;

    const btn = document.getElementById("btnReactivateAll");
    btn.disabled = true;
    const gagal = [];
    let sukses = 0;

    for (let i = 0; i < ids.length; i++) {
        btn.textContent = `Memproses ${i + 1}/${ids.length}...`;
        try {
            const hasil = await invokeSyncAuth("reactivate", ids[i]);
            if (hasil.ok) sukses++; else gagal.push({ userId: ids[i], message: hasil.message });
        } catch (err) {
            gagal.push({ userId: ids[i], message: err.message });
        }
    }

    btn.disabled = false;
    btn.textContent = "Aktifkan Semua";
    if (gagal.length === 0) {
        showToast(`Berhasil mengaktifkan ${sukses} akun.`, "success");
    } else {
        console.error("Detail kegagalan aktivasi akun:", gagal);
        showToast(`${sukses} berhasil, ${gagal.length} gagal. Lihat console untuk detail.`, "danger");
    }
    await refreshBannedBanner();
    await loadUsersPage();
}

// ===================================================
// 11. PAGINATION (server-side, berdasarkan totalRows dari count)
// ===================================================
function renderPagination() {
    const container = document.getElementById("usersPagination");
    const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE);

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `<button class="pagination-btn" id="pagePrev" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
    </button>`;

    // Kalau halaman terlalu banyak, batasi tampilan nomor (misal 7 tombol
    // di sekitar halaman aktif) supaya tidak terlalu panjang untuk data besar
    const maxVisible = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="pagination-btn" id="pageNext" ${currentPage === totalPages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
    </button>`;

    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (pendingChanges.size > 0) {
                const ok = confirm("Ada perubahan yang belum disimpan di halaman ini. Pindah halaman akan mengabaikan perubahan tersebut. Lanjutkan?");
                if (!ok) return;
                pendingChanges.clear();
            }
            currentPage = parseInt(btn.getAttribute("data-page"));
            loadUsersPage({ keepOrder: true });
        });
    });

    const prevBtn = document.getElementById("pagePrev");
    const nextBtn = document.getElementById("pageNext");
    if (prevBtn) prevBtn.addEventListener("click", () => prevBtn.click === prevBtn ? null : null);
    if (prevBtn) prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadUsersPage({ keepOrder: true }); } };
    if (nextBtn) nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; loadUsersPage({ keepOrder: true }); } };
}

// ===================================================
// 12. TOAST NOTIFIKASI
// ===================================================
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    const toastEl = document.createElement("div");
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    toastEl.setAttribute("role", "alert");
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    container.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toast.show();
    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
}
// ===================================================
// RESET PASSWORD (dipicu admin dari tombol merah)
// Memakai Edge Function sync-auth yang sudah ada (aksi
// "reset_password") -- bukan logika baru, reuse infrastruktur
// yang sudah terbukti jalan.
// ===================================================
async function handleAdminResetPassword(userId, username) {
    const konfirmasi = confirm(
        `Reset password untuk ${username}?\n\nPassword akan dikembalikan ke pola standar (${username}123).`
    );
    if (!konfirmasi) return;

    try {
        const { data, error } = await supabaseClient.functions.invoke("sync-auth", {
            body: { action: "reset_password", user_id: userId }
        });

        if (error || !data?.success) {
            const realMessage = await extractEdgeFunctionMessage(error, data, "Gagal mereset password.");
            throw new Error(realMessage);
        }

        showToast(`Password direset. Informasikan ke ${username} untuk login & buat password baru.`, "success");
        await loadUsersPage();

    } catch (err) {
        console.error("Gagal reset password:", err);
        alert("Gagal mereset password: " + err.message);
    }
}