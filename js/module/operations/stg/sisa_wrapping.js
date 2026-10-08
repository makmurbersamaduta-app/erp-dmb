// ===================================================
// js/module/operations/stg/sisa_wrapping.js
// Halaman Laporan Sisa Wrapping (stg_public.sisa_wrapping_view)
// 2 tab: Laporan (is_active=true) & History (is_active=false)
// Server-side pagination -- 100 baris per halaman.
// Fitur: search (kode artikel/nama barang/customer), filter per tab,
// modal detail saat baris diklik (edit Qty & Batch Number khusus tab Laporan).
// Filter Kode Artikel / Nama Barang / Customer: checklist
// dengan search per grup (nilai unik dari RPC, di-generate
// dinamis di JS -- bukan ditulis manual di HTML).
// ===================================================

const supabaseClient = window.supabaseClient;
const ROWS_PER_PAGE = 100;

// Daftar field yang pakai model "checklist + search" (dipakai sama
// untuk tab Laporan maupun History)
const CHECKLIST_FIELDS = [
    { key: "kodeArtikel", column: "kode_artikel", label: "Kode Artikel" },
    { key: "namaBarang", column: "nama_barang", label: "Nama Barang" },
    { key: "customer", column: "customer", label: "Customer" }
];

// ===================================================
// 1. STATE GLOBAL
// ===================================================
// Opsi checklist filter dipisah per tab: Laporan = data aktif, History = data tidak aktif
let referenceDataByTab = {
    Laporan: { kode_artikel: [], nama_barang: [], customer: [] },
    History: { kode_artikel: [], nama_barang: [], customer: [] }
};

let laporanState = {
    filters: { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "" },
    page: 1,
    totalRows: 0,
    data: [],
    search: "",   // kata kunci search aktif
    reqId: 0      // penanda permintaan terbaru (mencegah hasil lama menimpa hasil baru)
};

let historyState = {
    filters: { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "", tglKeluarDari: "", tglKeluarSampai: "" },
    page: 1,
    totalRows: 0,
    data: [],
    search: "",   // kata kunci search aktif
    reqId: 0      // penanda permintaan terbaru (mencegah hasil lama menimpa hasil baru)
};

// ===================================================
// 2. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupFilterToggle("Laporan");
    setupFilterToggle("History");
    setupFilterApply("Laporan");
    setupFilterApply("History");
    setupFilterReset("Laporan");
    setupFilterReset("History");
    setupDownloadLaporan();
    setupSearch("Laporan");
    setupSearch("History");
    setupRowModal();
    setupDeleteAction();

    try {
        await loadReferenceData();
    } catch (err) {
        console.error("Gagal memuat data referensi filter:", err);
    }

    renderFieldFilterGroups("Laporan");
    renderFieldFilterGroups("History");

    // Tab Laporan dimuat langsung karena itu tampilan pertama yang dilihat user.
    await loadLaporanPage();

    // Tab History TIDAK dimuat di awal -- baru di-query saat pertama kali
    // tab-nya diklik (lebih jarang dibuka, jadi tidak perlu query di muka).
    let historyLoaded = false;
    document.querySelector('[data-bs-target="#tabHistory"]')?.addEventListener("shown.bs.tab", async () => {
        if (!historyLoaded) {
            historyLoaded = true;
            await loadHistoryPage();
        }
    });
});

// ===================================================
// 3. DATA REFERENSI (Kode Artikel, Nama Barang, Customer)
// 1 RPC menggantikan query manual -- hemat egress, DISTINCT
// dikerjakan di database.
// ===================================================
async function loadReferenceData() {
    // Opsi filter diambil terpisah: data aktif untuk tab Laporan,
    // data tidak aktif untuk tab History.
    const [aktif, history] = await Promise.all([
        fetchFilterOptions(true),
        fetchFilterOptions(false)
    ]);
    referenceDataByTab.Laporan = aktif;
    referenceDataByTab.History = history;
}

