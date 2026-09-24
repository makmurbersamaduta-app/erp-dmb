<<<<<<< HEAD
// ===================================================
// js/module/operations/stg/artikel.js
// Halaman Database Artikel (stg_public.artikel)
// ===================================================

const supabaseClient = window.supabaseClient;

// ===================================================
// 1. STATE GLOBAL
// ===================================================
let referenceData = {
    customers: [],
    flutes: [],
    tipePartisis: [],
    joints: [],
    itemTypes: []
};

let activeFilters = {
    customer: [],
    flute: [],
    tipe_partisi: [],
    joint: [],
    item_type: []
};

let searchKeyword = "";
let currentPage = 1;
let totalRows = 0;
const ROWS_PER_PAGE = 100;

let currentPageData = [];

// ===================================================
// 2. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupSearchInput();
    setupFilterToggle();
    setupColumnToggle();
    setupEditModal();
    setupDeleteAction();

    // Menggunakan try-catch agar kegagalan ref data tidak memutus render tabel/panel
    try {
        await loadReferenceData();
    } catch (err) {
        console.error("Gagal memuat data referensi filter:", err);
    }

    renderFilterPanel();
    initColumnPanel();
    await loadArtikelPage();
});

// ===================================================
// 3. DATA REFERENSI UNTUK ISI FILTER
// ===================================================
async function loadReferenceData() {
    if (!supabaseClient) return;

    const [customerRes, fluteRes, tipePartisiRes, jointRes, itemTypeRes] = await Promise.all([
        supabaseClient.schema("stg_public").from("artikel").select("customer"),
        supabaseClient.schema("stg_public").from("artikel").select("flute"),
        supabaseClient.schema("stg_public").from("artikel").select("tipe_partisi"),
        supabaseClient.schema("stg_public").from("artikel").select("joint"),
        supabaseClient.schema("stg_public").from("artikel").select("item_type")
    ]);

    referenceData.customers = extractUniqueValues(customerRes.data, "customer");
    referenceData.flutes = extractUniqueValues(fluteRes.data, "flute");
    referenceData.tipePartisis = extractUniqueValues(tipePartisiRes.data, "tipe_partisi");
    referenceData.joints = extractUniqueValues(jointRes.data, "joint");
    referenceData.itemTypes = extractUniqueValues(itemTypeRes.data, "item_type");
}

