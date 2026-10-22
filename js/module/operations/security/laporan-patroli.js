// ===================================================
// laporan_patroli.js
// Halaman "Laporan Patroli" (sumber data: security.laporan_patroli)
// Fitur: tab cabang (Makassar / Surabaya), filter (area, titik patroli,
//        rentang tanggal), download Excel (mengikuti filter), tabel dengan
//        pagination 100 baris, data terbaru di paling atas, klik baris untuk
//        melihat lokasi scan petugas di peta.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const SCHEMA_SECURITY = "security";          // schema tabel patroli
const SCHEMA_HRD = "hrd";                    // schema tabel karyawan
const TABLE_LAPORAN = "laporan_patroli";     // log hasil scan
const TABLE_TITIK = "titik_patroli";         // master titik patroli
const TABLE_AREA = "areas";                  // schema public: nama area (kolom area_name)
const TABLE_EMPLOYEES = "employees";         // hrd.employees: nik_karyawan -> nama

const ROWS_PER_PAGE = 100;                   // baris per halaman di layar
const FETCH_CHUNK = 1000;                    // ukuran ambil data bertahap (batas Supabase = 1000)
const NIK_CHUNK = 100;                       // jumlah NIK per sekali cari nama petugas

// Cabang: branch_id -> nama tab
const BRANCHES = { 2: "Makassar", 1: "Surabaya" };
const DEFAULT_BRANCH = 2;

// Zona waktu TETAP per cabang. Jam patroli selalu tampil sesuai cabang datanya,
// siapa pun dan di mana pun laporan dibuka. Indonesia tidak memakai DST,
// jadi offset di bawah ini selalu tetap.
const BRANCH_TZ = {
    1: { zone: "Asia/Jakarta",   label: "WIB",  offset: "+07:00" },
    2: { zone: "Asia/Makassar",  label: "WITA", offset: "+08:00" }
};

// Peta lokasi scan (Leaflet + OpenStreetMap). Ganti MAP_TILE_URL jika ingin
// memakai penyedia peta lain. Pemakaian tile OpenStreetMap gratis cocok untuk
// pemakaian internal yang ringan.
const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAP_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const MAP_ZOOM = 18;                         // tingkat zoom saat peta dibuka (makin besar makin dekat)

// Halaman pengaturan titik (satu folder dengan halaman ini).
// Cabang yang sedang dibuka ikut dikirim sebagai ?branch_id=
const TITIK_PAGE = "titik-patroli.html";

// Sesi login & hak akses cabang (sama seperti catalog.js)
const SESSION_KEY = "erp_session";
const ROLE_IDS_ALL_BRANCH = [1, 2];             // 1 = Maintenance, 2 = Superadmin
// PERLU DICEK: nama field di erp_session yang berisi branch_id user.
// Samakan dengan nilai yang sudah berjalan di catalog.js Anda.
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan kondisi halaman saat ini.
// ===================================================
const state = {
    branchId: DEFAULT_BRANCH,
    canSwitch: false,
    page: 1,
    totalRows: 0,
    filters: { areaId: "", titikId: "", from: "", to: "" },
    titikList: [],            // titik patroli milik cabang ini (untuk dropdown & nama titik)
    titikMap: new Map(),      // id titik -> baris titik
    areaMap: new Map(),       // area_id -> area_name
    nameCache: new Map(),     // nik_karyawan -> nama (disimpan supaya tidak cari ulang)
    pageRows: new Map(),      // baris halaman aktif (id -> data mentah), dipakai saat baris diklik
    reqId: 0                  // penanda permintaan terbaru, supaya hasil lama tidak menimpa hasil baru
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

function branchName() {
    return BRANCHES[state.branchId] || `Cabang ${state.branchId}`;
}

function branchTz() {
    return BRANCH_TZ[state.branchId] || BRANCH_TZ[DEFAULT_BRANCH];
}

// Memecah waktu UTC dari database menjadi tanggal dan jam di zona waktu cabang.
// Hasil: { tanggal: "21-10-2026", waktu: "15:00:05" }
function splitDateTime(iso) {
    if (!iso) return { tanggal: "", waktu: "" };
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: branchTz().zone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date(iso));
    const p = {};
    parts.forEach(x => { p[x.type] = x.value; });
    return { tanggal: `${p.day}-${p.month}-${p.year}`, waktu: `${p.hour}:${p.minute}:${p.second}` };
}

