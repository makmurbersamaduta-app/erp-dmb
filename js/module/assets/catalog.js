// ===================================================
// catalog.js
// Halaman "Stock Barang" (sumber data: view ga.stock_view)
// Fitur: tab cabang (Makassar / Surabaya), search, download Excel,
//        tabel Baru / Second dengan pagination 100 baris,
//        tombol Barang Masuk / Barang Keluar / Surat Jalan.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const DB_SCHEMA = "ga";              // schema database
const STOCK_VIEW = "stock_view";     // view sumber data
const ROWS_PER_PAGE = 100;           // baris maksimal per halaman

// Cabang: branch_id -> nama tab
const BRANCHES = { 1: "Makassar", 2: "Surabaya" };
const DEFAULT_BRANCH = 1;

// Halaman tujuan untuk 3 tombol di bawah tabel.
// Cabang yang sedang dibuka ikut dikirim sebagai ?branch_id=1 atau ?branch_id=2.
const ACTION_PAGES = {
    masuk: "barang_masuk.html",
    keluar: "barang_keluar.html",
    suratJalan: "surat_jalan.html"
};

// Sesi login & hak akses cabang
const SESSION_KEY = "erp_session";              // key sesi login di browser (JSON)
const ROLE_IDS_ALL_BRANCH = [1, 2];             // roleId yang boleh pindah cabang: 1 = Maintenance, 2 = Superadmin
// PERLU DICEK: nama field di erp_session yang berisi branch_id user.
// Contoh sesi yang saya terima TIDAK punya field cabang, jadi ini tebakan.
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan kondisi halaman saat ini.
// ===================================================
const state = {
    branchId: DEFAULT_BRANCH,
    canSwitch: false,   // true jika user boleh pindah tab cabang
    items: [],      // semua barang cabang ini (satu baris per kode barang, sudah digabung Baru + Second)
    search: "",
    page: 1,
    reqId: 0        // penanda permintaan terbaru, supaya hasil lama tidak menimpa hasil baru
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// Fungsi: potongan kecil yang dipakai berulang.
// ===================================================
const $ = (id) => document.getElementById(id);

// Mengamankan teks sebelum dimasukkan ke HTML
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Angka -> "1.234,5" (format Indonesia, maksimal 2 desimal)
function formatQty(n) {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n) || 0);
}

function qtyCellHtml(n) {
    const v = Number(n) || 0;
    const cls = v < 0 ? "qty-negative" : (v === 0 ? "qty-zero" : "");
    return `<td class="col-qty ${cls}">${formatQty(v)}</td>`;
}

function todayLocalIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function branchName() {
    return BRANCHES[state.branchId] || `Cabang ${state.branchId}`;
}

// ===================================================
// KELOMPOK 3B: SESI LOGIN & HAK PINDAH CABANG
// Fungsi: membaca sesi login (erp_session), lalu menentukan:
//  - user Maintenance (roleId 1) atau Superadmin (roleId 2): tab cabang
//    tampil dan boleh dipilih bebas
//  - user lain: tab disembunyikan, data otomatis sesuai branch_id di sesinya
// CATATAN KEAMANAN: ini hanya mengatur tampilan di browser. Pembatasan
// data yang sebenarnya harus dipasang di database (RLS).
// ===================================================
function getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        console.error("Sesi login tidak bisa dibaca:", err);
        return null;
    }
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