function extractUniqueValues(rows, columnName) {
    if (!rows || !Array.isArray(rows)) return [];
    const values = rows
        .map(r => r[columnName])
        .filter(v => v !== null && v !== undefined && String(v).trim() !== "");
    return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

// ===================================================
// 4. AMBIL DATA HALAMAN AKTIF (SERVER-SIDE PAGINATION)
// ===================================================
async function loadArtikelPage() {
    const tbody = document.getElementById("artikelTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr class="row-loading"><td colspan="15"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("artikel")
            .select("*", { count: "exact" });

        if (searchKeyword) {
            query = query.ilike("kode_artikel", `%${searchKeyword}%`);
        }

        if (activeFilters.customer.length > 0) query = query.in("customer", activeFilters.customer);
        if (activeFilters.flute.length > 0) query = query.in("flute", activeFilters.flute);
        if (activeFilters.tipe_partisi.length > 0) query = query.in("tipe_partisi", activeFilters.tipe_partisi);
        if (activeFilters.joint.length > 0) query = query.in("joint", activeFilters.joint);
        if (activeFilters.item_type.length > 0) query = query.in("item_type", activeFilters.item_type);

        const start = (currentPage - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("kode_artikel").range(start, end);

        const { data, error, count } = await query;

        if (error) throw error;

        currentPageData = data || [];
        totalRows = count || 0;

        renderTable();
        renderPagination();

    } catch (err) {
        console.error("Gagal memuat data artikel:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="15">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 5. SEARCH
// ===================================================
function setupSearchInput() {
    const input = document.getElementById("inputSearch");
    if (!input) return;

    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchKeyword = input.value.trim();
            currentPage = 1;
            loadArtikelPage();
        }, 350);
    });
}

// ===================================================
// 6. FILTER PANEL & DROPDOWN TOGGLE
// ===================================================
function setupFilterToggle() {
    const btnToggle = document.getElementById("btnFilterToggle");
    const panel = document.getElementById("filterPanel");

    if (!btnToggle || !panel) return;

    // Toggle tampilan panel filter saat tombol Filter diklik
    btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("d-none");
    });

    // Tutup panel jika diklik di luar area tombol dan panel
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && !btnToggle.contains(e.target)) {
            panel.classList.add("d-none");
        }
    });

    // Toggle expand/collapse untuk tiap kategori filter
    document.querySelectorAll(".filter-group-header").forEach(header => {
        header.addEventListener("click", (e) => {
            e.stopPropagation();
            const targetId = header.getAttribute("data-target");
            const body = document.getElementById(targetId);
            if (body) {
                header.classList.toggle("expanded");
                body.classList.toggle("expanded");
            }
        });
    });

    // Tombol Reset Filter
    const btnReset = document.getElementById("btnFilterReset");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            activeFilters = { customer: [], flute: [], tipe_partisi: [], joint: [], item_type: [] };
            renderFilterPanel();
            currentPage = 1;
            loadArtikelPage();
            updateFilterBadge();
        });
    }

    // Tombol Terapkan Filter
    const btnApply = document.getElementById("btnFilterApply");
    if (btnApply) {
        btnApply.addEventListener("click", () => {
            activeFilters.customer = getCheckedValues("filterCustomer");
            activeFilters.flute = getCheckedValues("filterFlute");
            activeFilters.tipe_partisi = getCheckedValues("filterTipePartisi");
            activeFilters.joint = getCheckedValues("filterJoint");
            activeFilters.item_type = getCheckedValues("filterItemType");

            currentPage = 1;
            loadArtikelPage();
            panel.classList.add("d-none");
            updateFilterBadge();
        });
    }
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
    if (!badge) return;

    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

function renderFilterPanel() {
    renderFilterGroup("filterCustomer", referenceData.customers, "customer");
    renderFilterGroup("filterFlute", referenceData.flutes, "flute");
    renderFilterGroup("filterTipePartisi", referenceData.tipePartisis, "tipe_partisi");
    renderFilterGroup("filterJoint", referenceData.joints, "joint");
    renderFilterGroup("filterItemType", referenceData.itemTypes, "item_type");
}

function renderFilterGroup(containerId, values, filterKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!values || values.length === 0) {
        container.innerHTML = `<span class="data-empty-cell p-2 d-block">Tidak ada data</span>`;
        return;
    }

    const currentActive = activeFilters[filterKey] || [];

    container.innerHTML = values.map(val => {
        const isChecked = currentActive.includes(String(val)) ? "checked" : "";
        return `
            <label class="filter-checkbox-item">
                <input type="checkbox" value="${val}" ${isChecked}>
                <span>${val}</span>
            </label>
        `;
    }).join("");
}

