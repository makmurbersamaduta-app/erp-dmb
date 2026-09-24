<<<<<<< HEAD
// ===================================================
// js/module/operations/stg/borong.js
// Halaman Laporan Hasil Borong
// 3 tab: Data Hasil Borong, Pending, Qty Loading & Corrugator
// Modal detail di-generate dinamis (tabel Artikel & Employee
// berbeda struktur tergantung tab dan grup_kerja batch).
// ===================================================

const supabaseClient = window.supabaseClient;
const ROWS_PER_PAGE = 100;
const NAMA_BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const SHIFT_LABELS = { "1": "1 (Satu)", "2": "2 (Dua)", "3": "3 (Tiga)" };

// ===================================================
// 1. ROLE & AKSES HALAMAN
// PENTING: pembatasan di sisi TAMPILAN saja (frontend),
// bukan di database.
// Semua angka di sini adalah ROLE ID (bukan jabatan_id --
// revisi dari versi sebelumnya yang keliru pakai jabatan_id).
// ===================================================
const ROLE_MAINTENANCE = 1;
const ROLE_SUPERADMIN = 2;
const ROLE_ADMIN = 3;
const ROLE_SUPERVISOR = 4;
const ROLE_ADMIN_STG = 6;
const ROLE_KARU_STG = 8;

const ROLE_FULL_ACCESS = [ROLE_MAINTENANCE, ROLE_SUPERADMIN]; // lihat semua data, semua tab, tanpa scoping
const ALLOWED_PAGE_ROLES = [ROLE_MAINTENANCE, ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ADMIN_STG, ROLE_KARU_STG];

function getCurrentUserSession() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function resolveAccess() {
    const session = getCurrentUserSession();
    const roleId = session?.roleId;
    const userNik = session?.nik;

    const isFullAccess = ROLE_FULL_ACCESS.includes(roleId);
    const isKaruStg = roleId === ROLE_KARU_STG;
    const isAdminStg = roleId === ROLE_ADMIN_STG;

    const hasPageAccess = ALLOWED_PAGE_ROLES.includes(roleId);
    const canAccessPending = isFullAccess || isKaruStg;
    const canAccessQty = isFullAccess || isAdminStg;

    // KARU STG (non-fullaccess) dibatasi hanya lihat data miliknya sendiri
    // (nik_karu = username-nya), berlaku di tab Data Hasil Borong & Pending
    const scopedToOwnKaru = isKaruStg && !isFullAccess;

    return {
        roleId, userNik,
        isFullAccess,
        hasPageAccess,
        canAccessPending,
        canAccessQty,
        scopedToOwnKaru
    };
}

function applyRoleAccess() {
    const access = resolveAccess();

    if (!access.hasPageAccess) {
        document.querySelector(".bg-tabs-wrapper").classList.add("d-none");
        document.querySelector(".bg-main").innerHTML = `
            <div class="text-center py-5" style="color: var(--bg-text-muted);">
                <i class="fa-solid fa-lock fa-2x mb-3"></i>
                <p>Anda tidak memiliki akses ke halaman ini.</p>
            </div>
        `;
        return access;
    }

    if (!access.canAccessPending) {
        document.querySelector('[data-bs-target="#tabPendingBorong"]')?.closest(".nav-item")?.classList.add("d-none");
    }
    if (!access.canAccessQty) {
        document.querySelector('[data-bs-target="#tabQtyLoading"]')?.closest(".nav-item")?.classList.add("d-none");
    }

    return access;
}

let currentAccess = null;

// ===================================================
// 2. STATE GLOBAL
// ===================================================
let referenceData = { kode_batch: [], petugas_input: [] };

let dataHasilState = { filters: { kodeBatch: [], petugasInput: [], periode: "" }, page: 1, totalRows: 0, data: [] };
let pendingState = { page: 1, totalRows: 0, data: [] };
let qtyState = { page: 1, totalRows: 0, data: [] };

// Batch yang sedang dibuka di modal, dan mode modal saat ini
let currentModalMode = null; // "datahasil" | "pending" | "qty"
let currentModalBatch = null;

// ===================================================
// 3. PERHITUNGAN PERIODE (cutoff 16-31 / 1-15)
// 16-31 = Periode 1, nama bulan = bulan tanggal itu sendiri
// 1-15  = Periode 2, nama bulan = BULAN SEBELUMNYA
// Contoh: 1-15 Agustus = Periode 2 "Juli"
// ===================================================
function getPeriodeForDate(dateObj) {
    const day = dateObj.getDate();
    let month = dateObj.getMonth() + 1; // 1-12
    let year = dateObj.getFullYear();
    let sub = 1;

    if (day <= 15) {
        sub = 2;
        month -= 1;
        if (month < 1) { month = 12; year -= 1; }
    } else {
        sub = 1;
    }
    return { year, month, sub };
}

function getPeriodeDateRange(year, month, sub) {
    let start, end;
    if (sub === 1) {
        start = new Date(year, month - 1, 16);
        end = new Date(year, month - 1, 31);
    } else {
        // Periode 2: 1-15 BULAN SESUDAHNYA dari nama bulan
        let nextMonth = month + 1, nextYear = year;
        if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
        start = new Date(nextYear, nextMonth - 1, 1);
        end = new Date(nextYear, nextMonth - 1, 15);
    }
    return { start: toIsoDate(start), end: toIsoDate(end) };
}

function toIsoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodeLabel(year, month, sub) {
    return `${NAMA_BULAN_ID[month - 1]} ${year} - Periode ${sub}`;
}

// Isi dropdown Periode: 3 bulan terakhir x 2 sub-periode = 6 opsi
function populatePeriodeOptions() {
    const select = document.getElementById("filterPeriodeDataHasil");
    if (!select) return;

    const today = new Date();
    let current = getPeriodeForDate(today);

    // Urutan mundur: mulai dari periode saat ini, mundur 6 kali (3 bulan x 2 sub)
    let year = current.year, month = current.month, sub = current.sub;

    for (let i = 0; i < 6; i++) {
        const opt = document.createElement("option");
        opt.value = `${year}-${String(month).padStart(2, "0")}-${sub}`;
        opt.textContent = periodeLabel(year, month, sub);
        select.appendChild(opt);

        if (sub === 1) {
            sub = 2;
            month -= 1;
            if (month < 1) { month = 12; year -= 1; }
        } else {
            sub = 1;
        }
    }
}

// ===================================================
// 4. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    currentAccess = applyRoleAccess();

    setupFilterToggleDataHasil();
    setupModalCommon();
    setupDownloadDataHasil();

    try {
        await loadReferenceData();
    } catch (err) {
        console.error("Gagal memuat data referensi filter:", err);
    }

    renderFieldFilterGroupsDataHasil();
    populatePeriodeOptions();

    await loadDataHasilPage();

    // Pending & Qty dimuat lazy saat tab diklik pertama kali
    let pendingLoaded = false;
    document.querySelector('[data-bs-target="#tabPendingBorong"]')?.addEventListener("shown.bs.tab", async () => {
        if (!pendingLoaded && currentAccess.canAccessPending) {
            pendingLoaded = true;
            await loadPendingPage();
        }
    });

    let qtyLoaded = false;
    document.querySelector('[data-bs-target="#tabQtyLoading"]')?.addEventListener("shown.bs.tab", async () => {
        if (!qtyLoaded && currentAccess.canAccessQty) {
            qtyLoaded = true;
            await loadQtyPage();
        }
    });

    // Buka tab tertentu otomatis kalau halaman diakses lewat link
    // berisi hash, misal dari dashboard: borong.html#tabPendingBorong
    // Dipanggil SETELAH listener shown.bs.tab di atas terpasang, supaya
    // data tab yang dituju tetap otomatis termuat (bukan cuma tabnya
    // yang pindah, tapi kosong).
    openTabFromUrlHash();
});

// Buka tab Bootstrap sesuai window.location.hash (dipanggil sekali saat load)
function openTabFromUrlHash() {
    if (!currentAccess.hasPageAccess) return; // halaman sudah diganti pesan akses ditolak

    const hash = window.location.hash; // contoh: "#tabPendingBorong"
    if (!hash) return;

    const tabButton = document.querySelector(`[data-bs-target="${hash}"]`);
    if (tabButton && !tabButton.closest(".nav-item")?.classList.contains("d-none")) {
        bootstrap.Tab.getOrCreateInstance(tabButton).show();
    }
}

// ===================================================
// 5. DATA REFERENSI FILTER (Kode Batch, Petugas Input)
// ===================================================
async function loadReferenceData() {
    const { data, error } = await supabaseClient
        .schema("stg_public")
        .rpc("get_borong_filter_options");

    if (error) {
        console.error("Gagal memuat opsi filter:", error.message);
        return;
    }

    referenceData.kode_batch = data?.kode_batch || [];
    referenceData.petugas_input = data?.petugas_input || []; // [{nik, nama}]
}

function renderFieldFilterGroupsDataHasil() {
    const container = document.getElementById("filterFieldGroupsDataHasil");
    if (!container) return;

    const kodeBatchOptions = referenceData.kode_batch.map(v => ({ value: v, label: v }));
    const petugasOptions = referenceData.petugas_input.map(p => ({ value: p.nik, label: p.nama }));

    container.innerHTML = `
        ${renderChecklistGroupHtml("kodeBatch", "Kode Batch", kodeBatchOptions)}
        ${renderChecklistGroupHtml("petugasInput", "Petugas Input", petugasOptions)}
    `;

    setupChecklistGroupBehavior("kodeBatch");
    setupChecklistGroupBehavior("petugasInput");
}

