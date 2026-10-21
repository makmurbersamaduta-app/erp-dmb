// ===================================================
// rekap-permintaan.js
// Halaman "Rekap Permintaan"
// Baca : ga.rekap_permintaan_view (tabel utama), ga.v_request_tutup dan
//        ga.v_request_tutup_item (modal Close Request)
// Tulis: lewat fungsi database ga.close_request
// WAJIB: jalankan rekap-permintaan.sql (dan sebelumnya barang_keluar.sql).
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const DB_SCHEMA = "ga";
const VIEW_REKAP = "rekap_permintaan_view";
const VIEW_TUTUP = "v_request_tutup";
const VIEW_TUTUP_ITEM = "v_request_tutup_item";
const RPC_CLOSE = "close_request";
const ROWS_PER_PAGE = 100;               // baris maksimal per halaman

// Cabang: branch_id -> nama tab
const BRANCHES = { 2: "Makassar", 1: "Surabaya" };
const DEFAULT_BRANCH = 2;                // Makassar

// Sesi login & hak akses
const SESSION_KEY = "erp_session";       // key sesi login di browser (JSON)
const ROLE_IDS_ALL_BRANCH = [1, 2];      // roleId 1 = Maintenance, 2 = Superadmin: pindah cabang + Close Request
// PERLU DISESUAIKAN: nama field cabang di erp_session (sesi Anda belum memuatnya).
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// Halaman tujuan untuk 3 tombol di bawah tabel (cabang yang dibuka ikut dikirim sebagai ?branch_id=)
const ACTION_PAGES = {
    masuk: "barang_masuk.html",
    keluar: "barang_keluar.html",
    suratJalan: "surat_jalan.html"
};

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// ===================================================
const state = { branchId: DEFAULT_BRANCH, canSwitch: false, rows: [], totalRows: 0, page: 1, reqId: 0 };
let closeState = freshClose();
function freshClose() { return { opts: [], selected: null, saving: false, seq: 0 }; }

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
function formatTanggal(s) {
    if (!s) return "-";
    const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    if (isNaN(dt)) return "-";
    return `${HARI[dt.getDay()]}, ${String(dt.getDate()).padStart(2, "0")} ${BULAN[dt.getMonth()]} ${dt.getFullYear()}`;
}
function todayLocalIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function branchName() { return BRANCHES[state.branchId] || `Cabang ${state.branchId}`; }