// ===================================================
// 7. RENDER TABEL
// ===================================================
function renderTable() {
    const tbody = document.getElementById("artikelTableBody");
    if (!tbody) return;

    if (currentPageData.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="16">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (currentPage - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = currentPageData.map((a, index) => {
        const nomorUrut = start + index + 1;
        return `
            <tr data-id="${a.id}">
                <td class="col-no">${nomorUrut}</td>
                <td data-col="kode_artikel">${a.kode_artikel || '-'}</td>
                <td data-col="nama_barang">${a.nama_barang || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="customer">${a.customer || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="flute">${a.flute || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="width">${a.width ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="length">${a.length ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="panjang_box">${a.panjang_box ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="lebar_box">${a.lebar_box ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="tinggi_box">${a.tinggi_box ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="tipe_partisi">${a.tipe_partisi || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="joint">${a.joint || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="pcs_pallet">${a.pcs_pallet ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="item_type">${a.item_type || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="wrapping_ml">${a.wrapping_ml ?? '<span class="data-empty-cell">-</span>'}</td>
                <td class="col-aksi">
                    <button type="button" class="btn-row-action btn-row-edit" data-action="edit" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" class="btn-row-action btn-row-delete" data-action="delete" title="Hapus">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    applyColumnVisibility();
}

// ===================================================
// 8. PAGINATION
// ===================================================
function renderPagination() {
    let container = document.getElementById("artikelPagination");

    if (!container) {
        container = document.createElement("div");
        container.id = "artikelPagination";
        container.className = "art-pagination";
        const main = document.querySelector(".art-main");
        if (main) main.appendChild(container);
    }

    const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE);

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `<button class="pagination-btn" id="pagePrev" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
    </button>`;

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
            currentPage = parseInt(btn.getAttribute("data-page"));
            loadArtikelPage();
        });
    });

    const prevBtn = document.getElementById("pagePrev");
    const nextBtn = document.getElementById("pageNext");
    if (prevBtn) prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadArtikelPage(); } };
    if (nextBtn) nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; loadArtikelPage(); } };
}

// ===================================================
// 9. ATUR KOLOM (tampil/sembunyi kolom tabel)
// ===================================================
let visibleColumns = new Set(); // diisi semua data-col saat init (default semua terlihat)

function initColumnPanel() {
    // Ambil daftar kolom dari <th data-col="..."> di thead
    const thElements = document.querySelectorAll("thead th[data-col]");
    const panelBody = document.getElementById("columnPanelBody");
    if (!panelBody) return;

    let html = "";
    thElements.forEach(th => {
        const colKey = th.getAttribute("data-col");
        const label = th.textContent.trim();
        visibleColumns.add(colKey); // default: semua kolom terlihat
        html += `
            <label class="column-checkbox-item">
                <input type="checkbox" value="${colKey}" checked>
                <span>${label}</span>
            </label>
        `;
    });
    panelBody.innerHTML = html;
}

function setupColumnToggle() {
    const btnToggle = document.getElementById("btnColumnToggle");
    const panel = document.getElementById("columnPanel");
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

    const btnApply = document.getElementById("btnColumnApply");
    if (btnApply) {
        btnApply.addEventListener("click", () => {
            const checkboxes = document.querySelectorAll("#columnPanelBody input[type='checkbox']");
            visibleColumns = new Set(
                Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value)
            );
            applyColumnVisibility();
            panel.classList.add("d-none");
        });
    }
}

// Terapkan tampil/sembunyi ke <th> DAN <td> yang sedang ada di DOM,
// dipanggil ulang tiap kali tabel di-render (data berganti halaman/filter)
function applyColumnVisibility() {
    document.querySelectorAll("[data-col]").forEach(el => {
        const colKey = el.getAttribute("data-col");
        el.style.display = visibleColumns.has(colKey) ? "" : "none";
    });
}

// ===================================================
// 10. EDIT ARTIKEL (via modal)
// ===================================================
function setupEditModal() {
    const tbody = document.getElementById("artikelTableBody");
    if (!tbody) return;

    // Event delegation -- tombol Edit/Delete dibuat ulang tiap render,
    // jadi listener dipasang di tbody (elemen induk yang tetap sama)
    tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;

        const row = btn.closest("tr");
        const id = row?.getAttribute("data-id");
        if (!id) return;

        const action = btn.getAttribute("data-action");
        if (action === "edit") openEditModal(id);
        if (action === "delete") handleDeleteArtikel(id);
    });

    const btnSave = document.getElementById("btnSaveEditArtikel");
    if (btnSave) {
        btnSave.addEventListener("click", saveEditArtikel);
    }
}

function openEditModal(id) {
    const artikel = currentPageData.find(a => String(a.id) === String(id));
    if (!artikel) {
        alert("Data tidak ditemukan pada halaman saat ini.");
        return;
    }

    document.getElementById("editArtikelId").value = artikel.id;
    document.getElementById("editKodeArtikel").value = artikel.kode_artikel || "";
    document.getElementById("editNamaBarang").value = artikel.nama_barang || "";
    document.getElementById("editCustomer").value = artikel.customer || "";
    document.getElementById("editFlute").value = artikel.flute || "";
    document.getElementById("editWidth").value = artikel.width ?? "";
    document.getElementById("editLength").value = artikel.length ?? "";
    document.getElementById("editWrappingMl").value = artikel.wrapping_ml ?? "";
    document.getElementById("editPanjangBox").value = artikel.panjang_box ?? "";
    document.getElementById("editLebarBox").value = artikel.lebar_box ?? "";
    document.getElementById("editTinggiBox").value = artikel.tinggi_box ?? "";
    document.getElementById("editTipePartisi").value = artikel.tipe_partisi || "";
    document.getElementById("editJoint").value = artikel.joint || "";
    document.getElementById("editPcsPallet").value = artikel.pcs_pallet ?? "";
    document.getElementById("editItemType").value = artikel.item_type || "";

    const modalEl = document.getElementById("modalEditArtikel");
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();
}

function parseNumOrNull(val) {
    if (val === null || val === undefined || String(val).trim() === "") return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

async function saveEditArtikel() {
    const btnSave = document.getElementById("btnSaveEditArtikel");
    const id = document.getElementById("editArtikelId").value;
    if (!id) return;

    const payload = {
        kode_artikel: document.getElementById("editKodeArtikel").value.trim(),
        nama_barang: document.getElementById("editNamaBarang").value.trim() || null,
        customer: document.getElementById("editCustomer").value.trim() || null,
        flute: document.getElementById("editFlute").value.trim() || null,
        width: parseNumOrNull(document.getElementById("editWidth").value),
        length: parseNumOrNull(document.getElementById("editLength").value),
        wrapping_ml: parseNumOrNull(document.getElementById("editWrappingMl").value),
        panjang_box: parseNumOrNull(document.getElementById("editPanjangBox").value),
        lebar_box: parseNumOrNull(document.getElementById("editLebarBox").value),
        tinggi_box: parseNumOrNull(document.getElementById("editTinggiBox").value),
        tipe_partisi: document.getElementById("editTipePartisi").value.trim() || null,
        joint: document.getElementById("editJoint").value.trim() || null,
        pcs_pallet: parseNumOrNull(document.getElementById("editPcsPallet").value),
        item_type: document.getElementById("editItemType").value.trim() || null
    };

    if (!payload.kode_artikel) {
        alert("Kode Artikel wajib diisi.");
        return;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("artikel")
            .update(payload)
            .eq("id", id);

        if (error) throw error;

        const modalEl = document.getElementById("modalEditArtikel");
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();

        await loadArtikelPage();

    } catch (err) {
        console.error("Gagal menyimpan perubahan artikel:", err);
        alert("Gagal menyimpan perubahan: " + err.message);
    } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Simpan Perubahan`;
    }
}

// ===================================================
// 11. DELETE ARTIKEL (hard delete -- permanen, sesuai keputusan
// bahwa data artikel boleh dihapus fisik, beda dari data karyawan)
// ===================================================
function setupDeleteAction() {
    // Listener sudah dipasang lewat event delegation di setupEditModal()
    // (1 listener tbody menangani baik tombol edit maupun delete)
}

async function handleDeleteArtikel(id) {
    const artikel = currentPageData.find(a => String(a.id) === String(id));
    const namaKonfirmasi = artikel ? `${artikel.kode_artikel} - ${artikel.nama_barang || ""}` : id;

    const konfirmasi = confirm(
        `Yakin ingin menghapus artikel "${namaKonfirmasi}" secara PERMANEN?\n\nTindakan ini tidak bisa dibatalkan.`
    );
    if (!konfirmasi) return;

    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("artikel")
            .delete()
            .eq("id", id);

        if (error) throw error;

        await loadArtikelPage();

    } catch (err) {
        console.error("Gagal menghapus artikel:", err);
        alert("Gagal menghapus data: " + err.message);
    }
}

async function reloadArtikelTable() {
    await loadArtikelPage();
=======
// ===================================================
// js/module/operations/stg/artikel.js
// Halaman Database Artikel (stg_public.artikel)
// ===================================================

const supabaseClient = window.supabaseClient;

// ===================================================
// 1. STATE GLOBAL
// ===================================================
let referenceData = {
    customers: [],
    flutes: [],
    tipePartisis: [],
    joints: [],
    itemTypes: []
};

let activeFilters = {
    customer: [],
    flute: [],
    tipe_partisi: [],
    joint: [],
    item_type: []
};

let searchKeyword = "";
let currentPage = 1;
let totalRows = 0;
const ROWS_PER_PAGE = 100;

let currentPageData = [];

// ===================================================
// 2. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupSearchInput();
    setupFilterToggle();
    setupColumnToggle();
    setupEditModal();
    setupDeleteAction();

    // Menggunakan try-catch agar kegagalan ref data tidak memutus render tabel/panel
    try {
        await loadReferenceData();
    } catch (err) {
        console.error("Gagal memuat data referensi filter:", err);
    }

    renderFilterPanel();
    initColumnPanel();
    await loadArtikelPage();
});

// ===================================================
// 3. DATA REFERENSI UNTUK ISI FILTER
// ===================================================
async function loadReferenceData() {
    if (!supabaseClient) return;

    const [customerRes, fluteRes, tipePartisiRes, jointRes, itemTypeRes] = await Promise.all([
        supabaseClient.schema("stg_public").from("artikel").select("customer"),
        supabaseClient.schema("stg_public").from("artikel").select("flute"),
        supabaseClient.schema("stg_public").from("artikel").select("tipe_partisi"),
        supabaseClient.schema("stg_public").from("artikel").select("joint"),
        supabaseClient.schema("stg_public").from("artikel").select("item_type")
    ]);

    referenceData.customers = extractUniqueValues(customerRes.data, "customer");
    referenceData.flutes = extractUniqueValues(fluteRes.data, "flute");
    referenceData.tipePartisis = extractUniqueValues(tipePartisiRes.data, "tipe_partisi");
    referenceData.joints = extractUniqueValues(jointRes.data, "joint");
    referenceData.itemTypes = extractUniqueValues(itemTypeRes.data, "item_type");
}

function extractUniqueValues(rows, columnName) {
    if (!rows || !Array.isArray(rows)) return [];
    const values = rows
        .map(r => r[columnName])
        .filter(v => v !== null && v !== undefined && String(v).trim() !== "");
    return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

// ===================================================
// 4. AMBIL DATA HALAMAN AKTIF (SERVER-SIDE PAGINATION)
// ===================================================
async function loadArtikelPage() {
    const tbody = document.getElementById("artikelTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr class="row-loading"><td colspan="15"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("artikel")
            .select("*", { count: "exact" });

        if (searchKeyword) {
            query = query.ilike("kode_artikel", `%${searchKeyword}%`);
        }

        if (activeFilters.customer.length > 0) query = query.in("customer", activeFilters.customer);
        if (activeFilters.flute.length > 0) query = query.in("flute", activeFilters.flute);
        if (activeFilters.tipe_partisi.length > 0) query = query.in("tipe_partisi", activeFilters.tipe_partisi);
        if (activeFilters.joint.length > 0) query = query.in("joint", activeFilters.joint);
        if (activeFilters.item_type.length > 0) query = query.in("item_type", activeFilters.item_type);

        const start = (currentPage - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("kode_artikel").range(start, end);

        const { data, error, count } = await query;

        if (error) throw error;

        currentPageData = data || [];
        totalRows = count || 0;

        renderTable();
        renderPagination();

    } catch (err) {
        console.error("Gagal memuat data artikel:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="15">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

// ===================================================
// 5. SEARCH
// ===================================================
function setupSearchInput() {
    const input = document.getElementById("inputSearch");
    if (!input) return;

    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchKeyword = input.value.trim();
            currentPage = 1;
            loadArtikelPage();
        }, 350);
    });
}

// ===================================================
// 6. FILTER PANEL & DROPDOWN TOGGLE
// ===================================================
function setupFilterToggle() {
    const btnToggle = document.getElementById("btnFilterToggle");
    const panel = document.getElementById("filterPanel");

    if (!btnToggle || !panel) return;

    // Toggle tampilan panel filter saat tombol Filter diklik
    btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("d-none");
    });

    // Tutup panel jika diklik di luar area tombol dan panel
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && !btnToggle.contains(e.target)) {
            panel.classList.add("d-none");
        }
    });

    // Toggle expand/collapse untuk tiap kategori filter
    document.querySelectorAll(".filter-group-header").forEach(header => {
        header.addEventListener("click", (e) => {
            e.stopPropagation();
            const targetId = header.getAttribute("data-target");
            const body = document.getElementById(targetId);
            if (body) {
                header.classList.toggle("expanded");
                body.classList.toggle("expanded");
            }
        });
    });

    // Tombol Reset Filter
    const btnReset = document.getElementById("btnFilterReset");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            activeFilters = { customer: [], flute: [], tipe_partisi: [], joint: [], item_type: [] };
            renderFilterPanel();
            currentPage = 1;
            loadArtikelPage();
            updateFilterBadge();
        });
    }

    // Tombol Terapkan Filter
    const btnApply = document.getElementById("btnFilterApply");
    if (btnApply) {
        btnApply.addEventListener("click", () => {
            activeFilters.customer = getCheckedValues("filterCustomer");
            activeFilters.flute = getCheckedValues("filterFlute");
            activeFilters.tipe_partisi = getCheckedValues("filterTipePartisi");
            activeFilters.joint = getCheckedValues("filterJoint");
            activeFilters.item_type = getCheckedValues("filterItemType");

            currentPage = 1;
            loadArtikelPage();
            panel.classList.add("d-none");
            updateFilterBadge();
        });
    }
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
    if (!badge) return;

    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

