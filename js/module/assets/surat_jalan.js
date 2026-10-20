// ===================================================
// surat_jalan.js
// Halaman "Surat Jalan"
// Baca : ga.surat_jalan (daftar batch), ga.stock_out_detail_view (isi barang),
//        ga.stock_out_opsi_filter (pilihan filter)
// PDF  : dibuat di browser memakai jsPDF + jsPDF-AutoTable (kertas A4)
// WAJIB: jalankan surat_jalan.sql (dan sebelumnya barang_keluar.sql) di Supabase.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const DB_SCHEMA = "ga";
const VIEW_SJ = "surat_jalan";
const VIEW_DETAIL = "stock_out_detail_view";
const VIEW_OPSI = "stock_out_opsi_filter";
const ROWS_PER_PAGE = 100;               // baris maksimal per halaman

// Cabang: branch_id -> nama tab
const BRANCHES = { 2: "Makassar", 1: "Surabaya" };
const DEFAULT_BRANCH = 2;                // Makassar

// Sesi login & hak akses
const SESSION_KEY = "erp_session";       // key sesi login di browser (JSON)
const ROLE_IDS_ALL_BRANCH = [1, 2];      // roleId 1 = Maintenance, 2 = Superadmin: boleh pindah cabang
// PERLU DISESUAIKAN: nama field cabang di erp_session (sesi Anda belum memuatnya).
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// PDF
// PERLU DICEK: path logo dihitung dari halaman ini (modules/assets/surat_jalan.html).
// Jika logo tidak ditemukan, PDF tetap dibuat tanpa logo.
const LOGO_PATH = "../../assets/images/logo-dmb.jpg";
const COMPANY_NAME = "PT. DUTA MAKMUR BERSAMA";
const COLOR_BRAND = [170, 24, 33];       // merah nama perusahaan (RGB)

// Filter checklist: key -> judul (jenis di view stock_out_opsi_filter), kolom di ga.surat_jalan
const FILTER_FIELDS = [
    { key: "department", label: "Departemen", column: "department_id", numeric: true },
    { key: "area", label: "Area", column: "area_id", numeric: true },
    { key: "periode", label: "Periode", column: "periode", numeric: false }
];

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ===================================================
const state = {
    branchId: DEFAULT_BRANCH,
    canSwitch: false,
    rows: [], totalRows: 0, page: 1, search: "", reqId: 0,
    filters: { dari: "", sampai: "", department: [], area: [], periode: [] },
    opsi: { department: [], area: [], periode: [] }
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// ===================================================
const $ = (id) => document.getElementById(id);
const ga = () => supabaseClient.schema(DB_SCHEMA);

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatQty(n) { return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n) || 0); }

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function parseIsoDate(s) {
    const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}
// Tabel: "Senin, 05 Okt 2026"
function formatTanggal(s) {
    if (!s) return "-";
    const d = parseIsoDate(s);
    if (isNaN(d)) return "-";
    return `${HARI[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
// PDF: "5 Oktober 2026"
function formatTanggalPanjang(s) {
    if (!s) return "-";
    const d = parseIsoDate(s);
    if (isNaN(d)) return "-";
    return `${d.getDate()} ${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}`;
}
// Urutan periode ("Oktober 2026" -> angka) agar terbaru di atas
function periodeSortKey(label) {
    const [bln, thn] = String(label).split(" ");
    const i = BULAN_PANJANG.indexOf(bln);
    return (parseInt(thn, 10) || 0) * 12 + (i < 0 ? 0 : i);
}
function branchName() { return BRANCHES[state.branchId] || `Cabang ${state.branchId}`; }

function showToast(text) {
    const t = $("ctToast");
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { t.style.display = "none"; }, 4000);
}
function setBusy(btn, busy, busyText) {
    if (busy) {
        btn.dataset.origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${busyText}`;
    } else {
        btn.disabled = false;
        if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    }
}

