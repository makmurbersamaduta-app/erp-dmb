// ===================================================
// data-barang.js
// Halaman "Database Barang" (schema ga)
// Tabel: ga.data_barang, ga.data_barang_reform, ga.kategori_barang
// Fitur: tabel + pagination, search, filter, download Excel,
//        tambah barang, lihat/edit/hapus barang, update harga.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// Kalau ada yang perlu diubah (nama bucket, persen harga internal, dll),
// cukup ubah di sini.
// ===================================================
const supabaseClient = window.supabaseClient;

const DB_SCHEMA = "ga";                 // schema database
const BUCKET_FOTO = "data-barang";      // nama bucket Storage (public)
const ROWS_PER_PAGE = 50;               // jumlah baris per halaman tabel
const INTERNAL_MARKUP_PERCENT = 5;      // Harga Internal = Harga Supplier + 5%

// Pengaturan kompresi foto (sebelum upload ke Supabase).
// Ingin lebih kecil lagi? Turunkan angka di bawah. Ingin lebih tajam? Naikkan.
const FOTO_MAX_SIDE = 640;             // sisi terpanjang foto (piksel)
const FOTO_QUALITY_START = 0.5;        // kualitas JPEG awal (0.1 - 1.0)
const FOTO_QUALITY_MIN = 0.3;          // kualitas terendah yang boleh dipakai
const FOTO_TARGET_BYTES = 50 * 1024;   // target ukuran maksimal (50 KB)

// Sesi login disimpan di browser pada key "erp_session" berupa JSON
// (berisi nik, fullName, roleName, dll). Username = nik karyawan.
const USERNAME_STORAGE_KEY = "erp_session";

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan kondisi halaman saat ini (data tabel, filter aktif,
// halaman ke berapa, dll).
// ===================================================
let kategoriList = [];      // semua kategori (aktif & tidak aktif) dari ga.kategori_barang
let estimasiOptions = [];   // daftar unik estimasi masa pakai (untuk filter)

const state = {
    filters: { kategori: [], level: [], estimasi: [] },
    page: 1,
    totalRows: 0,
    data: [],       // baris barang halaman ini (sudah digabung dengan harga aktif di row.price)
    search: "",
    reqId: 0        // penanda permintaan terbaru, supaya hasil lama tidak menimpa hasil baru
};

// Konteks modal Barang: mode = "add" | "view" | "edit"
let modalCtx = { mode: null, row: null };
let kodeReqId = 0;          // penanda permintaan kode barang terbaru
let hargaCtx = { row: null };
let kategoriFormCtx = { mode: null, row: null };

// Satuan: daftar tetap + satuan tambahan yang sudah pernah dipakai di data barang
const SATUAN_DEFAULT = ["Pcs", "Liter", "Meter", "Kg", "Lembar", "Pack", "Botol", "Set", "Unit", "Pasang", "Roll"];
const SATUAN_NEW_VALUE = "__new__";   // nilai khusus untuk opsi "Tambah Satuan"
let satuanExtra = [];

// Field filter: key = nama di state.filters
const FILTER_FIELDS = [
    { key: "kategori", label: "Kategori Barang" },
    { key: "level", label: "Level Approval" },
    { key: "estimasi", label: "Estimasi Masa Pakai (bulan)" }
];

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// Fungsi: potongan kecil yang dipakai berulang oleh bagian lain.
// ===================================================
const $ = (id) => document.getElementById(id);
const db = () => supabaseClient.schema(DB_SCHEMA);

// Mengamankan teks sebelum dimasukkan ke HTML (mencegah kode berbahaya dari input user)
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Angka -> "1.234.567" (pemisah ribuan format Indonesia)
function formatRupiah(n) {
    if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "";
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n));
}

// "1.234.567" -> 1234567 (NaN jika kosong)
function parseRupiah(text) {
    const digits = String(text || "").replace(/\D/g, "");
    return digits === "" ? NaN : Number(digits);
}

// Tanggal hari ini format YYYY-MM-DD memakai jam lokal
// (tidak memakai toISOString karena di WIB bisa bergeser ke hari sebelumnya)
function todayLocalIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mengambil username (NIK) user yang sedang login.
// Sesi berupa JSON, jadi dibaca dulu lalu diambil field "nik"-nya.
function getCurrentUsername() {
    const raw = sessionStorage.getItem(USERNAME_STORAGE_KEY) || localStorage.getItem(USERNAME_STORAGE_KEY);
    if (!raw) return null;
    try {
        const nik = JSON.parse(raw)?.nik;
        return nik ? String(nik).trim() : null;
    } catch (err) {
        console.error("Sesi login tidak bisa dibaca:", err);
        return null;
    }
}

// Jika username tidak ditemukan, proses simpan dihentikan (supaya created_by tidak kosong)
function requireUsername(msgFn) {
    const u = getCurrentUsername();
    if (!u) msgFn("Username tidak ditemukan di sesi login. Silakan login ulang, lalu coba lagi.", "danger");
    return u;
}

function showMsg(elId, text, type) {
    const el = $(elId);
    if (!text) { el.classList.add("d-none"); el.textContent = ""; return; }
    el.className = `alert py-2 small alert-${type}`;
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

// Dari beberapa baris harga milik satu barang, ambil yang terbaru (created_at terbesar)
function pickLatestPrices(rows) {
    const map = new Map();
    (rows || []).forEach(r => {
        const cur = map.get(r.data_barang_id);
        if (!cur || new Date(r.created_at) > new Date(cur.created_at)) map.set(r.data_barang_id, r);
    });
    return map;
}

// Ambil harga AKTIF untuk sekumpulan id barang (dipotong 100 id per permintaan)
async function fetchActivePrices(ids) {
    const all = [];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { data, error } = await db()
            .from("data_barang_reform")
            .select("data_barang_id, harga_supplier, harga_jual, persen_harga_jual, harga_internal, harga_amortisasi, created_at")
            .in("data_barang_id", chunk)
            .eq("is_active", true);
        if (error) throw error;
        all.push(...(data || []));
    }
    return pickLatestPrices(all);
}

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: dijalankan saat halaman selesai dimuat.
// Memasang semua tombol, memuat kategori, lalu memuat tabel.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupFilterPanel();
    setupSearch();
    setupDownload();
    setupBarangModal();
    setupHargaModal();
    setupKategoriModal();

    try {
        await loadKategori();
        await loadEstimasiOptions();
    } catch (err) {
        console.error("Gagal memuat data referensi:", err);
    }
    renderFilterGroups();
    await loadBarangPage();
});

// ===================================================
// KELOMPOK 5: DATA REFERENSI
// Fungsi: mengambil daftar kategori (untuk dropdown & filter)
// dan daftar estimasi masa pakai unik (untuk filter).
// ===================================================
async function loadKategori() {
    const { data, error } = await db()
        .from("kategori_barang")
        .select("id, kode, kategori, is_active")
        .order("kategori", { ascending: true });
    if (error) throw error;
    kategoriList = data || [];
}