// Batas awal / akhir hari menurut zona waktu cabang, dalam bentuk UTC (untuk filter tanggal)
function startOfDayIso(dateStr) {
    return new Date(`${dateStr}T00:00:00.000${branchTz().offset}`).toISOString();
}
function endOfDayIso(dateStr) {
    return new Date(`${dateStr}T23:59:59.999${branchTz().offset}`).toISOString();
}

function todayInBranch() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: branchTz().zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return parts; // format YYYY-MM-DD
}

function areaName(id) {
    if (id === null || id === undefined || id === "") return "";
    return state.areaMap.get(String(id)) || `Area ${id}`;
}

// Membaca kolom titik_map berformat "latitude,longitude" (contoh: -5.147665,119.432732).
// Hasil: { lat, lng }, atau null jika kosong / bukan koordinat yang valid.
function parseLatLng(text) {
    if (!text) return null;
    const m = String(text).trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

// Mengambil SEMUA baris dari satu query dengan cara bertahap per 1000 baris,
// supaya tidak terkena batas 1000 baris dari Supabase.
// buildQuery(from, to) harus mengembalikan query yang sudah memakai .range(from, to).
async function fetchAll(buildQuery) {
    const out = [];
    for (let from = 0; ; from += FETCH_CHUNK) {
        const { data, error } = await buildQuery(from, from + FETCH_CHUNK - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < FETCH_CHUNK) break;
    }
    return out;
}

// ===================================================
// KELOMPOK 3B: SESI LOGIN & HAK PINDAH CABANG
// Fungsi: membaca sesi login (erp_session). Maintenance & Superadmin melihat
// tab cabang; user lain hanya melihat cabang di sesinya.
// CATATAN KEAMANAN: ini hanya mengatur tampilan di browser. Pembatasan data
// yang sebenarnya harus dipasang di database (RLS).
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

// Menghentikan halaman dengan pesan jelas
function blockPage(message) {
    $("branchTitle").textContent = "-";
    $("patroliTableBody").innerHTML = `<tr class="row-empty"><td colspan="6">${esc(message)}</td></tr>`;
    // Hanya tombol yang ada di halaman (btnAturTitik sudah dihapus dari HTML)
    ["btnFilter", "btnDownload"].forEach(id => { const el = $(id); if (el) el.disabled = true; });
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

    // Diagnostik: tab cabang hanya muncul jika roleId sesi ada di ROLE_IDS_ALL_BRANCH.
    // Lihat nilai ini di Console (F12) jika tab tidak muncul.
    console.info("[Laporan Patroli] roleId sesi:", session ? session.roleId : null,
        "| boleh pindah cabang:", state.canSwitch, "| cabang di sesi:", sessionBranch);

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
    setupFilter();
    setupDownload();
    setupMapModal();
    updateTabUi();
    loadBranch();
});

// ===================================================
// KELOMPOK 5: TAB CABANG
// Fungsi: pindah antar Makassar / Surabaya. Mengganti judul, mereset filter,
// memuat ulang data cabang yang dipilih, dan mencatat pilihan di alamat halaman.
// ===================================================
function setupTabs() {
    document.querySelectorAll(".lp-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.branch, 10);
            if (!state.canSwitch || id === state.branchId) return;
            state.branchId = id;
            state.page = 1;
            state.filters = { areaId: "", titikId: "", from: "", to: "" };
            updateTabUi();
            closeFilterPanel();

            const url = new URL(window.location.href);
            url.searchParams.set("branch_id", String(id));
            window.history.replaceState(null, "", url);

            loadBranch();
        });
    });
}

function updateTabUi() {
    document.querySelectorAll(".lp-tab").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.branch, 10) === state.branchId);
    });
    $("branchTitle").textContent = branchName();
    $("thWaktu").textContent = `Waktu Patroli (${branchTz().label})`;
    updateFilterBadge();
}