async function fetchFilterOptions(isActive) {
    const empty = { kode_artikel: [], nama_barang: [], customer: [] };

    const { data, error } = await supabaseClient
        .schema("stg_public")
        .rpc("get_sisa_wrapping_filter_options_by_status", { p_is_active: isActive });

    if (error) {
        console.error("Gagal memuat opsi filter (is_active=" + isActive + "):", error.message);
        return empty;
    }

    return {
        kode_artikel: data?.kode_artikel || [],
        nama_barang: data?.nama_barang || [],
        customer: data?.customer || []
    };
}

// ===================================================
// 4. RENDER GRUP FILTER (Kode Artikel / Nama Barang / Customer)
// Dibuat dinamis lewat JS -- 1 fungsi dipakai untuk kedua tab,
// supaya tidak ada duplikasi markup panjang di HTML.
// ===================================================
function renderFieldFilterGroups(tabName) {
    const container = document.getElementById(`filterFieldGroups${tabName}`);
    if (!container) return;

    const state = tabName === "Laporan" ? laporanState : historyState;

    container.innerHTML = CHECKLIST_FIELDS.map(field => {
        const values = referenceDataByTab[tabName][field.column] || [];
        const groupId = `filterGroup_${field.key}_${tabName}`;
        const searchId = `filterSearch_${field.key}_${tabName}`;
        const listId = `filterList_${field.key}_${tabName}`;
        const selected = state.filters[field.key] || [];

        const checkboxesHtml = values.map(val => `
            <label class="filter-checkbox-item" data-search-text="${String(val).toLowerCase()}">
                <input type="checkbox" value="${val}" ${selected.includes(String(val)) ? "checked" : ""}>
                <span>${val}</span>
            </label>
        `).join("");

        return `
            <div class="filter-group">
                <button type="button" class="filter-group-header" data-target="${groupId}">
                    <span>${field.label}</span>
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <div class="filter-group-body-collapsible" id="${groupId}">
                    <input type="text" class="filter-inline-search" id="${searchId}" placeholder="Cari ${field.label.toLowerCase()}...">
                    <div class="filter-checkbox-list" id="${listId}">
                        ${values.length > 0 ? checkboxesHtml : '<span class="data-empty-cell">Tidak ada data</span>'}
                    </div>
                </div>
            </div>
        `;
    }).join("");

    // Pasang listener expand/collapse per grup
    container.querySelectorAll(".filter-group-header").forEach(header => {
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

    // Pasang listener search per grup -- filter checklist secara live
    // di sisi client (data sudah dimuat sekali dari RPC, tidak query ulang)
    CHECKLIST_FIELDS.forEach(field => {
        const searchInput = document.getElementById(`filterSearch_${field.key}_${tabName}`);
        const listContainer = document.getElementById(`filterList_${field.key}_${tabName}`);
        if (!searchInput || !listContainer) return;

        searchInput.addEventListener("input", () => {
            const keyword = searchInput.value.trim().toLowerCase();
            listContainer.querySelectorAll(".filter-checkbox-item").forEach(item => {
                const text = item.getAttribute("data-search-text") || "";
                item.style.display = text.includes(keyword) ? "flex" : "none";
            });
        });

        // Klik di search box tidak menutup panel filter
        searchInput.addEventListener("click", (e) => e.stopPropagation());
    });
}

// ===================================================
// 4B. HELPER QUERY: SEARCH + FILTER (dipakai tabel & download)
// ===================================================

// Search mencocokkan sebagian teks di kode_artikel, nama_barang, ATAU customer.
// Nilai dibungkus tanda kutip ganda supaya karakter seperti koma/kurung
// pada kata kunci tidak merusak sintaks query.
function buildSearchOrClause(keyword) {
    const safe = keyword.replace(/[\\"]/g, "\\$&");
    const pattern = `"%${safe}%"`;
    return `kode_artikel.ilike.${pattern},nama_barang.ilike.${pattern},customer.ilike.${pattern}`;
}

// Terapkan search + semua filter dari state tab ke query Supabase.
function applyStateFilters(query, state) {
    const f = state.filters;

    if (state.search) query = query.or(buildSearchOrClause(state.search));

    if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
    if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
    if (f.customer.length > 0) query = query.in("customer", f.customer);
    if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
    if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);

    // Khusus History (di state Laporan field ini tidak ada, jadi otomatis dilewati)
    if (f.tglKeluarDari) query = query.gte("tanggal_out", f.tglKeluarDari);
    if (f.tglKeluarSampai) query = query.lte("tanggal_out", f.tglKeluarSampai);

    return query;
}

// Kotak search di toolbar tiap tab (jeda 400 ms setelah berhenti mengetik)
function setupSearch(tabName) {
    const input = document.getElementById(`searchInput${tabName}`);
    if (!input) return;

    let timer = null;
    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const state = tabName === "Laporan" ? laporanState : historyState;
            state.search = input.value.trim();
            state.page = 1;
            if (tabName === "Laporan") loadLaporanPage();
            else loadHistoryPage();
        }, 400);
    });
}

