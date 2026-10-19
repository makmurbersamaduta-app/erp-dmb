// ===================================================
// barang_masuk.js
// Halaman "Data Barang Masuk"
// Baca : view ga.stock_in_view (stock_in + nama/satuan/foto barang + nama kategori)
// Tulis: tabel ga.stock_in (tambah, edit qty/status, hapus permanen)
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const DB_SCHEMA = "ga";
const TABLE_STOCK_IN = "stock_in";          // tabel tujuan simpan / edit / hapus
const VIEW_STOCK_IN = "stock_in_view";      // view sumber tabel utama
const ROWS_PER_PAGE = 100;                  // baris maksimal per halaman tabel utama
const MODAL_START_ROWS = 5;                 // jumlah baris kosong saat modal Input dibuka
const MODAL_MAX_ROWS = 50;                  // batas maksimal baris di modal Input
const SUGGEST_LIMIT = 15;                   // jumlah saran Kode Barang yang ditampilkan

// Cabang: branch_id -> nama tab
const BRANCHES = { 2: "Makassar", 1: "Surabaya" };
const DEFAULT_BRANCH = 2;

// Sesi login & hak akses
const SESSION_KEY = "erp_session";          // key sesi login di browser (JSON)
const ROLE_IDS_ALL_BRANCH = [1, 2];         // roleId 1 = Maintenance, 2 = Superadmin: boleh pindah cabang + edit/hapus
// PERLU DICEK: nama field di erp_session yang berisi branch_id user.
// Contoh sesi yang saya terima tidak punya field cabang, jadi ini tebakan.
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// Hanya tampilkan barang yang "Tersedia" di cabang tsb (kolom is_makassar / is_surabaya di data_barang).
// Barang yang nilainya false disembunyikan dari pencarian Kode Barang. Ubah ke false untuk mematikan.
const BATASI_BARANG_PER_CABANG = true;
const BRANCH_FLAG_COLUMN = { 2: "is_makassar", 1: "is_surabaya" };

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan kondisi halaman dan modal saat ini.
// ===================================================
const state = {
    branchId: DEFAULT_BRANCH,
    canSwitch: false,   // true = Maintenance / Superadmin (tab cabang + edit/hapus)
    rows: [],           // baris tabel utama halaman ini
    totalRows: 0,
    page: 1,
    search: "",
    reqId: 0            // penanda permintaan terbaru
};

// Modal: mode = "add" | "edit"
// rows[i] = { item, text, qty, isNew, keterangan }   item = data barang terpilih (atau null)
let modalState = { mode: null, rows: [], editRow: null };

// Daftar saran Kode Barang
const suggest = { items: [], active: -1, rowIdx: -1, timer: null, reqId: 0, box: null };

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// ===================================================
const $ = (id) => document.getElementById(id);

// Mengamankan teks sebelum dimasukkan ke HTML
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatQty(n) {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n) || 0);
}