// ===================================================
// KELOMPOK 6: MEMUAT DATA PENDUKUNG (TITIK & AREA)
// Fungsi: mengambil daftar titik patroli cabang ini dan nama area, dipakai
// untuk isi dropdown filter dan untuk menampilkan nama titik/area di tabel.
// Setelah selesai, laporan halaman pertama dimuat.
// ===================================================
async function loadBranch() {
    const myReq = ++state.reqId;
    $("patroliTableBody").innerHTML = `<tr class="row-loading"><td colspan="6"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    $("patroliPagination").innerHTML = "";

    try {
        const [titik, areas] = await Promise.all([
            fetchAll((from, to) => supabaseClient
                .schema(SCHEMA_SECURITY).from(TABLE_TITIK)
                .select("id, area_id, titik_patroli, kode_titik")
                .eq("branch_id", state.branchId)
                .order("titik_patroli", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to)),
            // select("*") dipakai karena nama kolom id di tabel areas belum saya ketahui;
            // kunci area diambil dari kolom "id" atau "area_id", mana yang ada.
            fetchAll((from, to) => supabaseClient
                .from(TABLE_AREA).select("*").range(from, to))
        ]);
        if (myReq !== state.reqId) return;

        state.titikList = titik;
        state.titikMap = new Map(titik.map(t => [String(t.id), t]));
        state.areaMap = new Map(areas.map(a => [String(a.id ?? a.area_id), a.area_name]));

        fillAreaOptions();
        fillTitikOptions("");
        syncPanelFromState();
        await loadReport();
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat data pendukung:", err);
        $("patroliTableBody").innerHTML = `<tr class="row-empty"><td colspan="6">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

// ===================================================
// KELOMPOK 7: FILTER
// Fungsi: panel filter (Area, Titik Patroli, Tanggal dari-sampai).
// Dropdown Titik Patroli ikut menyempit sesuai Area yang dipilih.
// Filter baru berlaku setelah tombol "Terapkan" ditekan.
// ===================================================
function setupFilter() {
    $("btnFilter").addEventListener("click", (e) => {
        e.stopPropagation();
        $("filterPanel").hidden = !$("filterPanel").hidden;
    });
    // klik di luar panel menutup panel
    document.addEventListener("click", (e) => {
        if (!$("filterPanel").hidden && !e.target.closest(".lp-filter-wrap")) closeFilterPanel();
    });
    $("fArea").addEventListener("change", () => fillTitikOptions($("fArea").value));
    $("btnFilterApply").addEventListener("click", applyFilter);
    $("btnFilterReset").addEventListener("click", resetFilter);
}

function closeFilterPanel() { $("filterPanel").hidden = true; }

function fillAreaOptions() {
    const ids = [...new Set(state.titikList.map(t => t.area_id).filter(v => v !== null && v !== undefined))];
    ids.sort((a, b) => areaName(a).localeCompare(areaName(b), "id"));
    $("fArea").innerHTML = `<option value="">Semua Area</option>` +
        ids.map(id => `<option value="${esc(id)}">${esc(areaName(id))}</option>`).join("");
}

function fillTitikOptions(areaId) {
    const list = state.titikList.filter(t => !areaId || String(t.area_id) === String(areaId));
    $("fTitik").innerHTML = `<option value="">Semua Titik</option>` +
        list.map(t => `<option value="${esc(t.id)}">${esc(t.titik_patroli || t.kode_titik)}</option>`).join("");
}

// Mengisi ulang isi panel sesuai filter yang sedang aktif
function syncPanelFromState() {
    const f = state.filters;
    $("fArea").value = f.areaId;
    fillTitikOptions(f.areaId);
    $("fTitik").value = f.titikId;
    $("fFrom").value = f.from;
    $("fTo").value = f.to;
}

function applyFilter() {
    const from = $("fFrom").value;
    const to = $("fTo").value;
    if (from && to && from > to) {
        alert("Tanggal \"sampai\" tidak boleh lebih awal dari tanggal \"dari\".");
        return;
    }
    state.filters = { areaId: $("fArea").value, titikId: $("fTitik").value, from, to };
    state.page = 1;
    closeFilterPanel();
    updateFilterBadge();
    loadReport();
}

function resetFilter() {
    state.filters = { areaId: "", titikId: "", from: "", to: "" };
    state.page = 1;
    syncPanelFromState();
    closeFilterPanel();
    updateFilterBadge();
    loadReport();
}

function activeFilterCount() {
    const f = state.filters;
    return (f.areaId ? 1 : 0) + (f.titikId ? 1 : 0) + ((f.from || f.to) ? 1 : 0);
}

function updateFilterBadge() {
    const n = activeFilterCount();
    $("filterBadge").textContent = n;
    $("filterBadge").hidden = n === 0;
}

// Menempelkan semua syarat (cabang + filter aktif) ke sebuah query laporan.
// Dipakai bersama oleh tabel di layar DAN download, jadi hasilnya selalu sama.
function applyFilters(query) {
    const f = state.filters;
    let q = query.eq("branch_id", state.branchId);
    if (f.areaId) q = q.eq("area_id", f.areaId);
    if (f.titikId) q = q.eq("titik_patroli_id", f.titikId);
    if (f.from) q = q.gte("created_at", startOfDayIso(f.from));
    if (f.to) q = q.lte("created_at", endOfDayIso(f.to));
    return q;
}

// ===================================================
// KELOMPOK 8: MEMUAT LAPORAN (PER HALAMAN)
// Fungsi: mengambil 100 baris sesuai halaman aktif dari database (bukan semua
// data sekaligus), urut terbaru di atas. count "exact" dipakai untuk
// mengetahui total baris agar jumlah halaman benar.
// ===================================================
const LAPORAN_COLUMNS = "id, created_at, branch_id, area_id, titik_patroli_id, titik_map, petugas";

async function loadReport() {
    const myReq = ++state.reqId;
    const from = (state.page - 1) * ROWS_PER_PAGE;

    $("patroliTableBody").innerHTML = `<tr class="row-loading"><td colspan="6"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        const { data, error, count } = await applyFilters(
            supabaseClient.schema(SCHEMA_SECURITY).from(TABLE_LAPORAN).select(LAPORAN_COLUMNS, { count: "exact" })
        )
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + ROWS_PER_PAGE - 1);
        if (error) throw error;

        await resolveNames((data || []).map(r => r.petugas));
        if (myReq !== state.reqId) return;       // user sudah pindah tab / ganti filter

        state.totalRows = count || 0;

        // jika halaman melewati total (misal data berkurang), kembali ke halaman terakhir
        const totalPages = Math.max(1, Math.ceil(state.totalRows / ROWS_PER_PAGE));
        if (state.page > totalPages) {
            state.page = totalPages;
            return loadReport();
        }
        renderTable(data || [], from);
        renderPagination(totalPages);
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat laporan patroli:", err);
        $("patroliTableBody").innerHTML = `<tr class="row-empty"><td colspan="6">Gagal memuat data: ${esc(err.message)}</td></tr>`;
        $("patroliPagination").innerHTML = "";
    }
}

// Mencari nama petugas dari hrd.employees berdasarkan nik_karyawan.
// Hanya NIK yang belum pernah dicari yang diambil dari database.
async function resolveNames(niks) {
    const need = [...new Set(niks.filter(n => n && !state.nameCache.has(String(n))).map(String))];
    for (let i = 0; i < need.length; i += NIK_CHUNK) {
        const chunk = need.slice(i, i + NIK_CHUNK);
        const { data, error } = await supabaseClient
            .schema(SCHEMA_HRD).from(TABLE_EMPLOYEES)
            .select("nik_karyawan, nama")
            .in("nik_karyawan", chunk);
        if (error) throw error;
        (data || []).forEach(e => state.nameCache.set(String(e.nik_karyawan), e.nama));
        // NIK yang tidak ditemukan ditandai null agar tidak dicari berulang
        chunk.forEach(n => { if (!state.nameCache.has(n)) state.nameCache.set(n, null); });
    }
}

// Mengubah satu baris database menjadi baris siap tampil
function toDisplayRow(r) {
    const dt = splitDateTime(r.created_at);
    const titik = state.titikMap.get(String(r.titik_patroli_id));
    const nik = r.petugas ? String(r.petugas) : "";
    return {
        tanggal: dt.tanggal,
        waktu: dt.waktu,
        area: areaName(r.area_id),
        // titik_map sekarang berisi koordinat lokasi scan, bukan nama titik. Hanya dipakai
        // sebagai nama cadangan untuk data lama jika isinya bukan koordinat.
        titik: (titik && (titik.titik_patroli || titik.kode_titik)) || (parseLatLng(r.titik_map) ? "" : (r.titik_map || "")),
        petugas: state.nameCache.get(nik) || nik   // jika nama tidak ditemukan, tampilkan NIK
    };
}

// ===================================================
// KELOMPOK 9: TAMPILAN TABEL + PAGINATION
// Fungsi: menampilkan baris halaman aktif dengan nomor urut yang berlanjut
// antar halaman, dan tombol halaman di bawah tabel.
// ===================================================
function renderTable(rows, offset) {
    const tbody = $("patroliTableBody");
    state.pageRows = new Map(rows.map(r => [String(r.id), r]));
    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="6">${activeFilterCount() ? "Tidak ada data yang cocok dengan filter." : "Belum ada data patroli untuk cabang ini."}</td></tr>`;
        return;
    }
    const dash = `<span class="data-empty-cell">-</span>`;
    tbody.innerHTML = rows.map((r, i) => {
        const d = toDisplayRow(r);
        const hasLoc = !!parseLatLng(r.titik_map);
        const pin = `<i class="fa-solid fa-location-dot lp-pin${hasLoc ? "" : " off"}" title="${hasLoc ? "Klik baris untuk melihat lokasi scan" : "Lokasi scan tidak tercatat"}"></i>`;
        return `
            <tr class="lp-row-click" data-id="${esc(r.id)}">
                <td class="col-no">${offset + i + 1}</td>
                <td>${esc(d.tanggal)}</td>
                <td>${esc(d.waktu)}</td>
                <td>${d.area ? esc(d.area) : dash}</td>
                <td>${d.titik ? esc(d.titik) : dash}${pin}</td>
                <td>${d.petugas ? esc(d.petugas) : dash}</td>
            </tr>`;
    }).join("");
}

