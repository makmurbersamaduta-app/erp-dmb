// ===================================================
// barang_keluar.js
// Halaman "Data Barang Keluar"
// Baca : ga.stock_out_detail_view, ga.stock_out_opsi_filter, ga.stock_view,
//        ga.v_request_open, ga.v_request_sisa, ga.v_pemohon_gudang, ga.data_barang
// Tulis: lewat fungsi database ga.simpan_stock_out / ga.ubah_stock_out
//        (satu transaksi: semua tersimpan atau tidak sama sekali)
// WAJIB: jalankan barang_keluar.sql di Supabase terlebih dulu.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const DB_SCHEMA = "ga";
const ROWS_PER_PAGE = 100;              // baris maksimal per halaman tabel utama
const MODAL_START_ROWS = 5;             // baris kosong awal (mode Non-Request)
const MODAL_MAX_ROWS = 50;              // batas baris (mode Non-Request)
const SUGGEST_LIMIT = 15;               // jumlah saran Kode Barang

// Nama view / fungsi di database
const VIEW_DETAIL = "stock_out_detail_view";
const VIEW_OPSI = "stock_out_opsi_filter";
const VIEW_STOCK = "stock_view";
const VIEW_REQUEST_OPEN = "v_request_open";
const VIEW_REQUEST_SISA = "v_request_sisa";
const VIEW_PEMOHON = "v_pemohon_gudang";
const RPC_SIMPAN = "simpan_stock_out";
const RPC_UBAH = "ubah_stock_out";
const RPC_NEXT_KODE = "next_kode_batch";

// Cabang: branch_id -> nama tab
const BRANCHES = { 2: "Makassar", 1: "Surabaya" };
const DEFAULT_BRANCH = 2;   // Makassar

// Sesi login & hak akses
const SESSION_KEY = "erp_session";          // key sesi login di browser (JSON)
const ROLE_IDS_ALL_BRANCH = [1, 2];         // roleId 1 = Maintenance, 2 = Superadmin: boleh pindah cabang + edit
// PERLU DISESUAIKAN: nama field cabang di erp_session (sesi Anda belum memuatnya).
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// Pencarian Kode Barang (Non-Request) hanya menampilkan barang yang tidak bernilai false di kolom cabang.
const BATASI_BARANG_PER_CABANG = true;

// Hanya permintaan dengan status ini yang muncul di dropdown "Kode Request"
// (harus sama persis dengan penulisan status di ga.request_batch, termasuk huruf besar/kecil).
const REQUEST_STATUS_SIAP_KIRIM = "Disetujui";
const BRANCH_FLAG_COLUMN = { 2: "is_makassar", 1: "is_surabaya" };

// Filter di panel Filter: key -> judul (jenis di view stock_out_opsi_filter)
const FILTER_FIELDS = [
    { key: "department", label: "Departemen", column: "department_id", numeric: true },
    { key: "area", label: "Area", column: "area_id", numeric: true },
    { key: "periode", label: "Periode", column: "periode_request", numeric: false },
    { key: "kategori", label: "Kategori", column: "kategori_id", numeric: true }
];

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ===================================================
const state = {
    branchId: DEFAULT_BRANCH,
    canSwitch: false,    // true = Maintenance / Superadmin (tab cabang + edit)
    rows: [], totalRows: 0, page: 1, search: "", reqId: 0,
    filters: { department: [], area: [], periode: [], kategori: [] },
    opsi: { department: [], area: [], periode: [], kategori: [] }
};

// State modal. mode: "add" | "edit". rows[i]:
// { kode, item, text, qty (angka/null), isNew, max, maxKode, listId, origNew, origQty }
let M = freshModal();
function freshModal() {
    return {
        mode: null, isRequest: true, batchId: null, origCount: 0,
        rows: [], sisaItems: [], request: null,
        requestOpts: null, pemohonOpts: null,
        stock: {},       // kode -> { baru, second }
        ownOut: {},      // "kode|isNew" -> qty milik batch yang sedang diedit (dikembalikan ke stok)
        reqSeq: 0, saving: false
    };
}
const suggest = { items: [], active: -1, rowIdx: -1, timer: null, reqId: 0, box: null, kind: "kode" };

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
function formatInt(n) { return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(n) || 0); }

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// "2026-10-05" -> Date lokal (tanpa pergeseran zona waktu)
function parseIsoDate(s) {
    const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}