function renderFilterPanel() {
    renderFilterGroup("filterCustomer", referenceData.customers, "customer");
    renderFilterGroup("filterFlute", referenceData.flutes, "flute");
    renderFilterGroup("filterTipePartisi", referenceData.tipePartisis, "tipe_partisi");
    renderFilterGroup("filterJoint", referenceData.joints, "joint");
    renderFilterGroup("filterItemType", referenceData.itemTypes, "item_type");
}

function renderFilterGroup(containerId, values, filterKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!values || values.length === 0) {
        container.innerHTML = `<span class="data-empty-cell p-2 d-block">Tidak ada data</span>`;
        return;
    }

    const currentActive = activeFilters[filterKey] || [];

    container.innerHTML = values.map(val => {
        const isChecked = currentActive.includes(String(val)) ? "checked" : "";
        return `
            <label class="filter-checkbox-item">
                <input type="checkbox" value="${val}" ${isChecked}>
                <span>${val}</span>
            </label>
        `;
    }).join("");
}

// ===================================================
// 7. RENDER TABEL
// ===================================================
function renderTable() {
    const tbody = document.getElementById("artikelTableBody");
    if (!tbody) return;

    if (currentPageData.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="16">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (currentPage - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = currentPageData.map((a, index) => {
        const nomorUrut = start + index + 1;
        return `
            <tr data-id="${a.id}">
                <td class="col-no">${nomorUrut}</td>
                <td data-col="kode_artikel">${a.kode_artikel || '-'}</td>
                <td data-col="nama_barang">${a.nama_barang || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="customer">${a.customer || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="flute">${a.flute || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="width">${a.width ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="length">${a.length ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="panjang_box">${a.panjang_box ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="lebar_box">${a.lebar_box ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="tinggi_box">${a.tinggi_box ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="tipe_partisi">${a.tipe_partisi || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="joint">${a.joint || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="pcs_pallet">${a.pcs_pallet ?? '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="item_type">${a.item_type || '<span class="data-empty-cell">-</span>'}</td>
                <td data-col="wrapping_ml">${a.wrapping_ml ?? '<span class="data-empty-cell">-</span>'}</td>
                <td class="col-aksi">
                    <button type="button" class="btn-row-action btn-row-edit" data-action="edit" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" class="btn-row-action btn-row-delete" data-action="delete" title="Hapus">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    applyColumnVisibility();
}

// ===================================================
// 8. PAGINATION
// ===================================================
function renderPagination() {
    let container = document.getElementById("artikelPagination");

    if (!container) {
        container = document.createElement("div");
        container.id = "artikelPagination";
        container.className = "art-pagination";
        const main = document.querySelector(".art-main");
        if (main) main.appendChild(container);
    }

    const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE);

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `<button class="pagination-btn" id="pagePrev" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
    </button>`;

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
            currentPage = parseInt(btn.getAttribute("data-page"));
            loadArtikelPage();
        });
    });

    const prevBtn = document.getElementById("pagePrev");
    const nextBtn = document.getElementById("pageNext");
    if (prevBtn) prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadArtikelPage(); } };
    if (nextBtn) nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; loadArtikelPage(); } };
}

// ===================================================
// 9. ATUR KOLOM (tampil/sembunyi kolom tabel)
// ===================================================
let visibleColumns = new Set(); // diisi semua data-col saat init (default semua terlihat)

function initColumnPanel() {
    // Ambil daftar kolom dari <th data-col="..."> di thead
    const thElements = document.querySelectorAll("thead th[data-col]");
    const panelBody = document.getElementById("columnPanelBody");
    if (!panelBody) return;

    let html = "";
    thElements.forEach(th => {
        const colKey = th.getAttribute("data-col");
        const label = th.textContent.trim();
        visibleColumns.add(colKey); // default: semua kolom terlihat
        html += `
            <label class="column-checkbox-item">
                <input type="checkbox" value="${colKey}" checked>
                <span>${label}</span>
            </label>
        `;
    });
    panelBody.innerHTML = html;
}

function setupColumnToggle() {
    const btnToggle = document.getElementById("btnColumnToggle");
    const panel = document.getElementById("columnPanel");
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

    const btnApply = document.getElementById("btnColumnApply");
    if (btnApply) {
        btnApply.addEventListener("click", () => {
            const checkboxes = document.querySelectorAll("#columnPanelBody input[type='checkbox']");
            visibleColumns = new Set(
                Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value)
            );
            applyColumnVisibility();
            panel.classList.add("d-none");
        });
    }
}

// Terapkan tampil/sembunyi ke <th> DAN <td> yang sedang ada di DOM,
// dipanggil ulang tiap kali tabel di-render (data berganti halaman/filter)
function applyColumnVisibility() {
    document.querySelectorAll("[data-col]").forEach(el => {
        const colKey = el.getAttribute("data-col");
        el.style.display = visibleColumns.has(colKey) ? "" : "none";
    });
}

// ===================================================
// 10. EDIT ARTIKEL (via modal)
// ===================================================
function setupEditModal() {
    const tbody = document.getElementById("artikelTableBody");
    if (!tbody) return;

    // Event delegation -- tombol Edit/Delete dibuat ulang tiap render,
    // jadi listener dipasang di tbody (elemen induk yang tetap sama)
    tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;

        const row = btn.closest("tr");
        const id = row?.getAttribute("data-id");
        if (!id) return;

        const action = btn.getAttribute("data-action");
        if (action === "edit") openEditModal(id);
        if (action === "delete") handleDeleteArtikel(id);
    });

    const btnSave = document.getElementById("btnSaveEditArtikel");
    if (btnSave) {
        btnSave.addEventListener("click", saveEditArtikel);
    }
}

function openEditModal(id) {
    const artikel = currentPageData.find(a => String(a.id) === String(id));
    if (!artikel) {
        alert("Data tidak ditemukan pada halaman saat ini.");
        return;
    }

    document.getElementById("editArtikelId").value = artikel.id;
    document.getElementById("editKodeArtikel").value = artikel.kode_artikel || "";
    document.getElementById("editNamaBarang").value = artikel.nama_barang || "";
    document.getElementById("editCustomer").value = artikel.customer || "";
    document.getElementById("editFlute").value = artikel.flute || "";
    document.getElementById("editWidth").value = artikel.width ?? "";
    document.getElementById("editLength").value = artikel.length ?? "";
    document.getElementById("editWrappingMl").value = artikel.wrapping_ml ?? "";
    document.getElementById("editPanjangBox").value = artikel.panjang_box ?? "";
    document.getElementById("editLebarBox").value = artikel.lebar_box ?? "";
    document.getElementById("editTinggiBox").value = artikel.tinggi_box ?? "";
    document.getElementById("editTipePartisi").value = artikel.tipe_partisi || "";
    document.getElementById("editJoint").value = artikel.joint || "";
    document.getElementById("editPcsPallet").value = artikel.pcs_pallet ?? "";
    document.getElementById("editItemType").value = artikel.item_type || "";

    const modalEl = document.getElementById("modalEditArtikel");
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();
}

function parseNumOrNull(val) {
    if (val === null || val === undefined || String(val).trim() === "") return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

async function saveEditArtikel() {
    const btnSave = document.getElementById("btnSaveEditArtikel");
    const id = document.getElementById("editArtikelId").value;
    if (!id) return;

    const payload = {
        kode_artikel: document.getElementById("editKodeArtikel").value.trim(),
        nama_barang: document.getElementById("editNamaBarang").value.trim() || null,
        customer: document.getElementById("editCustomer").value.trim() || null,
        flute: document.getElementById("editFlute").value.trim() || null,
        width: parseNumOrNull(document.getElementById("editWidth").value),
        length: parseNumOrNull(document.getElementById("editLength").value),
        wrapping_ml: parseNumOrNull(document.getElementById("editWrappingMl").value),
        panjang_box: parseNumOrNull(document.getElementById("editPanjangBox").value),
        lebar_box: parseNumOrNull(document.getElementById("editLebarBox").value),
        tinggi_box: parseNumOrNull(document.getElementById("editTinggiBox").value),
        tipe_partisi: document.getElementById("editTipePartisi").value.trim() || null,
        joint: document.getElementById("editJoint").value.trim() || null,
        pcs_pallet: parseNumOrNull(document.getElementById("editPcsPallet").value),
        item_type: document.getElementById("editItemType").value.trim() || null
    };

    if (!payload.kode_artikel) {
        alert("Kode Artikel wajib diisi.");
        return;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("artikel")
            .update(payload)
            .eq("id", id);

        if (error) throw error;

        const modalEl = document.getElementById("modalEditArtikel");
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();

        await loadArtikelPage();

    } catch (err) {
        console.error("Gagal menyimpan perubahan artikel:", err);
        alert("Gagal menyimpan perubahan: " + err.message);
    } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Simpan Perubahan`;
    }
}

// ===================================================
// 11. DELETE ARTIKEL (hard delete -- permanen, sesuai keputusan
// bahwa data artikel boleh dihapus fisik, beda dari data karyawan)
// ===================================================
function setupDeleteAction() {
    // Listener sudah dipasang lewat event delegation di setupEditModal()
    // (1 listener tbody menangani baik tombol edit maupun delete)
}

async function handleDeleteArtikel(id) {
    const artikel = currentPageData.find(a => String(a.id) === String(id));
    const namaKonfirmasi = artikel ? `${artikel.kode_artikel} - ${artikel.nama_barang || ""}` : id;

    const konfirmasi = confirm(
        `Yakin ingin menghapus artikel "${namaKonfirmasi}" secara PERMANEN?\n\nTindakan ini tidak bisa dibatalkan.`
    );
    if (!konfirmasi) return;

    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("artikel")
            .delete()
            .eq("id", id);

        if (error) throw error;

        await loadArtikelPage();

    } catch (err) {
        console.error("Gagal menghapus artikel:", err);
        alert("Gagal menghapus data: " + err.message);
    }
}

async function reloadArtikelTable() {
    await loadArtikelPage();
>>>>>>> 3d00068 (Initial commit Web ERP)
}