function renderPagination(totalPages) {
    const container = $("patroliPagination");
    const totalRows = state.totalRows;
    if (totalPages <= 1) {
        container.innerHTML = totalRows > 0 ? `<span class="lp-page-info">${totalRows} data</span>` : "";
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
    html += `<span class="lp-page-info">${totalRows} data</span>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => { state.page = parseInt(btn.dataset.page, 10); loadReport(); });
    });
    container.querySelector('[data-nav="prev"]').onclick = () => { if (state.page > 1) { state.page--; loadReport(); } };
    container.querySelector('[data-nav="next"]').onclick = () => { if (state.page < totalPages) { state.page++; loadReport(); } };
}

// ===================================================
// KELOMPOK 10: DOWNLOAD EXCEL
// Fungsi: mengunduh SEMUA data cabang yang sedang dibuka (bukan hanya halaman
// ini). Jika filter aktif, hanya data hasil filter yang diunduh.
// Data diambil bertahap per 1000 baris sampai habis.
// Kolom: Tanggal, Waktu Patroli, Area, Titik Patroli, Petugas Patroli.
// ===================================================
function setupDownload() {
    $("btnDownload").addEventListener("click", handleDownload);
}

async function handleDownload() {
    const btn = $("btnDownload");
    const label = btn.querySelector("span");
    const oldText = label.textContent;
    const myBranch = state.branchId;
    btn.disabled = true;
    label.textContent = "Menyiapkan...";

    try {
        const rows = await fetchAll((from, to) => applyFilters(
            supabaseClient.schema(SCHEMA_SECURITY).from(TABLE_LAPORAN).select(LAPORAN_COLUMNS)
        )
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to));

        if (rows.length === 0) {
            alert("Tidak ada data untuk diunduh.");
            return;
        }
        await resolveNames(rows.map(r => r.petugas));
        if (myBranch !== state.branchId) return;   // user pindah tab saat menunggu

        const aoa = [["Tanggal", "Waktu Patroli", "Area", "Titik Patroli", "Petugas Patroli"]];
        rows.forEach(r => {
            const d = toDisplayRow(r);
            aoa.push([d.tanggal, d.waktu, d.area, d.titik, d.petugas]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 30 }, { wch: 28 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Patroli ${branchName()}`);
        XLSX.writeFile(wb, `Laporan_Patroli_${branchName()}_${todayInBranch()}.xlsx`);
    } catch (err) {
        console.error("Gagal download laporan patroli:", err);
        alert(`Gagal mengunduh data: ${err.message}`);
    } finally {
        btn.disabled = false;
        label.textContent = oldText;
    }
}