// "Senin, 05 Okt 2026"
function formatTanggal(s) {
    if (!s) return "-";
    const d = parseIsoDate(s);
    if (isNaN(d)) return "-";
    return `${HARI[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
function todayLocalIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// "2026-10-05" -> "Oktober 2026"
function periodeFromIso(iso) {
    if (!iso) return "";
    const d = parseIsoDate(iso);
    return isNaN(d) ? "" : `${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}`;
}
// Kunci pengurutan periode ("Oktober 2026" -> angka), supaya urutan per bulan, bukan abjad
function periodeSortKey(label) {
    const [bln, thn] = String(label).split(" ");
    const i = BULAN_PANJANG.indexOf(bln);
    return (parseInt(thn, 10) || 0) * 12 + (i < 0 ? 0 : i);
}

function branchName() { return BRANCHES[state.branchId] || `Cabang ${state.branchId}`; }

function showMsg(text, type) {
    const el = $("mkMessage");
    if (!text) { el.classList.add("d-none"); el.textContent = ""; return; }
    el.className = `alert py-2 small alert-${type || "danger"}`;
    el.style.whiteSpace = "pre-line";
    el.textContent = text;
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
// (roleId 2) boleh pindah cabang dan mengedit. User lain hanya melihat
// cabangnya sendiri dan hanya bisa input.
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
function getCurrentUsername() {
    const nik = getSession()?.nik;
    return nik ? String(nik).trim() : null;
}
function blockPage(message) {
    $("branchTitle").textContent = "-";
    $("stockOutTableBody").innerHTML = `<tr class="row-empty"><td colspan="12">${esc(message)}</td></tr>`;
    ["searchInput", "btnFilterToggle", "btnBarangKeluar"].forEach(id => { $(id).disabled = true; });
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
    setupModal();
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
            state.filters = { department: [], area: [], periode: [], kategori: [] };
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
// Fungsi: Search di kode barang, nama barang, kategori. Filter berdasarkan
// Departemen, Area, Periode, Kategori (pilihan diambil dari data cabang ini).
// ===================================================
function buildSearchOrClause(keyword) {
    const safe = keyword.replace(/[\\"]/g, "\\$&");
    const pattern = `"%${safe}%"`;
    return `kode_barang.ilike.${pattern},nama_barang.ilike.${pattern},kategori.ilike.${pattern}`;
}

function applyFilters(query) {
    if (state.search) query = query.or(buildSearchOrClause(state.search));
    FILTER_FIELDS.forEach(f => {
        const sel = state.filters[f.key];
        if (sel.length > 0) query = query.in(f.column, f.numeric ? sel.map(Number) : sel);
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
        const opsi = { department: [], area: [], periode: [], kategori: [] };
        (data || []).forEach(r => {
            if (opsi[r.jenis]) opsi[r.jenis].push({ value: String(r.nilai), label: r.label || "-" });
        });
        opsi.department.sort((a, b) => a.label.localeCompare(b.label, "id"));
        opsi.area.sort((a, b) => a.label.localeCompare(b.label, "id"));
        opsi.kategori.sort((a, b) => a.label.localeCompare(b.label, "id"));
        opsi.periode.sort((a, b) => periodeSortKey(b.label) - periodeSortKey(a.label));   // terbaru di atas
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
        FILTER_FIELDS.forEach(f => {
            state.filters[f.key] = Array.from(document.querySelectorAll(`#fl_${f.key} input:checked`)).map(cb => cb.value);
        });
        state.page = 1;
        updateFilterBadge();
        panel.hidden = true;
        loadPage();
    });
    $("btnFilterReset").addEventListener("click", () => {
        state.filters = { department: [], area: [], periode: [], kategori: [] };
        state.page = 1;
        renderFilterGroups();
        updateFilterBadge();
        loadPage();
    });
}
function updateFilterBadge() {
    const total = FILTER_FIELDS.reduce((sum, f) => sum + state.filters[f.key].length, 0);
    const badge = $("filterCountBadge");
    badge.textContent = total;
    badge.hidden = total === 0;
}

// ===================================================
// KELOMPOK 8: TABEL UTAMA
// Fungsi: mengambil 100 baris per halaman dari stock_out_detail_view untuk
// cabang terpilih. Urutan: Area (A-Z) -> tanggal terbaru -> batch terbaru.
// Setiap pergantian Area diberi baris judul kelompok.
// ===================================================
const DETAIL_COLUMNS = "list_id, batch_id, kode_batch, tanggal, kode_barang, nama_barang, satuan, qty, is_new, kategori, department_name, area_name, periode_request";