// Mengambil daftar estimasi masa pakai unik (untuk filter) dan daftar satuan
// yang sudah pernah dipakai (untuk dropdown Satuan) dari barang aktif.
async function loadEstimasiOptions() {
    const estSet = new Set();
    const satMap = new Map();   // huruf kecil -> tulisan asli (menghindari duplikat "pcs" / "Pcs")
    const PAGE = 1000;
    for (let from = 0, loop = 0; loop < 30; loop++, from += PAGE) {
        const { data, error } = await db()
            .from("data_barang")
            .select("estimasi_masa_pakai, satuan")
            .eq("is_active", true)
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw error;
        (data || []).forEach(r => {
            if (r.estimasi_masa_pakai !== null && r.estimasi_masa_pakai !== undefined) estSet.add(r.estimasi_masa_pakai);
            const s = String(r.satuan || "").trim().replace(/\s+/g, " ");
            if (s && !satMap.has(s.toLowerCase())) satMap.set(s.toLowerCase(), s);
        });
        if (!data || data.length < PAGE) break;
    }
    estimasiOptions = Array.from(estSet).sort((a, b) => a - b);

    const defaultLower = new Set(SATUAN_DEFAULT.map(s => s.toLowerCase()));
    satuanExtra = Array.from(satMap.entries())
        .filter(([lower]) => !defaultLower.has(lower))
        .map(([, original]) => original)
        .sort((a, b) => a.localeCompare(b, "id"));
}

// ===================================================
// KELOMPOK 6: QUERY SEARCH + FILTER
// Fungsi: menyusun kondisi pencarian dan filter.
// Dipakai bersama oleh tabel dan download Excel.
// Search mencari di: kode barang, nama barang, dan nama kategori.
// ===================================================
function buildSearchOrClause(keyword) {
    const safe = keyword.replace(/[\\"]/g, "\\$&");
    const pattern = `"%${safe}%"`;
    const parts = [`kode_barang.ilike.${pattern}`, `nama_barang.ilike.${pattern}`];

    // Kategori ada di tabel lain, jadi dicari dulu id kategori yang namanya cocok
    const kw = keyword.toLowerCase();
    const ids = kategoriList.filter(k => (k.kategori || "").toLowerCase().includes(kw)).map(k => k.id);
    if (ids.length > 0) parts.push(`kategori_barang_id.in.(${ids.join(",")})`);

    return parts.join(",");
}

function applyStateFilters(query) {
    const f = state.filters;
    if (state.search) query = query.or(buildSearchOrClause(state.search));
    if (f.kategori.length > 0) query = query.in("kategori_barang_id", f.kategori.map(Number));
    if (f.level.length > 0) query = query.in("level_approval", f.level);
    if (f.estimasi.length > 0) query = query.in("estimasi_masa_pakai", f.estimasi.map(Number));
    return query;
}

function setupSearch() {
    const input = $("searchInput");
    let timer = null;
    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.search = input.value.trim();
            state.page = 1;
            loadBarangPage();
        }, 400);
    });
}

// ===================================================
// KELOMPOK 7: TABEL BARANG
// Fungsi: mengambil barang aktif (is_active = true) per halaman,
// menggabungkan dengan harga aktif terbarunya, lalu menampilkannya.
// ===================================================
const BARANG_COLUMNS = "id, kode_barang, nama_barang, satuan, deskripsi, level_approval, estimasi_masa_pakai, photo_path, kategori_barang_id, is_makassar, is_surabaya, is_bekasi";

async function loadBarangPage() {
    const myReq = ++state.reqId;
    const tbody = $("barangTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = db().from("data_barang").select(BARANG_COLUMNS, { count: "exact" }).eq("is_active", true);
        query = applyStateFilters(query);

        const start = (state.page - 1) * ROWS_PER_PAGE;
        query = query.order("kode_barang", { ascending: true }).range(start, start + ROWS_PER_PAGE - 1);

        const { data, error, count } = await query;
        if (myReq !== state.reqId) return;
        if (error) throw error;

        const rows = data || [];
        const priceMap = rows.length ? await fetchActivePrices(rows.map(r => r.id)) : new Map();
        if (myReq !== state.reqId) return;

        rows.forEach(r => { r.price = priceMap.get(r.id) || null; });
        state.data = rows;
        state.totalRows = count || 0;

        renderBarangTable();
        renderPagination();
    } catch (err) {
        console.error("Gagal memuat data barang:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

function renderBarangTable() {
    const tbody = $("barangTableBody");
    if (state.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">Tidak ada data ditemukan.</td></tr>`;
        return;
    }
    const start = (state.page - 1) * ROWS_PER_PAGE;
    const dash = `<span class="data-empty-cell">-</span>`;
    const money = (v) => (v === null || v === undefined) ? dash : formatRupiah(v);

    tbody.innerHTML = state.data.map((r, i) => `
        <tr class="row-clickable" data-id="${esc(r.id)}">
            <td class="col-no">${start + i + 1}</td>
            <td>${esc(r.kode_barang)}</td>
            <td>${r.nama_barang ? esc(r.nama_barang) : dash}</td>
            <td>${r.satuan ? esc(r.satuan) : dash}</td>
            <td class="col-num">${money(r.price?.harga_amortisasi)}</td>
            <td class="col-num">${money(r.price?.harga_jual)}</td>
            <td class="col-num">${money(r.price?.harga_internal)}</td>
        </tr>
    `).join("");
}

function renderPagination() {
    const container = $("barangPagination");
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
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page); loadBarangPage(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadBarangPage(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadBarangPage(); } };
}

// ===================================================
// KELOMPOK 8: PANEL FILTER
// Fungsi: buka/tutup panel, membuat daftar checklist
// (Kategori, Level Approval, Estimasi Masa Pakai), tombol Terapkan & Reset.
// ===================================================
function getFilterOptions(key) {
    if (key === "kategori") return kategoriList.map(k => ({ value: String(k.id), label: k.kategori || "-" }));
    if (key === "level") return [{ value: "Supervisor", label: "Supervisor" }, { value: "Manajer", label: "Manajer" }];
    if (key === "estimasi") return estimasiOptions.map(n => ({ value: String(n), label: `${n} bulan` }));
    return [];
}

function renderFilterGroups() {
    const container = $("filterGroups");
    container.innerHTML = FILTER_FIELDS.map(field => {
        const selected = state.filters[field.key] || [];
        const items = getFilterOptions(field.key).map(opt => `
            <label class="filter-checkbox-item" data-search-text="${esc(opt.label.toLowerCase())}">
                <input type="checkbox" value="${esc(opt.value)}" ${selected.includes(opt.value) ? "checked" : ""}>
                <span>${esc(opt.label)}</span>
            </label>`).join("");
        return `
            <div class="filter-group">
                <button type="button" class="filter-group-header" data-target="fg_${field.key}">
                    <span>${field.label}</span><i class="fa-solid fa-chevron-down"></i>
                </button>
                <div class="filter-group-body" id="fg_${field.key}">
                    <input type="text" class="filter-inline-search" id="fs_${field.key}" placeholder="Cari...">
                    <div class="filter-checkbox-list" id="fl_${field.key}">
                        ${items || '<span class="data-empty-cell">Tidak ada data</span>'}
                    </div>
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

    FILTER_FIELDS.forEach(field => {
        const input = $(`fs_${field.key}`);
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("input", () => {
            const kw = input.value.trim().toLowerCase();
            $(`fl_${field.key}`).querySelectorAll(".filter-checkbox-item").forEach(item => {
                item.style.display = (item.dataset.searchText || "").includes(kw) ? "flex" : "none";
            });
        });
    });
}

function setupFilterPanel() {
    const btn = $("btnFilterToggle");
    const panel = $("filterPanel");

    btn.addEventListener("click", (e) => { e.stopPropagation(); panel.classList.toggle("d-none"); });
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && !btn.contains(e.target)) panel.classList.add("d-none");
    });

    $("btnFilterApply").addEventListener("click", () => {
        FILTER_FIELDS.forEach(field => {
            state.filters[field.key] = Array.from(
                document.querySelectorAll(`#fl_${field.key} input[type="checkbox"]:checked`)
            ).map(cb => cb.value);
        });
        state.page = 1;
        updateFilterBadge();
        panel.classList.add("d-none");
        loadBarangPage();
    });

    $("btnFilterReset").addEventListener("click", () => {
        state.filters = { kategori: [], level: [], estimasi: [] };
        state.page = 1;
        renderFilterGroups();
        updateFilterBadge();
        loadBarangPage();
    });
}