// Tanggal format "dddd, dd mmm yyyy", contoh: "Senin, 05 Okt 2026" (jam lokal browser)
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function formatTanggal(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d)) return "-";
    return `${HARI[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

function branchName() {
    return BRANCHES[state.branchId] || `Cabang ${state.branchId}`;
}

function showMsg(text, type) {
    const el = $("miMessage");
    if (!text) { el.classList.add("d-none"); el.textContent = ""; return; }
    el.className = `alert py-2 small alert-${type}`;
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
// Fungsi: membaca sesi login (erp_session). Maintenance (roleId 1) dan
// Superadmin (roleId 2) boleh pindah cabang dan edit/hapus. User lain
// hanya melihat cabangnya sendiri (dari sesi) dan hanya bisa input.
// CATATAN KEAMANAN: ini hanya mengatur tampilan di browser. Pembatasan
// yang sebenarnya harus dipasang di database (RLS).
// ===================================================
function getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (err) { console.error("Sesi login tidak bisa dibaca:", err); return null; }
}

function canSwitchBranch(session) {
    return !!session && ROLE_IDS_ALL_BRANCH.includes(Number(session.roleId));
}

function getSessionBranchId(session) {
    if (!session) return null;
    for (const field of SESSION_BRANCH_FIELDS) {
        const n = parseInt(session[field], 10);
        if (!isNaN(n)) return n;
    }
    return null;
}

// Username = NIK dari sesi login
function getCurrentUsername() {
    const nik = getSession()?.nik;
    return nik ? String(nik).trim() : null;
}

// Menghentikan halaman dengan pesan jelas (jika cabang user tidak bisa ditentukan)
function blockPage(message) {
    $("branchTitle").textContent = "-";
    $("stockInTableBody").innerHTML = `<tr class="row-empty"><td colspan="10">${esc(message)}</td></tr>`;
    ["searchInput", "btnInput"].forEach(id => { $(id).disabled = true; });
}

// ===================================================
// KELOMPOK 5: INISIALISASI
// Fungsi: dijalankan saat halaman selesai dimuat.
//  - Maintenance / Superadmin: cabang awal dari alamat halaman (?branch_id=2),
//    lalu branch_id sesi, lalu default.
//  - User lain: cabang SELALU dari sesi; ?branch_id di alamat diabaikan.
// ===================================================
document.addEventListener("DOMContentLoaded", () => {
    const session = getSession();
    state.canSwitch = canSwitchBranch(session);
    const sessionBranch = getSessionBranchId(session);

    if (state.canSwitch) {
        const fromUrl = parseInt(new URLSearchParams(window.location.search).get("branch_id"), 10);
        state.branchId = BRANCHES[fromUrl] ? fromUrl
                       : BRANCHES[sessionBranch] ? sessionBranch
                       : DEFAULT_BRANCH;
        $("branchTabs").hidden = false;
    } else {
        $("branchTabs").hidden = true;
        if (!session) { blockPage("Sesi login tidak ditemukan. Silakan login ulang."); return; }
        if (!BRANCHES[sessionBranch]) { blockPage("Cabang akun Anda tidak terdeteksi. Hubungi admin."); return; }
        state.branchId = sessionBranch;
    }

    setupTabs();
    setupSearch();
    setupModal();
    updateTabUi();
    loadPage();
});

// ===================================================
// KELOMPOK 6: TAB CABANG
// Fungsi: pindah Makassar / Surabaya (khusus Maintenance & Superadmin).
// Pilihan dicatat di alamat halaman, dan tombol Kembali membawa cabang
// yang sama ke catalog.html.
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
    if (state.canSwitch) $("btnBack").href = `catalog.html?branch_id=${state.branchId}`;
}

// ===================================================
// KELOMPOK 7: SEARCH
// Fungsi: mencari di Kode Barang, Nama Barang, dan Kategori
// (dikerjakan di database, jadi hasilnya mencakup semua halaman).
// ===================================================
function buildSearchOrClause(keyword) {
    const safe = keyword.replace(/[\\"]/g, "\\$&");
    const pattern = `"%${safe}%"`;
    return `kode_barang.ilike.${pattern},nama_barang.ilike.${pattern},kategori.ilike.${pattern}`;
}

function setupSearch() {
    const input = $("searchInput");
    let timer = null;
    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.search = input.value.trim();
            state.page = 1;
            loadPage();
        }, 400);
    });
}

// ===================================================
// KELOMPOK 8: MEMUAT & MENAMPILKAN TABEL UTAMA
// Fungsi: mengambil 100 baris per halaman dari stock_in_view untuk cabang
// terpilih, diurutkan per kategori lalu tanggal terbaru. Setiap pergantian
// kategori diberi baris judul kelompok.
// ===================================================
const VIEW_COLUMNS = "id, created_at, kode_barang, nama_barang, satuan, photo_path, qty, is_new, kategori_id, kategori, keterangan, petugas";

async function loadPage() {
    const myReq = ++state.reqId;
    $("stockInTableBody").innerHTML = `<tr class="row-loading"><td colspan="10"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient.schema(DB_SCHEMA).from(VIEW_STOCK_IN)
            .select(VIEW_COLUMNS, { count: "exact" })
            .eq("branch_id", state.branchId);
        if (state.search) query = query.or(buildSearchOrClause(state.search));

        const start = (state.page - 1) * ROWS_PER_PAGE;
        query = query
            .order("kategori", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
            .order("id", { ascending: true })
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
        console.error("Gagal memuat data barang masuk:", err);
        $("stockInTableBody").innerHTML = `<tr class="row-empty"><td colspan="10">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

function renderTable() {
    const tbody = $("stockInTableBody");
    if (state.rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">${state.search ? "Tidak ada data yang cocok dengan pencarian." : "Belum ada data barang masuk untuk cabang ini."}</td></tr>`;
        return;
    }

    const start = (state.page - 1) * ROWS_PER_PAGE;
    const dash = `<span class="data-empty-cell">-</span>`;
    const clickable = state.canSwitch ? "row-clickable" : "";
    let lastGroup = null;
    let html = "";

    state.rows.forEach((r, i) => {
        const group = r.kategori || "";
        if (group !== lastGroup) {
            html += `<tr class="row-group"><td colspan="10"><i class="fa-solid fa-tag"></i> ${group ? esc(group) : "Tanpa Kategori"}</td></tr>`;
            lastGroup = group;
        }
        const qty = formatQty(r.qty);
        const empty = `<span class="qty-zero">-</span>`;
        html += `
            <tr class="${clickable}" data-id="${esc(r.id)}">
                <td class="col-no">${start + i + 1}</td>
                <td>${esc(formatTanggal(r.created_at))}</td>
                <td>${esc(r.kode_barang)}</td>
                <td>${r.nama_barang ? esc(r.nama_barang) : dash}</td>
                <td class="col-qty">${r.is_new === true ? qty : empty}</td>
                <td class="col-qty">${r.is_new === true ? empty : qty}</td>
                <td>${r.satuan ? esc(r.satuan) : dash}</td>
                <td>${r.is_new === true
                    ? '<span class="badge-status badge-new">New</span>'
                    : '<span class="badge-status badge-second">Second</span>'}</td>
                <td>${r.kategori ? esc(r.kategori) : dash}</td>
                <td class="col-ket">${r.keterangan ? esc(r.keterangan) : dash}</td>
            </tr>`;
    });
    tbody.innerHTML = html;

    // Klik baris -> modal Edit / Hapus (hanya Maintenance & Superadmin)
    if (state.canSwitch) {
        tbody.querySelectorAll("tr.row-clickable").forEach(tr => {
            tr.addEventListener("click", () => {
                const row = state.rows.find(x => String(x.id) === tr.dataset.id);
                if (row) openEditModal(row);
            });
        });
    }
}