async function loadPage() {
    const myReq = ++state.reqId;
    $("stockOutTableBody").innerHTML = `<tr class="row-loading"><td colspan="12"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    try {
        let query = ga().from(VIEW_DETAIL).select(DETAIL_COLUMNS, { count: "exact" }).eq("branch_id", state.branchId);
        query = applyFilters(query);
        const start = (state.page - 1) * ROWS_PER_PAGE;
        query = query
            .order("area_name", { ascending: true, nullsFirst: false })
            .order("tanggal", { ascending: false })
            .order("batch_id", { ascending: false })
            .order("kode_barang", { ascending: true })
            .order("list_id", { ascending: true })
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
        console.error("Gagal memuat data barang keluar:", err);
        $("stockOutTableBody").innerHTML = `<tr class="row-empty"><td colspan="12">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

function renderTable() {
    const tbody = $("stockOutTableBody");
    if (state.rows.length === 0) {
        const filtered = state.search || FILTER_FIELDS.some(f => state.filters[f.key].length > 0);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="12">${filtered ? "Tidak ada data yang cocok dengan pencarian / filter." : "Belum ada data barang keluar untuk cabang ini."}</td></tr>`;
        return;
    }
    const start = (state.page - 1) * ROWS_PER_PAGE;
    const dash = `<span class="data-empty-cell">-</span>`;
    const empty = `<span class="qty-zero">-</span>`;
    const clickable = state.canSwitch ? "row-clickable" : "";
    let lastGroup = null;
    let html = "";

    state.rows.forEach((r, i) => {
        const group = r.area_name || "";
        if (group !== lastGroup) {
            html += `<tr class="row-group"><td colspan="12"><i class="fa-solid fa-location-dot"></i> ${group ? esc(group) : "Tanpa Area"}</td></tr>`;
            lastGroup = group;
        }
        const qty = formatQty(r.qty);
        html += `
            <tr class="${clickable}" data-batch="${esc(r.batch_id)}">
                <td class="col-no">${start + i + 1}</td>
                <td>${esc(formatTanggal(r.tanggal))}</td>
                <td>${esc(r.kode_barang)}</td>
                <td>${r.nama_barang ? esc(r.nama_barang) : dash}</td>
                <td class="col-qty">${r.is_new === true ? qty : empty}</td>
                <td class="col-qty">${r.is_new === true ? empty : qty}</td>
                <td>${r.satuan ? esc(r.satuan) : dash}</td>
                <td>${r.is_new === true ? '<span class="badge-status badge-new">New</span>' : '<span class="badge-status badge-second">Second</span>'}</td>
                <td>${r.kategori ? esc(r.kategori) : dash}</td>
                <td>${r.department_name ? esc(r.department_name) : dash}</td>
                <td>${r.area_name ? esc(r.area_name) : dash}</td>
                <td>${r.periode_request ? esc(r.periode_request) : dash}</td>
            </tr>`;
    });
    tbody.innerHTML = html;

    // Klik baris -> modal edit untuk batch baris itu (hanya Maintenance & Superadmin)
    if (state.canSwitch) {
        tbody.querySelectorAll("tr.row-clickable").forEach(tr => {
            tr.addEventListener("click", () => openEditModal(tr.dataset.batch));
        });
    }
}

function renderPagination() {
    const container = $("stockOutPagination");
    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);
    if (totalPages <= 1) {
        container.innerHTML = state.totalRows > 0 ? `<span class="ct-page-info">${state.totalRows} baris</span>` : "";
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
    html += `<span class="ct-page-info">${state.totalRows} baris</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); loadPage(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadPage(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadPage(); } };
}

// ===================================================
// KELOMPOK 9: MODAL - PEMASANGAN TOMBOL & KEJADIAN
// Fungsi: memasang semua tombol di modal, kotak saran melayang, dan
// penanganan ketikan di tabel barang (satu pendengar untuk semua baris).
// ===================================================
function setupModal() {
    $("btnBarangKeluar").addEventListener("click", openAddModal);
    $("btnMkSimpan").addEventListener("click", () => {
        if (M.mode === "add") saveAdd();
        else if (M.mode === "edit") saveEdit();
    });

    // Pilihan Request / Non-Request
    $("segJenis").addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (btn) setJenis(btn.dataset.val === "true");
    });

    $("fTanggal").addEventListener("change", () => {
        if (M.mode !== "add") return;
        refreshKodeBatch();
        updatePeriode();
    });
    $("fKodeRequest").addEventListener("change", onRequestChange);
    $("fPemohonSel").addEventListener("change", onPemohonChange);
    $("btnTambahItem").addEventListener("click", showMissingMenu);

    // Kotak saran / menu "Tambah" (dipasang di dalam elemen modal agar tampil di atas modal)
    suggest.box = document.createElement("div");
    suggest.box.className = "ks-box";
    suggest.box.style.display = "none";
    $("modalKeluar").appendChild(suggest.box);
    suggest.box.addEventListener("mousedown", (e) => {
        e.preventDefault();      // jangan pindahkan fokus dari kolom Kode Barang
        const el = e.target.closest(".ks-item");
        if (el) pickSuggestion(parseInt(el.dataset.k, 10));
    });
    document.addEventListener("scroll", (e) => { if (e.target !== suggest.box) hideSuggest(); }, true);
    document.addEventListener("mousedown", (e) => {
        if (suggest.kind === "missing" && suggest.box.style.display !== "none"
            && !suggest.box.contains(e.target) && e.target.closest("#btnTambahItem") === null) hideSuggest();
    });

    $("modalKeluar").addEventListener("hidden.bs.modal", () => {
        hideSuggest();
        M = freshModal();
        showMsg("", "");
    });

    const tbody = $("mkTbody");
    tbody.addEventListener("input", (e) => {
        const tr = e.target.closest("tr[data-i]");
        if (!tr) return;
        const i = parseInt(tr.dataset.i, 10);
        if (e.target.classList.contains("kode-input")) onKodeInput(i, e.target);
        else if (e.target.classList.contains("qty-input")) onQtyInput(i, e.target);
    });
    tbody.addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-i]");
        if (!tr) return;
        const i = parseInt(tr.dataset.i, 10);
        const segBtn = e.target.closest(".seg button");
        if (segBtn) {
            M.rows[i].isNew = segBtn.dataset.val === "true";
            segBtn.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === segBtn));
            refreshRowCalc(i);
            return;
        }
        if (e.target.closest(".btn-hapus-row")) removeRow(i);
    });
    tbody.addEventListener("keydown", (e) => {
        if (!e.target.classList.contains("kode-input") || suggest.kind !== "kode") return;
        if (suggest.box.style.display === "none") return;
        if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggest(-1); }
        else if (e.key === "Enter") { e.preventDefault(); pickSuggestion(suggest.active >= 0 ? suggest.active : 0); }
        else if (e.key === "Escape") { e.stopPropagation(); hideSuggest(); }
    });
    tbody.addEventListener("focusout", (e) => {
        if (e.target.classList.contains("kode-input")) setTimeout(() => { if (suggest.kind === "kode") hideSuggest(); }, 150);
    });
}

// ===================================================
// KELOMPOK 10: MODAL - BUKA MODE INPUT & PILIHAN JENIS
// Fungsi: membuka modal Input. Default jenis "Request". Mengganti jenis
// mengosongkan tabel barang. Kode batch yang tampil hanya PRATINJAU; nomor
// final ditetapkan database saat Simpan (aman jika dua orang menyimpan bersamaan).
// ===================================================
async function openAddModal() {
    M = freshModal();
    M.mode = "add";
    M.isRequest = true;

    $("mkTitle").textContent = `Barang Keluar - ${branchName()}`;
    $("fTanggal").value = todayLocalIso();
    resetHeaderFields();
    applyModeUi();
    M.rows = [];
    renderRows();
    updateCount();
    updateTambahBtn();
    showMsg("", "");
    bootstrap.Modal.getOrCreateInstance($("modalKeluar")).show();

    refreshKodeBatch();
    try {
        await ensureRequestOpts();
        populateRequestSelect();
    } catch (err) {
        showMsg("Gagal memuat daftar permintaan: " + err.message, "danger");
    }
}

function resetHeaderFields() {
    ["fKodeRequestTxt", "fPemohonTxt", "fDepartemen", "fArea", "fPeriode"].forEach(id => { $(id).value = ""; });
    $("fKodeRequest").value = "";
    $("fPemohonSel").value = "";
    M.request = null;
}