function renderChecklistGroupHtml(key, label, options) {
    const groupId = `filterGroup_${key}`;
    const searchId = `filterSearch_${key}`;
    const listId = `filterList_${key}`;
    const selected = dataHasilState.filters[key] || [];

    const items = options.map(opt => `
        <label class="filter-checkbox-item" data-search-text="${String(opt.label).toLowerCase()}">
            <input type="checkbox" value="${opt.value}" ${selected.includes(String(opt.value)) ? "checked" : ""}>
            <span>${opt.label}</span>
        </label>
    `).join("");

    return `
        <div class="filter-group">
            <button type="button" class="filter-group-header" data-target="${groupId}">
                <span>${label}</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="filter-group-body-collapsible" id="${groupId}">
                <input type="text" class="filter-inline-search" id="${searchId}" placeholder="Cari ${label.toLowerCase()}...">
                <div class="filter-checkbox-list" id="${listId}">
                    ${options.length > 0 ? items : '<span class="data-empty-cell">Tidak ada data</span>'}
                </div>
            </div>
        </div>
    `;
}

function setupChecklistGroupBehavior(key) {
    const header = document.querySelector(`[data-target="filterGroup_${key}"]`);
    const body = document.getElementById(`filterGroup_${key}`);
    if (header && body) {
        header.addEventListener("click", (e) => {
            e.stopPropagation();
            header.classList.toggle("expanded");
            body.classList.toggle("expanded");
        });
    }

    const searchInput = document.getElementById(`filterSearch_${key}`);
    const listContainer = document.getElementById(`filterList_${key}`);
    if (searchInput && listContainer) {
        searchInput.addEventListener("input", () => {
            const keyword = searchInput.value.trim().toLowerCase();
            listContainer.querySelectorAll(".filter-checkbox-item").forEach(item => {
                const text = item.getAttribute("data-search-text") || "";
                item.style.display = text.includes(keyword) ? "flex" : "none";
            });
        });
        searchInput.addEventListener("click", (e) => e.stopPropagation());
    }
}

// ===================================================
// 6. FILTER PANEL: toggle, apply, reset (Data Hasil Borong)
// ===================================================
function setupFilterToggleDataHasil() {
    const btnToggle = document.getElementById("btnFilterToggleDataHasil");
    const panel = document.getElementById("filterPanelDataHasil");
    if (!btnToggle || !panel) return;

    btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("d-none");
    });
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && !btnToggle.contains(e.target)) {
            panel.classList.add("d-none");
        }
    });

    document.getElementById("btnFilterApplyDataHasil").addEventListener("click", () => {
        dataHasilState.filters.kodeBatch = getCheckedValues("filterList_kodeBatch");
        dataHasilState.filters.petugasInput = getCheckedValues("filterList_petugasInput");
        dataHasilState.filters.periode = document.getElementById("filterPeriodeDataHasil").value;

        dataHasilState.page = 1;
        updateFilterBadgeDataHasil();
        panel.classList.add("d-none");
        loadDataHasilPage();
    });

    document.getElementById("btnFilterResetDataHasil").addEventListener("click", () => {
        document.querySelectorAll("#filterFieldGroupsDataHasil input[type='checkbox']").forEach(cb => cb.checked = false);
        document.getElementById("filterPeriodeDataHasil").value = "";
        dataHasilState.filters = { kodeBatch: [], petugasInput: [], periode: "" };
        dataHasilState.page = 1;
        updateFilterBadgeDataHasil();
        loadDataHasilPage();
    });
}