function updateFilterBadge() {
    const f = state.filters;
    const total = f.kategori.length + f.level.length + f.estimasi.length;
    const badge = $("filterCountBadge");
    badge.textContent = total;
    badge.classList.toggle("d-none", total === 0);
}

// ===================================================
// KELOMPOK 9: DOWNLOAD EXCEL
// Fungsi: mengunduh SELURUH barang aktif sesuai search + filter yang aktif
// (tidak dibatasi pagination). Tanpa filter = semua barang aktif.
// Kolom: Kode, Nama, Satuan, Deskripsi, Harga Jual, Harga Internal, Harga Amortisasi.
// ===================================================
function setupDownload() {
    $("btnDownload").addEventListener("click", handleDownload);
}

async function handleDownload() {
    const btn = $("btnDownload");
    setBusy(btn, true, "Menyiapkan...");
    try {
        const PAGE = 1000;
        const allRows = [];
        let totalCount = null;

        while (totalCount === null || allRows.length < totalCount) {
            let q = db().from("data_barang").select(BARANG_COLUMNS, { count: "exact" }).eq("is_active", true);
            q = applyStateFilters(q);
            q = q.order("kode_barang", { ascending: true }).range(allRows.length, allRows.length + PAGE - 1);
            const { data, error, count } = await q;
            if (error) throw error;
            if (totalCount === null) totalCount = count || 0;
            if (!data || data.length === 0) break;
            allRows.push(...data);
        }

        if (allRows.length === 0) {
            alert("Tidak ada data untuk diunduh sesuai filter yang aktif.");
            return;
        }
        if (totalCount !== null && allRows.length < totalCount) {
            alert(`Peringatan: hanya ${allRows.length} dari ${totalCount} baris yang berhasil diambil.`);
        }

        const priceMap = await fetchActivePrices(allRows.map(r => r.id));

        const exportData = allRows.map(r => {
            const p = priceMap.get(r.id);
            return {
                "Kode Barang": r.kode_barang,
                "Nama Barang": r.nama_barang,
                "Satuan": r.satuan,
                "Deskripsi": r.deskripsi,
                "Harga Jual": p ? Number(p.harga_jual) : null,
                "Harga Internal": p ? Number(p.harga_internal) : null,
                "Harga Amortisasi": p ? Number(p.harga_amortisasi) : null
            };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportData), "Database Barang");
        XLSX.writeFile(wb, `Database_Barang_${todayLocalIso()}.xlsx`);
    } catch (err) {
        console.error("Gagal download:", err);
        alert("Gagal menyiapkan file download: " + err.message);
    } finally {
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 10: KALKULATOR HARGA
// Fungsi: rumus otomatis (dipakai modal Barang dan modal Update Harga):
//   Harga Internal   = Harga Supplier + 5% dari Harga Supplier
//   Harga Jual       = Harga Supplier + (Margin / 100 x Harga Supplier)
//   Harga Amortisasi = Harga Jual / Estimasi Masa Pakai
// Semua hasil dibulatkan ke rupiah penuh, supaya yang tampil = yang tersimpan.
// Juga mengatur input otomatis berformat ribuan (1.234.567).
// ===================================================
function computePrices(supplier, margin, estimasi) {
    const internal = Math.round(supplier + (INTERNAL_MARKUP_PERCENT / 100) * supplier);
    const jual = Math.round(supplier + (margin / 100) * supplier);
    const amort = estimasi > 0 ? Math.round(jual / estimasi) : 0; // estimasi kosong/0 -> amortisasi 0
    return { internal, jual, amort };
}

function bindThousandInput(input) {
    input.addEventListener("input", () => {
        const n = parseRupiah(input.value);
        input.value = isNaN(n) ? "" : formatRupiah(n);
    });
}

// cfg: { supplier, margin, internal, jual, amort, getEstimasi }
function bindPriceCalc(cfg, extraTriggers = []) {
    const recalc = () => {
        const supplier = parseRupiah(cfg.supplier.value);
        const margin = parseFloat(cfg.margin.value);
        const estimasi = parseInt(cfg.getEstimasi(), 10);

        if (isNaN(supplier)) {
            cfg.internal.value = ""; cfg.jual.value = ""; cfg.amort.value = "";
            return;
        }
        const internal = Math.round(supplier + (INTERNAL_MARKUP_PERCENT / 100) * supplier);
        cfg.internal.value = formatRupiah(internal);

        if (isNaN(margin)) { cfg.jual.value = ""; cfg.amort.value = ""; return; }
        const p = computePrices(supplier, margin, estimasi);
        cfg.jual.value = formatRupiah(p.jual);
        cfg.amort.value = isNaN(estimasi) ? "" : formatRupiah(p.amort);
    };

    bindThousandInput(cfg.supplier);
    cfg.supplier.addEventListener("input", recalc);
    cfg.margin.addEventListener("input", recalc);
    extraTriggers.forEach(el => el.addEventListener("input", recalc));
    return recalc;
}

// Menyimpan harga BARU sebagai baris riwayat (is_active = true),
// lalu menonaktifkan baris harga lama milik barang yang sama.
async function insertHargaBaru(barangId, p, username) {
    const { data: inserted, error } = await db()
        .from("data_barang_reform")
        .insert({
            created_at: new Date().toISOString(),
            created_by: username,
            data_barang_id: barangId,
            harga_supplier: p.supplier,
            persen_harga_jual: p.margin,
            harga_internal: p.internal,
            harga_jual: p.jual,
            harga_amortisasi: p.amort,
            is_active: true
        })
        .select("id")
        .single();
    if (error) throw error;

    // Nonaktifkan harga lama (semua baris aktif milik barang ini, kecuali yang baru)
    const { error: errOld } = await db()
        .from("data_barang_reform")
        .update({ is_active: false })
        .eq("data_barang_id", barangId)
        .eq("is_active", true)
        .neq("id", inserted.id);
    if (errOld) {
        // Harga baru sudah tersimpan. Tabel tetap menampilkan harga terbaru (created_at terbesar).
        console.warn("Harga baru tersimpan, tapi gagal menonaktifkan harga lama:", errOld);
    }
    return inserted;
}

// ===================================================
// KELOMPOK 11: FOTO (KOMPRESI + UPLOAD)
// Fungsi: mengecilkan foto (sisi terpanjang maks 640 px, JPEG kualitas 50%, turun otomatis sampai ~50 KB),
// mengunggah ke bucket "data-barang", dan menghapus foto lama bila perlu.
// Nama file = kode barang (ATK0001.jpg). Yang disimpan di photo_path adalah URL publik foto.
// ===================================================
function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("Gagal mengompres foto.")), "image/jpeg", quality);
    });
}