// Mengatur tampilan kolom sesuai mode (add/edit) dan jenis (Request / Non-Request)
function applyModeUi() {
    const add = M.mode === "add";
    const req = M.isRequest;

    $("segJenis").classList.toggle("disabled", !add);
    $("segJenis").querySelectorAll("button").forEach(b => b.classList.toggle("active", (b.dataset.val === "true") === req));
    $("fTanggal").readOnly = !add;

    // Kode Request: dropdown (input Request), teks (edit Request), disembunyikan (Non-Request)
    $("wrapKodeRequest").classList.toggle("d-none", !req);
    $("fKodeRequest").classList.toggle("d-none", !add);
    $("fKodeRequestTxt").classList.toggle("d-none", add);

    // Pemohon: dropdown hanya saat input Non-Request, selain itu teks
    const pemohonSelect = add && !req;
    $("fPemohonSel").classList.toggle("d-none", !pemohonSelect);
    $("fPemohonTxt").classList.toggle("d-none", pemohonSelect);

    $("thQtyInput").textContent = req ? "Permintaan" : "Keluar";
    $("kodeBatchNote").textContent = add ? "Nomor final ditetapkan saat disimpan." : "";
    $("btnTambahItem").classList.toggle("d-none", !(add && req));
    $("btnMkSimpan").innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan`;
}

function hasFilledRows() {
    return M.rows.some(r => r.item || (r.text || "").trim() !== "" || r.qty);
}

async function setJenis(isReq) {
    if (M.mode !== "add" || M.isRequest === isReq) return;
    if (hasFilledRows() && !confirm("Mengganti jenis akan mengosongkan isian barang. Lanjutkan?")) return;

    M.reqSeq++;                      // batalkan pemuatan permintaan yang sedang berjalan
    M.isRequest = isReq;
    M.sisaItems = [];
    resetHeaderFields();
    applyModeUi();
    showMsg("", "");
    hideSuggest();

    if (isReq) {
        M.rows = [];
        renderRows(); updateCount(); updateTambahBtn();
        try { await ensureRequestOpts(); populateRequestSelect(); }
        catch (err) { showMsg("Gagal memuat daftar permintaan: " + err.message, "danger"); }
    } else {
        M.rows = Array.from({ length: MODAL_START_ROWS }, makeEmptyRow);
        renderRows(); updateCount(); updateTambahBtn();
        updatePeriode();
        try { await ensurePemohonOpts(); populatePemohonSelect(); }
        catch (err) { showMsg("Gagal memuat daftar pemohon: " + err.message, "danger"); }
    }
}

async function refreshKodeBatch() {
    const tgl = $("fTanggal").value;
    const field = $("fKodeBatch");
    if (!tgl) { field.value = ""; return; }
    field.value = "...";
    try {
        const { data, error } = await ga().rpc(RPC_NEXT_KODE, { p_tanggal: tgl });
        if (error) throw error;
        if (tgl === $("fTanggal").value) field.value = data || "";
    } catch (err) {
        field.value = "";
        showMsg("Gagal membuat pratinjau kode batch: " + err.message, "warning");
    }
}

// Periode (Non-Request) = bulan dan tahun dari Tanggal, mis. "Oktober 2026"
function updatePeriode() {
    if (M.mode === "add" && !M.isRequest) $("fPeriode").value = periodeFromIso($("fTanggal").value);
}

// ===================================================
// KELOMPOK 11: MODAL - DATA PERMINTAAN & PEMOHON
// Fungsi: mengisi dropdown "Kode Request" (permintaan aktif cabang ini yang
// masih punya barang belum terkirim) dan dropdown Pemohon (karyawan bukan
// role employee). Memilih permintaan memuat barang yang BELUM terkirim lengkap.
// ===================================================
async function ensureRequestOpts() {
    if (M.requestOpts) return;
    const { data, error } = await ga().from(VIEW_REQUEST_OPEN)
        .select("id, kode_batch, pemohon, nama_pemohon, department_id, department_name, area_id, area_name, periode_permintaan")
        .eq("branch_id", state.branchId)
        .eq("status", REQUEST_STATUS_SIAP_KIRIM)
        .eq("ada_sisa", true)
        .order("kode_batch", { ascending: false });
    if (error) throw error;
    M.requestOpts = data || [];
}

function populateRequestSelect() {
    const sel = $("fKodeRequest");
    sel.innerHTML = `<option value="">Pilih Kode Request</option>` +
        (M.requestOpts || []).map(o =>
            `<option value="${esc(o.id)}">${esc(o.kode_batch)}, ${esc(o.nama_pemohon || o.pemohon || "-")}</option>`).join("");
    if ((M.requestOpts || []).length === 0) showMsg(`Tidak ada permintaan berstatus "${REQUEST_STATUS_SIAP_KIRIM}" yang masih menunggu pengiriman di cabang ini.`, "info");
}

async function ensurePemohonOpts() {
    if (M.pemohonOpts) return;
    const { data, error } = await ga().from(VIEW_PEMOHON)
        .select("nik, nama, department_id, department_name, area_id, area_name")
        .order("nama", { ascending: true });
    if (error) throw error;
    M.pemohonOpts = data || [];
}

function populatePemohonSelect() {
    $("fPemohonSel").innerHTML = `<option value="">Pilih Pemohon</option>` +
        (M.pemohonOpts || []).map(o => `<option value="${esc(o.nik)}">${esc(o.nama)}</option>`).join("");
}

function onPemohonChange() {
    const opt = (M.pemohonOpts || []).find(o => o.nik === $("fPemohonSel").value);
    $("fDepartemen").value = opt?.department_name || "";
    $("fArea").value = opt?.area_name || "";
}

async function fetchBarangInfo(kodes) {
    const map = {};
    if (!kodes.length) return map;
    const { data, error } = await ga().from("data_barang")
        .select("kode_barang, nama_barang, satuan, photo_path, kategori_barang_id, is_active")
        .in("kode_barang", kodes);
    if (error) throw error;
    (data || []).forEach(d => {
        const cur = map[d.kode_barang];
        if (!cur || (d.is_active === true && cur.is_active !== true)) map[d.kode_barang] = d;
    });
    return map;
}

async function onRequestChange() {
    const id = $("fKodeRequest").value;
    const mySeq = ++M.reqSeq;
    M.request = (M.requestOpts || []).find(o => String(o.id) === id) || null;
    M.rows = [];
    M.sisaItems = [];
    $("fPemohonTxt").value = M.request ? (M.request.nama_pemohon || M.request.pemohon || "") : "";
    $("fDepartemen").value = M.request?.department_name || "";
    $("fArea").value = M.request?.area_name || "";
    $("fPeriode").value = M.request?.periode_permintaan || "";
    renderRows(); updateCount(); updateTambahBtn();
    if (!M.request) return;

    showMsg("Memuat barang permintaan...", "info");
    try {
        const { data, error } = await ga().from(VIEW_REQUEST_SISA)
            .select("kode_barang, kategori_barang_id, qty_diminta, qty_terkirim, qty_sisa")
            .eq("request_batch_id", id).gt("qty_sisa", 0)
            .order("kode_barang", { ascending: true });
        if (error) throw error;
        if (mySeq !== M.reqSeq) return;

        const kodes = (data || []).map(x => x.kode_barang);
        const info = await fetchBarangInfo(kodes);
        await ensureStock(kodes);
        if (mySeq !== M.reqSeq) return;

        M.sisaItems = (data || []).map(x => ({
            kode_barang: x.kode_barang,
            qty_sisa: Number(x.qty_sisa) || 0,
            item: info[x.kode_barang] || { kode_barang: x.kode_barang, nama_barang: null, satuan: null, photo_path: null, kategori_barang_id: x.kategori_barang_id, is_active: null }
        }));
        M.rows = M.sisaItems.map(makeRowFromSisa);
        renderRows(); updateCount(); updateTambahBtn();
        showMsg(M.rows.length === 0 ? "Semua barang pada permintaan ini sudah terkirim lengkap." : "", "info");
    } catch (err) {
        if (mySeq !== M.reqSeq) return;
        console.error("Gagal memuat barang permintaan:", err);
        showMsg("Gagal memuat barang permintaan: " + err.message, "danger");
    }
}

function makeRowFromSisa(s) {
    return {
        kode: s.kode_barang, item: s.item, text: s.kode_barang,
        qty: s.qty_sisa, isNew: true, max: s.qty_sisa, maxKode: s.qty_sisa,
        listId: null, origNew: null, origQty: 0
    };
}
function makeEmptyRow() {
    return { kode: "", item: null, text: "", qty: null, isNew: true, max: null, maxKode: null, listId: null, origNew: null, origQty: 0 };
}

// ===================================================
// KELOMPOK 12: MODAL - STOK
// Fungsi: mengambil stok per barang dari stock_view (Baru dan Second).
// "Sisa Stock" = Stock - qty yang akan keluar; merah dan tebal jika minus.
// Pada mode Edit, qty milik batch itu sendiri dikembalikan ke Stock
// (karena sudah terpotong di stok saat ini).
// ===================================================
async function ensureStock(kodes) {
    const need = Array.from(new Set(kodes)).filter(k => k && !M.stock[k]);
    if (!need.length) return;
    const { data, error } = await ga().from(VIEW_STOCK)
        .select("kode_barang, qty, is_new")
        .eq("branch_id", state.branchId).in("kode_barang", need);
    if (error) throw error;
    need.forEach(k => { M.stock[k] = { baru: 0, second: 0 }; });
    (data || []).forEach(r => {
        const s = M.stock[r.kode_barang];
        if (!s) return;
        if (r.is_new === true) s.baru += Number(r.qty) || 0;
        else s.second += Number(r.qty) || 0;
    });
}

// Stok efektif untuk barang + status; null jika belum dimuat
function stockEff(kode, isNew) {
    const s = M.stock[kode];
    if (!s) return null;
    return (isNew ? s.baru : s.second) + (M.ownOut[`${kode}|${isNew}`] || 0);
}

function refreshRowCalc(i) {
    const row = M.rows[i];
    const tr = getTr(i);
    if (!row || !tr) return;
    const stockCell = tr.querySelector(".stock-out");
    const sisaCell = tr.querySelector(".sisa-out");
    sisaCell.classList.remove("sisa-neg");
    if (!row.item) { stockCell.textContent = ""; sisaCell.textContent = ""; return; }
    const st = stockEff(row.item.kode_barang, row.isNew);
    if (st === null) { stockCell.textContent = "..."; sisaCell.textContent = ""; return; }
    const sisa = st - (row.qty || 0);
    stockCell.textContent = formatQty(st);
    sisaCell.textContent = formatQty(sisa);
    if (sisa < 0) sisaCell.classList.add("sisa-neg");
}
function refreshAllCalc() { M.rows.forEach((_, i) => refreshRowCalc(i)); }

// ===================================================
// KELOMPOK 13: MODAL - TABEL BARANG
// Fungsi: menggambar baris, mengelola Qty (angka bulat, pemisah ribuan
// otomatis; mode Request tidak boleh melebihi permintaan), tombol
// Baru/Second, tombol Hapus baris, dan tombol "Tambah" (mode Request)
// untuk memunculkan kembali barang permintaan yang tadi dihapus.
// ===================================================
function getTr(i) { return $("mkTbody").querySelector(`tr[data-i="${i}"]`); }

function fotoCellHtml(url) {
    if (!url) return `<span class="data-empty-cell">-</span>`;
    return `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="mi-thumb" src="${esc(url)}" alt="Foto"></a>`;
}

function buildRowHtml(i, row) {
    const it = row.item;
    const kodeReadonly = M.mode === "edit" || M.isRequest;
    const showHapus = M.mode === "edit" || M.isRequest;
    const max = row.max;
    return `
        <tr data-i="${i}">
            <td class="mi-no">${i + 1}</td>
            <td><input type="text" class="md-input kode-input" value="${esc(row.text)}" placeholder="Kode Barang, Nama Barang" autocomplete="off" ${kodeReadonly ? "readonly" : ""}></td>
            <td><input type="text" class="md-input" value="${esc(it?.nama_barang || "")}" readonly tabindex="-1"></td>
            <td><div class="seg">
                <button type="button" data-val="true" class="${row.isNew ? "active" : ""}">Baru</button>
                <button type="button" data-val="false" class="${row.isNew ? "" : "active"}">Second</button>
            </div></td>
            <td>
                <input type="text" class="md-input qty-input" inputmode="numeric" value="${row.qty ? formatInt(row.qty) : ""}" autocomplete="off">
                ${M.isRequest && max != null ? `<div class="md-hint">maks. ${formatInt(max)}</div>` : ""}
            </td>
            <td class="col-calc stock-out"></td>
            <td class="col-calc sisa-out"></td>
            <td><input type="text" class="md-input" value="${esc(it?.satuan || "")}" readonly tabindex="-1"></td>
            <td class="foto-out">${fotoCellHtml(it?.photo_path)}</td>
            <td>${showHapus ? `<button type="button" class="btn btn-sm btn-outline-danger btn-hapus-row" title="Hapus baris"><i class="fa-solid fa-trash"></i></button>` : ""}</td>
        </tr>`;
}

function renderRows() {
    const tbody = $("mkTbody");
    if (M.rows.length === 0) {
        const text = M.isRequest && M.mode === "add" ? "Pilih Kode Request untuk menampilkan barang." : "Tidak ada barang.";
        tbody.innerHTML = `<tr class="row-placeholder"><td colspan="10">${text}</td></tr>`;
        return;
    }
    tbody.innerHTML = M.rows.map((r, i) => buildRowHtml(i, r)).join("");
    refreshAllCalc();
}

function updateCount() {
    const n = M.rows.length;
    $("mkCount").textContent = (M.mode === "add" && !M.isRequest)
        ? `${n} / ${MODAL_MAX_ROWS} baris (baris kosong diabaikan)`
        : (n ? `${n} barang` : "");
}

function onQtyInput(i, el) {
    const row = M.rows[i];
    const digits = el.value.replace(/\D/g, "");
    let n = digits === "" ? null : Number(digits);
    if (n !== null && M.isRequest && row.max != null && n > row.max) n = row.max;   // tidak boleh melebihi permintaan
    row.qty = n;
    el.value = n === null ? "" : formatInt(n);
    refreshRowCalc(i);
    maybeAddRow(i);
}

// Mode Non-Request: tambah baris kosong jika baris terakhir mulai diisi (maksimal 50)
function maybeAddRow(i) {
    if (M.mode !== "add" || M.isRequest) return;
    if (i !== M.rows.length - 1 || M.rows.length >= MODAL_MAX_ROWS) return;
    const row = makeEmptyRow();
    M.rows.push(row);
    $("mkTbody").insertAdjacentHTML("beforeend", buildRowHtml(M.rows.length - 1, row));
    updateCount();
}

function removeRow(i) {
    if (M.mode === "edit" && M.rows.length <= 1) {
        showMsg("Batch minimal berisi satu barang.", "warning");
        return;
    }
    M.rows.splice(i, 1);
    renderRows(); updateCount(); updateTambahBtn();
}

// Barang permintaan yang belum ada di tabel (karena dihapus)
function missingItems() {
    return M.sisaItems.filter(s => !M.rows.some(r => r.kode === s.kode_barang));
}
function updateTambahBtn() {
    const btn = $("btnTambahItem");
    btn.disabled = !(M.mode === "add" && M.isRequest && missingItems().length > 0);
}
function showMissingMenu() {
    const items = missingItems();
    if (!items.length) return;
    suggest.kind = "missing";
    suggest.items = items;
    suggest.active = -1;
    const box = suggest.box;
    box.innerHTML = items.map((s, k) => `
        <div class="ks-item" data-k="${k}"><b>${esc(s.kode_barang)}</b> &mdash; ${esc(s.item.nama_barang || "-")} <span class="data-empty-cell">(sisa ${formatInt(s.qty_sisa)})</span></div>`).join("");
    const rect = $("btnTambahItem").getBoundingClientRect();
    const width = 360;
    box.style.width = `${width}px`;
    box.style.left = `${Math.max(8, rect.right - width)}px`;
    box.style.top = "auto";
    box.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    box.style.display = "block";
}
async function addMissingItem(k) {
    const s = suggest.items[k];
    hideSuggest();
    if (!s) return;
    M.rows.push(makeRowFromSisa(s));
    try { await ensureStock([s.kode_barang]); } catch (err) { console.error(err); }
    renderRows(); updateCount(); updateTambahBtn();
}

// ===================================================
// KELOMPOK 14: MODAL - PENCARIAN KODE BARANG (mode Non-Request)
// Fungsi: saat mengetik di Kode Barang, muncul saran "KODE - Nama" dari
// data_barang (barang aktif dan tersedia di cabang ini). Setelah dipilih,
// Nama, Satuan, Foto, dan Stock terisi. Mengubah teks membatalkan pilihan.
// ===================================================
function onKodeInput(i, inputEl) {
    if (M.mode !== "add" || M.isRequest) return;
    const row = M.rows[i];
    row.text = inputEl.value;
    if (row.item) {
        row.item = null; row.kode = "";
        const tr = getTr(i);
        tr.children[2].querySelector("input").value = "";
        tr.children[7].querySelector("input").value = "";
        tr.querySelector(".foto-out").innerHTML = fotoCellHtml(null);
        refreshRowCalc(i);
    }
    if (row.text.trim() !== "") maybeAddRow(i);

    clearTimeout(suggest.timer);
    const term = row.text.trim();
    if (!term) { hideSuggest(); return; }
    suggest.timer = setTimeout(() => runSuggest(i, term, inputEl), 250);
}

async function runSuggest(i, term, inputEl) {
    const myReq = ++suggest.reqId;
    try {
        const safe = term.replace(/[\\"]/g, "\\$&");
        const pattern = `"%${safe}%"`;
        const { data, error } = await ga().from("data_barang")
            .select("kode_barang, nama_barang, satuan, photo_path, kategori_barang_id, is_active, is_makassar, is_surabaya")
            .eq("is_active", true)
            .or(`kode_barang.ilike.${pattern},nama_barang.ilike.${pattern}`)
            .order("kode_barang", { ascending: true })
            .limit(SUGGEST_LIMIT * 3);
        if (myReq !== suggest.reqId) return;
        if (error) throw error;

        let items = data || [];
        const flagCol = BRANCH_FLAG_COLUMN[state.branchId];
        if (BATASI_BARANG_PER_CABANG && flagCol) items = items.filter(x => x[flagCol] !== false);
        suggest.kind = "kode";
        suggest.items = items.slice(0, SUGGEST_LIMIT);
        suggest.active = suggest.items.length ? 0 : -1;
        suggest.rowIdx = i;
        showSuggest(inputEl);
    } catch (err) {
        if (myReq !== suggest.reqId) return;
        console.error("Gagal mencari barang:", err);
        suggest.kind = "kode"; suggest.items = []; suggest.rowIdx = i;
        showSuggest(inputEl, "Gagal mencari barang: " + err.message);
    }
}

function showSuggest(inputEl, errorText) {
    const box = suggest.box;
    const rect = inputEl.getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.bottom + 2}px`;
    box.style.bottom = "auto";
    box.style.width = `${Math.max(rect.width, 340)}px`;
    box.innerHTML = suggest.items.length === 0
        ? `<div class="ks-empty">${esc(errorText || "Tidak ada barang yang cocok.")}</div>`
        : suggest.items.map((x, k) => `
            <div class="ks-item ${k === suggest.active ? "active" : ""}" data-k="${k}">
                <b>${esc(x.kode_barang)}</b> &mdash; ${esc(x.nama_barang || "-")}
            </div>`).join("");
    box.style.display = "block";
}
function hideSuggest() {
    if (!suggest.box) return;
    suggest.box.style.display = "none";
    suggest.items = [];
    suggest.active = -1;
    suggest.kind = "kode";
}
function moveSuggest(step) {
    if (!suggest.items.length) return;
    suggest.active = (suggest.active + step + suggest.items.length) % suggest.items.length;
    suggest.box.querySelectorAll(".ks-item").forEach((el, k) => el.classList.toggle("active", k === suggest.active));
}