function renderPagination() {
    const container = $("stockInPagination");
    const totalPages = Math.ceil(state.totalRows / ROWS_PER_PAGE);
    if (totalPages <= 1) {
        container.innerHTML = state.totalRows > 0 ? `<span class="ct-page-info">${state.totalRows} data</span>` : "";
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
    html += `<span class="ct-page-info">${state.totalRows} data</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); loadPage(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadPage(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadPage(); } };
}

// ===================================================
// KELOMPOK 9: MODAL - BAGIAN UMUM
// Fungsi: memasang tombol-tombol modal, membuat baris tabel isian,
// dan menangani ketikan pada baris (Kode Barang, Qty, Baru/Second, Keterangan).
// Baris baru muncul otomatis saat baris terakhir mulai diisi (maks. 50).
// ===================================================
function setupModal() {
    $("btnInput").addEventListener("click", openInputModal);
    $("btnMiSimpan").addEventListener("click", () => {
        if (modalState.mode === "add") saveAdd();
        else if (modalState.mode === "edit") saveEdit();
    });
    $("btnMiHapus").addEventListener("click", handleHapus);

    // Kotak saran Kode Barang: dipasang di dalam elemen modal agar tampil di atas modal
    suggest.box = document.createElement("div");
    suggest.box.className = "ks-box";
    suggest.box.style.display = "none";
    $("modalInput").appendChild(suggest.box);
    suggest.box.addEventListener("mousedown", (e) => {
        e.preventDefault();      // jangan pindahkan fokus dari kolom Kode Barang
        const el = e.target.closest(".ks-item");
        if (el) pickSuggestion(parseInt(el.dataset.k, 10));
    });
    document.addEventListener("scroll", (e) => { if (e.target !== suggest.box) hideSuggest(); }, true);
    $("modalInput").addEventListener("hidden.bs.modal", () => {
        hideSuggest();
        modalState = { mode: null, rows: [], editRow: null };
        showMsg("", "");
    });

    // Penanganan ketikan di tabel modal (satu pendengar untuk semua baris)
    const tbody = $("miTbody");
    tbody.addEventListener("input", (e) => {
        const tr = e.target.closest("tr[data-i]");
        if (!tr) return;
        const i = parseInt(tr.dataset.i, 10);
        const row = modalState.rows[i];
        if (e.target.classList.contains("kode-input")) onKodeInput(i, e.target);
        else if (e.target.classList.contains("qty-input")) { row.qty = e.target.value; maybeAddRow(i); }
        else if (e.target.classList.contains("ket-input")) row.keterangan = e.target.value;
    });
    tbody.addEventListener("click", (e) => {
        const btn = e.target.closest(".seg button");
        if (!btn) return;
        const tr = btn.closest("tr[data-i]");
        const row = modalState.rows[parseInt(tr.dataset.i, 10)];
        row.isNew = btn.dataset.val === "true";
        btn.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
    });
    tbody.addEventListener("keydown", (e) => {
        if (!e.target.classList.contains("kode-input")) return;
        if (suggest.box.style.display === "none") return;
        if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggest(-1); }
        else if (e.key === "Enter") { e.preventDefault(); pickSuggestion(suggest.active >= 0 ? suggest.active : 0); }
        else if (e.key === "Escape") { e.stopPropagation(); hideSuggest(); }
    });
    tbody.addEventListener("focusout", (e) => {
        if (e.target.classList.contains("kode-input")) setTimeout(hideSuggest, 150);
    });
}

function makeEmptyRow() {
    return { item: null, text: "", qty: "", isNew: true, keterangan: "" };
}

function fotoCellHtml(url) {
    if (!url) return `<span class="data-empty-cell">-</span>`;
    return `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="mi-thumb" src="${esc(url)}" alt="Foto"></a>`;
}

// Membuat HTML satu baris tabel di modal. mode "edit" = kode & keterangan readonly.
function buildRowHtml(i, row, mode) {
    const edit = mode === "edit";
    const it = row.item;
    return `
        <tr data-i="${i}">
            <td class="mi-no">${i + 1}</td>
            <td><input type="text" class="md-input kode-input" value="${esc(row.text)}" placeholder="Kode Barang, Nama Barang" autocomplete="off" ${edit ? "readonly" : ""}></td>
            <td><input type="text" class="md-input nama-out" value="${esc(it?.nama_barang || "")}" readonly tabindex="-1"></td>
            <td><input type="number" class="md-input qty-input" value="${esc(row.qty)}" min="0" step="any" inputmode="decimal"></td>
            <td><input type="text" class="md-input satuan-out" value="${esc(it?.satuan || "")}" readonly tabindex="-1"></td>
            <td><div class="seg">
                <button type="button" data-val="true" class="${row.isNew ? "active" : ""}">Baru</button>
                <button type="button" data-val="false" class="${row.isNew ? "" : "active"}">Second</button>
            </div></td>
            <td class="foto-out">${fotoCellHtml(it?.photo_path)}</td>
            <td><input type="text" class="md-input ket-input" value="${esc(row.keterangan)}" maxlength="500" ${edit ? "readonly" : ""}></td>
        </tr>`;
}

function updateCount() {
    $("miCount").textContent = modalState.mode === "add"
        ? `${modalState.rows.length} / ${MODAL_MAX_ROWS} baris (baris kosong diabaikan)`
        : "";
}

// Menambah satu baris kosong jika baris yang sedang diisi adalah baris terakhir
function maybeAddRow(i) {
    if (modalState.mode !== "add") return;
    if (i !== modalState.rows.length - 1) return;
    if (modalState.rows.length >= MODAL_MAX_ROWS) return;
    const row = makeEmptyRow();
    modalState.rows.push(row);
    $("miTbody").insertAdjacentHTML("beforeend", buildRowHtml(modalState.rows.length - 1, row, "add"));
    updateCount();
}

function getTr(i) {
    return $("miTbody").querySelector(`tr[data-i="${i}"]`);
}

// ===================================================
// KELOMPOK 10: MODAL - PENCARIAN KODE BARANG (AUTOSEARCH)
// Fungsi: saat mengetik di kolom Kode Barang, muncul daftar saran
// "KODE - Nama Barang" dari data_barang (barang aktif). Setelah dipilih,
// Nama Barang, Satuan, dan Foto terisi otomatis (readonly).
// Mengubah teks setelah memilih akan membatalkan pilihan sebelumnya.
// ===================================================
function onKodeInput(i, inputEl) {
    const row = modalState.rows[i];
    row.text = inputEl.value;

    if (row.item) {                  // teks diubah -> pilihan lama dibatalkan
        row.item = null;
        const tr = getTr(i);
        tr.querySelector(".nama-out").value = "";
        tr.querySelector(".satuan-out").value = "";
        tr.querySelector(".foto-out").innerHTML = fotoCellHtml(null);
    }
    if (row.text.trim() !== "") maybeAddRow(i);

    clearTimeout(suggest.timer);
    const term = row.text.trim();
    if (term.length === 0) { hideSuggest(); return; }
    suggest.timer = setTimeout(() => runSuggest(i, term, inputEl), 250);
}

async function runSuggest(i, term, inputEl) {
    const myReq = ++suggest.reqId;
    try {
        const safe = term.replace(/[\\"]/g, "\\$&");
        const pattern = `"%${safe}%"`;
        const { data, error } = await supabaseClient.schema(DB_SCHEMA).from("data_barang")
            .select("kode_barang, nama_barang, satuan, photo_path, kategori_barang_id, is_makassar, is_surabaya")
            .eq("is_active", true)
            .or(`kode_barang.ilike.${pattern},nama_barang.ilike.${pattern}`)
            .order("kode_barang", { ascending: true })
            .limit(SUGGEST_LIMIT * 3);
        if (myReq !== suggest.reqId) return;
        if (error) throw error;

        let items = data || [];
        const flagCol = BRANCH_FLAG_COLUMN[state.branchId];
        if (BATASI_BARANG_PER_CABANG && flagCol) items = items.filter(x => x[flagCol] !== false);
        suggest.items = items.slice(0, SUGGEST_LIMIT);
        suggest.active = suggest.items.length ? 0 : -1;
        suggest.rowIdx = i;
        showSuggest(inputEl);
    } catch (err) {
        if (myReq !== suggest.reqId) return;
        console.error("Gagal mencari barang:", err);
        suggest.items = [];
        suggest.rowIdx = i;
        showSuggest(inputEl, "Gagal mencari barang: " + err.message);
    }
}

function showSuggest(inputEl, errorText) {
    const box = suggest.box;
    const rect = inputEl.getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.bottom + 2}px`;
    box.style.width = `${Math.max(rect.width, 340)}px`;

    if (suggest.items.length === 0) {
        box.innerHTML = `<div class="ks-empty">${esc(errorText || "Tidak ada barang yang cocok.")}</div>`;
    } else {
        box.innerHTML = suggest.items.map((x, k) => `
            <div class="ks-item ${k === suggest.active ? "active" : ""}" data-k="${k}">
                <b>${esc(x.kode_barang)}</b> &mdash; ${esc(x.nama_barang || "-")}
            </div>`).join("");
    }
    box.style.display = "block";
}

function hideSuggest() {
    suggest.box.style.display = "none";
    suggest.items = [];
    suggest.active = -1;
}

function moveSuggest(step) {
    if (suggest.items.length === 0) return;
    suggest.active = (suggest.active + step + suggest.items.length) % suggest.items.length;
    suggest.box.querySelectorAll(".ks-item").forEach((el, k) => el.classList.toggle("active", k === suggest.active));
}

function pickSuggestion(k) {
    const item = suggest.items[k];
    const i = suggest.rowIdx;
    if (!item || i < 0) return;
    const row = modalState.rows[i];
    row.item = item;
    row.text = item.kode_barang;

    const tr = getTr(i);
    tr.querySelector(".kode-input").value = item.kode_barang;
    tr.querySelector(".nama-out").value = item.nama_barang || "";
    tr.querySelector(".satuan-out").value = item.satuan || "";
    tr.querySelector(".foto-out").innerHTML = fotoCellHtml(item.photo_path);
    tr.classList.remove("row-invalid");

    hideSuggest();
    maybeAddRow(i);
    tr.querySelector(".qty-input").focus();
}

// ===================================================
// KELOMPOK 11: MODAL INPUT - BUKA & SIMPAN
// Fungsi: membuka modal dengan 5 baris kosong. Saat "Simpan", semua
// baris yang terisi divalidasi dulu, lalu dikirim dalam SATU permintaan
// ke database. Jika satu baris saja gagal, tidak ada yang tersimpan.
// Kolom yang diisi otomatis: kategori_id (dari barang), petugas (NIK sesi),
// branch_id (cabang yang sedang dibuka), created_at.
// ===================================================
function openInputModal() {
    modalState = { mode: "add", rows: [], editRow: null };
    for (let i = 0; i < MODAL_START_ROWS; i++) modalState.rows.push(makeEmptyRow());

    $("miTitle").textContent = `Input Barang Masuk - ${branchName()}`;
    $("miTbody").innerHTML = modalState.rows.map((r, i) => buildRowHtml(i, r, "add")).join("");
    $("btnMiHapus").classList.add("d-none");
    $("btnMiSimpan").innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan`;
    showMsg("", "");
    updateCount();
    bootstrap.Modal.getOrCreateInstance($("modalInput")).show();
}

async function saveAdd() {
    showMsg("", "");
    $("miTbody").querySelectorAll("tr").forEach(tr => tr.classList.remove("row-invalid"));

    // Baris dianggap "terisi" jika ada teks kode, pilihan barang, atau qty
    const used = [];
    modalState.rows.forEach((r, i) => {
        if (r.item || r.text.trim() !== "" || String(r.qty).trim() !== "") used.push({ r, i });
    });
    if (used.length === 0) { showMsg("Isi minimal satu baris barang.", "warning"); return; }

    const errors = [];
    used.forEach(({ r, i }) => {
        const msgs = [];
        if (!r.item) msgs.push("pilih Kode Barang dari daftar saran");
        const qty = parseFloat(r.qty);
        if (isNaN(qty) || qty <= 0) msgs.push("Qty harus lebih dari 0");
        if (msgs.length) {
            errors.push(`Baris ${i + 1}: ${msgs.join(", ")}.`);
            getTr(i).classList.add("row-invalid");
        }
    });
    if (errors.length) {
        const shown = errors.slice(0, 6).join("\n");
        showMsg(`Tidak ada data yang disimpan. Perbaiki dulu:\n${shown}${errors.length > 6 ? `\n...dan ${errors.length - 6} baris lain.` : ""}`, "danger");
        return;
    }

    const username = getCurrentUsername();
    if (!username) { showMsg("Username (NIK) tidak ditemukan di sesi login. Silakan login ulang, lalu coba lagi.", "danger"); return; }

    // Peringatan jika kode barang + status yang sama terisi lebih dari sekali
    const seen = new Set();
    const dupes = new Set();
    used.forEach(({ r }) => {
        const key = `${r.item.kode_barang}|${r.isNew}`;
        if (seen.has(key)) dupes.add(`${r.item.kode_barang} (${r.isNew ? "Baru" : "Second"})`);
        seen.add(key);
    });
    if (dupes.size > 0 && !confirm(`Barang ini terisi lebih dari satu baris:\n${Array.from(dupes).join(", ")}\n\nTetap simpan?`)) return;

    const now = new Date().toISOString();
    const payload = used.map(({ r }) => ({
        created_at: now,
        kode_barang: r.item.kode_barang,
        qty: parseFloat(r.qty),
        branch_id: state.branchId,
        kategori_id: r.item.kategori_barang_id ?? null,
        petugas: username,
        is_new: r.isNew,
        keterangan: r.keterangan.trim() || null
    }));

    const btn = $("btnMiSimpan");
    setBusy(btn, true, "Menyimpan...");
    try {
        // Satu perintah insert untuk semua baris = satu transaksi (semua tersimpan atau tidak sama sekali)
        const { error } = await supabaseClient.schema(DB_SCHEMA).from(TABLE_STOCK_IN).insert(payload);
        if (error) throw error;

        bootstrap.Modal.getOrCreateInstance($("modalInput")).hide();
        state.page = 1;
        await loadPage();
        alert(`${payload.length} baris barang masuk berhasil disimpan.`);
    } catch (err) {
        console.error("Gagal menyimpan barang masuk:", err);
        showMsg(`Tidak ada data yang tersimpan. ${err.message}`, "danger");
    } finally {
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 12: MODAL EDIT & HAPUS (khusus Maintenance & Superadmin)
// Fungsi: klik baris tabel membuka modal berisi SATU baris itu. Hanya Qty
// dan Baru/Second yang bisa diubah; kolom lain readonly. Saat disimpan,
// kolom petugas diganti dengan NIK user yang mengedit.
// "Hapus" menghapus baris dari database secara permanen.
// ===================================================
function openEditModal(r) {
    if (!state.canSwitch) return;
    modalState = {
        mode: "edit",
        editRow: r,
        rows: [{
            item: { kode_barang: r.kode_barang, nama_barang: r.nama_barang, satuan: r.satuan, photo_path: r.photo_path },
            text: r.kode_barang,
            qty: String(r.qty ?? ""),
            isNew: r.is_new === true,
            keterangan: r.keterangan || ""
        }]
    };

    $("miTitle").textContent = `Edit Barang Masuk - ${branchName()}`;
    $("miTbody").innerHTML = buildRowHtml(0, modalState.rows[0], "edit");
    $("btnMiHapus").classList.remove("d-none");
    $("btnMiSimpan").innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan`;
    showMsg("", "");
    updateCount();
    bootstrap.Modal.getOrCreateInstance($("modalInput")).show();
}

async function saveEdit() {
    const r = modalState.editRow;
    const row = modalState.rows[0];
    if (!r || !row) return;

    const qty = parseFloat(row.qty);
    if (isNaN(qty) || qty <= 0) { showMsg("Qty harus lebih dari 0.", "danger"); return; }

    const username = getCurrentUsername();
    if (!username) { showMsg("Username (NIK) tidak ditemukan di sesi login. Silakan login ulang, lalu coba lagi.", "danger"); return; }

    if (qty === Number(r.qty) && row.isNew === (r.is_new === true)) {   // tidak ada perubahan
        bootstrap.Modal.getOrCreateInstance($("modalInput")).hide();
        return;
    }

    const btn = $("btnMiSimpan");
    setBusy(btn, true, "Menyimpan...");
    try {
        const { data, error } = await supabaseClient.schema(DB_SCHEMA).from(TABLE_STOCK_IN)
            .update({ qty, is_new: row.isNew, petugas: username })
            .eq("id", r.id).eq("branch_id", state.branchId)
            .select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
            showMsg("Tidak ada data yang berubah. Kemungkinan data sudah dihapus, atau akun ini tidak punya izin mengubahnya.", "danger");
            return;
        }
        bootstrap.Modal.getOrCreateInstance($("modalInput")).hide();
        await loadPage();
    } catch (err) {
        console.error("Gagal menyimpan perubahan:", err);
        showMsg("Gagal menyimpan: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}

async function handleHapus() {
    const r = modalState.editRow;
    if (!r) return;

    const ok = confirm(
        "HAPUS PERMANEN data barang masuk ini?\n\n" +
        `Tanggal : ${formatTanggal(r.created_at)}\n` +
        `Barang  : ${r.kode_barang} - ${r.nama_barang || "-"}\n` +
        `Qty     : ${formatQty(r.qty)} (${r.is_new === true ? "Baru" : "Second"})\n\n` +
        "Data tidak bisa dikembalikan dan stok barang akan berkurang."
    );
    if (!ok) return;

    const btn = $("btnMiHapus");
    setBusy(btn, true, "Menghapus...");
    try {
        const { data, error } = await supabaseClient.schema(DB_SCHEMA).from(TABLE_STOCK_IN)
            .delete()
            .eq("id", r.id).eq("branch_id", state.branchId)
            .select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
            showMsg("Tidak ada data yang terhapus. Kemungkinan data sudah dihapus, atau akun ini tidak punya izin menghapusnya.", "danger");
            return;
        }
        bootstrap.Modal.getOrCreateInstance($("modalInput")).hide();
        if (state.rows.length === 1 && state.page > 1) state.page--;
        await loadPage();
    } catch (err) {
        console.error("Gagal menghapus:", err);
        showMsg("Gagal menghapus: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}