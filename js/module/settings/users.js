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
    bagians: []
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
const ROWS_PER_PAGE = 25;

// Menyimpan data baris yang SEDANG ditampilkan di halaman aktif saja
// (bukan semua data -- karena sekarang server-side pagination)
let currentPageData = [];

// ===================================================
// 2. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupBackButton();
    setupSearchInput();
    setupFilterToggle();
    setupSaveButton();
    setupCreateAuthButton();

    await loadReferenceData();
    renderFilterPanel();

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
        supabaseClient.from("cost_centers").select("id, costcenter_name").eq("is_active", true).order("costcenter_name"),
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
}

// ===================================================
// 5. AMBIL DATA HALAMAN AKTIF (SERVER-SIDE PAGINATION)
//    Query ke users_directory_view, dengan search + filter
//    diterapkan di level query (bukan di JS), lalu dipotong
//    per halaman pakai .range()
// ===================================================
async function loadUsersPage() {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .from("users_directory_view")
            .select("*", { count: "exact" });

        // Search: NIK atau nama karyawan
        if (searchKeyword) {
            query = query.or(`username.ilike.%${searchKeyword}%,nama_karyawan.ilike.%${searchKeyword}%`);
        }

        // Filter checklist -- pakai .in() untuk tiap kolom yang ada isinya
        if (activeFilters.branch_id.length > 0) query = query.in("branch_id", activeFilters.branch_id);
        if (activeFilters.costcenter_id.length > 0) query = query.in("costcenter_id", activeFilters.costcenter_id);
        if (activeFilters.departemen_id.length > 0) query = query.in("departemen_id", activeFilters.departemen_id);
        if (activeFilters.jabatan_id.length > 0) query = query.in("jabatan_id", activeFilters.jabatan_id);
        if (activeFilters.area_id.length > 0) query = query.in("area_id", activeFilters.area_id);
        if (activeFilters.bagian_id.length > 0) query = query.in("bagian_id", activeFilters.bagian_id);
        if (activeFilters.role_id.length > 0) query = query.in("role_id", activeFilters.role_id);

        // Pagination: hitung range berdasarkan halaman aktif
        const start = (currentPage - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
                // Urutan: auth_uid kosong (belum punya akun login) tetap prioritas
        // paling atas (operasional, supaya admin lihat yang perlu dibuatkan
        // akun dulu), lalu dikelompokkan Branch -> Cost Center -> Jabatan.
        query = query
        .order("auth_uid", { ascending: true, nullsFirst: true })
        .order("branch_id", { ascending: true })
        .order("costcenter_id", { ascending: true })
        .order("jabatan_id", { ascending: true })
        .range(start, end);

        const { data, error, count } = await query;

        if (error) throw error;

        currentPageData = data || [];
        totalRows = count || 0;

        renderTable();
        renderPagination();

    } catch (err) {
        console.error("Gagal memuat data users:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data: ${err.message}</td></tr>`;
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
    renderFilterGroup("filterCostCenter", referenceData.costCenters, "id", "costcenter_name");
    renderFilterGroup("filterDepartemen", referenceData.departments, "id", "department_name");
    renderFilterGroup("filterJabatan", referenceData.jabatans, "id", "jabatan_name");
    renderFilterGroup("filterArea", referenceData.areas, "id", "area_name");
    renderFilterGroup("filterBagian", referenceData.bagians, "id", "bagian_name");
    renderFilterGroup("filterRole", referenceData.roles, "id", "role_name");
}

function renderFilterGroup(containerId, list, idField, nameField) {
    const container = document.getElementById(containerId);
    if (!container) return; // jaga-jaga kalau HTML belum ditambah grup Area/Bagian
    if (list.length === 0) {
        container.innerHTML = `<span class="data-empty-cell">Tidak ada data</span>`;
        return;
    }
    container.innerHTML = list.map(item => `
        <label class="filter-checkbox-item">
            <input type="checkbox" value="${item[idField]}">
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
        tbody.innerHTML = `<tr class="row-empty"><td colspan="8">Tidak ada data ditemukan.</td></tr>`;
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
            return `<input type="checkbox" class="auth-checkbox" data-user-id="${u.user_id}" data-mode="resync" ${pendingAuthActions.has(u.user_id) ? 'checked' : ''} title="Sinkron ulang (NIK berubah)">`;
        }
        return `<i class="fa-solid fa-circle-check" style="color: var(--users-success);" title="Akun login aktif & tersinkron"></i>`;
    })()}
</td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".role-select").forEach(select => {
        select.addEventListener("change", handleRoleChange);
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

async function executeBulkAuthCreate() {
    const btn = document.getElementById("btnCreateAuth");
    const entries = Array.from(pendingAuthActions.entries()); // [userId, mode]

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`;

    let sukses = 0;
    let gagal = [];

    for (const [userId, mode] of entries) {
        try {
            // mode "create" -> action "create", mode "resync" -> action "resync"
            const { data, error } = await supabaseClient.functions.invoke("sync-auth", {
                body: { action: mode, user_id: userId }
            });

            if (error || !data?.success) {
                gagal.push({ userId, message: data?.message || error?.message || "Gagal" });
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
            loadUsersPage();
        });
    });

    const prevBtn = document.getElementById("pagePrev");
    const nextBtn = document.getElementById("pageNext");
    if (prevBtn) prevBtn.addEventListener("click", () => prevBtn.click === prevBtn ? null : null);
    if (prevBtn) prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadUsersPage(); } };
    if (nextBtn) nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; loadUsersPage(); } };
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