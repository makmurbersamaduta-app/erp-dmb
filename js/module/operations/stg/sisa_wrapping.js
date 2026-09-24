<<<<<<< HEAD
// ===================================================
// js/module/operations/stg/sisa_wrapping.js
// Halaman Laporan Sisa Wrapping (stg_public.sisa_wrapping_view)
// 2 tab: Laporan (is_active=true) & History (is_active=false)
// Server-side pagination -- 100 baris per halaman.
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
let referenceData = { kode_artikel: [], nama_barang: [], customer: [] };

let laporanState = {
    filters: { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "" },
    page: 1,
    totalRows: 0,
    data: []
};

let historyState = {
    filters: { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "", tglKeluarDari: "", tglKeluarSampai: "" },
    page: 1,
    totalRows: 0,
    data: []
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
    const { data, error } = await supabaseClient
        .schema("stg_public")
        .rpc("get_sisa_wrapping_filter_options");

    if (error) {
        console.error("Gagal memuat opsi filter:", error.message);
        return;
    }

    referenceData.kode_artikel = data?.kode_artikel || [];
    referenceData.nama_barang = data?.nama_barang || [];
    referenceData.customer = data?.customer || [];
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
        const values = referenceData[field.column] || [];
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
    const tbody = document.getElementById("laporanTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="10"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*", { count: "exact" })
            .eq("is_active", true);

        const f = laporanState.filters;
        if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
        if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
        if (f.customer.length > 0) query = query.in("customer", f.customer);
        if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
        if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);

        const start = (laporanState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("created_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
        if (error) throw error;

        laporanState.data = data || [];
        laporanState.totalRows = count || 0;

        renderLaporanTable();
        renderPagination("laporanPagination", laporanState, loadLaporanPage);

    } catch (err) {
        console.error("Gagal memuat data laporan:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

function renderLaporanTable() {
    const tbody = document.getElementById("laporanTableBody");
    if (laporanState.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (laporanState.page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = laporanState.data.map((row, index) => `
        <tr>
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
    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="12"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*", { count: "exact" })
            .eq("is_active", false);

        const f = historyState.filters;
        if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
        if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
        if (f.customer.length > 0) query = query.in("customer", f.customer);
        if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
        if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);
        if (f.tglKeluarDari) query = query.gte("tanggal_out", f.tglKeluarDari);
        if (f.tglKeluarSampai) query = query.lte("tanggal_out", f.tglKeluarSampai);

        const start = (historyState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("update_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
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
        <tr>
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
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*")
            .eq("is_active", true);

        // Terapkan filter yang SAMA PERSIS dengan tampilan tabel Laporan
        const f = laporanState.filters;
        if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
        if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
        if (f.customer.length > 0) query = query.in("customer", f.customer);
        if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
        if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);

        query = query.order("created_at", { ascending: false });

        // Ambil SEMUA baris (tanpa .range() 100 baris) -- diambil bertahap
        // per 1000 baris kalau datanya besar, mengikuti batas default
        // PostgREST per-request.
        let allRows = [];
        let start = 0;
        const CHUNK = 1000;
        while (true) {
            const { data: chunkData, error: chunkErr } = await query.range(start, start + CHUNK - 1);
            if (chunkErr) throw chunkErr;
            allRows = allRows.concat(chunkData || []);
            if (!chunkData || chunkData.length < CHUNK) break;
            start += CHUNK;
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
=======
// ===================================================
// js/module/operations/stg/sisa_wrapping.js
// Halaman Laporan Sisa Wrapping (stg_public.sisa_wrapping_view)
// 2 tab: Laporan (is_active=true) & History (is_active=false)
// Server-side pagination -- 100 baris per halaman.
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
let referenceData = { kode_artikel: [], nama_barang: [], customer: [] };

let laporanState = {
    filters: { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "" },
    page: 1,
    totalRows: 0,
    data: []
};

let historyState = {
    filters: { kodeArtikel: [], namaBarang: [], customer: [], tglMasukDari: "", tglMasukSampai: "", tglKeluarDari: "", tglKeluarSampai: "" },
    page: 1,
    totalRows: 0,
    data: []
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
    const { data, error } = await supabaseClient
        .schema("stg_public")
        .rpc("get_sisa_wrapping_filter_options");

    if (error) {
        console.error("Gagal memuat opsi filter:", error.message);
        return;
    }

    referenceData.kode_artikel = data?.kode_artikel || [];
    referenceData.nama_barang = data?.nama_barang || [];
    referenceData.customer = data?.customer || [];
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
        const values = referenceData[field.column] || [];
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
    const tbody = document.getElementById("laporanTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="10"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*", { count: "exact" })
            .eq("is_active", true);

        const f = laporanState.filters;
        if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
        if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
        if (f.customer.length > 0) query = query.in("customer", f.customer);
        if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
        if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);

        const start = (laporanState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("created_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
        if (error) throw error;

        laporanState.data = data || [];
        laporanState.totalRows = count || 0;

        renderLaporanTable();
        renderPagination("laporanPagination", laporanState, loadLaporanPage);

    } catch (err) {
        console.error("Gagal memuat data laporan:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

function renderLaporanTable() {
    const tbody = document.getElementById("laporanTableBody");
    if (laporanState.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (laporanState.page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = laporanState.data.map((row, index) => `
        <tr>
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
    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="12"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*", { count: "exact" })
            .eq("is_active", false);

        const f = historyState.filters;
        if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
        if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
        if (f.customer.length > 0) query = query.in("customer", f.customer);
        if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
        if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);
        if (f.tglKeluarDari) query = query.gte("tanggal_out", f.tglKeluarDari);
        if (f.tglKeluarSampai) query = query.lte("tanggal_out", f.tglKeluarSampai);

        const start = (historyState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("update_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
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
        <tr>
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
        let query = supabaseClient
            .schema("stg_public")
            .from("sisa_wrapping_view")
            .select("*")
            .eq("is_active", true);

        // Terapkan filter yang SAMA PERSIS dengan tampilan tabel Laporan
        const f = laporanState.filters;
        if (f.kodeArtikel.length > 0) query = query.in("kode_artikel", f.kodeArtikel);
        if (f.namaBarang.length > 0) query = query.in("nama_barang", f.namaBarang);
        if (f.customer.length > 0) query = query.in("customer", f.customer);
        if (f.tglMasukDari) query = query.gte("tanggal_masuk", f.tglMasukDari);
        if (f.tglMasukSampai) query = query.lte("tanggal_masuk", f.tglMasukSampai);

        query = query.order("created_at", { ascending: false });

        // Ambil SEMUA baris (tanpa .range() 100 baris) -- diambil bertahap
        // per 1000 baris kalau datanya besar, mengikuti batas default
        // PostgREST per-request.
        let allRows = [];
        let start = 0;
        const CHUNK = 1000;
        while (true) {
            const { data: chunkData, error: chunkErr } = await query.range(start, start + CHUNK - 1);
            if (chunkErr) throw chunkErr;
            allRows = allRows.concat(chunkData || []);
            if (!chunkData || chunkData.length < CHUNK) break;
            start += CHUNK;
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
>>>>>>> 3d00068 (Initial commit Web ERP)
}