// ===================================================
// 5. HELPER: format tanggal ke dd/mm/yyyy untuk tampilan
// ===================================================
function formatTanggal(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// ===================================================
// 6. TAB LAPORAN -- ambil data (is_active = true)
// ===================================================
async function loadLaporanPage() {
    const myReq = ++laporanState.reqId;
    const tbody = document.getElementById("laporanTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="11"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*", { count: "exact" })
            .eq("is_active", true);

        query = applyStateFilters(query, laporanState);

        const start = (laporanState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("created_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
        if (myReq !== laporanState.reqId) return; // ada permintaan yang lebih baru
        if (error) throw error;

        laporanState.data = data || [];
        laporanState.totalRows = count || 0;

        renderLaporanTable();
        renderPagination("laporanPagination", laporanState, loadLaporanPage);

    } catch (err) {
        console.error("Gagal memuat data laporan:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="11">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

function renderLaporanTable() {
    const tbody = document.getElementById("laporanTableBody");
    if (laporanState.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="11">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (laporanState.page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = laporanState.data.map((row, index) => `
        <tr class="row-clickable" data-id="${String(row.id).replace(/"/g, "&quot;")}">
            <td class="col-no">${start + index + 1}</td>
            <td class="col-aksi">
                <button type="button" class="btn-download-label" data-id="${row.id}">
                    <i class="fa-solid fa-file-pdf"></i> Label
                </button>
            </td>
            <td>${row.kode_artikel || "-"}</td>
            <td>${row.nama_barang || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.customer || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.batch_number || '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatTanggal(row.tanggal_masuk) || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.qty ?? '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.petugas_in || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.shift_in || '<span class="data-empty-cell">-</span>'}</td>
            <td class="col-hapus">
                <button type="button" class="btn-delete-row" data-id="${String(row.id).replace(/"/g, "&quot;")}">
                    <i class="fa-solid fa-trash"></i> Hapus
                </button>
            </td>
        </tr>
    `).join("");

    tbody.querySelectorAll(".btn-download-label").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            downloadLabelWrapping(id);
        });
    });
}

// ===================================================
// GENERATE LABEL PDF + QR CODE
// QR Code berisi id baris (kolom "id" di sisa_wrapping),
// dipakai nanti untuk scan-cari record saat barang dikeluarkan.
// ===================================================
async function downloadLabelWrapping(id) {
    const row = laporanState.data.find(r => String(r.id) === String(id));
    if (!row) {
        alert("Data tidak ditemukan pada halaman saat ini.");
        return;
    }

    try {
        // 1. Generate QR Code sebagai gambar (data URL base64)
        const qrDataUrl = await QRCode.toDataURL(String(row.id), {
            width: 300,
            margin: 1
        });

        // 2. Siapkan dokumen PDF (satuan milimeter, ukuran A4)
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "mm", format: "a4" });

        const marginX = 15;
        const tableWidth = 180;
        const labelColWidth = 55;
        const rowHeight = 10;
        let cursorY = 25;

        // 3. Judul
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("Label Sisa Wrapping", marginX, cursorY);
        cursorY += 12;

        // 4. Data baris label (urutan sesuai contoh)
        const fields = [
            { label: "ARTICLE", value: row.kode_artikel || "-", boldValue: true },
            { label: "NAMA ITEM", value: row.nama_barang || "-" },
            { label: "CUSTOMER", value: row.customer || "-" },
            { label: "KODE PRODUKSI", value: row.batch_number || "-" },
            { label: "SHIFT", value: row.shift_in || "-" },
            { label: "TANGGAL", value: formatTanggal(row.tanggal_masuk) || "-" },
            { label: "QTY", value: row.qty !== null && row.qty !== undefined ? String(row.qty) : "-" },
            { label: "Diperiksa Oleh", value: row.petugas_in || "-" }
        ];

        const tableTopY = cursorY;

        // 5. Gambar tiap baris: teks label, garis pemisah vertikal (":"),
        //    teks value, dan garis horizontal bawah tiap baris
        doc.setFontSize(12);
        fields.forEach((field, index) => {
            const rowY = cursorY + index * rowHeight;

            doc.setFont("helvetica", "normal");
            doc.text(field.label, marginX + 2, rowY + 7);
            doc.text(":", marginX + labelColWidth, rowY + 7);

            doc.setFont("helvetica", field.boldValue ? "bold" : "normal");
            doc.text(String(field.value), marginX + labelColWidth + 5, rowY + 7);

            // Garis horizontal bawah baris ini
            doc.setDrawColor(0);
            doc.line(marginX, rowY + rowHeight, marginX + tableWidth, rowY + rowHeight);
        });

        const tableBottomY = cursorY + fields.length * rowHeight;

        // 6. Garis luar tabel (kotak besar) + garis pemisah vertikal antar kolom
        doc.rect(marginX, tableTopY, tableWidth, tableBottomY - tableTopY);
        doc.line(marginX + labelColWidth, tableTopY, marginX + labelColWidth, tableBottomY);

        // 7. Kotak QR Code di bawah tabel
        const qrBoxHeight = 75;
        const qrBoxTopY = tableBottomY;
        doc.rect(marginX, qrBoxTopY, tableWidth, qrBoxHeight);

        const qrImageSize = 50;
        const qrImageX = marginX + (tableWidth - qrImageSize) / 2;
        const qrImageY = qrBoxTopY + (qrBoxHeight - qrImageSize) / 2;
        doc.addImage(qrDataUrl, "PNG", qrImageX, qrImageY, qrImageSize, qrImageSize);

        // 8. Simpan file, nama berdasarkan Kode Artikel + id
        const fileName = `Label_${row.kode_artikel || "artikel"}_${row.id}.pdf`;
        doc.save(fileName);

    } catch (err) {
        console.error("Gagal membuat label PDF:", err);
        alert("Gagal membuat label PDF: " + err.message);
    }
}

// ===================================================
// 7. TAB HISTORY -- ambil data (is_active = false)
// ===================================================
async function loadHistoryPage() {
    const myReq = ++historyState.reqId;
    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="12"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*", { count: "exact" })
            .eq("is_active", false);

        query = applyStateFilters(query, historyState);

        const start = (historyState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("update_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
        if (myReq !== historyState.reqId) return; // ada permintaan yang lebih baru
        if (error) throw error;

        historyState.data = data || [];
        historyState.totalRows = count || 0;

        renderHistoryTable();
        renderPagination("historyPagination", historyState, loadHistoryPage);

    } catch (err) {
        console.error("Gagal memuat data history:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="12">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

function renderHistoryTable() {
    const tbody = document.getElementById("historyTableBody");
    if (historyState.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="12">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (historyState.page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = historyState.data.map((row, index) => `
        <tr class="row-clickable" data-id="${String(row.id).replace(/"/g, "&quot;")}">
            <td class="col-no">${start + index + 1}</td>
            <td>${row.kode_artikel || "-"}</td>
            <td>${row.nama_barang || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.customer || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.batch_number || '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatTanggal(row.tanggal_masuk) || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.qty ?? '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.petugas_in || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.shift_in || '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatTanggal(row.tanggal_out) || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.petugas_out || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.shift_out || '<span class="data-empty-cell">-</span>'}</td>
        </tr>
    `).join("");
}

// ===================================================
// 8. FILTER PANEL -- toggle, apply, reset
// ===================================================
function setupFilterToggle(tabName) {
    const btnToggle = document.getElementById(`btnFilterToggle${tabName}`);
    const panel = document.getElementById(`filterPanel${tabName}`);
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
}

function setupFilterApply(tabName) {
    const btnApply = document.getElementById(`btnFilterApply${tabName}`);
    if (!btnApply) return;

    btnApply.addEventListener("click", () => {
        const state = tabName === "Laporan" ? laporanState : historyState;

        // Ambil checkbox yang tercentang untuk tiap grup (Kode Artikel,
        // Nama Barang, Customer) -- termasuk yang sedang disembunyikan
        // oleh live-search, supaya pilihan tidak hilang saat search dihapus.
        CHECKLIST_FIELDS.forEach(field => {
            const listId = `filterList_${field.key}_${tabName}`;
            const checked = Array.from(
                document.querySelectorAll(`#${listId} input[type="checkbox"]:checked`)
            ).map(cb => cb.value);
            state.filters[field.key] = checked;
        });

        state.filters.tglMasukDari = document.getElementById(`filterTglMasukDari${tabName}`).value;
        state.filters.tglMasukSampai = document.getElementById(`filterTglMasukSampai${tabName}`).value;

        if (tabName === "History") {
            state.filters.tglKeluarDari = document.getElementById("filterTglKeluarDariHistory").value;
            state.filters.tglKeluarSampai = document.getElementById("filterTglKeluarSampaiHistory").value;
        }

        state.page = 1;
        updateFilterBadge(tabName);
        document.getElementById(`filterPanel${tabName}`).classList.add("d-none");

        if (tabName === "Laporan") loadLaporanPage();
        else loadHistoryPage();
    });
}

function setupFilterReset(tabName) {
    const btnReset = document.getElementById(`btnFilterReset${tabName}`);
    if (!btnReset) return;

    btnReset.addEventListener("click", () => {
        const state = tabName === "Laporan" ? laporanState : historyState;

        // Uncheck semua checkbox di 3 grup, dan kosongkan search box-nya
        CHECKLIST_FIELDS.forEach(field => {
            const listId = `filterList_${field.key}_${tabName}`;
            const searchId = `filterSearch_${field.key}_${tabName}`;
            document.querySelectorAll(`#${listId} input[type="checkbox"]`).forEach(cb => cb.checked = false);
            document.querySelectorAll(`#${listId} .filter-checkbox-item`).forEach(item => item.style.display = "flex");
            const searchInput = document.getElementById(searchId);
            if (searchInput) searchInput.value = "";
        });

        document.getElementById(`filterTglMasukDari${tabName}`).value = "";
        document.getElementById(`filterTglMasukSampai${tabName}`).value = "";

        if (tabName === "History") {
            document.getElementById("filterTglKeluarDariHistory").value = "";
            document.getElementById("filterTglKeluarSampaiHistory").value = "";
        }

        state.filters = tabName === "Laporan"
            ? { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "" }
            : { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "", tglKeluarDari: "", tglKeluarSampai: "" };

        state.page = 1;
        updateFilterBadge(tabName);

        if (tabName === "Laporan") loadLaporanPage();
        else loadHistoryPage();
    });
}

function updateFilterBadge(tabName) {
    const state = tabName === "Laporan" ? laporanState : historyState;
    const f = state.filters;

    let total = f.kodeArtikel.length + f.namaBarang.length + f.customer.length;
    if (f.tglMasukDari) total++;
    if (f.tglMasukSampai) total++;
    if (tabName === "History") {
        if (f.tglKeluarDari) total++;
        if (f.tglKeluarSampai) total++;
    }

    const badge = document.getElementById(`filterCountBadge${tabName}`);
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

// ===================================================
// 9. PAGINATION (generik, dipakai kedua tab)
// ===================================================
function renderPagination(containerId, state, reloadFn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = `<button class="pagination-btn" data-nav="prev" ${state.page === 1 ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-left"></i>
    </button>`;

    const maxVisible = 7;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === state.page ? "active" : ""}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="pagination-btn" data-nav="next" ${state.page === totalPages ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-right"></i>
    </button>`;

    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            state.page = parseInt(btn.getAttribute("data-page"));
            reloadFn();
        });
    });

    const prevBtn = container.querySelector('[data-nav="prev"]');
    const nextBtn = container.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.onclick = () => { if (state.page > 1) { state.page--; reloadFn(); } };
    if (nextBtn) nextBtn.onclick = () => { if (state.page < totalPages) { state.page++; reloadFn(); } };
}

// ===================================================
// DOWNLOAD EXCEL (tab Laporan) -- ambil SELURUH data
// sesuai filter aktif, TIDAK dibatasi pagination 100 baris.
// ===================================================
function setupDownloadLaporan() {
    const btn = document.getElementById("btnDownloadLaporan");
    if (btn) btn.addEventListener("click", handleDownloadLaporan);
}

async function handleDownloadLaporan() {
    const btn = document.getElementById("btnDownloadLaporan");
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Menyiapkan...</span>`;

    try {
        // Ambil SEMUA baris yang cocok dengan search + filter tab Laporan,
        // bertahap. Total dipastikan lewat count "exact", dan pengambilan
        // lanjut dari jumlah baris yang BENAR-BENAR diterima. Urutan memakai
        // created_at lalu id agar baris ber-created_at sama tidak tertukar
        // atau terlewat di batas antar-halaman.
        const PAGE = 1000;
        const allRows = [];
        let totalCount = null;

        while (totalCount === null || allRows.length < totalCount) {
            let q = supabaseClient
                .schema("stg_public")
                .from("sisa_wrapping_view")
                .select("*", { count: "exact" })
                .eq("is_active", true);

            q = applyStateFilters(q, laporanState);
            q = q.order("created_at", { ascending: false })
                 .order("id", { ascending: false })
                 .range(allRows.length, allRows.length + PAGE - 1);

            const { data: chunkData, error: chunkErr, count } = await q;
            if (chunkErr) throw chunkErr;

            if (totalCount === null) totalCount = count || 0;
            if (!chunkData || chunkData.length === 0) break;

            allRows.push(...chunkData);
        }

        if (totalCount !== null && allRows.length < totalCount) {
            alert(`Peringatan: hanya ${allRows.length} dari ${totalCount} baris yang berhasil diambil.`);
        }

        if (allRows.length === 0) {
            alert("Tidak ada data untuk diunduh sesuai filter yang aktif.");
            return;
        }

        const exportData = allRows.map(r => ({
            "Tanggal": formatTanggal(r.tanggal_masuk),
            "Kode Artikel": r.kode_artikel,
            "Nama Barang": r.nama_barang,
            "Customer": r.customer,
            "Batch Number": r.batch_number,
            "Qty": r.qty
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Laporan Sisa Wrapping");

        const todayIso = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `Laporan_Sisa_Wrapping_${todayIso}.xlsx`);

    } catch (err) {
        console.error("Gagal download laporan sisa wrapping:", err);
        alert("Gagal menyiapkan file download: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
}


// ===================================================
// 10. MODAL DETAIL BARIS (muncul saat baris tabel diklik)
// - Awalnya SEMUA field terkunci (readonly), di tab Laporan maupun History.
// - Tombol "Edit" hanya ada di tab Laporan, dan hanya membuka
//   field Batch Number & Qty. Field lain tetap terkunci.
// ===================================================
let modalContext = { tab: null, row: null };
let modalPhotoReq = 0;

function setupRowModal() {
    document.getElementById("laporanTableBody")?.addEventListener("click", (e) => handleRowClick(e, "Laporan"));
    document.getElementById("historyTableBody")?.addEventListener("click", (e) => handleRowClick(e, "History"));

    document.getElementById("btnModalEdit")?.addEventListener("click", () => setModalEditMode(true));
    document.getElementById("btnModalBatal")?.addEventListener("click", cancelModalEdit);
    document.getElementById("btnModalSimpan")?.addEventListener("click", saveModalEdit);
    document.getElementById("modalSisaWrapping")?.addEventListener("hidden.bs.modal", resetModalState);
}

function handleRowClick(e, tabName) {
    // Klik tombol "Label" tetap mengunduh PDF, tidak membuka modal
    if (e.target.closest(".btn-download-label")) return;
    if (e.target.closest(".btn-delete-row")) return;

    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const state = tabName === "Laporan" ? laporanState : historyState;
    const row = state.data.find(r => String(r.id) === tr.getAttribute("data-id"));
    if (!row) return;

    openRowModal(tabName, row);
}

function openRowModal(tabName, row) {
    modalContext = { tab: tabName, row: row };

    fillModal(row);
    setModalEditMode(false);
    loadModalPhoto(row.id);

    const modalEl = document.getElementById("modalSisaWrapping");
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function fillModal(row) {
    document.getElementById("mdKodeArtikel").value = row.kode_artikel || "";
    document.getElementById("mdNamaBarang").value = row.nama_barang || "";
    document.getElementById("mdCustomer").value = row.customer || "";
    document.getElementById("mdBatch").value = row.batch_number || "";
    document.getElementById("mdQty").value = row.qty ?? "";
    document.getElementById("mdTglMasuk").value = formatTanggal(row.tanggal_masuk) || "";
    document.getElementById("mdPetugas").value = row.petugas_in || "";
}

// on = true  -> Batch Number & Qty bisa diedit, tombol Batal + Simpan muncul
// on = false -> semua terkunci, tombol Edit muncul (hanya di tab Laporan)
function setModalEditMode(on) {
    const batch = document.getElementById("mdBatch");
    const qty = document.getElementById("mdQty");

    batch.readOnly = !on;
    qty.readOnly = !on;

    document.getElementById("btnModalEdit").classList.toggle("d-none", on || modalContext.tab !== "Laporan");
    document.getElementById("btnModalBatal").classList.toggle("d-none", !on);
    document.getElementById("btnModalSimpan").classList.toggle("d-none", !on);
    document.getElementById("btnModalTutup").classList.toggle("d-none", on);

    showModalMessage("", "");
    if (on) batch.focus();
}

function cancelModalEdit() {
    if (modalContext.row) fillModal(modalContext.row); // kembalikan ke nilai awal
    setModalEditMode(false);
}

function showModalMessage(text, type) {
    const el = document.getElementById("mdMessage");
    if (!text) {
        el.classList.add("d-none");
        el.textContent = "";
        return;
    }
    el.className = `alert py-2 small alert-${type}`;
    el.textContent = text;
}

// Foto tidak ada di sisa_wrapping_view, jadi diambil dari tabel sisa_wrapping
// (kolom foto_path) saat modal dibuka.
async function loadModalPhoto(rowId) {
    const wrap = document.getElementById("mdFotoWrapper");
    wrap.innerHTML = `<span class="data-empty-cell">Memuat foto...</span>`;
    const myReq = ++modalPhotoReq;

    const { data, error } = await supabaseClient
        .schema("stg_public")
        .from("sisa_wrapping")
        .select("foto_path")
        .eq("id", rowId)
        .maybeSingle();

    if (myReq !== modalPhotoReq) return; // modal sudah pindah ke baris lain / ditutup

    if (error) {
        console.error("Gagal memuat foto:", error);
        wrap.innerHTML = `<span class="data-empty-cell">Gagal memuat foto.</span>`;
        return;
    }

    const url = data?.foto_path;
    if (!url) {
        wrap.innerHTML = `<span class="data-empty-cell">Tidak ada foto.</span>`;
        return;
    }

    wrap.innerHTML = "";
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Foto barang";
    img.className = "md-foto";
    img.onerror = () => { wrap.innerHTML = `<span class="data-empty-cell">Foto tidak dapat dimuat.</span>`; };

    link.appendChild(img);
    wrap.appendChild(link);
}

async function saveModalEdit() {
    const row = modalContext.row;
    if (!row) return;

    // --- Validasi input ---
    const newBatch = document.getElementById("mdBatch").value.trim() || null;
    const qtyRaw = document.getElementById("mdQty").value.trim();
    const newQty = Number(qtyRaw);

    if (qtyRaw === "" || isNaN(newQty) || newQty < 0) {
        showModalMessage("Qty harus berupa angka dan tidak boleh negatif.", "danger");
        return;
    }

    const batchBefore = row.batch_number || null;
    const qtyBefore = row.qty === null || row.qty === undefined ? null : Number(row.qty);
    if (newBatch === batchBefore && newQty === qtyBefore) {
        setModalEditMode(false); // tidak ada perubahan
        return;
    }

    const btnSimpan = document.getElementById("btnModalSimpan");
    const btnBatal = document.getElementById("btnModalBatal");
    const origHtml = btnSimpan.innerHTML;
    btnSimpan.disabled = true;
    btnBatal.disabled = true;
    btnSimpan.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
        // Update ke TABEL sisa_wrapping (bukan view). Hanya baris yang masih
        // aktif yang boleh diedit. .select() dipakai untuk memastikan ada
        // baris yang benar-benar berubah.
        const { data, error } = await supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping")
            .update({
                batch_number: newBatch,
                qty: newQty,
                update_at: new Date().toISOString()
            })
            .eq("id", row.id)
            .eq("is_active", true)
            .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
            showModalMessage("Tidak ada data yang tersimpan. Kemungkinan data sudah tidak aktif, atau akun ini tidak punya izin mengubah data.", "danger");
            return;
        }

        // Berhasil: perbarui data di memori, kembali ke mode terkunci, segarkan tabel
        row.batch_number = newBatch;
        row.qty = newQty;
        fillModal(row);
        setModalEditMode(false);
        showModalMessage("Perubahan berhasil disimpan.", "success");
        await loadLaporanPage();

    } catch (err) {
        console.error("Gagal menyimpan perubahan:", err);
        showModalMessage("Gagal menyimpan: " + err.message, "danger");
    } finally {
        btnSimpan.disabled = false;
        btnBatal.disabled = false;
        btnSimpan.innerHTML = origHtml;
    }
}

function resetModalState() {
    modalPhotoReq++;
    modalContext = { tab: null, row: null };
    document.getElementById("mdFotoWrapper").innerHTML = "";
    showModalMessage("", "");
}


// ===================================================
// 11. HAPUS BARIS (khusus tab Laporan)
// Menghapus PERMANEN baris dari tabel stg_public.sisa_wrapping.
// Hanya baris aktif (is_active = true) yang bisa dihapus.
// ===================================================
function setupDeleteAction() {
    document.getElementById("laporanTableBody")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-delete-row");
        if (!btn) return;
        deleteLaporanRow(btn.getAttribute("data-id"), btn);
    });
}

async function deleteLaporanRow(id, btn) {
    const row = laporanState.data.find(r => String(r.id) === String(id));
    if (!row) {
        alert("Data tidak ditemukan pada halaman saat ini.");
        return;
    }

    // Konfirmasi dulu -- penghapusan tidak bisa dibatalkan
    const ok = confirm(
        "Hapus data ini secara permanen?\n\n" +
        `Kode Artikel : ${row.kode_artikel || "-"}\n` +
        `Batch Number : ${row.batch_number || "-"}\n` +
        `Qty          : ${row.qty ?? "-"}\n` +
        `Tanggal Masuk: ${formatTanggal(row.tanggal_masuk) || "-"}\n\n` +
        "Tindakan ini TIDAK dapat dibatalkan."
    );
    if (!ok) return;

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
        // .select("id") dipakai untuk memastikan ada baris yang benar-benar terhapus
        const { data, error } = await supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping")
            .delete()
            .eq("id", row.id)
            .eq("is_active", true)
            .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
            alert("Tidak ada data yang terhapus. Kemungkinan data sudah tidak aktif atau sudah dihapus, atau akun ini tidak punya izin menghapus.");
            return;
        }

        // Jika yang dihapus adalah satu-satunya baris di halaman ini, mundur satu halaman
        if (laporanState.data.length === 1 && laporanState.page > 1) laporanState.page--;
        await loadLaporanPage();

    } catch (err) {
        console.error("Gagal menghapus data:", err);
        alert("Gagal menghapus data: " + err.message);
    } finally {
        // Jika baris sudah dirender ulang, tombol lama tidak ada lagi -- aman diabaikan
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
}