// Langkah: perkecil dimensi -> simpan JPEG -> jika masih di atas target ukuran,
// turunkan kualitas bertahap sampai target tercapai atau kualitas minimum.
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith("image/")) { reject(new Error("File harus berupa gambar.")); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = async () => {
            try {
                const scale = Math.min(1, FOTO_MAX_SIDE / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext("2d");
                ctx.imageSmoothingQuality = "high";
                ctx.fillStyle = "#fff";            // latar putih (PNG transparan -> tidak jadi hitam)
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);

                let quality = FOTO_QUALITY_START;
                let blob = await canvasToJpegBlob(canvas, quality);
                while (blob.size > FOTO_TARGET_BYTES && quality - 0.1 >= FOTO_QUALITY_MIN - 1e-9) {
                    quality = Math.round((quality - 0.1) * 100) / 100;
                    blob = await canvasToJpegBlob(canvas, quality);
                }
                resolve(blob);
            } catch (err) {
                reject(err);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Foto tidak dapat dibaca.")); };
        img.src = url;
    });
}

// Nama file foto = kode barang, contoh: ATK0001.jpg
// (selalu .jpg karena foto dikonversi ke JPEG saat dikompres)
function fotoPathForKode(kode) {
    return `${String(kode).trim().replace(/[^A-Za-z0-9_-]+/g, "_")}.jpg`;
}

// Alamat publik foto untuk sebuah kode barang (tanpa mengunggah apa pun)
function fotoUrlForKode(kode) {
    return supabaseClient.storage.from(BUCKET_FOTO).getPublicUrl(fotoPathForKode(kode)).data.publicUrl;
}

// Dua alamat dianggap sama jika file-nya sama (bagian setelah "?" diabaikan)
function samaFoto(a, b) {
    return String(a || "").split("?")[0] === String(b || "").split("?")[0];
}

// Mengunggah foto yang sudah dikompres dengan nama KODE.jpg.
// upsert: true = menimpa file lama bernama sama (dipakai saat foto diganti).
// cacheControl 60 detik: foto yang diganti tidak "tersangkut" lama di cache browser.
async function uploadFotoBlob(blob, kode) {
    const { error } = await supabaseClient.storage.from(BUCKET_FOTO)
        .upload(fotoPathForKode(kode), blob, { contentType: "image/jpeg", upsert: true, cacheControl: "60" });
    if (error) throw error;
    return fotoUrlForKode(kode);
}

async function uploadFoto(file, kode) {
    const blob = await compressImage(file);
    return uploadFotoBlob(blob, kode);
}

async function removeFotoByUrl(url) {
    if (!url) return;
    try {
        const marker = `/${BUCKET_FOTO}/`;
        const idx = url.indexOf(marker);
        if (idx === -1) return;
        const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
        await supabaseClient.storage.from(BUCKET_FOTO).remove([path]);
    } catch (err) {
        console.warn("Gagal menghapus foto lama:", err);
    }
}

function renderFotoInto(container, url) {
    container.innerHTML = "";
    if (!url) { container.innerHTML = `<span class="data-empty-cell">Tidak ada foto.</span>`; return; }
    const link = document.createElement("a");
    link.href = url; link.target = "_blank"; link.rel = "noopener";
    const img = document.createElement("img");
    img.src = url; img.alt = "Foto barang"; img.className = "md-foto";
    img.onerror = () => { container.innerHTML = `<span class="data-empty-cell">Foto tidak dapat dimuat.</span>`; };
    link.appendChild(img);
    container.appendChild(link);
}

// ===================================================
// KELOMPOK 12: GENERATE KODE BARANG
// Fungsi: kode = kode kategori + nomor urut 4 digit (contoh ATK0001).
// Nomor urut = nomor terbesar yang sudah ada untuk kategori itu + 1
// (data nonaktif ikut dihitung, supaya kode lama tidak dipakai ulang).
// ===================================================
async function generateKode(kategoriId) {
    const kat = kategoriList.find(k => String(k.id) === String(kategoriId));
    if (!kat || !kat.kode) throw new Error("Kategori ini belum memiliki kode di tabel kategori_barang.");
    const prefix = String(kat.kode).trim();

    // "_" pada LIKE = tepat satu karakter, jadi pola ini = prefix + 4 karakter
    const { data, error } = await db()
        .from("data_barang")
        .select("kode_barang")
        .like("kode_barang", `${prefix}____`)
        .order("kode_barang", { ascending: false })
        .limit(20);
    if (error) throw error;

    const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d{4})$");
    let max = 0;
    (data || []).forEach(r => {
        const m = re.exec(r.kode_barang || "");
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    if (max >= 9999) throw new Error(`Nomor urut kategori ${prefix} sudah mencapai 9999.`);
    return prefix + String(max + 1).padStart(4, "0");
}

async function refreshKode() {
    const kategoriId = $("fKategori").value;
    const myReq = ++kodeReqId;
    if (!kategoriId) { $("fKode").value = ""; return; }
    $("fKode").value = "Membuat kode...";
    try {
        const kode = await generateKode(kategoriId);
        if (myReq !== kodeReqId) return;
        $("fKode").value = kode;
        showMsg("mbMessage", "", "");
    } catch (err) {
        if (myReq !== kodeReqId) return;
        $("fKode").value = "";
        showMsg("mbMessage", "Gagal membuat kode barang: " + err.message, "danger");
    }
}

// ===================================================
// KELOMPOK 13: MODAL BARANG (Tambah / Lihat / Edit)
// Fungsi: satu modal untuk tiga mode.
//  - add  : semua kolom terbuka
//  - view : semua readonly + tombol Update Harga, Edit, Hapus
//  - edit : kolom terbuka KECUALI kode, kategori, harga supplier, dan margin
//           (harga diubah lewat tombol "Update Harga" supaya riwayat harga tercatat)
// ===================================================
let recalcBarang = () => {};

function setupBarangModal() {
    recalcBarang = bindPriceCalc({
        supplier: $("fSupplier"), margin: $("fMargin"),
        internal: $("fInternal"), jual: $("fJual"), amort: $("fAmortisasi"),
        getEstimasi: () => $("fEstimasi").value
    }, [$("fEstimasi")]);

    $("btnTambah").addEventListener("click", openAddModal);
    $("barangTableBody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        const row = state.data.find(r => String(r.id) === tr.dataset.id);
        if (row) openViewModal(row);
    });

    $("fKategori").addEventListener("change", () => { if (modalCtx.mode === "add") refreshKode(); });
    $("fSatuan").addEventListener("change", () => {
        const isNew = $("fSatuan").value === SATUAN_NEW_VALUE;
        toggleSatuanBaru(isNew);
        if (isNew) $("fSatuanBaru").focus();
    });

    $("fFoto").addEventListener("change", () => {
        const file = $("fFoto").files[0];
        const box = $("fFotoPreview");
        if (!file) { renderFotoInto(box, modalCtx.row?.photo_path || null); return; }
        const localUrl = URL.createObjectURL(file);
        box.innerHTML = `<img src="${localUrl}" class="md-foto" alt="Pratinjau">`;
    });

    $("btnMbEdit").addEventListener("click", () => setBarangMode("edit"));
    $("btnMbBatal").addEventListener("click", () => {
        if (modalCtx.mode === "edit") { fillBarangForm(modalCtx.row); setBarangMode("view"); }
        else bootstrap.Modal.getOrCreateInstance($("modalBarang")).hide();
    });
    $("btnMbHapus").addEventListener("click", handleHapus);
    $("btnMbUpdateHarga").addEventListener("click", () => {
        const row = modalCtx.row;
        const hideEl = $("modalBarang");
        hideEl.addEventListener("hidden.bs.modal", () => openHargaModal(row), { once: true });
        bootstrap.Modal.getOrCreateInstance(hideEl).hide();
    });

    $("formBarang").addEventListener("submit", (e) => {
        e.preventDefault();
        if (modalCtx.mode === "add") saveBarangAdd();
        else if (modalCtx.mode === "edit") saveBarangEdit();
    });

    $("modalBarang").addEventListener("hidden.bs.modal", () => {
        kodeReqId++;
        modalCtx = { mode: null, row: null };
        showMsg("mbMessage", "", "");
    });
}