function showToast(text) {
    const t = $("ctToast");
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { t.style.display = "none"; }, 4000);
}
function showRcMsg(text, type) {
    const el = $("rcMessage");
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
// (roleId 2): tab cabang + tombol Close Request. User lain: hanya cabangnya
// sendiri, tanpa tombol Close Request.
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
    $("rekapTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">${esc(message)}</td></tr>`;
    ["btnDownload", "btnBarangMasuk", "btnBarangKeluar", "btnSuratJalan"].forEach(id => { $(id).disabled = true; });
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
        $("btnCloseRequest").hidden = false;
    } else {
        $("branchTabs").hidden = true;
        $("btnCloseRequest").hidden = true;
        if (!session) { blockPage("Sesi login tidak ditemukan. Silakan login ulang."); return; }
        if (!BRANCHES[sessionBranch]) { blockPage("Cabang akun Anda tidak terdeteksi. Hubungi admin."); return; }
        state.branchId = sessionBranch;
    }

    setupTabs();
    $("btnDownload").addEventListener("click", handleDownload);
    if (state.canSwitch) setupCloseModal();
    updateTabUi();
    loadPage();
});

// ===================================================
// KELOMPOK 6: TAB CABANG
// Fungsi: pindah Makassar / Surabaya (khusus Maintenance & Superadmin).
// ===================================================
function setupTabs() {
    document.querySelectorAll(".ct-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.branch, 10);
            if (!state.canSwitch || id === state.branchId) return;
            state.branchId = id;
            state.page = 1;
            updateTabUi();

            const url = new URL(window.location.href);
            url.searchParams.set("branch_id", String(id));
            window.history.replaceState(null, "", url);

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
    if (state.canSwitch) $("btnBack").href = `../../index.html?branch_id=${state.branchId}`;
}

// ===================================================
// KELOMPOK 7: TABEL UTAMA
// Fungsi: mengambil 100 baris per halaman dari ga.rekap_permintaan_view untuk
// cabang terpilih, urut kode barang. Selisih = Stock - Permintaan;
// merah dan tebal jika minus (stok tidak cukup memenuhi permintaan).
// ===================================================
async function loadPage() {
    const myReq = ++state.reqId;
    $("rekapTableBody").innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    $("rekapPagination").innerHTML = "";
    try {
        const start = (state.page - 1) * ROWS_PER_PAGE;
        const { data, error, count } = await ga().from(VIEW_REKAP)
            .select("kode_barang, nama_barang, satuan, qty, stock, selisih", { count: "exact" })
            .eq("branch_id", state.branchId)
            .order("kode_barang", { ascending: true })
            .range(start, start + ROWS_PER_PAGE - 1);
        if (myReq !== state.reqId) return;
        if (error) throw error;
        state.rows = data || [];
        state.totalRows = count || 0;
        renderTable();
        renderPagination();
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat rekap permintaan:", err);
        $("rekapTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

function renderTable() {
    const tbody = $("rekapTableBody");
    if (state.rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Tidak ada permintaan yang menunggu pengiriman di cabang ini.</td></tr>`;
        return;
    }
    const start = (state.page - 1) * ROWS_PER_PAGE;
    const dash = `<span class="data-empty-cell">-</span>`;
    tbody.innerHTML = state.rows.map((r, i) => {
        const selisih = Number(r.selisih) || 0;
        return `
            <tr>
                <td class="col-no">${start + i + 1}</td>
                <td>${esc(r.kode_barang)}</td>
                <td>${r.nama_barang ? esc(r.nama_barang) : dash}</td>
                <td class="col-qty">${formatQty(r.qty)}</td>
                <td class="col-qty">${formatQty(r.stock)}</td>
                <td class="col-qty ${selisih < 0 ? "selisih-neg" : ""}">${formatQty(selisih)}</td>
                <td>${r.satuan ? esc(r.satuan) : dash}</td>
            </tr>`;
    }).join("");
}