// ===================================================
// KELOMPOK 4: SESI LOGIN & HAK AKSES
// Fungsi: membaca erp_session. Maintenance (roleId 1) dan Superadmin
// (roleId 2) boleh pindah cabang. User lain hanya melihat cabangnya sendiri.
// CATATAN KEAMANAN: ini hanya mengatur tampilan di browser.
// ===================================================
function getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (err) { console.error("Sesi login tidak bisa dibaca:", err); return null; }
}
function canSwitchBranch(session) { return !!session && ROLE_IDS_ALL_BRANCH.includes(Number(session.roleId)); }
function getSessionBranchId(session) {
    if (!session) return null;
    for (const field of SESSION_BRANCH_FIELDS) {
        const n = parseInt(session[field], 10);
        if (!isNaN(n)) return n;
    }
    return null;
}
function blockPage(message) {
    $("branchTitle").textContent = "-";
    $("sjTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">${esc(message)}</td></tr>`;
    ["searchInput", "btnFilterToggle"].forEach(id => { $(id).disabled = true; });
}

// ===================================================
// KELOMPOK 5: INISIALISASI
// Fungsi: dijalankan saat halaman selesai dimuat.
//  - Maintenance / Superadmin: cabang awal dari ?branch_id=, lalu sesi, lalu default.
//  - User lain: cabang SELALU dari sesi; ?branch_id di alamat diabaikan.
// ===================================================
document.addEventListener("DOMContentLoaded", () => {
    const session = getSession();
    state.canSwitch = canSwitchBranch(session);
    const sessionBranch = getSessionBranchId(session);

    if (state.canSwitch) {
        const fromUrl = parseInt(new URLSearchParams(window.location.search).get("branch_id"), 10);
        state.branchId = BRANCHES[fromUrl] ? fromUrl : BRANCHES[sessionBranch] ? sessionBranch : DEFAULT_BRANCH;
        $("branchTabs").hidden = false;
    } else {
        $("branchTabs").hidden = true;
        if (!session) { blockPage("Sesi login tidak ditemukan. Silakan login ulang."); return; }
        if (!BRANCHES[sessionBranch]) { blockPage("Cabang akun Anda tidak terdeteksi. Hubungi admin."); return; }
        state.branchId = sessionBranch;
    }

    setupTabs();
    setupSearch();
    setupFilterPanel();
    $("sjTableBody").addEventListener("click", onTableClick);
    updateTabUi();
    loadOpsi();
    loadPage();
});

// ===================================================
// KELOMPOK 6: TAB CABANG
// Fungsi: pindah Makassar / Surabaya (khusus Maintenance & Superadmin).
// Filter direset karena pilihannya berbeda tiap cabang.
// ===================================================
function setupTabs() {
    document.querySelectorAll(".ct-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.branch, 10);
            if (!state.canSwitch || id === state.branchId) return;
            state.branchId = id;
            state.page = 1;
            state.filters = { dari: "", sampai: "", department: [], area: [], periode: [] };
            $("fltDari").value = ""; $("fltSampai").value = "";
            updateTabUi();
            updateFilterBadge();

            const url = new URL(window.location.href);
            url.searchParams.set("branch_id", String(id));
            window.history.replaceState(null, "", url);

            loadOpsi();
            loadPage();
        });
    });
}
function updateTabUi() {
    document.querySelectorAll(".ct-tab").forEach(btn => {
        const active = parseInt(btn.dataset.branch, 10) === state.branchId;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    $("branchTitle").textContent = branchName();
    if (state.canSwitch) $("btnBack").href = `catalog.html?branch_id=${state.branchId}`;
}

// ===================================================
// KELOMPOK 7: SEARCH & FILTER
// Fungsi: Search di kode batch dan area. Filter: tanggal kirim (dari-sampai),
// departemen, area, periode (pilihan diambil dari data cabang ini).
// ===================================================
function buildSearchOrClause(keyword) {
    const safe = keyword.replace(/[\\"]/g, "\\$&");
    const pattern = `"%${safe}%"`;
    return `kode_batch.ilike.${pattern},area_name.ilike.${pattern}`;
}

function applyFilters(query) {
    const f = state.filters;
    if (state.search) query = query.or(buildSearchOrClause(state.search));
    if (f.dari) query = query.gte("tanggal", f.dari);
    if (f.sampai) query = query.lte("tanggal", f.sampai);
    FILTER_FIELDS.forEach(field => {
        const sel = f[field.key];
        if (sel.length > 0) query = query.in(field.column, field.numeric ? sel.map(Number) : sel);
    });
    return query;
}

function setupSearch() {
    const input = $("searchInput");
    let timer = null;
    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.search = input.value.trim(); state.page = 1; loadPage(); }, 400);
    });
}

async function loadOpsi() {
    const branch = state.branchId;
    try {
        const { data, error } = await ga().from(VIEW_OPSI).select("jenis, nilai, label").eq("branch_id", branch);
        if (error) throw error;
        if (branch !== state.branchId) return;
        const opsi = { department: [], area: [], periode: [] };
        (data || []).forEach(r => {
            if (opsi[r.jenis]) opsi[r.jenis].push({ value: String(r.nilai), label: r.label || "-" });
        });
        opsi.department.sort((a, b) => a.label.localeCompare(b.label, "id"));
        opsi.area.sort((a, b) => a.label.localeCompare(b.label, "id"));
        opsi.periode.sort((a, b) => periodeSortKey(b.label) - periodeSortKey(a.label));
        state.opsi = opsi;
    } catch (err) {
        console.error("Gagal memuat pilihan filter:", err);
    }
    renderFilterGroups();
}

function renderFilterGroups() {
    const container = $("filterGroups");
    container.innerHTML = FILTER_FIELDS.map(f => {
        const selected = state.filters[f.key];
        const items = (state.opsi[f.key] || []).map(o => `
            <label class="filter-checkbox-item" data-search-text="${esc(o.label.toLowerCase())}">
                <input type="checkbox" value="${esc(o.value)}" ${selected.includes(o.value) ? "checked" : ""}>
                <span>${esc(o.label)}</span>
            </label>`).join("");
        return `
            <div class="filter-group">
                <button type="button" class="filter-group-header" data-target="fg_${f.key}">
                    <span>${f.label}</span><i class="fa-solid fa-chevron-down"></i>
                </button>
                <div class="filter-group-body" id="fg_${f.key}">
                    <input type="text" class="filter-inline-search" id="fs_${f.key}" placeholder="Cari...">
                    <div class="filter-checkbox-list" id="fl_${f.key}">${items || '<span class="data-empty-cell">Belum ada data</span>'}</div>
                </div>
            </div>`;
    }).join("");

    container.querySelectorAll(".filter-group-header").forEach(h => {
        h.addEventListener("click", (e) => {
            e.stopPropagation();
            h.classList.toggle("expanded");
            $(h.dataset.target).classList.toggle("expanded");
        });
    });
    FILTER_FIELDS.forEach(f => {
        const input = $(`fs_${f.key}`);
        input.addEventListener("input", () => {
            const kw = input.value.trim().toLowerCase();
            $(`fl_${f.key}`).querySelectorAll(".filter-checkbox-item").forEach(item => {
                item.style.display = (item.dataset.searchText || "").includes(kw) ? "flex" : "none";
            });
        });
    });
}

function setupFilterPanel() {
    const btn = $("btnFilterToggle");
    const panel = $("filterPanel");
    btn.addEventListener("click", (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; });
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && !btn.contains(e.target)) panel.hidden = true;
    });

    $("btnFilterApply").addEventListener("click", () => {
        const dari = $("fltDari").value, sampai = $("fltSampai").value;
        if (dari && sampai && dari > sampai) {
            alert("Tanggal \"Dari\" tidak boleh lebih besar dari \"Sampai\".");
            return;
        }
        state.filters.dari = dari;
        state.filters.sampai = sampai;
        FILTER_FIELDS.forEach(f => {
            state.filters[f.key] = Array.from(document.querySelectorAll(`#fl_${f.key} input:checked`)).map(cb => cb.value);
        });
        state.page = 1;
        updateFilterBadge();
        panel.hidden = true;
        loadPage();
    });

    $("btnFilterReset").addEventListener("click", () => {
        state.filters = { dari: "", sampai: "", department: [], area: [], periode: [] };
        $("fltDari").value = ""; $("fltSampai").value = "";
        state.page = 1;
        renderFilterGroups();
        updateFilterBadge();
        loadPage();
    });
}