async function pickSuggestion(k) {
    if (suggest.kind === "missing") { addMissingItem(k); return; }
    const item = suggest.items[k];
    const i = suggest.rowIdx;
    if (!item || i < 0) return;
    const row = M.rows[i];
    row.item = item; row.kode = item.kode_barang; row.text = item.kode_barang;

    const tr = getTr(i);
    tr.querySelector(".kode-input").value = item.kode_barang;
    tr.children[2].querySelector("input").value = item.nama_barang || "";
    tr.children[7].querySelector("input").value = item.satuan || "";
    tr.querySelector(".foto-out").innerHTML = fotoCellHtml(item.photo_path);
    tr.classList.remove("row-invalid");

    hideSuggest();
    maybeAddRow(i);
    tr.querySelector(".qty-input").focus();
    refreshRowCalc(i);
    try {
        await ensureStock([item.kode_barang]);
        refreshAllCalc();
    } catch (err) {
        console.error("Gagal memuat stok:", err);
        showMsg("Gagal memuat stok: " + err.message, "warning");
    }
}

// ===================================================
// KELOMPOK 15: VALIDASI & SIMPAN BARU
// Fungsi: memeriksa semua isian, lalu mengirim SEMUA baris dalam satu
// panggilan fungsi database (ga.simpan_stock_out). Jika satu baris saja
// gagal (stok minus, melebihi permintaan, dll), TIDAK ADA yang tersimpan.
// Database memeriksa ulang semua aturan, jadi hasilnya aman walau dua
// orang menyimpan bersamaan.
// ===================================================
function markInvalid(i) { getTr(i)?.classList.add("row-invalid"); }