function getCheckedValues(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return [];
    return Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function updateFilterBadgeDataHasil() {
    const f = dataHasilState.filters;
    let total = f.kodeBatch.length + f.petugasInput.length + (f.periode ? 1 : 0);
    const badge = document.getElementById("filterCountBadgeDataHasil");
    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

// ===================================================
// 7. HELPER: format tanggal, shift
// ===================================================
function formatTanggal(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function formatShift(val) {
    return SHIFT_LABELS[String(val)] || val || "-";
}

// Format angka dengan separator ribuan (titik, gaya Indonesia).
// Mengembalikan null/undefined apa adanya supaya pemanggil tetap bisa
// pakai fallback "data-empty-cell" seperti biasa.
function formatAngka(val) {
    if (val === null || val === undefined || val === "") return val;
    const num = Number(val);
    if (isNaN(num)) return val;
    return num.toLocaleString("id-ID");
}

// Terapkan sorting standar ke semua query: tanggal_bstb desc, lalu shift_sort asc
function applyStandardSort(query) {
    return query.order("tanggal_bstb", { ascending: false }).order("shift_sort", { ascending: true });
}

// Update badge angka di tab Pending / Qty
function updateCountBadge(badgeId, count) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

// ===================================================
// 8. TAB DATA HASIL BORONG
// ===================================================
async function loadDataHasilPage() {
    const tbody = document.getElementById("dataHasilTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("*", { count: "exact" })
            .ilike("status", "%approved%");

        // KARU STG (non-fullaccess) hanya lihat data miliknya sendiri
        if (currentAccess.scopedToOwnKaru && currentAccess.userNik) {
            query = query.eq("nik_karu", currentAccess.userNik);
        }

        const f = dataHasilState.filters;
        if (f.kodeBatch.length > 0) query = query.in("no_batch", f.kodeBatch);
        if (f.petugasInput.length > 0) query = query.in("nik_input", f.petugasInput);

        if (f.periode) {
            const [py, pm, ps] = f.periode.split("-").map(Number);
            const range = getPeriodeDateRange(py, pm, ps);
            query = query.gte("tanggal_bstb", range.start).lte("tanggal_bstb", range.end);
        } else {
            // Default: cuma periode TERBARU
            const today = new Date();
            const cur = getPeriodeForDate(today);
            const range = getPeriodeDateRange(cur.year, cur.month, cur.sub);
            query = query.gte("tanggal_bstb", range.start).lte("tanggal_bstb", range.end);
        }

        query = applyStandardSort(query);

        const start = (dataHasilState.page - 1) * ROWS_PER_PAGE;
        query = query.range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        dataHasilState.data = data || [];
        dataHasilState.totalRows = count || 0;

        renderTableGeneric("dataHasilTableBody", dataHasilState.data, dataHasilState.page, true, "datahasil");
        renderPagination("dataHasilPagination", dataHasilState, loadDataHasilPage);

    } catch (err) {
        console.error("Gagal memuat data hasil borong:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 9. TAB PENDING
// ===================================================
async function loadPendingPage() {
    const tbody = document.getElementById("pendingBorongTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("*", { count: "exact" })
            .not("status", "ilike", "%approved%") // hilang untuk SEMUA role begitu approved
            .eq("has_kosong_loading_corrugator", false); // qty loading/corrugator harus sudah lengkap

        // KARU STG (non-fullaccess) hanya lihat data miliknya sendiri
        if (currentAccess.scopedToOwnKaru && currentAccess.userNik) {
            query = query.eq("nik_karu", currentAccess.userNik);
        }

        query = applyStandardSort(query);

        const start = (pendingState.page - 1) * ROWS_PER_PAGE;
        query = query.range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        pendingState.data = data || [];
        pendingState.totalRows = count || 0;

        renderTableGeneric("pendingBorongTableBody", pendingState.data, pendingState.page, false, "pending");
        renderPagination("pendingBorongPagination", pendingState, loadPendingPage);
        updateCountBadge("pendingCountBadgeBorong", pendingState.totalRows);

    } catch (err) {
        console.error("Gagal memuat data pending:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 10. TAB QTY LOADING & CORRUGATOR
// ===================================================
async function loadQtyPage() {
    const tbody = document.getElementById("qtyLoadingTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("*", { count: "exact" })
            .eq("has_loading_corrugator", true);

        // Aturan per role:
        // - Full access (Maintenance/Superadmin): tampil selama status_payroll belum Close
        // - Admin STG: HANYA tampil kalau qty loading/corrugator masih kosong
        if (currentAccess.isFullAccess) {
            query = query.ilike("status_payroll", "%open%");
        } else {
            query = query.eq("has_kosong_loading_corrugator", true);
        }

        // Urutan: yang qty-nya masih kosong ditaruh PALING ATAS,
        // baru diurutkan tanggal terbaru -> shift custom (sesuai standar)
        query = query
            .order("has_kosong_loading_corrugator", { ascending: false })
            .order("tanggal_bstb", { ascending: false })
            .order("shift_sort", { ascending: true });

        const start = (qtyState.page - 1) * ROWS_PER_PAGE;
        query = query.range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        qtyState.data = data || [];
        qtyState.totalRows = count || 0;

        renderTableGeneric("qtyLoadingTableBody", qtyState.data, qtyState.page, false, "qty");
        renderPagination("qtyLoadingPagination", qtyState, loadQtyPage);
        updateCountBadge("qtyCountBadgeBorong", qtyState.totalRows);

    } catch (err) {
        console.error("Gagal memuat data qty loading:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 11. RENDER TABEL UTAMA (generik untuk 3 tab)
// ===================================================
function renderTableGeneric(tbodyId, rows, page, showStatusPayroll, mode) {
    const tbody = document.getElementById(tbodyId);
    const colspan = showStatusPayroll ? 8 : 7;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="${colspan}">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = rows.map((row, index) => {
        const statusPayrollCell = showStatusPayroll ? `
            <td><span class="badge-status ${(row.status_payroll || '').toLowerCase() === 'open' ? 'badge-open' : 'badge-close'}">${row.status_payroll || '-'}</span></td>
        ` : "";

        return `
            <tr class="row-clickable" data-id="${row.id}">
                <td class="col-no">${start + index + 1}</td>
                <td>${row.no_batch || "-"}</td>
                <td>${row.grup_kerja || '<span class="data-empty-cell">-</span>'}</td>
                <td>${formatTanggal(row.tanggal_bstb) || '<span class="data-empty-cell">-</span>'}</td>
                <td>${formatShift(row.shift)}</td>
                <td>${row.nama_input || '<span class="data-empty-cell">-</span>'}</td>
                <td>${row.nama_karu || '<span class="data-empty-cell">-</span>'}</td>
                ${statusPayrollCell}
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(tr => {
        tr.addEventListener("click", () => {
            const id = tr.getAttribute("data-id");
            const row = rows.find(r => String(r.id) === String(id));
            openDetailModal(row, mode);
        });
    });
}

// ===================================================
// 12. PAGINATION (generik untuk 3 tab)
// ===================================================
function renderPagination(containerId, state, reloadFn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);
    if (totalPages <= 1) { container.innerHTML = ""; return; }

    let html = `<button class="pagination-btn" data-nav="prev" ${state.page === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>`;

    const maxVisible = 7;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === state.page ? "active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class="pagination-btn" data-nav="next" ${state.page === totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>`;

    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.getAttribute("data-page")); reloadFn(); });
    });
    const prevBtn = container.querySelector('[data-nav="prev"]');
    const nextBtn = container.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.onclick = () => { if (state.page > 1) { state.page--; reloadFn(); } };
    if (nextBtn) nextBtn.onclick = () => { if (state.page < totalPages) { state.page++; reloadFn(); } };
}

// ===================================================
// 13. MODAL DETAIL -- ambil data mentah + gabung manual di JS
// ===================================================
async function openDetailModal(batchRow, mode) {
    currentModalMode = mode;
    currentModalBatch = batchRow;

    document.getElementById("modalBatchId").value = batchRow.id;
    document.getElementById("modalInfoKodeBatch").textContent = batchRow.no_batch || "-";
    document.getElementById("modalInfoTanggal").textContent = formatTanggal(batchRow.tanggal_bstb) || "-";
    document.getElementById("modalInfoPetugas").textContent = batchRow.nama_input || "-";
    document.getElementById("modalInfoKaru").textContent = batchRow.nama_karu || "-";

    document.getElementById("modalDetailTitle").textContent =
        mode === "pending" ? "Detail Batch - Approval" :
        mode === "qty" ? "Detail Batch - Input Qty" : "Detail Batch";

    // Ambil data mentah borong_artikel & borong_employee untuk batch ini
    const [artikelRes, employeeRes] = await Promise.all([
        supabaseClient.schema("stg_public").from("borong_artikel").select("*").eq("batch_id", batchRow.id),
        supabaseClient.schema("stg_public").from("borong_employee").select("*").eq("batch_id", batchRow.id)
    ]);

    const artikelRows = artikelRes.data || [];
    const employeeRowsRaw = employeeRes.data || [];

    // Gabungkan manual: nama_barang/customer dari stg_public.artikel,
    // nama_pekerjaan & satuan dari stg_public.harga_borong (ambil 1
    // baris representatif per kode_pekerjaan -- lihat catatan di bawah)
    const kodeArtikelList = [...new Set(artikelRows.map(a => a.kode_artikel).filter(Boolean))];
    const kodePekerjaanList = [...new Set(artikelRows.map(a => a.kode_pekerjaan).filter(Boolean))];

    const [artikelMasterRes, hargaBorongRes] = await Promise.all([
        kodeArtikelList.length > 0
            ? supabaseClient.schema("stg_public").from("artikel").select("kode_artikel, nama_barang, customer").in("kode_artikel", kodeArtikelList)
            : Promise.resolve({ data: [] }),
        kodePekerjaanList.length > 0
            ? supabaseClient.schema("stg_public").from("harga_borong").select("kode_pekerjaan, nama_pekerjaan, satuan").in("kode_pekerjaan", kodePekerjaanList)
            : Promise.resolve({ data: [] })
    ]);

    const artikelMaster = artikelMasterRes.data || [];
    // Catatan: kode_pekerjaan BUKAN unik di harga_borong (bisa >1 baris
    // per kode, beda varian harga). Untuk label Jenis Pekerjaan & Satuan
    // di sini cukup ambil SATU baris representatif (yang pertama ketemu) --
    // nama_pekerjaan konsisten antar varian, tapi satuan idealnya
    // dipastikan konsisten juga; kalau ternyata beda-beda per varian,
    // nilai yang tampil di sini cuma perkiraan terbaik, bukan otoritatif
    // (perhitungan harga sesungguhnya tetap domain modul Payroll).
    const hargaPekerjaanMap = {};
    (hargaBorongRes.data || []).forEach(hb => {
        if (!hargaPekerjaanMap[hb.kode_pekerjaan]) hargaPekerjaanMap[hb.kode_pekerjaan] = hb;
    });

    const enrichedArtikel = artikelRows.map(ba => {
        const master = artikelMaster.find(a => a.kode_artikel === ba.kode_artikel);
        const hb = hargaPekerjaanMap[ba.kode_pekerjaan];
        return {
            ...ba,
            nama_barang: master?.nama_barang || null,
            customer: master?.customer || null,
            nama_pekerjaan: hb?.nama_pekerjaan || ba.kode_pekerjaan || "-",
            satuan: hb?.satuan || null
        };
    });

    // Gabungkan employee dengan nama & bagian
    const nikList = [...new Set(employeeRowsRaw.map(e => e.employee_id).filter(Boolean))];
    let employeeMaster = [];
    if (nikList.length > 0) {
        const { data: empData } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .select("id, nik_karyawan, nama")
            .in("nik_karyawan", nikList);
        employeeMaster = empData || [];

        const empIds = employeeMaster.map(e => e.id);
        if (empIds.length > 0) {
            const { data: assignData } = await supabaseClient
                .schema("hrd")
                .from("employee_assignments")
                .select("employee_id, bagian_id")
                .in("employee_id", empIds)
                .eq("is_active", true);

            const bagianIds = [...new Set((assignData || []).map(a => a.bagian_id).filter(Boolean))];
            let bagianMaster = [];
            if (bagianIds.length > 0) {
                const { data: bgData } = await supabaseClient.from("bagians").select("id, bagian_name").in("id", bagianIds);
                bagianMaster = bgData || [];
            }

            employeeMaster = employeeMaster.map(e => {
                const assign = (assignData || []).find(a => a.employee_id === e.id);
                const bagian = bagianMaster.find(b => b.id === assign?.bagian_id);
                return { ...e, bagian: bagian?.bagian_name || null };
            });
        }
    }

    const enrichedEmployee = employeeRowsRaw.map(be => {
        const master = employeeMaster.find(e => e.nik_karyawan === be.employee_id);
        return {
            ...be,
            nama: master?.nama || null,
            bagian: master?.bagian || null
        };
    });

    renderModalArtikelTable(enrichedArtikel, mode);
    renderModalEmployeeTable(enrichedArtikel, enrichedEmployee, batchRow.grup_kerja, mode);
    renderModalFooter(mode, batchRow);

    const modalInstance = bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetailBatch"));
    modalInstance.show();
}

// ===================================================
// 14. RENDER TABEL ARTIKEL DI MODAL
// ===================================================
function renderModalArtikelTable(artikelRows, mode) {
    const container = document.getElementById("modalArtikelTableContainer");
    const showExtra = mode === "datahasil"; // Harga Borong & Total Harga cuma di tab Data Hasil Borong
    const editableQty = mode === "qty";

    let headHtml = `
        <th>No</th><th>Jenis Pekerjaan</th><th>Kode Artikel</th><th>Nama Barang</th><th>Customer</th>
        ${showExtra ? "<th>Harga Borong</th>" : ""}
        <th>Qty</th><th>Satuan</th>
        ${showExtra ? "<th>Total Harga</th>" : ""}
        <th>Half Proses</th>
    `;

    let bodyHtml = artikelRows.map((a, i) => {
        const isLoadingCorrugator = ["loading", "corrugator"].includes((a.grup_kerja || "").toLowerCase());
        const qtyCell = (editableQty && isLoadingCorrugator)
            ? `<input type="number" class="modal-qty-input" data-artikel-id="${a.id}" value="${a.qty ?? ''}">`
            : (formatAngka(a.qty) ?? '<span class="data-empty-cell">-</span>');

        const hargaBorongHitung = (a.qty && a.total_harga) ? formatAngka((a.total_harga / a.qty).toFixed(2)) : "-";

        return `
            <tr>
                <td>${i + 1}</td>
                <td>${a.nama_pekerjaan || "-"}</td>
                <td>${a.kode_artikel || '<span class="data-empty-cell">-</span>'}</td>
                <td>${a.nama_barang || '<span class="data-empty-cell">-</span>'}</td>
                <td>${a.customer || '<span class="data-empty-cell">-</span>'}</td>
                ${showExtra ? `<td>${hargaBorongHitung}</td>` : ""}
                <td>${qtyCell}</td>
                <td>${a.satuan || '<span class="data-empty-cell">-</span>'}</td>
                ${showExtra ? `<td>${formatAngka(a.total_harga) ?? '<span class="data-empty-cell">-</span>'}</td>` : ""}
                <td class="text-center">${a.is_half_proses ? '<i class="fa-solid fa-check text-success"></i>' : "-"}</td>
            </tr>
        `;
    }).join("");

    container.innerHTML = `
        <table class="modal-detail-table">
            <thead><tr>${headHtml}</tr></thead>
            <tbody>${bodyHtml || '<tr><td colspan="10" class="text-center text-muted">Tidak ada data artikel.</td></tr>'}</tbody>
        </table>
    `;
}

// ===================================================
// 15. RENDER TABEL EMPLOYEE DI MODAL
// Manual = matrix (kolom per POSISI baris artikel dalam batch)
// Selain Manual = tabel standar dengan kolom Ketua Grup
// ===================================================
function renderModalEmployeeTable(artikelRows, employeeRows, grupKerjaBatch, mode) {
    const container = document.getElementById("modalEmployeeTableContainer");
    const showUpah = mode === "datahasil";

    // Kumpulkan NIK unik (urutan kemunculan pertama dipertahankan)
    const uniqueNiks = [...new Set(employeeRows.map(e => e.employee_id))];

    if ((grupKerjaBatch || "").toLowerCase() === "manual") {
        // --- MATRIX: kolom = posisi baris artikel dalam batch ---
        let headHtml = `<th>No</th>${showUpah ? "<th>Upah</th>" : ""}<th>No Absen</th><th>Nama</th><th>Bagian</th>`;
        artikelRows.forEach((a, idx) => {
            headHtml += `<th>Kode Artikel ${idx + 1}</th>`;
        });

        let bodyHtml = uniqueNiks.map((nik, index) => {
            const empRowsForNik = employeeRows.filter(e => e.employee_id === nik);
            const sample = empRowsForNik[0];

            let cells = "";
            artikelRows.forEach(a => {
                const match = empRowsForNik.find(e => e.borong_artikel_id === a.id);
                cells += `<td class="text-center">${match ? (formatAngka(match.qty) ?? '<span class="data-empty-cell">-</span>') : "-"}</td>`;
            });

            const upahCell = showUpah ? `<td>${formatAngka(sample.upah_borong) ?? '<span class="data-empty-cell">-</span>'}</td>` : "";

            return `
                <tr>
                    <td>${index + 1}</td>
                    ${upahCell}
                    <td>${nik}</td>
                    <td>${sample.nama || '<span class="data-empty-cell">-</span>'}</td>
                    <td>${sample.bagian || '<span class="data-empty-cell">-</span>'}</td>
                    ${cells}
                </tr>
            `;
        }).join("");

        container.innerHTML = `
            <table class="modal-detail-table">
                <thead><tr>${headHtml}</tr></thead>
                <tbody>${bodyHtml || '<tr><td colspan="10" class="text-center text-muted">Tidak ada data karyawan.</td></tr>'}</tbody>
            </table>
        `;
    } else {
        // --- STANDAR: Corrugator, Loading, Grup ---
        let headHtml = `<th>No</th>${showUpah ? "<th>Upah</th>" : ""}<th>No Absen</th><th>Nama</th><th>Bagian</th><th>Ketua Grup</th>`;

        let bodyHtml = uniqueNiks.map((nik, index) => {
            const emp = employeeRows.find(e => e.employee_id === nik);
            const upahCell = showUpah ? `<td>${formatAngka(emp.upah_borong) ?? '<span class="data-empty-cell">-</span>'}</td>` : "";

            return `
                <tr>
                    <td>${index + 1}</td>
                    ${upahCell}
                    <td>${nik}</td>
                    <td>${emp.nama || '<span class="data-empty-cell">-</span>'}</td>
                    <td>${emp.bagian || '<span class="data-empty-cell">-</span>'}</td>
                    <td class="text-center">${emp.is_head ? '<i class="fa-solid fa-check text-success"></i>' : "-"}</td>
                </tr>
            `;
        }).join("");

        container.innerHTML = `
            <table class="modal-detail-table">
                <thead><tr>${headHtml}</tr></thead>
                <tbody>${bodyHtml || '<tr><td colspan="6" class="text-center text-muted">Tidak ada data karyawan.</td></tr>'}</tbody>
            </table>
        `;
    }
}

// ===================================================
// 16. FOOTER MODAL -- tombol berbeda per mode
// ===================================================
function renderModalFooter(mode, batchRow) {
    const footer = document.getElementById("modalDetailFooter");

    if (mode === "pending") {
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>
            <button type="button" class="btn btn-danger" id="btnRejectBatch">
                <i class="fa-solid fa-xmark me-1"></i> Reject
            </button>
            <button type="button" class="btn btn-success" id="btnApproveBatch">
                <i class="fa-solid fa-check me-1"></i> Approve
            </button>
        `;
        document.getElementById("btnApproveBatch").addEventListener("click", () => handleApprovalBatch(batchRow.id, "Approved"));
        document.getElementById("btnRejectBatch").addEventListener("click", () => handleApprovalBatch(batchRow.id, "Rejected"));
    } else if (mode === "qty") {
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>
            <button type="button" class="btn btn-primary" id="btnSimpanQty">
                <i class="fa-solid fa-floppy-disk me-1"></i> Simpan Qty
            </button>
        `;
        document.getElementById("btnSimpanQty").addEventListener("click", handleSimpanQty);
    } else {
        footer.innerHTML = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>`;
    }
}

// ===================================================
// 17. AKSI: Approve/Reject (tab Pending)
// ===================================================
async function handleApprovalBatch(batchId, newStatus) {
    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("borong_batch")
            .update({ status: newStatus, approved_by: currentAccess.userNik, approved_at: new Date().toISOString() })
            .eq("id", batchId);

        if (error) throw error;

        bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetailBatch")).hide();
        await loadPendingPage();

    } catch (err) {
        console.error("Gagal memproses approval:", err);
        alert("Gagal memproses approval: " + err.message);
    }
}

// ===================================================
// 18. AKSI: Simpan Qty (tab Qty Loading & Corrugator)
// ===================================================
async function handleSimpanQty() {
    const btn = document.getElementById("btnSimpanQty");
    const qtyInputs = document.querySelectorAll("#modalArtikelTableContainer .modal-qty-input");

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
        for (const input of qtyInputs) {
            const artikelId = input.getAttribute("data-artikel-id");
            const qtyVal = input.value.trim() === "" ? null : parseFloat(input.value);

            const { error } = await supabaseClient
                .schema("stg_public")
                .from("borong_artikel")
                .update({ qty: qtyVal })
                .eq("id", artikelId);

            if (error) throw error;
        }

        bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetailBatch")).hide();
        await loadQtyPage();

    } catch (err) {
        console.error("Gagal menyimpan qty:", err);
        alert("Gagal menyimpan qty: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Simpan Qty`;
    }
}

// ===================================================
// 19. SETUP MODAL UMUM (reset saat ditutup)
// ===================================================
function setupModalCommon() {
    document.getElementById("modalDetailBatch").addEventListener("hidden.bs.modal", () => {
        currentModalMode = null;
        currentModalBatch = null;
        document.getElementById("modalArtikelTableContainer").innerHTML = "";
        document.getElementById("modalEmployeeTableContainer").innerHTML = "";
    });
}

// ===================================================
// 20. DOWNLOAD EXCEL (tab Data Hasil Borong) -- ambil
// SELURUH data sesuai filter aktif, TIDAK dibatasi
// pagination 100 baris. Sumber: borong_report_per_pekerja.
// ===================================================
function setupDownloadDataHasil() {
    const btn = document.getElementById("btnDownloadDataHasil");
    if (btn) btn.addEventListener("click", handleDownloadDataHasil);
}

async function handleDownloadDataHasil() {
    const btn = document.getElementById("btnDownloadDataHasil");
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Menyiapkan...</span>`;

    try {
        // 1. Tentukan rentang tanggal periode yang sedang aktif (sama
        // seperti logika tampilan tabel: filter eksplisit, atau default
        // periode terbaru)
        const f = dataHasilState.filters;
        let dateRange;
        if (f.periode) {
            const [py, pm, ps] = f.periode.split("-").map(Number);
            dateRange = getPeriodeDateRange(py, pm, ps);
        } else {
            const today = new Date();
            const cur = getPeriodeForDate(today);
            dateRange = getPeriodeDateRange(cur.year, cur.month, cur.sub);
        }

        // 2. Ambil daftar no_batch yang sesuai filter+periode+status dari
        // borong_batch_view dulu (supaya bisa filter kodeBatch/petugasInput/
        // scoping KARU yang tidak ada di borong_report_per_pekerja)
        let batchQuery = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("no_batch")
            .ilike("status", "%approved%")
            .gte("tanggal_bstb", dateRange.start)
            .lte("tanggal_bstb", dateRange.end);

        if (currentAccess.scopedToOwnKaru && currentAccess.userNik) {
            batchQuery = batchQuery.eq("nik_karu", currentAccess.userNik);
        }
        if (f.kodeBatch.length > 0) batchQuery = batchQuery.in("no_batch", f.kodeBatch);
        if (f.petugasInput.length > 0) batchQuery = batchQuery.in("nik_input", f.petugasInput);

        const { data: batchRows, error: batchErr } = await batchQuery;
        if (batchErr) throw batchErr;

        const noBatchList = [...new Set((batchRows || []).map(b => b.no_batch))];

        if (noBatchList.length === 0) {
            alert("Tidak ada data untuk diunduh sesuai filter yang aktif.");
            return;
        }

        // 3. Ambil seluruh baris report untuk daftar no_batch itu.
        // TIDAK pakai .range() -- sengaja tanpa batas pagination,
        // sesuai permintaan (download tidak terpengaruh limit 100 baris).
        // Supabase/PostgREST tetap punya batas default per-request (1000
        // baris), jadi diambil bertahap per 1000 kalau datanya besar.
        let allRows = [];
        let batchStart = 0;
        const CHUNK = 1000;
        while (true) {
            const { data: chunkData, error: chunkErr } = await supabaseClient
                .schema("stg_public")
                .from("borong_report_per_pekerja")
                .select("*")
                .in("kode_batch", noBatchList)
                .range(batchStart, batchStart + CHUNK - 1);

            if (chunkErr) throw chunkErr;
            allRows = allRows.concat(chunkData || []);

            if (!chunkData || chunkData.length < CHUNK) break;
            batchStart += CHUNK;
        }

        if (allRows.length === 0) {
            alert("Tidak ada data untuk diunduh sesuai filter yang aktif.");
            return;
        }

        // 4. Susun ke format Excel sesuai kolom yang diminta
        const exportData = allRows.map(r => ({
            "Kode Batch": r.kode_batch,
            "Tanggal": formatTanggal(r.tanggal),
            "Shift": formatShift(r.shift),
            "Jenis Pekerjaan": r.jenis_pekerjaan,
            "Kode Pekerjaan": r.kode_pekerjaan,
            "Kode Artikel": r.kode_artikel,
            "Qty": r.qty,
            "No Absen": r.no_absen,
            "Grup Kerja": r.grup_kerja
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Data Hasil Borong");

        const namaFile = `Laporan_Hasil_Borong_${toIsoDate(new Date())}.xlsx`;
        XLSX.writeFile(wb, namaFile);

    } catch (err) {
        console.error("Gagal download data hasil borong:", err);
        alert("Gagal menyiapkan file download: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
=======
// ===================================================
// js/module/operations/stg/borong.js
// Halaman Laporan Hasil Borong
// 3 tab: Data Hasil Borong, Pending, Qty Loading & Corrugator
// Modal detail di-generate dinamis (tabel Artikel & Employee
// berbeda struktur tergantung tab dan grup_kerja batch).
// ===================================================

const supabaseClient = window.supabaseClient;
const ROWS_PER_PAGE = 100;
const NAMA_BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const SHIFT_LABELS = { "1": "1 (Satu)", "2": "2 (Dua)", "3": "3 (Tiga)" };

// ===================================================
// 1. ROLE & AKSES HALAMAN
// PENTING: pembatasan di sisi TAMPILAN saja (frontend),
// bukan di database.
// Semua angka di sini adalah ROLE ID (bukan jabatan_id --
// revisi dari versi sebelumnya yang keliru pakai jabatan_id).
// ===================================================
const ROLE_MAINTENANCE = 1;
const ROLE_SUPERADMIN = 2;
const ROLE_ADMIN = 3;
const ROLE_SUPERVISOR = 4;
const ROLE_ADMIN_STG = 6;
const ROLE_KARU_STG = 8;

const ROLE_FULL_ACCESS = [ROLE_MAINTENANCE, ROLE_SUPERADMIN]; // lihat semua data, semua tab, tanpa scoping
const ALLOWED_PAGE_ROLES = [ROLE_MAINTENANCE, ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ADMIN_STG, ROLE_KARU_STG];

function getCurrentUserSession() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function resolveAccess() {
    const session = getCurrentUserSession();
    const roleId = session?.roleId;
    const userNik = session?.nik;

    const isFullAccess = ROLE_FULL_ACCESS.includes(roleId);
    const isKaruStg = roleId === ROLE_KARU_STG;
    const isAdminStg = roleId === ROLE_ADMIN_STG;

    const hasPageAccess = ALLOWED_PAGE_ROLES.includes(roleId);
    const canAccessPending = isFullAccess || isKaruStg;
    const canAccessQty = isFullAccess || isAdminStg;

    // KARU STG (non-fullaccess) dibatasi hanya lihat data miliknya sendiri
    // (nik_karu = username-nya), berlaku di tab Data Hasil Borong & Pending
    const scopedToOwnKaru = isKaruStg && !isFullAccess;

    return {
        roleId, userNik,
        isFullAccess,
        hasPageAccess,
        canAccessPending,
        canAccessQty,
        scopedToOwnKaru
    };
}

function applyRoleAccess() {
    const access = resolveAccess();

    if (!access.hasPageAccess) {
        document.querySelector(".bg-tabs-wrapper").classList.add("d-none");
        document.querySelector(".bg-main").innerHTML = `
            <div class="text-center py-5" style="color: var(--bg-text-muted);">
                <i class="fa-solid fa-lock fa-2x mb-3"></i>
                <p>Anda tidak memiliki akses ke halaman ini.</p>
            </div>
        `;
        return access;
    }

    if (!access.canAccessPending) {
        document.querySelector('[data-bs-target="#tabPendingBorong"]')?.closest(".nav-item")?.classList.add("d-none");
    }
    if (!access.canAccessQty) {
        document.querySelector('[data-bs-target="#tabQtyLoading"]')?.closest(".nav-item")?.classList.add("d-none");
    }

    return access;
}

let currentAccess = null;

// ===================================================
// 2. STATE GLOBAL
// ===================================================
let referenceData = { kode_batch: [], petugas_input: [] };

let dataHasilState = { filters: { kodeBatch: [], petugasInput: [], periode: "" }, page: 1, totalRows: 0, data: [] };
let pendingState = { page: 1, totalRows: 0, data: [] };
let qtyState = { page: 1, totalRows: 0, data: [] };

// Batch yang sedang dibuka di modal, dan mode modal saat ini
let currentModalMode = null; // "datahasil" | "pending" | "qty"
let currentModalBatch = null;

// ===================================================
// 3. PERHITUNGAN PERIODE (cutoff 16-31 / 1-15)
// 16-31 = Periode 1, nama bulan = bulan tanggal itu sendiri
// 1-15  = Periode 2, nama bulan = BULAN SEBELUMNYA
// Contoh: 1-15 Agustus = Periode 2 "Juli"
// ===================================================
function getPeriodeForDate(dateObj) {
    const day = dateObj.getDate();
    let month = dateObj.getMonth() + 1; // 1-12
    let year = dateObj.getFullYear();
    let sub = 1;

    if (day <= 15) {
        sub = 2;
        month -= 1;
        if (month < 1) { month = 12; year -= 1; }
    } else {
        sub = 1;
    }
    return { year, month, sub };
}

function getPeriodeDateRange(year, month, sub) {
    let start, end;
    if (sub === 1) {
        start = new Date(year, month - 1, 16);
        end = new Date(year, month - 1, 31);
    } else {
        // Periode 2: 1-15 BULAN SESUDAHNYA dari nama bulan
        let nextMonth = month + 1, nextYear = year;
        if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
        start = new Date(nextYear, nextMonth - 1, 1);
        end = new Date(nextYear, nextMonth - 1, 15);
    }
    return { start: toIsoDate(start), end: toIsoDate(end) };
}

function toIsoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodeLabel(year, month, sub) {
    return `${NAMA_BULAN_ID[month - 1]} ${year} - Periode ${sub}`;
}

// Isi dropdown Periode: 3 bulan terakhir x 2 sub-periode = 6 opsi
function populatePeriodeOptions() {
    const select = document.getElementById("filterPeriodeDataHasil");
    if (!select) return;

    const today = new Date();
    let current = getPeriodeForDate(today);

    // Urutan mundur: mulai dari periode saat ini, mundur 6 kali (3 bulan x 2 sub)
    let year = current.year, month = current.month, sub = current.sub;

    for (let i = 0; i < 6; i++) {
        const opt = document.createElement("option");
        opt.value = `${year}-${String(month).padStart(2, "0")}-${sub}`;
        opt.textContent = periodeLabel(year, month, sub);
        select.appendChild(opt);

        if (sub === 1) {
            sub = 2;
            month -= 1;
            if (month < 1) { month = 12; year -= 1; }
        } else {
            sub = 1;
        }
    }
}

// ===================================================
// 4. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    currentAccess = applyRoleAccess();

    setupFilterToggleDataHasil();
    setupModalCommon();
    setupDownloadDataHasil();

    try {
        await loadReferenceData();
    } catch (err) {
        console.error("Gagal memuat data referensi filter:", err);
    }

    renderFieldFilterGroupsDataHasil();
    populatePeriodeOptions();

    await loadDataHasilPage();

    // Pending & Qty dimuat lazy saat tab diklik pertama kali
    let pendingLoaded = false;
    document.querySelector('[data-bs-target="#tabPendingBorong"]')?.addEventListener("shown.bs.tab", async () => {
        if (!pendingLoaded && currentAccess.canAccessPending) {
            pendingLoaded = true;
            await loadPendingPage();
        }
    });

    let qtyLoaded = false;
    document.querySelector('[data-bs-target="#tabQtyLoading"]')?.addEventListener("shown.bs.tab", async () => {
        if (!qtyLoaded && currentAccess.canAccessQty) {
            qtyLoaded = true;
            await loadQtyPage();
        }
    });

    // Buka tab tertentu otomatis kalau halaman diakses lewat link
    // berisi hash, misal dari dashboard: borong.html#tabPendingBorong
    // Dipanggil SETELAH listener shown.bs.tab di atas terpasang, supaya
    // data tab yang dituju tetap otomatis termuat (bukan cuma tabnya
    // yang pindah, tapi kosong).
    openTabFromUrlHash();
});

// Buka tab Bootstrap sesuai window.location.hash (dipanggil sekali saat load)
function openTabFromUrlHash() {
    if (!currentAccess.hasPageAccess) return; // halaman sudah diganti pesan akses ditolak

    const hash = window.location.hash; // contoh: "#tabPendingBorong"
    if (!hash) return;

    const tabButton = document.querySelector(`[data-bs-target="${hash}"]`);
    if (tabButton && !tabButton.closest(".nav-item")?.classList.contains("d-none")) {
        bootstrap.Tab.getOrCreateInstance(tabButton).show();
    }
}

// ===================================================
// 5. DATA REFERENSI FILTER (Kode Batch, Petugas Input)
// ===================================================
async function loadReferenceData() {
    const { data, error } = await supabaseClient
        .schema("stg_public")
        .rpc("get_borong_filter_options");

    if (error) {
        console.error("Gagal memuat opsi filter:", error.message);
        return;
    }

    referenceData.kode_batch = data?.kode_batch || [];
    referenceData.petugas_input = data?.petugas_input || []; // [{nik, nama}]
}

function renderFieldFilterGroupsDataHasil() {
    const container = document.getElementById("filterFieldGroupsDataHasil");
    if (!container) return;

    const kodeBatchOptions = referenceData.kode_batch.map(v => ({ value: v, label: v }));
    const petugasOptions = referenceData.petugas_input.map(p => ({ value: p.nik, label: p.nama }));

    container.innerHTML = `
        ${renderChecklistGroupHtml("kodeBatch", "Kode Batch", kodeBatchOptions)}
        ${renderChecklistGroupHtml("petugasInput", "Petugas Input", petugasOptions)}
    `;

    setupChecklistGroupBehavior("kodeBatch");
    setupChecklistGroupBehavior("petugasInput");
}

function renderChecklistGroupHtml(key, label, options) {
    const groupId = `filterGroup_${key}`;
    const searchId = `filterSearch_${key}`;
    const listId = `filterList_${key}`;
    const selected = dataHasilState.filters[key] || [];

    const items = options.map(opt => `
        <label class="filter-checkbox-item" data-search-text="${String(opt.label).toLowerCase()}">
            <input type="checkbox" value="${opt.value}" ${selected.includes(String(opt.value)) ? "checked" : ""}>
            <span>${opt.label}</span>
        </label>
    `).join("");

    return `
        <div class="filter-group">
            <button type="button" class="filter-group-header" data-target="${groupId}">
                <span>${label}</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="filter-group-body-collapsible" id="${groupId}">
                <input type="text" class="filter-inline-search" id="${searchId}" placeholder="Cari ${label.toLowerCase()}...">
                <div class="filter-checkbox-list" id="${listId}">
                    ${options.length > 0 ? items : '<span class="data-empty-cell">Tidak ada data</span>'}
                </div>
            </div>
        </div>
    `;
}

function setupChecklistGroupBehavior(key) {
    const header = document.querySelector(`[data-target="filterGroup_${key}"]`);
    const body = document.getElementById(`filterGroup_${key}`);
    if (header && body) {
        header.addEventListener("click", (e) => {
            e.stopPropagation();
            header.classList.toggle("expanded");
            body.classList.toggle("expanded");
        });
    }

    const searchInput = document.getElementById(`filterSearch_${key}`);
    const listContainer = document.getElementById(`filterList_${key}`);
    if (searchInput && listContainer) {
        searchInput.addEventListener("input", () => {
            const keyword = searchInput.value.trim().toLowerCase();
            listContainer.querySelectorAll(".filter-checkbox-item").forEach(item => {
                const text = item.getAttribute("data-search-text") || "";
                item.style.display = text.includes(keyword) ? "flex" : "none";
            });
        });
        searchInput.addEventListener("click", (e) => e.stopPropagation());
    }
}

// ===================================================
// 6. FILTER PANEL: toggle, apply, reset (Data Hasil Borong)
// ===================================================
function setupFilterToggleDataHasil() {
    const btnToggle = document.getElementById("btnFilterToggleDataHasil");
    const panel = document.getElementById("filterPanelDataHasil");
    if (!btnToggle || !panel) return;

    btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("d-none");
    });
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && !btnToggle.contains(e.target)) {
            panel.classList.add("d-none");
        }
    });

    document.getElementById("btnFilterApplyDataHasil").addEventListener("click", () => {
        dataHasilState.filters.kodeBatch = getCheckedValues("filterList_kodeBatch");
        dataHasilState.filters.petugasInput = getCheckedValues("filterList_petugasInput");
        dataHasilState.filters.periode = document.getElementById("filterPeriodeDataHasil").value;

        dataHasilState.page = 1;
        updateFilterBadgeDataHasil();
        panel.classList.add("d-none");
        loadDataHasilPage();
    });

    document.getElementById("btnFilterResetDataHasil").addEventListener("click", () => {
        document.querySelectorAll("#filterFieldGroupsDataHasil input[type='checkbox']").forEach(cb => cb.checked = false);
        document.getElementById("filterPeriodeDataHasil").value = "";
        dataHasilState.filters = { kodeBatch: [], petugasInput: [], periode: "" };
        dataHasilState.page = 1;
        updateFilterBadgeDataHasil();
        loadDataHasilPage();
    });
}

function getCheckedValues(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return [];
    return Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function updateFilterBadgeDataHasil() {
    const f = dataHasilState.filters;
    let total = f.kodeBatch.length + f.petugasInput.length + (f.periode ? 1 : 0);
    const badge = document.getElementById("filterCountBadgeDataHasil");
    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

// ===================================================
// 7. HELPER: format tanggal, shift
// ===================================================
function formatTanggal(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function formatShift(val) {
    return SHIFT_LABELS[String(val)] || val || "-";
}

// Format angka dengan separator ribuan (titik, gaya Indonesia).
// Mengembalikan null/undefined apa adanya supaya pemanggil tetap bisa
// pakai fallback "data-empty-cell" seperti biasa.
function formatAngka(val) {
    if (val === null || val === undefined || val === "") return val;
    const num = Number(val);
    if (isNaN(num)) return val;
    return num.toLocaleString("id-ID");
}

// Terapkan sorting standar ke semua query: tanggal_bstb desc, lalu shift_sort asc
function applyStandardSort(query) {
    return query.order("tanggal_bstb", { ascending: false }).order("shift_sort", { ascending: true });
}

// Update badge angka di tab Pending / Qty
function updateCountBadge(badgeId, count) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

// ===================================================
// 8. TAB DATA HASIL BORONG
// ===================================================
async function loadDataHasilPage() {
    const tbody = document.getElementById("dataHasilTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("*", { count: "exact" })
            .ilike("status", "%approved%");

        // KARU STG (non-fullaccess) hanya lihat data miliknya sendiri
        if (currentAccess.scopedToOwnKaru && currentAccess.userNik) {
            query = query.eq("nik_karu", currentAccess.userNik);
        }

        const f = dataHasilState.filters;
        if (f.kodeBatch.length > 0) query = query.in("no_batch", f.kodeBatch);
        if (f.petugasInput.length > 0) query = query.in("nik_input", f.petugasInput);

        if (f.periode) {
            const [py, pm, ps] = f.periode.split("-").map(Number);
            const range = getPeriodeDateRange(py, pm, ps);
            query = query.gte("tanggal_bstb", range.start).lte("tanggal_bstb", range.end);
        } else {
            // Default: cuma periode TERBARU
            const today = new Date();
            const cur = getPeriodeForDate(today);
            const range = getPeriodeDateRange(cur.year, cur.month, cur.sub);
            query = query.gte("tanggal_bstb", range.start).lte("tanggal_bstb", range.end);
        }

        query = applyStandardSort(query);

        const start = (dataHasilState.page - 1) * ROWS_PER_PAGE;
        query = query.range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        dataHasilState.data = data || [];
        dataHasilState.totalRows = count || 0;

        renderTableGeneric("dataHasilTableBody", dataHasilState.data, dataHasilState.page, true, "datahasil");
        renderPagination("dataHasilPagination", dataHasilState, loadDataHasilPage);

    } catch (err) {
        console.error("Gagal memuat data hasil borong:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 9. TAB PENDING
// ===================================================
async function loadPendingPage() {
    const tbody = document.getElementById("pendingBorongTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("*", { count: "exact" })
            .not("status", "ilike", "%approved%") // hilang untuk SEMUA role begitu approved
            .eq("has_kosong_loading_corrugator", false); // qty loading/corrugator harus sudah lengkap

        // KARU STG (non-fullaccess) hanya lihat data miliknya sendiri
        if (currentAccess.scopedToOwnKaru && currentAccess.userNik) {
            query = query.eq("nik_karu", currentAccess.userNik);
        }

        query = applyStandardSort(query);

        const start = (pendingState.page - 1) * ROWS_PER_PAGE;
        query = query.range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        pendingState.data = data || [];
        pendingState.totalRows = count || 0;

        renderTableGeneric("pendingBorongTableBody", pendingState.data, pendingState.page, false, "pending");
        renderPagination("pendingBorongPagination", pendingState, loadPendingPage);
        updateCountBadge("pendingCountBadgeBorong", pendingState.totalRows);

    } catch (err) {
        console.error("Gagal memuat data pending:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 10. TAB QTY LOADING & CORRUGATOR
// ===================================================
async function loadQtyPage() {
    const tbody = document.getElementById("qtyLoadingTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("*", { count: "exact" })
            .eq("has_loading_corrugator", true);

        // Aturan per role:
        // - Full access (Maintenance/Superadmin): tampil selama status_payroll belum Close
        // - Admin STG: HANYA tampil kalau qty loading/corrugator masih kosong
        if (currentAccess.isFullAccess) {
            query = query.ilike("status_payroll", "%open%");
        } else {
            query = query.eq("has_kosong_loading_corrugator", true);
        }

        // Urutan: yang qty-nya masih kosong ditaruh PALING ATAS,
        // baru diurutkan tanggal terbaru -> shift custom (sesuai standar)
        query = query
            .order("has_kosong_loading_corrugator", { ascending: false })
            .order("tanggal_bstb", { ascending: false })
            .order("shift_sort", { ascending: true });

        const start = (qtyState.page - 1) * ROWS_PER_PAGE;
        query = query.range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        qtyState.data = data || [];
        qtyState.totalRows = count || 0;

        renderTableGeneric("qtyLoadingTableBody", qtyState.data, qtyState.page, false, "qty");
        renderPagination("qtyLoadingPagination", qtyState, loadQtyPage);
        updateCountBadge("qtyCountBadgeBorong", qtyState.totalRows);

    } catch (err) {
        console.error("Gagal memuat data qty loading:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 11. RENDER TABEL UTAMA (generik untuk 3 tab)
// ===================================================
function renderTableGeneric(tbodyId, rows, page, showStatusPayroll, mode) {
    const tbody = document.getElementById(tbodyId);
    const colspan = showStatusPayroll ? 8 : 7;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="${colspan}">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = rows.map((row, index) => {
        const statusPayrollCell = showStatusPayroll ? `
            <td><span class="badge-status ${(row.status_payroll || '').toLowerCase() === 'open' ? 'badge-open' : 'badge-close'}">${row.status_payroll || '-'}</span></td>
        ` : "";

        return `
            <tr class="row-clickable" data-id="${row.id}">
                <td class="col-no">${start + index + 1}</td>
                <td>${row.no_batch || "-"}</td>
                <td>${row.grup_kerja || '<span class="data-empty-cell">-</span>'}</td>
                <td>${formatTanggal(row.tanggal_bstb) || '<span class="data-empty-cell">-</span>'}</td>
                <td>${formatShift(row.shift)}</td>
                <td>${row.nama_input || '<span class="data-empty-cell">-</span>'}</td>
                <td>${row.nama_karu || '<span class="data-empty-cell">-</span>'}</td>
                ${statusPayrollCell}
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(tr => {
        tr.addEventListener("click", () => {
            const id = tr.getAttribute("data-id");
            const row = rows.find(r => String(r.id) === String(id));
            openDetailModal(row, mode);
        });
    });
}

// ===================================================
// 12. PAGINATION (generik untuk 3 tab)
// ===================================================
function renderPagination(containerId, state, reloadFn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);
    if (totalPages <= 1) { container.innerHTML = ""; return; }

    let html = `<button class="pagination-btn" data-nav="prev" ${state.page === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>`;

    const maxVisible = 7;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === state.page ? "active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class="pagination-btn" data-nav="next" ${state.page === totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>`;

    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.getAttribute("data-page")); reloadFn(); });
    });
    const prevBtn = container.querySelector('[data-nav="prev"]');
    const nextBtn = container.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.onclick = () => { if (state.page > 1) { state.page--; reloadFn(); } };
    if (nextBtn) nextBtn.onclick = () => { if (state.page < totalPages) { state.page++; reloadFn(); } };
}

// ===================================================
// 13. MODAL DETAIL -- ambil data mentah + gabung manual di JS
// ===================================================
async function openDetailModal(batchRow, mode) {
    currentModalMode = mode;
    currentModalBatch = batchRow;

    document.getElementById("modalBatchId").value = batchRow.id;
    document.getElementById("modalInfoKodeBatch").textContent = batchRow.no_batch || "-";
    document.getElementById("modalInfoTanggal").textContent = formatTanggal(batchRow.tanggal_bstb) || "-";
    document.getElementById("modalInfoPetugas").textContent = batchRow.nama_input || "-";
    document.getElementById("modalInfoKaru").textContent = batchRow.nama_karu || "-";

    document.getElementById("modalDetailTitle").textContent =
        mode === "pending" ? "Detail Batch - Approval" :
        mode === "qty" ? "Detail Batch - Input Qty" : "Detail Batch";

    // Ambil data mentah borong_artikel & borong_employee untuk batch ini
    const [artikelRes, employeeRes] = await Promise.all([
        supabaseClient.schema("stg_public").from("borong_artikel").select("*").eq("batch_id", batchRow.id),
        supabaseClient.schema("stg_public").from("borong_employee").select("*").eq("batch_id", batchRow.id)
    ]);

    const artikelRows = artikelRes.data || [];
    const employeeRowsRaw = employeeRes.data || [];

    // Gabungkan manual: nama_barang/customer dari stg_public.artikel,
    // nama_pekerjaan & satuan dari stg_public.harga_borong (ambil 1
    // baris representatif per kode_pekerjaan -- lihat catatan di bawah)
    const kodeArtikelList = [...new Set(artikelRows.map(a => a.kode_artikel).filter(Boolean))];
    const kodePekerjaanList = [...new Set(artikelRows.map(a => a.kode_pekerjaan).filter(Boolean))];

    const [artikelMasterRes, hargaBorongRes] = await Promise.all([
        kodeArtikelList.length > 0
            ? supabaseClient.schema("stg_public").from("artikel").select("kode_artikel, nama_barang, customer").in("kode_artikel", kodeArtikelList)
            : Promise.resolve({ data: [] }),
        kodePekerjaanList.length > 0
            ? supabaseClient.schema("stg_public").from("harga_borong").select("kode_pekerjaan, nama_pekerjaan, satuan").in("kode_pekerjaan", kodePekerjaanList)
            : Promise.resolve({ data: [] })
    ]);

    const artikelMaster = artikelMasterRes.data || [];
    // Catatan: kode_pekerjaan BUKAN unik di harga_borong (bisa >1 baris
    // per kode, beda varian harga). Untuk label Jenis Pekerjaan & Satuan
    // di sini cukup ambil SATU baris representatif (yang pertama ketemu) --
    // nama_pekerjaan konsisten antar varian, tapi satuan idealnya
    // dipastikan konsisten juga; kalau ternyata beda-beda per varian,
    // nilai yang tampil di sini cuma perkiraan terbaik, bukan otoritatif
    // (perhitungan harga sesungguhnya tetap domain modul Payroll).
    const hargaPekerjaanMap = {};
    (hargaBorongRes.data || []).forEach(hb => {
        if (!hargaPekerjaanMap[hb.kode_pekerjaan]) hargaPekerjaanMap[hb.kode_pekerjaan] = hb;
    });

    const enrichedArtikel = artikelRows.map(ba => {
        const master = artikelMaster.find(a => a.kode_artikel === ba.kode_artikel);
        const hb = hargaPekerjaanMap[ba.kode_pekerjaan];
        return {
            ...ba,
            nama_barang: master?.nama_barang || null,
            customer: master?.customer || null,
            nama_pekerjaan: hb?.nama_pekerjaan || ba.kode_pekerjaan || "-",
            satuan: hb?.satuan || null
        };
    });

    // Gabungkan employee dengan nama & bagian
    const nikList = [...new Set(employeeRowsRaw.map(e => e.employee_id).filter(Boolean))];
    let employeeMaster = [];
    if (nikList.length > 0) {
        const { data: empData } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .select("id, nik_karyawan, nama")
            .in("nik_karyawan", nikList);
        employeeMaster = empData || [];

        const empIds = employeeMaster.map(e => e.id);
        if (empIds.length > 0) {
            const { data: assignData } = await supabaseClient
                .schema("hrd")
                .from("employee_assignments")
                .select("employee_id, bagian_id")
                .in("employee_id", empIds)
                .eq("is_active", true);

            const bagianIds = [...new Set((assignData || []).map(a => a.bagian_id).filter(Boolean))];
            let bagianMaster = [];
            if (bagianIds.length > 0) {
                const { data: bgData } = await supabaseClient.from("bagians").select("id, bagian_name").in("id", bagianIds);
                bagianMaster = bgData || [];
            }

            employeeMaster = employeeMaster.map(e => {
                const assign = (assignData || []).find(a => a.employee_id === e.id);
                const bagian = bagianMaster.find(b => b.id === assign?.bagian_id);
                return { ...e, bagian: bagian?.bagian_name || null };
            });
        }
    }

    const enrichedEmployee = employeeRowsRaw.map(be => {
        const master = employeeMaster.find(e => e.nik_karyawan === be.employee_id);
        return {
            ...be,
            nama: master?.nama || null,
            bagian: master?.bagian || null
        };
    });

    renderModalArtikelTable(enrichedArtikel, mode);
    renderModalEmployeeTable(enrichedArtikel, enrichedEmployee, batchRow.grup_kerja, mode);
    renderModalFooter(mode, batchRow);

    const modalInstance = bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetailBatch"));
    modalInstance.show();
}

// ===================================================
// 14. RENDER TABEL ARTIKEL DI MODAL
// ===================================================
function renderModalArtikelTable(artikelRows, mode) {
    const container = document.getElementById("modalArtikelTableContainer");
    const showExtra = mode === "datahasil"; // Harga Borong & Total Harga cuma di tab Data Hasil Borong
    const editableQty = mode === "qty";

    let headHtml = `
        <th>No</th><th>Jenis Pekerjaan</th><th>Kode Artikel</th><th>Nama Barang</th><th>Customer</th>
        ${showExtra ? "<th>Harga Borong</th>" : ""}
        <th>Qty</th><th>Satuan</th>
        ${showExtra ? "<th>Total Harga</th>" : ""}
        <th>Half Proses</th>
    `;

    let bodyHtml = artikelRows.map((a, i) => {
        const isLoadingCorrugator = ["loading", "corrugator"].includes((a.grup_kerja || "").toLowerCase());
        const qtyCell = (editableQty && isLoadingCorrugator)
            ? `<input type="number" class="modal-qty-input" data-artikel-id="${a.id}" value="${a.qty ?? ''}">`
            : (formatAngka(a.qty) ?? '<span class="data-empty-cell">-</span>');

        const hargaBorongHitung = (a.qty && a.total_harga) ? formatAngka((a.total_harga / a.qty).toFixed(2)) : "-";

        return `
            <tr>
                <td>${i + 1}</td>
                <td>${a.nama_pekerjaan || "-"}</td>
                <td>${a.kode_artikel || '<span class="data-empty-cell">-</span>'}</td>
                <td>${a.nama_barang || '<span class="data-empty-cell">-</span>'}</td>
                <td>${a.customer || '<span class="data-empty-cell">-</span>'}</td>
                ${showExtra ? `<td>${hargaBorongHitung}</td>` : ""}
                <td>${qtyCell}</td>
                <td>${a.satuan || '<span class="data-empty-cell">-</span>'}</td>
                ${showExtra ? `<td>${formatAngka(a.total_harga) ?? '<span class="data-empty-cell">-</span>'}</td>` : ""}
                <td class="text-center">${a.is_half_proses ? '<i class="fa-solid fa-check text-success"></i>' : "-"}</td>
            </tr>
        `;
    }).join("");

    container.innerHTML = `
        <table class="modal-detail-table">
            <thead><tr>${headHtml}</tr></thead>
            <tbody>${bodyHtml || '<tr><td colspan="10" class="text-center text-muted">Tidak ada data artikel.</td></tr>'}</tbody>
        </table>
    `;
}

// ===================================================
// 15. RENDER TABEL EMPLOYEE DI MODAL
// Manual = matrix (kolom per POSISI baris artikel dalam batch)
// Selain Manual = tabel standar dengan kolom Ketua Grup
// ===================================================
function renderModalEmployeeTable(artikelRows, employeeRows, grupKerjaBatch, mode) {
    const container = document.getElementById("modalEmployeeTableContainer");
    const showUpah = mode === "datahasil";

    // Kumpulkan NIK unik (urutan kemunculan pertama dipertahankan)
    const uniqueNiks = [...new Set(employeeRows.map(e => e.employee_id))];

    if ((grupKerjaBatch || "").toLowerCase() === "manual") {
        // --- MATRIX: kolom = posisi baris artikel dalam batch ---
        let headHtml = `<th>No</th>${showUpah ? "<th>Upah</th>" : ""}<th>No Absen</th><th>Nama</th><th>Bagian</th>`;
        artikelRows.forEach((a, idx) => {
            headHtml += `<th>Kode Artikel ${idx + 1}</th>`;
        });

        let bodyHtml = uniqueNiks.map((nik, index) => {
            const empRowsForNik = employeeRows.filter(e => e.employee_id === nik);
            const sample = empRowsForNik[0];

            let cells = "";
            artikelRows.forEach(a => {
                const match = empRowsForNik.find(e => e.borong_artikel_id === a.id);
                cells += `<td class="text-center">${match ? (formatAngka(match.qty) ?? '<span class="data-empty-cell">-</span>') : "-"}</td>`;
            });

            const upahCell = showUpah ? `<td>${formatAngka(sample.upah_borong) ?? '<span class="data-empty-cell">-</span>'}</td>` : "";

            return `
                <tr>
                    <td>${index + 1}</td>
                    ${upahCell}
                    <td>${nik}</td>
                    <td>${sample.nama || '<span class="data-empty-cell">-</span>'}</td>
                    <td>${sample.bagian || '<span class="data-empty-cell">-</span>'}</td>
                    ${cells}
                </tr>
            `;
        }).join("");

        container.innerHTML = `
            <table class="modal-detail-table">
                <thead><tr>${headHtml}</tr></thead>
                <tbody>${bodyHtml || '<tr><td colspan="10" class="text-center text-muted">Tidak ada data karyawan.</td></tr>'}</tbody>
            </table>
        `;
    } else {
        // --- STANDAR: Corrugator, Loading, Grup ---
        let headHtml = `<th>No</th>${showUpah ? "<th>Upah</th>" : ""}<th>No Absen</th><th>Nama</th><th>Bagian</th><th>Ketua Grup</th>`;

        let bodyHtml = uniqueNiks.map((nik, index) => {
            const emp = employeeRows.find(e => e.employee_id === nik);
            const upahCell = showUpah ? `<td>${formatAngka(emp.upah_borong) ?? '<span class="data-empty-cell">-</span>'}</td>` : "";

            return `
                <tr>
                    <td>${index + 1}</td>
                    ${upahCell}
                    <td>${nik}</td>
                    <td>${emp.nama || '<span class="data-empty-cell">-</span>'}</td>
                    <td>${emp.bagian || '<span class="data-empty-cell">-</span>'}</td>
                    <td class="text-center">${emp.is_head ? '<i class="fa-solid fa-check text-success"></i>' : "-"}</td>
                </tr>
            `;
        }).join("");

        container.innerHTML = `
            <table class="modal-detail-table">
                <thead><tr>${headHtml}</tr></thead>
                <tbody>${bodyHtml || '<tr><td colspan="6" class="text-center text-muted">Tidak ada data karyawan.</td></tr>'}</tbody>
            </table>
        `;
    }
}

// ===================================================
// 16. FOOTER MODAL -- tombol berbeda per mode
// ===================================================
function renderModalFooter(mode, batchRow) {
    const footer = document.getElementById("modalDetailFooter");

    if (mode === "pending") {
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>
            <button type="button" class="btn btn-danger" id="btnRejectBatch">
                <i class="fa-solid fa-xmark me-1"></i> Reject
            </button>
            <button type="button" class="btn btn-success" id="btnApproveBatch">
                <i class="fa-solid fa-check me-1"></i> Approve
            </button>
        `;
        document.getElementById("btnApproveBatch").addEventListener("click", () => handleApprovalBatch(batchRow.id, "Approved"));
        document.getElementById("btnRejectBatch").addEventListener("click", () => handleApprovalBatch(batchRow.id, "Rejected"));
    } else if (mode === "qty") {
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>
            <button type="button" class="btn btn-primary" id="btnSimpanQty">
                <i class="fa-solid fa-floppy-disk me-1"></i> Simpan Qty
            </button>
        `;
        document.getElementById("btnSimpanQty").addEventListener("click", handleSimpanQty);
    } else {
        footer.innerHTML = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>`;
    }
}

// ===================================================
// 17. AKSI: Approve/Reject (tab Pending)
// ===================================================
async function handleApprovalBatch(batchId, newStatus) {
    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("borong_batch")
            .update({ status: newStatus, approved_by: currentAccess.userNik, approved_at: new Date().toISOString() })
            .eq("id", batchId);

        if (error) throw error;

        bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetailBatch")).hide();
        await loadPendingPage();

    } catch (err) {
        console.error("Gagal memproses approval:", err);
        alert("Gagal memproses approval: " + err.message);
    }
}

// ===================================================
// 18. AKSI: Simpan Qty (tab Qty Loading & Corrugator)
// ===================================================
async function handleSimpanQty() {
    const btn = document.getElementById("btnSimpanQty");
    const qtyInputs = document.querySelectorAll("#modalArtikelTableContainer .modal-qty-input");

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
        for (const input of qtyInputs) {
            const artikelId = input.getAttribute("data-artikel-id");
            const qtyVal = input.value.trim() === "" ? null : parseFloat(input.value);

            const { error } = await supabaseClient
                .schema("stg_public")
                .from("borong_artikel")
                .update({ qty: qtyVal })
                .eq("id", artikelId);

            if (error) throw error;
        }

        bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetailBatch")).hide();
        await loadQtyPage();

    } catch (err) {
        console.error("Gagal menyimpan qty:", err);
        alert("Gagal menyimpan qty: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Simpan Qty`;
    }
}

// ===================================================
// 19. SETUP MODAL UMUM (reset saat ditutup)
// ===================================================
function setupModalCommon() {
    document.getElementById("modalDetailBatch").addEventListener("hidden.bs.modal", () => {
        currentModalMode = null;
        currentModalBatch = null;
        document.getElementById("modalArtikelTableContainer").innerHTML = "";
        document.getElementById("modalEmployeeTableContainer").innerHTML = "";
    });
}

// ===================================================
// 20. DOWNLOAD EXCEL (tab Data Hasil Borong) -- ambil
// SELURUH data sesuai filter aktif, TIDAK dibatasi
// pagination 100 baris. Sumber: borong_report_per_pekerja.
// ===================================================
function setupDownloadDataHasil() {
    const btn = document.getElementById("btnDownloadDataHasil");
    if (btn) btn.addEventListener("click", handleDownloadDataHasil);
}

async function handleDownloadDataHasil() {
    const btn = document.getElementById("btnDownloadDataHasil");
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Menyiapkan...</span>`;

    try {
        // 1. Tentukan rentang tanggal periode yang sedang aktif (sama
        // seperti logika tampilan tabel: filter eksplisit, atau default
        // periode terbaru)
        const f = dataHasilState.filters;
        let dateRange;
        if (f.periode) {
            const [py, pm, ps] = f.periode.split("-").map(Number);
            dateRange = getPeriodeDateRange(py, pm, ps);
        } else {
            const today = new Date();
            const cur = getPeriodeForDate(today);
            dateRange = getPeriodeDateRange(cur.year, cur.month, cur.sub);
        }

        // 2. Ambil daftar no_batch yang sesuai filter+periode+status dari
        // borong_batch_view dulu (supaya bisa filter kodeBatch/petugasInput/
        // scoping KARU yang tidak ada di borong_report_per_pekerja)
        let batchQuery = supabaseClient
            .schema("stg_public")
            .from("borong_batch_view")
            .select("no_batch")
            .ilike("status", "%approved%")
            .gte("tanggal_bstb", dateRange.start)
            .lte("tanggal_bstb", dateRange.end);

        if (currentAccess.scopedToOwnKaru && currentAccess.userNik) {
            batchQuery = batchQuery.eq("nik_karu", currentAccess.userNik);
        }
        if (f.kodeBatch.length > 0) batchQuery = batchQuery.in("no_batch", f.kodeBatch);
        if (f.petugasInput.length > 0) batchQuery = batchQuery.in("nik_input", f.petugasInput);

        const { data: batchRows, error: batchErr } = await batchQuery;
        if (batchErr) throw batchErr;

        const noBatchList = [...new Set((batchRows || []).map(b => b.no_batch))];

        if (noBatchList.length === 0) {
            alert("Tidak ada data untuk diunduh sesuai filter yang aktif.");
            return;
        }

        // 3. Ambil seluruh baris report untuk daftar no_batch itu.
        // TIDAK pakai .range() -- sengaja tanpa batas pagination,
        // sesuai permintaan (download tidak terpengaruh limit 100 baris).
        // Supabase/PostgREST tetap punya batas default per-request (1000
        // baris), jadi diambil bertahap per 1000 kalau datanya besar.
        let allRows = [];
        let batchStart = 0;
        const CHUNK = 1000;
        while (true) {
            const { data: chunkData, error: chunkErr } = await supabaseClient
                .schema("stg_public")
                .from("borong_report_per_pekerja")
                .select("*")
                .in("kode_batch", noBatchList)
                .range(batchStart, batchStart + CHUNK - 1);

            if (chunkErr) throw chunkErr;
            allRows = allRows.concat(chunkData || []);

            if (!chunkData || chunkData.length < CHUNK) break;
            batchStart += CHUNK;
        }

        if (allRows.length === 0) {
            alert("Tidak ada data untuk diunduh sesuai filter yang aktif.");
            return;
        }

        // 4. Susun ke format Excel sesuai kolom yang diminta
        const exportData = allRows.map(r => ({
            "Kode Batch": r.kode_batch,
            "Tanggal": formatTanggal(r.tanggal),
            "Shift": formatShift(r.shift),
            "Jenis Pekerjaan": r.jenis_pekerjaan,
            "Kode Pekerjaan": r.kode_pekerjaan,
            "Kode Artikel": r.kode_artikel,
            "Qty": r.qty,
            "No Absen": r.no_absen,
            "Grup Kerja": r.grup_kerja
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Data Hasil Borong");

        const namaFile = `Laporan_Hasil_Borong_${toIsoDate(new Date())}.xlsx`;
        XLSX.writeFile(wb, namaFile);

    } catch (err) {
        console.error("Gagal download data hasil borong:", err);
        alert("Gagal menyiapkan file download: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
>>>>>>> 3d00068 (Initial commit Web ERP)
}