function updateFilterBadge() {
    const f = state.filters;
    const total = (f.dari ? 1 : 0) + (f.sampai ? 1 : 0) + FILTER_FIELDS.reduce((sum, x) => sum + f[x.key].length, 0);
    const badge = $("filterCountBadge");
    badge.textContent = total;
    badge.hidden = total === 0;
}

// ===================================================
// KELOMPOK 8: TABEL UTAMA
// Fungsi: mengambil 100 baris per halaman dari ga.surat_jalan untuk cabang
// terpilih, diurutkan tanggal kirim terbaru di atas.
// ===================================================
const SJ_COLUMNS = "batch_id, kode_batch, tanggal, pemohon, nama_pemohon, branch_id, department_id, department_name, area_id, area_name, periode, petugas, nama_petugas, created_at";

async function loadPage() {
    const myReq = ++state.reqId;
    $("sjTableBody").innerHTML = `<tr class="row-loading"><td colspan="8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    try {
        let query = ga().from(VIEW_SJ).select(SJ_COLUMNS, { count: "exact" }).eq("branch_id", state.branchId);
        query = applyFilters(query);
        const start = (state.page - 1) * ROWS_PER_PAGE;
        query = query
            .order("tanggal", { ascending: false })
            .order("created_at", { ascending: false })
            .order("batch_id", { ascending: false })
            .range(start, start + ROWS_PER_PAGE - 1);
        const { data, error, count } = await query;
        if (myReq !== state.reqId) return;
        if (error) throw error;
        state.rows = data || [];
        state.totalRows = count || 0;
        renderTable();
        renderPagination();
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat surat jalan:", err);
        $("sjTableBody").innerHTML = `<tr class="row-empty"><td colspan="8">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

function renderTable() {
    const tbody = $("sjTableBody");
    if (state.rows.length === 0) {
        const filtered = state.search || state.filters.dari || state.filters.sampai
            || FILTER_FIELDS.some(f => state.filters[f.key].length > 0);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="8">${filtered ? "Tidak ada data yang cocok dengan pencarian / filter." : "Belum ada surat jalan untuk cabang ini."}</td></tr>`;
        return;
    }
    const start = (state.page - 1) * ROWS_PER_PAGE;
    const dash = `<span class="data-empty-cell">-</span>`;
    tbody.innerHTML = state.rows.map((r, i) => `
        <tr>
            <td class="col-no">${start + i + 1}</td>
            <td class="col-dl"><button type="button" class="btn-dl" data-batch="${esc(r.batch_id)}" title="Download surat jalan (PDF)"><i class="fa-solid fa-file-pdf"></i> PDF</button></td>
            <td>${esc(formatTanggal(r.tanggal))}</td>
            <td>${esc(r.kode_batch)}</td>
            <td>${r.nama_pemohon || r.pemohon ? esc(r.nama_pemohon || r.pemohon) : dash}</td>
            <td>${r.department_name ? esc(r.department_name) : dash}</td>
            <td>${r.area_name ? esc(r.area_name) : dash}</td>
            <td>${r.periode ? esc(r.periode) : dash}</td>
        </tr>`).join("");
}

function renderPagination() {
    const container = $("sjPagination");
    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);
    if (totalPages <= 1) {
        container.innerHTML = state.totalRows > 0 ? `<span class="ct-page-info">${state.totalRows} surat jalan</span>` : "";
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
    html += `<span class="ct-page-info">${state.totalRows} surat jalan</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); loadPage(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadPage(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadPage(); } };
}

// ===================================================
// KELOMPOK 9: DOWNLOAD SURAT JALAN (PDF)
// Fungsi: klik tombol PDF -> ambil isi barang batch itu -> buat PDF A4
// di browser -> terunduh sebagai file. Tidak ada data yang dikirim ke
// server lain. Isi barang dibaca dari stock_out_detail_view.
// ===================================================
function onTableClick(e) {
    const btn = e.target.closest(".btn-dl");
    if (btn) downloadSuratJalan(btn.dataset.batch, btn);
}

async function downloadSuratJalan(batchId, btn) {
    const row = state.rows.find(r => String(r.batch_id) === String(batchId));
    if (!row) { showToast("Data tidak ditemukan. Muat ulang halaman."); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        showToast("Pustaka PDF belum termuat. Periksa koneksi internet, lalu muat ulang halaman.");
        return;
    }

    setBusy(btn, true, "...");
    try {
        const { data, error } = await ga().from(VIEW_DETAIL)
            .select("kode_barang, nama_barang, satuan, qty")
            .eq("batch_id", batchId)
            .order("kode_barang", { ascending: true });
        if (error) throw error;

        const logo = await loadLogo();
        const doc = buildSuratJalanPdf(row, data || [], logo);
        doc.save(buildFileName(row));
    } catch (err) {
        console.error("Gagal membuat PDF:", err);
        showToast("Gagal membuat PDF: " + err.message);
    } finally {
        setBusy(btn, false);
    }
}

function buildFileName(row) {
    const clean = (s) => String(s || "").trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    const parts = ["Surat_Jalan", clean(row.kode_batch), clean(row.nama_pemohon || row.pemohon)].filter(Boolean);
    return parts.join("_") + ".pdf";
}

// Memuat logo sebagai data gambar (sekali saja). Mengembalikan null jika gagal.
let logoPromise = null;
function loadLogo() {
    if (!logoPromise) {
        logoPromise = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const c = document.createElement("canvas");
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    const ctx = c.getContext("2d");
                    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
                    ctx.drawImage(img, 0, 0);
                    resolve({ dataUrl: c.toDataURL("image/jpeg", 0.92), w: img.naturalWidth, h: img.naturalHeight });
                } catch (err) { console.warn("Logo tidak bisa diproses:", err); resolve(null); }
            };
            img.onerror = () => { console.warn("Logo tidak ditemukan di", LOGO_PATH); resolve(null); };
            img.src = LOGO_PATH;
        });
    }
    return logoPromise;
}