function renderPagination() {
    const container = $("rekapPagination");
    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);
    if (totalPages <= 1) {
        container.innerHTML = state.totalRows > 0 ? `<span class="ct-page-info">${state.totalRows} barang</span>` : "";
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
    html += `<span class="ct-page-info">${state.totalRows} barang</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); loadPage(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadPage(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadPage(); } };
}

// ===================================================
// KELOMPOK 8: DOWNLOAD EXCEL
// Fungsi: mengunduh SELURUH rekap cabang yang sedang dibuka (bukan hanya
// halaman ini), dengan header 2 tingkat dan isi yang sama dengan tabel utama:
// No, Kode Artikel, Nama Barang, Qty Barang (Permintaan, Stock, Selisih), Satuan.
// ===================================================
async function handleDownload() {
    const btn = $("btnDownload");
    setBusy(btn, true, "Menyiapkan...");
    try {
        const PAGE = 1000;
        const all = [];
        let total = null;
        while (total === null || all.length < total) {
            const { data, error, count } = await ga().from(VIEW_REKAP)
                .select("kode_barang, nama_barang, satuan, qty, stock, selisih", { count: "exact" })
                .eq("branch_id", state.branchId)
                .order("kode_barang", { ascending: true })
                .range(all.length, all.length + PAGE - 1);
            if (error) throw error;
            if (total === null) total = count || 0;
            if (!data || data.length === 0) break;
            all.push(...data);
        }
        if (all.length === 0) { alert("Tidak ada data untuk diunduh."); return; }

        const aoa = [
            ["No", "Kode Artikel", "Nama Barang", "Qty Barang", "", "", "Satuan"],
            ["", "", "", "Permintaan", "Stock", "Selisih", ""]
        ];
        all.forEach((r, i) => aoa.push([
            i + 1, r.kode_barang, r.nama_barang || "", Number(r.qty), Number(r.stock), Number(r.selisih), r.satuan || ""
        ]));

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!merges"] = [
            { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },   // No
            { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },   // Kode Artikel
            { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },   // Nama Barang
            { s: { r: 0, c: 3 }, e: { r: 0, c: 5 } },   // Qty Barang (3 kolom)
            { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } }    // Satuan
        ];
        ws["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 46 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 10 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Rekap Permintaan");
        XLSX.writeFile(wb, `Rekap_Permintaan_${branchName()}_${todayLocalIso()}.xlsx`);
    } catch (err) {
        console.error("Gagal download:", err);
        alert("Gagal menyiapkan file download: " + err.message);
    } finally {
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 9: TOMBOL AKSI (Barang Masuk / Barang Keluar / Surat Jalan)
// Fungsi: membuka halaman tujuan sambil membawa cabang yang sedang dibuka.
// ===================================================
function openActionPage(key, label) {
    const url = ACTION_PAGES[key];
    if (!url) { alert(`Halaman "${label}" belum tersedia.`); return; }
    window.location.href = `${url}${url.includes("?") ? "&" : "?"}branch_id=${state.branchId}`;
}

// ===================================================
// KELOMPOK 10: MODAL CLOSE REQUEST (khusus Maintenance & Superadmin)
// Fungsi: pilih Kode Permintaan (dropdown), lalu Pemohon, Tanggal, Periode,
// dan rincian barang yang belum terkirim tampil readonly. Tombol "Close
// Request" menonaktifkan permintaan lewat fungsi database (is_active = false).
// Permintaan yang ditutup hilang dari rekap ini, daftar Barang Keluar, dan
// daftar permintaan di PWA milik pemohon.
// ===================================================
function setupCloseModal() {
    $("btnCloseRequest").addEventListener("click", openCloseModal);
    $("rcKode").addEventListener("change", onCloseSelect);
    $("btnRcSubmit").addEventListener("click", submitClose);
    $("modalClose").addEventListener("hidden.bs.modal", () => { closeState = freshClose(); });
}

function resetCloseFields() {
    ["rcPemohon", "rcTanggal", "rcPeriode"].forEach(id => { $(id).value = ""; });
    $("rcTbody").innerHTML = `<tr class="rc-empty"><td colspan="4">Pilih Kode Permintaan untuk menampilkan rincian barang.</td></tr>`;
    $("btnRcSubmit").disabled = true;
}

async function openCloseModal() {
    if (!state.canSwitch) return;
    closeState = freshClose();
    $("rcTitle").textContent = `Close Request - ${branchName()}`;
    $("rcKode").innerHTML = `<option value="">Memuat...</option>`;
    resetCloseFields();
    showRcMsg("", "");
    bootstrap.Modal.getOrCreateInstance($("modalClose")).show();

    try {
        const { data, error } = await ga().from(VIEW_TUTUP)
            .select("id, kode_batch, tanggal, periode_permintaan, pemohon, nama_pemohon, jumlah_belum_terkirim")
            .eq("branch_id", state.branchId)
            .order("tanggal", { ascending: false })
            .order("kode_batch", { ascending: false });
        if (error) throw error;
        closeState.opts = data || [];

        $("rcKode").innerHTML = `<option value="">Pilih Kode Permintaan</option>` + closeState.opts.map(o => {
            const info = Number(o.jumlah_belum_terkirim) > 0 ? `${o.jumlah_belum_terkirim} barang belum terkirim` : "semua terkirim";
            return `<option value="${esc(o.id)}">${esc(o.kode_batch)}, ${esc(o.nama_pemohon || o.pemohon || "-")} (${esc(info)})</option>`;
        }).join("");
        if (closeState.opts.length === 0) showRcMsg(`Tidak ada permintaan berstatus "Disetujui" yang aktif di cabang ini.`, "info");
    } catch (err) {
        console.error("Gagal memuat daftar permintaan:", err);
        $("rcKode").innerHTML = `<option value="">Pilih Kode Permintaan</option>`;
        showRcMsg("Gagal memuat daftar permintaan: " + err.message, "danger");
    }
}

async function onCloseSelect() {
    const id = $("rcKode").value;
    const mySeq = ++closeState.seq;
    closeState.selected = closeState.opts.find(o => String(o.id) === id) || null;
    resetCloseFields();
    showRcMsg("", "");
    const sel = closeState.selected;
    if (!sel) return;

    $("rcPemohon").value = sel.nama_pemohon || sel.pemohon || "";
    $("rcTanggal").value = formatTanggal(sel.tanggal);
    $("rcPeriode").value = sel.periode_permintaan || "";
    $("rcTbody").innerHTML = `<tr class="rc-empty"><td colspan="4"><i class="fa-solid fa-spinner fa-spin"></i> Memuat rincian...</td></tr>`;

    try {
        const { data, error } = await ga().from(VIEW_TUTUP_ITEM)
            .select("kode_barang, nama_barang, satuan, qty_sisa")
            .eq("request_batch_id", id)
            .order("kode_barang", { ascending: true });
        if (error) throw error;
        if (mySeq !== closeState.seq) return;

        const rows = data || [];
        $("rcTbody").innerHTML = rows.length === 0
            ? `<tr class="rc-empty"><td colspan="4">Semua barang pada permintaan ini sudah terkirim lengkap.</td></tr>`
            : rows.map(r => `
                <tr>
                    <td>${esc(r.kode_barang)}</td>
                    <td>${esc(r.nama_barang || "-")}</td>
                    <td class="num">${formatQty(r.qty_sisa)}</td>
                    <td>${esc(r.satuan || "-")}</td>
                </tr>`).join("");
        $("btnRcSubmit").disabled = false;
    } catch (err) {
        if (mySeq !== closeState.seq) return;
        console.error("Gagal memuat rincian:", err);
        $("rcTbody").innerHTML = `<tr class="rc-empty"><td colspan="4">Gagal memuat rincian: ${esc(err.message)}</td></tr>`;
    }
}

async function submitClose() {
    const sel = closeState.selected;
    if (!sel || closeState.saving) return;
    const username = getCurrentUsername();
    if (!username) { showRcMsg("Username (NIK) tidak ditemukan di sesi login. Silakan login ulang, lalu coba lagi.", "danger"); return; }

    const sisa = Number(sel.jumlah_belum_terkirim) > 0
        ? `\n\nMasih ada ${sel.jumlah_belum_terkirim} barang yang belum terkirim; sisanya tidak akan dikirim lagi.`
        : "";
    const ok = confirm(
        `Tutup permintaan ${sel.kode_batch} (${sel.nama_pemohon || sel.pemohon || "-"})?${sisa}\n\n` +
        "Permintaan akan hilang dari Barang Keluar, rekap ini, dan daftar permintaan pemohon. Tindakan ini tidak dapat dibatalkan dari halaman ini."
    );
    if (!ok) return;

    const btn = $("btnRcSubmit");
    closeState.saving = true;
    setBusy(btn, true, "Menutup...");
    try {
        const { error } = await ga().rpc(RPC_CLOSE, { p: { id: sel.id, branch_id: state.branchId, username } });
        if (error) throw error;
        bootstrap.Modal.getOrCreateInstance($("modalClose")).hide();
        showToast(`Permintaan ${sel.kode_batch} ditutup.`);
        state.page = 1;
        loadPage();
    } catch (err) {
        console.error("Gagal Close Request:", err);
        showRcMsg("Gagal menutup permintaan: " + err.message, "danger");
    } finally {
        closeState.saving = false;
        setBusy(btn, false);
    }
}