// Isi dropdown kategori. Mode add = hanya kategori aktif.
// Mode lain = kategori aktif + kategori milik barang tsb (walau sudah nonaktif).
function populateKategoriSelect(selectedId) {
    const sel = $("fKategori");
    const list = kategoriList.filter(k => k.is_active || String(k.id) === String(selectedId));
    sel.innerHTML = `<option value="">Pilih Kategori</option>` +
        list.map(k => `<option value="${esc(k.id)}">${esc(k.kategori)}</option>`).join("");
    sel.value = selectedId ? String(selectedId) : "";
}

function getLevel() {
    return document.querySelector('input[name="fLevel"]:checked')?.value || "";
}

function setLevel(value) {
    document.querySelectorAll('input[name="fLevel"]').forEach(r => { r.checked = (r.value === value); });
}

function clearBarangForm() {
    $("formBarang").reset();
    toggleSatuanBaru(false);
    $("fKode").value = "";
    $("fFoto").value = "";
    $("fFotoPreview").innerHTML = "";
    $("fInternal").value = ""; $("fJual").value = ""; $("fAmortisasi").value = "";
    setLevel("");
    setKetersediaan(null);
}

function fillBarangForm(row) {
    clearBarangForm();
    populateKategoriSelect(row.kategori_barang_id);
    $("fKode").value = row.kode_barang || "";
    $("fNama").value = row.nama_barang || "";
    populateSatuanSelect(row.satuan);
    $("fDeskripsi").value = row.deskripsi || "";
    setLevel(row.level_approval || "");
    setKetersediaan(row);
    $("fEstimasi").value = row.estimasi_masa_pakai ?? "";
    renderFotoInto($("fFotoPreview"), row.photo_path);

    const p = row.price;
    $("fSupplier").value = p ? formatRupiah(p.harga_supplier) : "";
    $("fMargin").value = p?.persen_harga_jual ?? "";
    $("fInternal").value = p ? formatRupiah(p.harga_internal) : "";
    $("fJual").value = p ? formatRupiah(p.harga_jual) : "";
    $("fAmortisasi").value = p ? formatRupiah(p.harga_amortisasi) : "";
}

function setBarangMode(mode) {
    modalCtx.mode = mode;
    const add = mode === "add", edit = mode === "edit", view = mode === "view";
    const editable = add || edit;

    $("modalBarangTitle").textContent = add ? "Tambah Barang" : edit ? "Edit Barang" : "Detail Barang";

    ["fNama", "fDeskripsi", "fEstimasi"].forEach(id => { $(id).readOnly = !editable; });
    $("fSatuan").disabled = !editable;
    ["fSupplier", "fMargin"].forEach(id => { $(id).readOnly = !add; });
    $("fKategori").disabled = !add;
    document.querySelectorAll('input[name="fLevel"]').forEach(r => { r.disabled = !editable; });
    KETERSEDIAAN_FIELDS.forEach(f => {
        document.querySelectorAll(`input[name="${f.name}"]`).forEach(r => { r.disabled = !editable; });
    });

    // Input foto: tampil hanya saat add/edit. Wajib jika add, atau jika barang belum punya foto.
    $("fFoto").classList.toggle("d-none", !editable);
    $("fFoto").required = add || (edit && !modalCtx.row?.photo_path);
    $("fFotoStar").classList.toggle("d-none", !editable);

    // Tombol footer sesuai mode
    $("btnMbTutup").classList.toggle("d-none", editable);
    $("btnMbBatal").classList.toggle("d-none", !editable);
    $("btnMbSimpan").classList.toggle("d-none", !editable);
    $("btnMbEdit").classList.toggle("d-none", !view);
    $("btnMbHapus").classList.toggle("d-none", !view);
    $("btnMbUpdateHarga").classList.toggle("d-none", !view);
    showMsg("mbMessage", "", "");
}

function openAddModal() {
    modalCtx = { mode: "add", row: null };
    clearBarangForm();
    populateKategoriSelect(null);
    populateSatuanSelect(null);
    setKetersediaan({ is_makassar: true, is_surabaya: true, is_bekasi: true });   // default Tersedia
    setBarangMode("add");
    bootstrap.Modal.getOrCreateInstance($("modalBarang")).show();
}

function openViewModal(row) {
    modalCtx = { mode: "view", row };
    fillBarangForm(row);
    setBarangMode("view");
    bootstrap.Modal.getOrCreateInstance($("modalBarang")).show();
}

// ===================================================
// KELOMPOK 14: SIMPAN BARANG BARU
// Urutan: validasi -> upload foto -> simpan data_barang (kode dibuat ulang
// otomatis bila bentrok) -> simpan harga ke data_barang_reform.
// Jika simpan harga gagal, data_barang yang baru dibuat dibatalkan (rollback).
// ===================================================
function readBarangForm() {
    return {
        nama: $("fNama").value.trim(),
        satuan: resolveSatuan(),
        deskripsi: $("fDeskripsi").value.trim() || null,
        level: getLevel(),
        estimasi: parseInt($("fEstimasi").value, 10),
        kategoriId: $("fKategori").value,
        supplier: parseRupiah($("fSupplier").value),
        margin: parseFloat($("fMargin").value),
        avail: getKetersediaan()
    };
}

function validateBarangForm(v, isAdd) {
    if (!$("formBarang").reportValidity()) return false;
    if (!v.nama || !v.satuan) { showMsg("mbMessage", "Nama Barang dan Satuan tidak boleh kosong.", "danger"); return false; }
    if (isNaN(v.estimasi) || v.estimasi < 1) { showMsg("mbMessage", "Estimasi Masa Pakai minimal 1 bulan.", "danger"); return false; }
    if (Object.values(v.avail).some(x => x === null)) { showMsg("mbMessage", "Ketersediaan Makassar, Surabaya, dan Bekasi wajib dipilih.", "danger"); return false; }
    if (isAdd) {
        if (isNaN(v.supplier) || v.supplier <= 0) { showMsg("mbMessage", "Harga Supplier harus lebih dari 0.", "danger"); return false; }
        if (isNaN(v.margin) || v.margin < 0) { showMsg("mbMessage", "Margin Jual tidak boleh kosong atau negatif.", "danger"); return false; }
    }
    return true;
}