// Pemeriksaan stok & batas permintaan per kelompok barang (jumlah semua baris yang sama)
function checkGroups(rows) {
    const errs = [];
    const byStock = new Map();
    const byKode = new Map();
    rows.forEach(({ r, i }) => {
        const kode = r.item.kode_barang;
        const k1 = `${kode}|${r.isNew}`;
        byStock.set(k1, { kode, isNew: r.isNew, sum: (byStock.get(k1)?.sum || 0) + (r.qty || 0), idx: i });
        const cur = byKode.get(kode) || { sum: 0, max: r.maxKode, idx: i };
        cur.sum += r.qty || 0;
        byKode.set(kode, cur);
    });
    byStock.forEach(g => {
        const st = stockEff(g.kode, g.isNew);
        if (st === null) { errs.push({ idx: g.idx, msg: `Stok ${g.kode} belum termuat, coba lagi.` }); return; }
        if (g.sum > st) errs.push({ idx: g.idx, msg: `Stok ${g.kode} (${g.isNew ? "Baru" : "Second"}) tidak cukup: stok ${formatQty(st)}, keluar ${formatQty(g.sum)}.` });
    });
    if (M.isRequest) {
        byKode.forEach((g, kode) => {
            if (g.max != null && g.sum > g.max) errs.push({ idx: g.idx, msg: `Qty ${kode} melebihi permintaan (maks. ${formatQty(g.max)}, diisi ${formatQty(g.sum)}).` });
        });
    }
    return errs;
}