// Membuat dokumen PDF A4 portrait.
// Susunan: kop (logo + judul) -> data pemohon & pengiriman -> tabel barang
// (header berulang di tiap halaman) -> tanda tangan -> nomor halaman.
function buildSuratJalanPdf(batch, items, logo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = 210, pageH = 297, mL = 15, mR = 15;
    const dark = [30, 30, 30];

    // --- Kop surat ---
    let textX = mL;
    if (logo) {
        let h = 22, w = h * logo.w / logo.h;
        if (w > 60) { w = 60; h = w * logo.h / logo.w; }
        doc.addImage(logo.dataUrl, "JPEG", mL, 12, w, h);
        textX = mL + w + 6;
    }
    doc.setFont("times", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...dark);
    doc.text("SURAT JALAN", textX, 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...COLOR_BRAND);
    doc.text(COMPANY_NAME, textX, 32);
    doc.setDrawColor(...COLOR_BRAND);
    doc.setLineWidth(0.6);
    doc.line(mL, 38, pageW - mR, 38);

    // --- Data pemohon (kiri) dan pengiriman (kanan) ---
    const kiri = [
        ["Pemohon", batch.nama_pemohon || batch.pemohon],
        ["Departemen", batch.department_name],
        ["Area", batch.area_name]
    ];
    const kanan = [
        ["Kode Pengiriman", batch.kode_batch],
        ["Tanggal Kirim", formatTanggalPanjang(batch.tanggal)],
        ["Periode Permintaan", batch.periode]
    ];
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    let y = 46;
    const lh = 4.8;
    for (let i = 0; i < 3; i++) {
        const vl = doc.splitTextToSize(String(kiri[i][1] || "-"), 58);
        const vr = doc.splitTextToSize(String(kanan[i][1] || "-"), 48);
        doc.setFont("helvetica", "normal");
        doc.text(kiri[i][0], mL, y);
        doc.text(":", mL + 27, y);
        doc.text(vl, mL + 30, y);
        doc.text(kanan[i][0], 108, y);
        doc.text(":", 142, y);
        doc.text(vr, 145, y);
        y += Math.max(vl.length, vr.length) * lh + 1.8;
    }

    // --- Tabel barang ---
    const body = items.length
        ? items.map(it => [it.kode_barang || "", it.nama_barang || "", formatQty(it.qty), it.satuan || "", ""])
        : [[{ content: "Tidak ada barang.", colSpan: 5, styles: { halign: "center" } }]];

    doc.autoTable({
        startY: y + 3,
        head: [["Kode Barang", "Nama Barang", "Qty", "Satuan", "Keterangan"]],
        body,
        theme: "grid",
        margin: { left: mL, right: mR, top: 18, bottom: 22 },
        styles: { font: "helvetica", fontSize: 9, cellPadding: 1.7, lineColor: [90, 90, 90], lineWidth: 0.2, textColor: dark, valign: "middle", overflow: "linebreak" },
        headStyles: { fillColor: [225, 236, 245], textColor: dark, fontStyle: "bold", halign: "center" },
        alternateRowStyles: { fillColor: [247, 249, 252] },
        columnStyles: {
            0: { cellWidth: 27, halign: "center" },
            1: { cellWidth: "auto" },
            2: { cellWidth: 20, halign: "right" },
            3: { cellWidth: 22, halign: "center" },
            4: { cellWidth: 38 }
        }
    });

    // --- Tanda tangan (pindah halaman jika tidak muat) ---
    let sy = doc.lastAutoTable.finalY + 14;
    if (sy + 48 > pageH - 18) { doc.addPage(); sy = 28; }
    const cols = [
        { x: 15, label: "Petugas Gudang", nama: batch.nama_petugas || "" },
        { x: 80, label: "Dikirim Oleh", nama: "" },
        { x: 145, label: "Diterima Oleh", nama: "" }
    ];
    doc.setTextColor(...dark);
    cols.forEach(c => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(c.label, c.x, sy);
        const ny = sy + 32;
        doc.text("Nama :", c.x, ny);
        doc.setLineWidth(0.3);
        doc.setDrawColor(...dark);
        doc.line(c.x + 14, ny + 1, c.x + 50, ny + 1);
        if (c.nama) {                       // nama petugas: kecilkan huruf bila terlalu panjang
            let fs = 9;
            doc.setFontSize(fs);
            while (fs > 6 && doc.getTextWidth(c.nama) > 35) { fs -= 0.5; doc.setFontSize(fs); }
            doc.text(c.nama, c.x + 15, ny - 0.5);
        }
    });

    // --- Footer di semua halaman ---
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(String(batch.kode_batch || ""), mL, pageH - 10);
        doc.text(`Halaman ${p} dari ${total}`, pageW - mR, pageH - 10, { align: "right" });
    }
    return doc;
}