async function saveBarangAdd() {
    const v = readBarangForm();
    if (!validateBarangForm(v, true)) return;
    if (!/^[A-Za-z0-9]+\d{4}$/.test($("fKode").value)) {
        showMsg("mbMessage", "Kode barang belum terbentuk. Pilih kategori terlebih dulu.", "danger");
        return;
    }
    const username = requireUsername((t, ty) => showMsg("mbMessage", t, ty));
    if (!username) return;

    const btn = $("btnMbSimpan");
    setBusy(btn, true, "Menyimpan...");
    let barangId = null;
    let fotoUploaded = false;
    let kode = $("fKode").value;

    // Membatalkan barang yang sudah terlanjur tersimpan (dan fotonya) jika langkah berikutnya gagal
    async function batalkanBarang(pesan) {
        const { error: errDel } = await db().from("data_barang").delete().eq("id", barangId);
        if (fotoUploaded) await removeFotoByUrl(fotoUrlForKode(kode));
        if (errDel) throw new Error(`${pesan} dan barang ${kode} tidak bisa dibatalkan otomatis. Hubungi admin.`);
        throw new Error(`${pesan}, penambahan barang dibatalkan.`);
    }

    try {
        // 1. Kompres foto dulu (gagal cepat jika file bukan gambar)
        const fotoBlob = await compressImage($("fFoto").files[0]);

        // 2. Simpan data_barang (ulang sampai 3x jika kode bentrok).
        //    photo_path langsung diisi alamat foto yang akan diunggah (KODE.jpg).
        for (let attempt = 0; attempt < 3; attempt++) {
            const { data, error } = await db().from("data_barang").insert({
                created_at: new Date().toISOString(),
                created_by: username,
                kode_barang: kode,
                nama_barang: v.nama,
                satuan: v.satuan,
                deskripsi: v.deskripsi,
                level_approval: v.level,
                estimasi_masa_pakai: v.estimasi,
                photo_path: fotoUrlForKode(kode),
                kategori_barang_id: Number(v.kategoriId),
                ...v.avail,
                is_active: true
            }).select("id").single();

            if (!error) { barangId = data.id; break; }
            if (error.code === "23505" && attempt < 2) {   // kode kembar -> buat kode baru
                kode = await generateKode(v.kategoriId);
                $("fKode").value = kode;
                continue;
            }
            throw error;
        }

        // 3. Unggah foto dengan nama KODE.jpg. Kode ini sudah resmi milik barang baru
        //    (insert berhasil), jadi aman menimpa file sisa dengan nama yang sama.
        try {
            await uploadFotoBlob(fotoBlob, kode);
            fotoUploaded = true;
        } catch (errFoto) {
            await batalkanBarang(`Foto gagal diunggah (${errFoto.message})`);
        }

        // 4. Simpan harga
        const calc = computePrices(v.supplier, v.margin, v.estimasi);
        try {
            await insertHargaBaru(barangId, { supplier: v.supplier, margin: v.margin, ...calc }, username);
        } catch (errHarga) {
            await batalkanBarang(`Harga gagal disimpan (${errHarga.message})`);
        }

        bootstrap.Modal.getOrCreateInstance($("modalBarang")).hide();
        alert(`Barang berhasil ditambahkan dengan kode ${kode}.`);
        await afterDataChanged();
    } catch (err) {
        console.error("Gagal menambah barang:", err);
        showMsg("mbMessage", "Gagal menyimpan: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 15: SIMPAN EDIT BARANG
// Fungsi: memperbarui nama, satuan, deskripsi, level approval, estimasi,
// dan foto. Jika Estimasi Masa Pakai berubah, Harga Amortisasi ikut
// berubah, sehingga dicatat sebagai baris harga baru (riwayat tetap utuh).
// ===================================================
async function saveBarangEdit() {
    const row = modalCtx.row;
    if (!row) return;
    const v = readBarangForm();
    if (!validateBarangForm(v, false)) return;
    const username = requireUsername((t, ty) => showMsg("mbMessage", t, ty));
    if (!username) return;

    const newFile = $("fFoto").files[0] || null;
    // Perbandingan satuan tidak peduli huruf besar/kecil, supaya "pcs" lama tidak ditimpa diam-diam menjadi "Pcs"
    const satuanSame = v.satuan.trim().toLowerCase() === String(row.satuan || "").trim().toLowerCase();
    const changed =
        v.nama !== (row.nama_barang || "") ||
        !satuanSame ||
        KETERSEDIAAN_FIELDS.some(f => v.avail[f.column] !== (row[f.column] ?? null)) ||
        (v.deskripsi || "") !== (row.deskripsi || "") ||
        v.level !== (row.level_approval || "") ||
        v.estimasi !== row.estimasi_masa_pakai ||
        !!newFile;
    if (!changed) { setBarangMode("view"); return; }

    const btn = $("btnMbSimpan");
    setBusy(btn, true, "Menyimpan...");
    let newFotoUrl = null;

    try {
        const payload = {
            nama_barang: v.nama,
            satuan: satuanSame ? row.satuan : v.satuan,
            deskripsi: v.deskripsi,
            level_approval: v.level,
            estimasi_masa_pakai: v.estimasi,
            ...v.avail
        };
        if (newFile) {
            newFotoUrl = await uploadFoto(newFile, row.kode_barang);   // menimpa KODE.jpg lama bila ada
            payload.photo_path = newFotoUrl;
        }

        const { data, error } = await db().from("data_barang")
            .update(payload).eq("id", row.id).eq("is_active", true).select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
            if (newFotoUrl && !samaFoto(newFotoUrl, row.photo_path)) await removeFotoByUrl(newFotoUrl);
            showMsg("mbMessage", "Tidak ada data yang tersimpan. Kemungkinan barang sudah tidak aktif, atau akun ini tidak punya izin mengubah data.", "danger");
            return;
        }

        // Foto lama (dengan nama berbeda, mis. nama acak dari versi sebelumnya) dibersihkan setelah data baru tersimpan.
        // Jika namanya sama (KODE.jpg), file sudah tertimpa dan TIDAK boleh dihapus.
        if (newFotoUrl && row.photo_path && !samaFoto(newFotoUrl, row.photo_path)) await removeFotoByUrl(row.photo_path);

        // Estimasi berubah -> hitung ulang amortisasi, simpan sebagai harga baru
        let warn = "";
        if (v.estimasi !== row.estimasi_masa_pakai && row.price) {
            try {
                const supplier = Number(row.price.harga_supplier);
                const margin = Number(row.price.persen_harga_jual);
                const calc = computePrices(supplier, margin, v.estimasi);
                await insertHargaBaru(row.id, { supplier, margin, ...calc }, username);
            } catch (errHarga) {
                warn = " Namun Harga Amortisasi gagal diperbarui: " + errHarga.message;
            }
        }

        bootstrap.Modal.getOrCreateInstance($("modalBarang")).hide();
        if (warn) alert("Perubahan barang tersimpan." + warn);
        await afterDataChanged();
    } catch (err) {
        console.error("Gagal menyimpan perubahan:", err);
        if (newFotoUrl && !samaFoto(newFotoUrl, row.photo_path)) await removeFotoByUrl(newFotoUrl);
        showMsg("mbMessage", "Gagal menyimpan: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}

// Dipanggil setelah data berubah: muat ulang tabel dan opsi filter estimasi
async function afterDataChanged() {
    try { await loadEstimasiOptions(); renderFilterGroups(); } catch (e) { console.warn(e); }
    await loadBarangPage();
}

// ===================================================
// KELOMPOK 16: HAPUS BARANG
// Fungsi: bukan menghapus permanen, hanya menonaktifkan:
//  - data_barang: is_active=false, non_active_date=hari ini, non_active_by=username
//  - data_barang_reform: semua baris harga barang itu is_active=false
// ===================================================
async function handleHapus() {
    const row = modalCtx.row;
    if (!row) return;
    const username = requireUsername((t, ty) => showMsg("mbMessage", t, ty));
    if (!username) return;

    const ok = confirm(
        "Hapus barang ini?\n\n" +
        `Kode  : ${row.kode_barang}\n` +
        `Nama  : ${row.nama_barang || "-"}\n\n` +
        "Barang akan dinonaktifkan dan tidak muncul lagi di tabel."
    );
    if (!ok) return;

    const btn = $("btnMbHapus");
    setBusy(btn, true, "Menghapus...");
    try {
        const { data, error } = await db().from("data_barang")
            .update({ is_active: false, non_active_date: todayLocalIso(), non_active_by: username })
            .eq("id", row.id).eq("is_active", true).select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
            showMsg("mbMessage", "Tidak ada data yang berubah. Kemungkinan barang sudah nonaktif, atau akun ini tidak punya izin.", "danger");
            return;
        }

        const { error: errReform } = await db().from("data_barang_reform")
            .update({ is_active: false }).eq("data_barang_id", row.id);

        bootstrap.Modal.getOrCreateInstance($("modalBarang")).hide();
        if (errReform) alert("Barang dinonaktifkan, tetapi harga terkait gagal dinonaktifkan: " + errReform.message);

        if (state.data.length === 1 && state.page > 1) state.page--;
        await afterDataChanged();
    } catch (err) {
        console.error("Gagal menghapus:", err);
        showMsg("mbMessage", "Gagal menghapus: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 17: MODAL UPDATE HARGA
// Fungsi: mengisi harga baru untuk barang terpilih. Setiap simpan membuat
// baris riwayat baru di data_barang_reform, dan harga lama otomatis
// is_active = false. Rumus hitung sama dengan Tambah Barang.
// ===================================================
let recalcHarga = () => {};

function setupHargaModal() {
    recalcHarga = bindPriceCalc({
        supplier: $("hSupplier"), margin: $("hMargin"),
        internal: $("hInternal"), jual: $("hJual"), amort: $("hAmortisasi"),
        getEstimasi: () => hargaCtx.row?.estimasi_masa_pakai ?? 0
    });

    $("btnMhBatal").addEventListener("click", () => {
        bootstrap.Modal.getOrCreateInstance($("modalHarga")).hide();
    });
    $("formHarga").addEventListener("submit", (e) => { e.preventDefault(); saveHarga(); });
    $("modalHarga").addEventListener("hidden.bs.modal", () => {
        hargaCtx = { row: null };
        showMsg("mhMessage", "", "");
    });
}

function openHargaModal(row) {
    hargaCtx = { row };
    $("formHarga").reset();
    $("hKode").value = row.kode_barang || "";
    $("hNama").value = row.nama_barang || "";
    $("hSatuan").value = row.satuan || "";
    renderFotoInto($("hFotoWrapper"), row.photo_path);

    // Nilai awal = harga aktif saat ini (user tinggal mengubah yang perlu)
    const p = row.price;
    $("hSupplier").value = p ? formatRupiah(p.harga_supplier) : "";
    $("hMargin").value = p?.persen_harga_jual ?? "";
    recalcHarga();

    showMsg("mhMessage", "", "");
    bootstrap.Modal.getOrCreateInstance($("modalHarga")).show();
}

async function saveHarga() {
    const row = hargaCtx.row;
    if (!row) return;
    if (!$("formHarga").reportValidity()) return;

    const supplier = parseRupiah($("hSupplier").value);
    const margin = parseFloat($("hMargin").value);
    if (isNaN(supplier) || supplier <= 0) { showMsg("mhMessage", "Harga Supplier harus lebih dari 0.", "danger"); return; }
    if (isNaN(margin) || margin < 0) { showMsg("mhMessage", "Margin Jual tidak boleh kosong atau negatif.", "danger"); return; }

    const username = requireUsername((t, ty) => showMsg("mhMessage", t, ty));
    if (!username) return;

    const btn = $("btnMhSimpan");
    setBusy(btn, true, "Menyimpan...");
    try {
        const calc = computePrices(supplier, margin, row.estimasi_masa_pakai || 0);
        await insertHargaBaru(row.id, { supplier, margin, ...calc }, username);
        bootstrap.Modal.getOrCreateInstance($("modalHarga")).hide();
        await loadBarangPage();
    } catch (err) {
        console.error("Gagal update harga:", err);
        showMsg("mhMessage", "Gagal menyimpan harga: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 18: DROPDOWN SATUAN
// Fungsi: dropdown Satuan berisi daftar tetap (Pcs, Liter, Meter, ...),
// satuan lain yang sudah pernah dipakai barang, lalu "Tambah Satuan" di
// paling bawah. Jika "Tambah Satuan" dipilih, muncul kotak isian nama
// satuan baru. Satuan baru ikut tersimpan bersama barang, dan otomatis
// muncul di dropdown pada pemuatan berikutnya.
// ===================================================
function normalizeSatuan(text) {
    const s = String(text || "").trim().replace(/\s+/g, " ");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";   // huruf pertama kapital
}

function populateSatuanSelect(selected) {
    const sel = $("fSatuan");
    const list = [...SATUAN_DEFAULT, ...satuanExtra];
    let selValue = "";

    const wanted = String(selected || "").trim();
    if (wanted) {
        // Cocokkan tanpa peduli huruf besar/kecil; jika tidak ada, tambahkan apa adanya
        const hit = list.find(s => s.toLowerCase() === wanted.toLowerCase());
        if (hit) selValue = hit;
        else { list.push(wanted); selValue = wanted; }
    }

    sel.innerHTML = `<option value="">Pilih Satuan</option>` +
        list.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("") +
        `<option value="${SATUAN_NEW_VALUE}">Tambah Satuan</option>`;
    sel.value = selValue;
    toggleSatuanBaru(false);
}

function toggleSatuanBaru(show) {
    const input = $("fSatuanBaru");
    input.classList.toggle("d-none", !show);
    input.required = show;
    if (!show) input.value = "";
}

// Mengembalikan satuan final: dari dropdown, atau dari kotak "satuan baru"
// (jika ternyata sudah ada di daftar, memakai tulisan yang sudah ada).
function resolveSatuan() {
    const sel = $("fSatuan");
    if (sel.value !== SATUAN_NEW_VALUE) return sel.value;

    const typed = normalizeSatuan($("fSatuanBaru").value);
    if (!typed) return "";
    const existing = Array.from(sel.options)
        .map(o => o.value)
        .find(v => v && v !== SATUAN_NEW_VALUE && v.toLowerCase() === typed.toLowerCase());
    return existing || typed;
}

// ===================================================
// KELOMPOK 19: ATUR KATEGORI
// Fungsi: modal daftar kategori + sub modal.
//  - "Tambah Kategori": isi Kode + Kategori (is_active otomatis true)
//  - Klik baris: ubah status Aktif / Non-Aktif (Kode & Kategori terkunci,
//    karena kode kategori sudah dipakai sebagai awalan kode barang)
// Kategori Non-Aktif tidak muncul di dropdown Tambah Barang, tetapi barang
// lama yang memakainya tetap tampil.
// ===================================================
function setupKategoriModal() {
    $("btnAturKategori").addEventListener("click", openKategoriModal);

    $("btnTambahKategori").addEventListener("click", () => {
        swapModal("modalKategori", "modalKategoriForm", () => prepareKategoriForm("add", null));
    });

    $("kategoriTableBody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        const row = kategoriList.find(k => String(k.id) === tr.dataset.id);
        if (row) swapModal("modalKategori", "modalKategoriForm", () => prepareKategoriForm("edit", row));
    });

    $("btnKfBatal").addEventListener("click", () => {
        bootstrap.Modal.getOrCreateInstance($("modalKategoriForm")).hide();
    });
    $("formKategori").addEventListener("submit", (e) => { e.preventDefault(); saveKategori(); });

    // Setiap kali sub modal tertutup (Batal, tombol X, atau setelah simpan), kembali ke daftar
    $("modalKategoriForm").addEventListener("hidden.bs.modal", () => {
        kategoriFormCtx = { mode: null, row: null };
        renderKategoriTable();
        bootstrap.Modal.getOrCreateInstance($("modalKategori")).show();
    });
}

// Menutup modal "from", lalu setelah benar-benar tertutup membuka modal "to"
function swapModal(fromId, toId, beforeShow) {
    const from = $(fromId);
    from.addEventListener("hidden.bs.modal", () => {
        if (beforeShow) beforeShow();
        bootstrap.Modal.getOrCreateInstance($(toId)).show();
    }, { once: true });
    bootstrap.Modal.getOrCreateInstance(from).hide();
}

async function openKategoriModal() {
    showMsg("mkMessage", "", "");
    try { await loadKategori(); } catch (err) { showMsg("mkMessage", "Gagal memuat kategori: " + err.message, "danger"); }
    renderKategoriTable();
    bootstrap.Modal.getOrCreateInstance($("modalKategori")).show();
}

function renderKategoriTable() {
    const tbody = $("kategoriTableBody");
    if (kategoriList.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="3">Belum ada kategori.</td></tr>`;
        return;
    }
    const rows = [...kategoriList].sort((a, b) => String(a.kode || "").localeCompare(String(b.kode || ""), "id"));
    tbody.innerHTML = rows.map(k => `
        <tr class="row-clickable" data-id="${esc(k.id)}">
            <td>${esc(k.kode)}</td>
            <td>${esc(k.kategori)}</td>
            <td><span class="badge ${k.is_active ? "text-bg-success" : "text-bg-secondary"}">${k.is_active ? "Aktif" : "Non-Aktif"}</span></td>
        </tr>`).join("");
}

function prepareKategoriForm(mode, row) {
    kategoriFormCtx = { mode, row };
    const add = mode === "add";
    $("formKategori").reset();
    showMsg("mkfMessage", "", "");

    $("modalKategoriFormTitle").textContent = add ? "Tambah Kategori" : "Ubah Status Kategori";
    $("kfKode").value = row?.kode || "";
    $("kfKategori").value = row?.kategori || "";
    $("kfKode").readOnly = !add;
    $("kfKategori").readOnly = !add;
    $("kfKodeStar").classList.toggle("d-none", !add);
    $("kfKategoriStar").classList.toggle("d-none", !add);

    $("kfStatusGroup").classList.toggle("d-none", add);
    document.querySelectorAll('input[name="kfStatus"]').forEach(r => {
        r.required = !add;
        r.checked = !add && r.value === String(!!row.is_active);
    });
}

async function saveKategori() {
    const { mode, row } = kategoriFormCtx;
    if (!mode) return;
    if (!$("formKategori").reportValidity()) return;

    const btn = $("btnKfSimpan");
    setBusy(btn, true, "Menyimpan...");
    try {
        if (mode === "add") await saveKategoriBaru();
        else await saveStatusKategori(row);
    } catch (err) {
        console.error("Gagal menyimpan kategori:", err);
        showMsg("mkfMessage", "Gagal menyimpan: " + err.message, "danger");
    } finally {
        setBusy(btn, false);
    }
}

async function saveKategoriBaru() {
    const kode = $("kfKode").value.trim().toUpperCase();
    const kategori = $("kfKategori").value.trim().replace(/\s+/g, " ");

    if (!/^[A-Z0-9]{1,10}$/.test(kode)) {
        showMsg("mkfMessage", "Kode hanya boleh huruf dan angka (tanpa spasi atau simbol), maksimal 10 karakter.", "danger");
        return;
    }
    if (!kategori) { showMsg("mkfMessage", "Kategori tidak boleh kosong.", "danger"); return; }

    const sameKode = kategoriList.find(k => String(k.kode || "").trim().toUpperCase() === kode);
    if (sameKode) { showMsg("mkfMessage", `Kode ${kode} sudah dipakai kategori "${sameKode.kategori}".`, "danger"); return; }
    const sameName = kategoriList.find(k => String(k.kategori || "").trim().toLowerCase() === kategori.toLowerCase());
    if (sameName) { showMsg("mkfMessage", `Kategori "${sameName.kategori}" sudah ada (kode ${sameName.kode}).`, "danger"); return; }

    const { error } = await db().from("kategori_barang").insert({
        created_at: new Date().toISOString(),
        kode,
        kategori,
        is_active: true
    });
    if (error) {
        if (error.code === "23505") throw new Error(`Kode ${kode} sudah dipakai kategori lain.`);
        throw error;
    }
    await afterKategoriChanged();
}

async function saveStatusKategori(row) {
    const checked = document.querySelector('input[name="kfStatus"]:checked');
    if (!checked) { showMsg("mkfMessage", "Pilih status terlebih dulu.", "danger"); return; }
    const newActive = checked.value === "true";

    if (newActive === !!row.is_active) {          // tidak ada perubahan
        bootstrap.Modal.getOrCreateInstance($("modalKategoriForm")).hide();
        return;
    }

    // Menonaktifkan kategori yang masih dipakai barang aktif: minta konfirmasi
    if (!newActive) {
        const { count, error: errCount } = await db().from("data_barang")
            .select("id", { count: "exact", head: true })
            .eq("kategori_barang_id", row.id).eq("is_active", true);
        if (errCount) throw errCount;
        if (count > 0) {
            const ok = confirm(
                `Kategori "${row.kategori}" masih dipakai ${count} barang aktif.\n\n` +
                "Barang tersebut tetap tampil, tetapi kategori ini tidak bisa dipilih lagi untuk barang baru.\n\nLanjutkan?"
            );
            if (!ok) return;
        }
    }

    const { data, error } = await db().from("kategori_barang")
        .update({ is_active: newActive }).eq("id", row.id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
        showMsg("mkfMessage", "Tidak ada data yang berubah. Kemungkinan akun ini tidak punya izin mengubah kategori.", "danger");
        return;
    }
    await afterKategoriChanged();
}

// Muat ulang kategori, segarkan checklist filter, lalu tutup sub modal (kembali ke daftar)
async function afterKategoriChanged() {
    await loadKategori();
    renderFilterGroups();
    bootstrap.Modal.getOrCreateInstance($("modalKategoriForm")).hide();
}

// ===================================================
// KELOMPOK 20: KETERSEDIAAN (Makassar / Surabaya / Bekasi)
// Fungsi: tiga pilihan radio "Tersedia" (true) / "Tidak Tersedia" (false)
// yang disimpan ke kolom is_makassar, is_surabaya, is_bekasi di ga.data_barang.
// Default saat Tambah Barang = Tersedia semua. Jika data lama nilainya kosong
// (NULL), pilihan dibiarkan kosong dan wajib dipilih saat Edit.
// ===================================================
const KETERSEDIAAN_FIELDS = [
    { name: "fMakassar", column: "is_makassar" },
    { name: "fSurabaya", column: "is_surabaya" },
    { name: "fBekasi", column: "is_bekasi" }
];

// values = objek berisi is_makassar/is_surabaya/is_bekasi (true/false/null), atau null = kosongkan semua
function setKetersediaan(values) {
    KETERSEDIAAN_FIELDS.forEach(f => {
        const v = values ? values[f.column] : null;
        document.querySelectorAll(`input[name="${f.name}"]`).forEach(r => {
            r.checked = (v === true || v === false) && r.value === String(v);
        });
    });
}

// Mengembalikan { is_makassar: true/false/null, ... } sesuai pilihan di form
function getKetersediaan() {
    const out = {};
    KETERSEDIAAN_FIELDS.forEach(f => {
        const checked = document.querySelector(`input[name="${f.name}"]:checked`);
        out[f.column] = checked ? checked.value === "true" : null;
    });
    return out;
}