// ===================================================
// KELOMPOK 11: PETA LOKASI SCAN (MODAL)
// Fungsi: klik sebuah baris pada tabel membuka modal berisi peta yang
// menandai titik lokasi petugas saat scan (kolom titik_map, format
// "latitude,longitude"), plus info titik, area, petugas, dan waktu scan
// (zona waktu cabang). Tombol "Buka di Google Maps" membuka lokasi yang sama.
// Jika lokasi tidak tercatat (data lama atau GPS tidak terbaca saat scan),
// modal menampilkan keterangan, bukan peta.
// Peta dibuat sekali lalu dipakai ulang di setiap pembukaan.
// ===================================================
let leafletMap = null;
let leafletMarker = null;

function setupMapModal() {
    // Satu pendengar klik untuk semua baris tabel
    $("patroliTableBody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr.lp-row-click");
        if (!tr) return;
        if (window.getSelection && String(window.getSelection()).trim()) return;   // sedang memilih/menyalin teks
        const row = state.pageRows.get(tr.dataset.id);
        if (row) openMapModal(row);
    });
    $("btnMapClose").addEventListener("click", closeMapModal);
    $("btnMapCloseFoot").addEventListener("click", closeMapModal);
    $("mapOverlay").addEventListener("click", (e) => { if (e.target === $("mapOverlay")) closeMapModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMapModal(); });
}