function showErrors(errs) {
    errs.forEach(e => { if (e.idx != null) markInvalid(e.idx); });
    const shown = errs.slice(0, 6).map(e => e.msg).join("\n");
    showMsg(`Tidak ada data yang disimpan. Perbaiki dulu:\n${shown}${errs.length > 6 ? `\n...dan ${errs.length - 6} masalah lain.` : ""}`, "danger");
}

async function saveAdd() {
    if (M.saving) return;
    showMsg("", "");
    $("mkTbody").querySelectorAll("tr").forEach(tr => tr.classList.remove("row-invalid"));

    const tanggal = $("fTanggal").value;
    const errs = [];
    if (!tanggal) errs.push({ msg: "Tanggal wajib diisi." });

    let pemohon = null;
    if (M.isRequest) {
        if (!M.request) errs.push({ msg: "Pilih Kode Request." });
    } else {
        pemohon = $("fPemohonSel").value;
        if (!pemohon) errs.push({ msg: "Pilih Pemohon." });
    }

    // Baris yang dianggap terisi
    const used = [];
    M.rows.forEach((r, i) => {
        if (M.isRequest || r.item || (r.text || "").trim() !== "" || r.qty) used.push({ r, i });
    });
    if (used.length === 0) errs.push({ msg: "Isi minimal satu barang." });

    used.forEach(({ r, i }) => {
        const msgs = [];
        if (!r.item) msgs.push("pilih Kode Barang dari daftar saran");
        else if (r.item.is_active === false) msgs.push(`barang ${r.item.kode_barang} sudah nonaktif, hapus barisnya`);
        if (!r.qty || r.qty <= 0) msgs.push("Qty harus lebih dari 0");
        if (msgs.length) errs.push({ idx: i, msg: `Baris ${i + 1}: ${msgs.join(", ")}.` });
    });
    if (errs.length === 0) errs.push(...checkGroups(used));
    if (errs.length) { showErrors(errs); return; }

    const username = getCurrentUsername();
    if (!username) { showMsg("Username (NIK) tidak ditemukan di sesi login. Silakan login ulang, lalu coba lagi.", "danger"); return; }

    const payload = {
        tanggal,
        branch_id: state.branchId,
        is_request: M.isRequest,
        kode_request: M.isRequest ? M.request.kode_batch : null,
        pemohon: M.isRequest ? null : pemohon,
        petugas: username,
        items: used.map(({ r }) => ({ kode_barang: r.item.kode_barang, qty: r.qty, is_new: r.isNew }))
    };

    const btn = $("btnMkSimpan");
    M.saving = true;
    setBusy(btn, true, "Menyimpan...");
    try {
        const { data, error } = await ga().rpc(RPC_SIMPAN, { p: payload });
        if (error) throw error;
        bootstrap.Modal.getOrCreateInstance($("modalKeluar")).hide();
        state.page = 1;
        await Promise.all([loadPage(), loadOpsi()]);
        alert(`Barang keluar berhasil disimpan.\nKode batch: ${data?.kode_batch || "-"}`);
    } catch (err) {
        console.error("Gagal menyimpan barang keluar:", err);
        showMsg(`Tidak ada data yang tersimpan.\n${err.message}`, "danger");
    } finally {
        M.saving = false;
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 16: MODAL EDIT (khusus Maintenance & Superadmin)
// Fungsi: klik baris tabel membuka SEMUA barang dalam batch yang sama.
// Data batch readonly. Yang bisa diubah: Qty, Baru/Second, dan menghapus
// baris barang (batch minimal berisi satu barang). Saat Simpan, database
// memeriksa ulang stok minus dan batas permintaan.
// ===================================================
async function openEditModal(batchId) {
    if (!state.canSwitch) return;
    let lines;
    try {
        const { data, error } = await ga().from(VIEW_DETAIL).select("*")
            .eq("batch_id", batchId).eq("branch_id", state.branchId)
            .order("kode_barang", { ascending: true }).order("list_id", { ascending: true });
        if (error) throw error;
        lines = data || [];
    } catch (err) {
        alert("Gagal memuat data batch: " + err.message);
        return;
    }
    if (lines.length === 0) { alert("Data batch tidak ditemukan (mungkin sudah berubah). Muat ulang halaman."); return; }

    const head = lines[0];
    M = freshModal();
    M.mode = "edit";
    M.batchId = head.batch_id;
    M.origCount = lines.length;
    M.isRequest = head.is_request === true;

    // Batas Qty (mode Request) = diminta - terkirim oleh batch lain
    const maxByKode = {};
    if (M.isRequest) {
        try {
            const { data, error } = await ga().from(VIEW_REQUEST_SISA)
                .select("kode_barang, qty_diminta, qty_terkirim")
                .eq("kode_request", head.kode_request).eq("branch_id", state.branchId);
            if (error) throw error;
            const own = {};
            lines.forEach(l => { own[l.kode_barang] = (own[l.kode_barang] || 0) + Number(l.qty); });
            (data || []).forEach(v => {
                maxByKode[v.kode_barang] = Number(v.qty_diminta) - Number(v.qty_terkirim) + (own[v.kode_barang] || 0);
            });
        } catch (err) {
            alert("Gagal memuat data permintaan: " + err.message);
            return;
        }
    }

    lines.forEach(l => {
        const key = `${l.kode_barang}|${l.is_new === true}`;
        M.ownOut[key] = (M.ownOut[key] || 0) + Number(l.qty);
    });
    M.rows = lines.map(l => ({
        kode: l.kode_barang,
        item: { kode_barang: l.kode_barang, nama_barang: l.nama_barang, satuan: l.satuan, photo_path: l.photo_path, kategori_barang_id: l.kategori_id, is_active: true },
        text: l.kode_barang,
        qty: Number(l.qty), isNew: l.is_new === true,
        max: M.isRequest ? (maxByKode[l.kode_barang] ?? null) : null,
        maxKode: M.isRequest ? (maxByKode[l.kode_barang] ?? null) : null,
        listId: l.list_id, origNew: l.is_new === true, origQty: Number(l.qty)
    }));

    try { await ensureStock(M.rows.map(r => r.kode)); }
    catch (err) { alert("Gagal memuat stok: " + err.message); return; }

    $("mkTitle").textContent = `Edit Barang Keluar - ${branchName()}`;
    $("fKodeBatch").value = head.kode_batch || "";
    $("fTanggal").value = String(head.tanggal || "").slice(0, 10);
    $("fKodeRequestTxt").value = head.kode_request || "";
    $("fPemohonTxt").value = head.nama_pemohon || head.pemohon || "";
    $("fDepartemen").value = head.department_name || "";
    $("fArea").value = head.area_name || "";
    $("fPeriode").value = head.periode_request || "";
    applyModeUi();
    showMsg("", "");
    renderRows();
    updateCount();
    bootstrap.Modal.getOrCreateInstance($("modalKeluar")).show();
}

async function saveEdit() {
    if (M.saving) return;
    showMsg("", "");
    $("mkTbody").querySelectorAll("tr").forEach(tr => tr.classList.remove("row-invalid"));

    if (M.rows.length === 0) { showMsg("Batch minimal berisi satu barang.", "danger"); return; }
    const used = M.rows.map((r, i) => ({ r, i }));
    const errs = [];
    used.forEach(({ r, i }) => {
        if (!r.qty || r.qty <= 0) errs.push({ idx: i, msg: `Baris ${i + 1}: Qty harus lebih dari 0.` });
    });
    if (errs.length === 0) errs.push(...checkGroups(used));
    if (errs.length) { showErrors(errs); return; }

    // Tidak ada perubahan (jumlah baris, qty, dan status sama seperti awal)?
    const unchanged = M.rows.length === M.origCount
        && M.rows.every(r => r.qty === r.origQty && r.isNew === r.origNew);
    if (unchanged) {
        bootstrap.Modal.getOrCreateInstance($("modalKeluar")).hide();
        return;
    }

    const payload = {
        batch_id: M.batchId,
        branch_id: state.branchId,
        items: M.rows.map(r => ({ id: r.listId, qty: r.qty, is_new: r.isNew }))
    };

    const btn = $("btnMkSimpan");
    M.saving = true;
    setBusy(btn, true, "Menyimpan...");
    try {
        const { error } = await ga().rpc(RPC_UBAH, { p: payload });
        if (error) throw error;
        bootstrap.Modal.getOrCreateInstance($("modalKeluar")).hide();
        await Promise.all([loadPage(), loadOpsi()]);
    } catch (err) {
        console.error("Gagal menyimpan perubahan:", err);
        showMsg(`Tidak ada perubahan yang tersimpan.\n${err.message}`, "danger");
    } finally {
        M.saving = false;
        setBusy(btn, false);
    }
}