// Menghentikan halaman dengan pesan jelas (dipakai jika cabang user tidak bisa ditentukan)
function blockPage(message) {
    $("branchTitle").textContent = "-";
    $("stockTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">${esc(message)}</td></tr>`;
    ["searchInput", "btnDownload", "btnBarangMasuk", "btnBarangKeluar", "btnSuratJalan"]
        .forEach(id => { $(id).disabled = true; });
}

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: dijalankan saat halaman selesai dimuat.
//  - Maintenance / Superadmin: cabang awal dari alamat halaman (?branch_id=2),
//    jika tidak ada dipakai branch_id sesi, jika tidak ada juga dipakai default.
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
        if (!session) {
            blockPage("Sesi login tidak ditemukan. Silakan login ulang.");
            return;
        }
        if (!BRANCHES[sessionBranch]) {
            blockPage("Cabang akun Anda tidak terdeteksi. Hubungi admin.");
            return;
        }
        state.branchId = sessionBranch;
    }

    setupTabs();
    setupSearch();
    setupDownload();
    setupActionButtons();
    updateTabUi();
    loadStock();
});

// ===================================================
// KELOMPOK 5: TAB CABANG
// Fungsi: pindah antar Makassar / Surabaya. Mengganti judul kedua,
// memuat ulang data cabang yang dipilih, dan mencatat pilihan di alamat
// halaman supaya tetap sama saat kembali dari halaman lain.
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

            loadStock();
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
}

// ===================================================
// KELOMPOK 6: MEMUAT DATA STOK
// Fungsi: mengambil SELURUH baris stock_view milik cabang terpilih
// (1000 baris per permintaan), lalu menggabungkan baris "Baru" dan
// "Second" milik barang yang sama menjadi satu baris tabel.
// ===================================================
async function loadStock() {
    const myReq = ++state.reqId;
    $("stockTableBody").innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    $("stockPagination").innerHTML = "";

    try {
        const rows = [];
        const PAGE = 1000;
        for (let from = 0, loop = 0; loop < 200; loop++, from += PAGE) {
            const { data, error } = await supabaseClient
                .schema(DB_SCHEMA)
                .from(STOCK_VIEW)
                .select("branch_id, kode_barang, nama_barang, satuan, qty, kategori, is_new")
                .eq("branch_id", state.branchId)
                .order("kode_barang", { ascending: true })
                .order("is_new", { ascending: true })
                .range(from, from + PAGE - 1);
            if (myReq !== state.reqId) return;      // user sudah pindah tab
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < PAGE) break;
        }

        state.items = pivotRows(rows);
        state.page = 1;
        render();
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat stok:", err);
        $("stockTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

// Menggabungkan baris per (kode barang, is_new) menjadi satu baris per kode barang:
//   is_new = true            -> kolom Baru
//   is_new = false atau NULL -> kolom Second
function pivotRows(rows) {
    const map = new Map();
    rows.forEach(r => {
        let item = map.get(r.kode_barang);
        if (!item) {
            item = { kode_barang: r.kode_barang, nama_barang: null, satuan: null, kategori: null, qtyBaru: 0, qtySecond: 0 };
            map.set(r.kode_barang, item);
        }
        if (!item.nama_barang && r.nama_barang) item.nama_barang = r.nama_barang;
        if (!item.satuan && r.satuan) item.satuan = r.satuan;
        if (!item.kategori && r.kategori) item.kategori = r.kategori;

        const qty = Number(r.qty) || 0;
        if (r.is_new === true) item.qtyBaru += qty;
        else item.qtySecond += qty;
    });
    return Array.from(map.values())
        .sort((a, b) => String(a.kode_barang).localeCompare(String(b.kode_barang), "id"));
}

// ===================================================
// KELOMPOK 7: SEARCH
// Fungsi: menyaring daftar berdasarkan kode barang, nama barang,
// dan kategori (tanpa membedakan huruf besar/kecil).
// ===================================================
function setupSearch() {
    const input = $("searchInput");
    let timer = null;
    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.search = input.value.trim().toLowerCase();
            state.page = 1;
            render();
        }, 300);
    });
}

function getFilteredItems() {
    const kw = state.search;
    if (!kw) return state.items;
    return state.items.filter(it =>
        String(it.kode_barang || "").toLowerCase().includes(kw) ||
        String(it.nama_barang || "").toLowerCase().includes(kw) ||
        String(it.kategori || "").toLowerCase().includes(kw)
    );
}

// ===================================================
// KELOMPOK 8: TAMPILAN TABEL + PAGINATION
// Fungsi: menampilkan maksimal 100 baris per halaman, dengan nomor urut
// yang berlanjut antar halaman.
// ===================================================
function render() {
    const filtered = getFilteredItems();
    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;

    const start = (state.page - 1) * ROWS_PER_PAGE;
    const pageItems = filtered.slice(start, start + ROWS_PER_PAGE);
    const tbody = $("stockTableBody");

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">${state.search ? "Tidak ada data yang cocok dengan pencarian." : "Belum ada stok untuk cabang ini."}</td></tr>`;
    } else {
        const dash = `<span class="data-empty-cell">-</span>`;
        tbody.innerHTML = pageItems.map((it, i) => `
            <tr>
                <td class="col-no">${start + i + 1}</td>
                <td>${esc(it.kode_barang)}</td>
                <td>${it.nama_barang ? esc(it.nama_barang) : dash}</td>
                ${qtyCellHtml(it.qtyBaru)}
                ${qtyCellHtml(it.qtySecond)}
                <td>${it.satuan ? esc(it.satuan) : dash}</td>
                <td>${it.kategori ? esc(it.kategori) : dash}</td>
            </tr>`).join("");
    }
    renderPagination(filtered.length, totalPages);
}