function closeMapModal() { $("mapOverlay").hidden = true; }

function openMapModal(row) {
    const d = toDisplayRow(row);
    const dt = splitDateTime(row.created_at);
    const loc = parseLatLng(row.titik_map);

    $("mapInfoTitik").textContent = d.titik || "-";
    $("mapInfoArea").textContent = d.area || "-";
    $("mapInfoPetugas").textContent = d.petugas || "-";
    $("mapInfoWaktu").textContent = `${dt.tanggal} ${dt.waktu} ${branchTz().label}`;

    const mapBox = $("lpMap");
    const empty = $("mapEmpty");
    const google = $("btnMapGoogle");

    if (!loc) {
        $("mapInfoKoordinat").textContent = "-";
        mapBox.hidden = true;
        google.hidden = true;
        $("mapNote").hidden = true;
        empty.hidden = false;
        empty.textContent = "Lokasi scan tidak tercatat pada data ini. Kemungkinan data dibuat sebelum fitur lokasi ada, atau GPS HP tidak terbaca saat scan.";
        $("mapOverlay").hidden = false;
        return;
    }

    $("mapInfoKoordinat").textContent = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
    google.href = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    google.hidden = false;
    $("mapNote").hidden = false;
    $("mapOverlay").hidden = false;               // modal harus tampil dulu agar peta punya ukuran

    if (typeof L === "undefined") {
        mapBox.hidden = true;
        empty.hidden = false;
        empty.textContent = "Library peta gagal dimuat (periksa koneksi internet). Lokasi tetap bisa dibuka lewat tombol Google Maps.";
        return;
    }
    empty.hidden = true;
    mapBox.hidden = false;
    showOnMap(loc.lat, loc.lng);
}

function showOnMap(lat, lng) {
    if (!leafletMap) {
        leafletMap = L.map("lpMap");
        L.tileLayer(MAP_TILE_URL, { maxZoom: 19, attribution: MAP_ATTRIBUTION }).addTo(leafletMap);
    }
    // Penanda berbentuk pin memakai ikon Font Awesome (tidak butuh file gambar tambahan)
    const icon = L.divIcon({
        className: "lp-map-pin",
        html: '<i class="fa-solid fa-location-dot"></i>',
        iconSize: [34, 40],
        iconAnchor: [17, 38]
    });
    if (!leafletMarker) leafletMarker = L.marker([lat, lng], { icon }).addTo(leafletMap);
    else leafletMarker.setLatLng([lat, lng]);

    leafletMap.invalidateSize();                  // ukuran peta dihitung ulang karena modal baru saja tampil
    leafletMap.setView([lat, lng], MAP_ZOOM);
}