function renderPagination(totalRows, totalPages) {
    const container = $("stockPagination");
    if (totalPages <= 1) {
        container.innerHTML = totalRows > 0 ? `<span class="ct-page-info">${totalRows} barang</span>` : "";
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
    html += `<span class="ct-page-info">${totalRows} barang</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); render(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; render(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; render(); } };
}

// ===================================================
// KELOMPOK 9: DOWNLOAD EXCEL
// Fungsi: mengunduh SEMUA barang cabang yang sedang dibuka (bukan hanya
// halaman ini), sesuai kata pencarian bila ada.
// Kolom: Kategori, Kode Barang, Nama Barang, Qty Baru, Satuan, Qty Second, Satuan.
// ===================================================
function setupDownload() {
    $("btnDownload").addEventListener("click", handleDownload);
}

function handleDownload() {
    const items = getFilteredItems();
    if (items.length === 0) {
        alert("Tidak ada data untuk diunduh.");
        return;
    }

    // Memakai array-of-array karena judul kolom "Satuan" muncul dua kali
    const aoa = [["Kategori", "Kode Barang", "Nama Barang", "Qty Baru", "Satuan", "Qty Second", "Satuan"]];
    items.forEach(it => {
        aoa.push([
            it.kategori || "",
            it.kode_barang,
            it.nama_barang || "",
            it.qtyBaru,
            it.satuan || "",
            it.qtySecond,
            it.satuan || ""
        ]);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Stock ${branchName()}`);
    XLSX.writeFile(wb, `Stock_Barang_${branchName()}_${todayLocalIso()}.xlsx`);
}

// ===================================================
// KELOMPOK 10: TOMBOL AKSI (Barang Masuk / Barang Keluar / Surat Jalan)
// Fungsi: membuka halaman tujuan sesuai ACTION_PAGES di bagian atas file,
// sambil membawa cabang yang sedang dibuka (?branch_id=...).
// Jika halamannya belum diisi, muncul pesan pemberitahuan.
// ===================================================
function setupActionButtons() {
    $("btnBarangMasuk").addEventListener("click", () => openActionPage("masuk", "Barang Masuk"));
    $("btnBarangKeluar").addEventListener("click", () => openActionPage("keluar", "Barang Keluar"));
    $("btnSuratJalan").addEventListener("click", () => openActionPage("suratJalan", "Surat Jalan"));
}

function openActionPage(key, label) {
    const url = ACTION_PAGES[key];
    if (!url) {
        alert(`Halaman "${label}" belum tersedia. Isi ACTION_PAGES di catalog.js setelah halamannya dibuat.`);
        return;
    }
    window.location.href = `${url}${url.includes("?") ? "&" : "?"}branch_id=${state.branchId}`;
}