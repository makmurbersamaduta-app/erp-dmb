// ===================================================
// titik-patroli.js
// Halaman "Titik Patroli" (tabel: security.titik_patroli)
// Fitur: tab cabang, pencarian (nama titik & area), tambah titik, edit
//        (kode & nama saja), hapus (soft delete: is_active = false),
//        unduh label QR Code dalam PDF (A4).
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const SCHEMA_SECURITY = "security";
const SCHEMA_HRD = "hrd";
const TABLE_TITIK = "titik_patroli";
const TABLE_AREA = "areas";             // schema public: kolom id, area_name
const TABLE_BRANCH = "branches";        // schema public: kolom id, branch_name
const TABLE_EMPLOYEES = "employees";    // hrd.employees: nik_karyawan -> nama

// Filter "titik aktif". Baris lama yang is_active-nya masih NULL dianggap aktif,
// supaya data lama tidak hilang dari tabel.
const FILTER_ACTIVE = "is_active.is.null,is_active.eq.true";

const FETCH_CHUNK = 1000;               // ambil data bertahap per 1000 baris (batas Supabase)
const NIK_CHUNK = 100;

const BRANCHES = { 2: "Makassar", 1: "Surabaya" };   // dipakai untuk tab & judul
const DEFAULT_BRANCH = 2;

// Sesi login & hak pindah cabang (sama seperti halaman laporan)
const SESSION_KEY = "erp_session";
const ROLE_IDS_ALL_BRANCH = [1, 2];                  // 1 = Maintenance, 2 = Superadmin
const SESSION_BRANCH_FIELDS = ["branchId", "branch_id"];

// Ukuran label PDF (satuan cm, kertas A4 portrait)
const LABEL = {
    boxW: 5,            // lebar box luar
    boxH: 7,            // tinggi box luar
    qrSize: 4.5,        // ukuran kotak QR (termasuk garis tepinya)
    qrPadding: 0.4,     // jarak garis tepi ke modul QR (area putih agar mudah discan)
    qrTop: 0.25,        // jarak kotak QR dari tepi atas box
    pageTop: 2,         // jarak box dari tepi atas kertas
    fontSize: 12,       // ukuran huruf kode titik (pt), tebal
    lineWidth: 0.02,    // tebal garis tepi
    // Susunan "Download Semua": 3 kolom x 3 baris = 9 label per lembar A4.
    // Untuk 12 label per lembar ubah rows menjadi 4 dan gapX/gapY menjadi 0
    // (label menempel; hanya jika printer Anda bisa mencetak sampai ~0,85 cm dari tepi atas-bawah).
    cols: 3,
    rows: 3,
    gapX: 0.5,          // jarak antar label ke samping
    gapY: 0.5           // jarak antar label ke bawah
};

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan kondisi halaman saat ini.
// ===================================================
const state = {
    branchId: DEFAULT_BRANCH,
    canSwitch: false,
    titikList: [],             // titik aktif pada cabang yang dibuka
    selected: new Set(),       // id titik yang dicentang (tetap tersimpan saat pencarian berubah)
    search: "",
    areas: [],                 // semua baris tabel areas
    areaMap: new Map(),        // id area -> area_name
    branches: new Map(),       // id cabang -> branch_name
    refLoaded: false,
    nameCache: new Map(),      // nik_karyawan -> nama
    reqId: 0,
    form: { mode: "add", id: null },
    deleteTarget: null
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// ===================================================
const $ = (id) => document.getElementById(id);

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function branchName(id) {
    return state.branches.get(String(id)) || BRANCHES[id] || `Cabang ${id}`;
}

function areaName(id) {
    if (id === null || id === undefined || id === "") return "";
    return state.areaMap.get(String(id)) || `Area ${id}`;
}

// Mengambil SEMUA baris secara bertahap per 1000 baris (menghindari batas 1000 Supabase)
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

// Notifikasi singkat di bawah layar
let toastTimer = null;
function showToast(message) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ===================================================
// KELOMPOK 3B: SESI LOGIN
// Fungsi: membaca erp_session. Username (nik_karyawan) dipakai untuk kolom
// created_by. Hak pindah cabang hanya mengatur TAMPILAN di browser;
// pembatasan data yang sebenarnya harus dipasang di database (RLS).
// ===================================================
function getSession() {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
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

// Username yang disimpan ke created_by (username = nik_karyawan)
function getUsername() {
    const s = getSession();
    return s ? (s.nik || s.username || "") : "";
}

function blockPage(message) {
    $("branchTitle").textContent = "-";
    $("titikTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">${esc(message)}</td></tr>`;
    $("btnTambah").disabled = true;
    $("searchInput").disabled = true;
}

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: dijalankan saat halaman selesai dimuat.
//  - Maintenance / Superadmin: cabang awal dari alamat halaman (?branch_id=2),
//    jika tidak ada dipakai cabang di sesi, jika tidak ada juga dipakai default.
//  - User lain: cabang SELALU dari sesi.
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
    setupForm();
    setupDelete();
    setupTableActions();
    setupSelection();
    updateTabUi();
    loadBranch();
});

// ===================================================
// KELOMPOK 5: TAB CABANG
// Fungsi: pindah antar Makassar / Surabaya (hanya Maintenance & Superadmin).
// ===================================================
function setupTabs() {
    document.querySelectorAll(".tp-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.branch, 10);
            if (state.canSwitch && id !== state.branchId) switchBranch(id);
        });
    });
}

function switchBranch(id) {
    state.branchId = id;
    state.selected = new Set();
    state.search = "";
    $("searchInput").value = "";
    updateTabUi();
    const url = new URL(window.location.href);
    url.searchParams.set("branch_id", String(id));
    window.history.replaceState(null, "", url);
    loadBranch();
}

function updateTabUi() {
    document.querySelectorAll(".tp-tab").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.branch, 10) === state.branchId);
    });
    $("branchTitle").textContent = branchName(state.branchId);
}

// ===================================================
// KELOMPOK 6: MEMUAT DATA
// Fungsi: mengambil (1) nama area & cabang untuk tampilan dan dropdown
// (sekali saja), (2) daftar titik patroli AKTIF pada cabang yang dibuka,
// (3) nama pembuat dari hrd.employees berdasarkan nik_karyawan.
// ===================================================
async function ensureRefData() {
    if (state.refLoaded) return;
    const [areas, branches] = await Promise.all([
        fetchAll((from, to) => supabaseClient.from(TABLE_AREA).select("*").range(from, to)),
        fetchAll((from, to) => supabaseClient.from(TABLE_BRANCH).select("id, branch_name").range(from, to))
    ]);
    state.areas = areas;
    state.areaMap = new Map(areas.map(a => [String(a.id), a.area_name]));
    state.branches = new Map(branches.map(b => [String(b.id), b.branch_name]));
    state.refLoaded = true;
}

async function loadBranch() {
    const myReq = ++state.reqId;
    $("titikTableBody").innerHTML = `<tr class="row-loading"><td colspan="7"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    $("titikCount").textContent = "";

    try {
        await ensureRefData();
        const rows = await fetchAll((from, to) => supabaseClient
            .schema(SCHEMA_SECURITY).from(TABLE_TITIK)
            .select("id, branch_id, area_id, titik_patroli, kode_titik, created_by")
            .eq("branch_id", state.branchId)
            .or(FILTER_ACTIVE)
            .order("id", { ascending: true })
            .range(from, to));
        await resolveNames(rows.map(r => r.created_by));
        if (myReq !== state.reqId) return;       // user sudah pindah tab

        state.titikList = rows;
        const ids = new Set(rows.map(r => String(r.id)));
        state.selected = new Set([...state.selected].filter(id => ids.has(id)));
        updateTabUi();                           // nama cabang dari database sudah tersedia
        renderTable();
    } catch (err) {
        if (myReq !== state.reqId) return;
        console.error("Gagal memuat titik patroli:", err);
        $("titikTableBody").innerHTML = `<tr class="row-empty"><td colspan="7">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

// Mencari nama dari hrd.employees berdasarkan nik_karyawan (hasil disimpan di nameCache)
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
        chunk.forEach(n => { if (!state.nameCache.has(n)) state.nameCache.set(n, null); });
    }
}

// ===================================================
// KELOMPOK 7: PENCARIAN & TAMPILAN TABEL
// Fungsi: pencarian memfilter data yang sudah dimuat (nama titik patroli dan
// nama area), tanpa membuka database lagi. Urutan: area, lalu nama titik.
// ===================================================
function setupSearch() {
    let timer = null;
    $("searchInput").addEventListener("input", (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.search = e.target.value; renderTable(); }, 200);
    });
}

// Urutan tampilan: area, lalu nama titik. Dipakai juga untuk urutan label di PDF.
function sortTitik(rows) {
    return rows.sort((a, b) =>
        areaName(a.area_id).localeCompare(areaName(b.area_id), "id", { numeric: true }) ||
        (a.titik_patroli || "").localeCompare(b.titik_patroli || "", "id", { numeric: true }));
}

function visibleRows() {
    const q = state.search.trim().toLowerCase();
    return sortTitik(state.titikList.filter(t => !q
        || (t.titik_patroli || "").toLowerCase().includes(q)
        || areaName(t.area_id).toLowerCase().includes(q)));
}

function renderTable() {
    const rows = visibleRows();
    const tbody = $("titikTableBody");

    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="7">${state.search.trim() ? "Tidak ada titik patroli yang cocok dengan pencarian." : "Belum ada titik patroli untuk cabang ini."}</td></tr>`;
        $("titikCount").textContent = "";
        updateSelectionUi();
        return;
    }

    const dash = `<span class="data-empty-cell">-</span>`;
    tbody.innerHTML = rows.map((t, i) => {
        const nik = t.created_by ? String(t.created_by) : "";
        const pembuat = state.nameCache.get(nik) || nik;   // jika nama tidak ditemukan, tampilkan NIK
        return `
            <tr>
                <td class="col-check"><input type="checkbox" class="row-check" data-id="${esc(t.id)}" ${state.selected.has(String(t.id)) ? "checked" : ""}></td>
                <td class="col-no">${i + 1}</td>
                <td class="col-center">
                    <button type="button" class="tp-icon-btn" data-act="label" data-id="${esc(t.id)}" title="Unduh label QR (PDF)">
                        <i class="fa-solid fa-file-pdf"></i> Download
                    </button>
                </td>
                <td>${areaName(t.area_id) ? esc(areaName(t.area_id)) : dash}</td>
                <td>${t.titik_patroli ? esc(t.titik_patroli) : dash}</td>
                <td>${pembuat ? esc(pembuat) : dash}</td>
                <td class="col-center">
                    <span class="tp-actions">
                        <button type="button" class="tp-icon-btn" data-act="edit" data-id="${esc(t.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
                        <button type="button" class="tp-icon-btn danger" data-act="delete" data-id="${esc(t.id)}"><i class="fa-solid fa-trash"></i> Hapus</button>
                    </span>
                </td>
            </tr>`;
    }).join("");

    $("titikCount").textContent = `${rows.length} titik patroli`;
    updateSelectionUi();
}

// Satu pendengar klik untuk semua tombol di dalam tabel (Label, Edit, Hapus)
function setupTableActions() {
    $("titikTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const titik = state.titikList.find(t => String(t.id) === btn.dataset.id);
        if (!titik) return;
        if (btn.dataset.act === "label") downloadLabel(titik);
        else if (btn.dataset.act === "edit") openForm("edit", titik);
        else if (btn.dataset.act === "delete") openDelete(titik);
    });
}

// ===================================================
// KELOMPOK 8: MODAL TAMBAH / EDIT
// Fungsi: form Kode, Nama, Cabang, Area.
//  - Tambah: semua terisi. Cabang dikunci ke cabang user jika bukan
//    Maintenance/Superadmin. Pilihan Area menyempit mengikuti Cabang jika
//    tabel areas punya kolom branch_id.
//  - Edit: hanya Kode dan Nama yang bisa diubah; Cabang dan Area terkunci.
// Di belakang layar: created_by = username (nik) dari sesi login,
// is_active = true (saat tambah). Saat edit, created_by diganti user yang mengedit.
// ===================================================
function setupForm() {
    $("btnTambah").addEventListener("click", () => openForm("add"));
    $("btnFormClose").addEventListener("click", closeForm);
    $("btnFormCancel").addEventListener("click", closeForm);
    $("btnFormSave").addEventListener("click", saveForm);
    $("fBranch").addEventListener("change", () => {
        if (state.form.mode === "add") fillAreaSelect($("fBranch").value, "");
    });
    $("modalForm").addEventListener("click", (e) => { if (e.target === $("modalForm")) closeForm(); });
    // Enter di kolom isian = Simpan; Escape menutup modal
    ["fKode", "fNama"].forEach(id => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") saveForm(); }));
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        closeForm();
        closeDelete();
    });
}

function optionList(items, selectedValue, placeholder) {
    const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
    return head + items.map(o =>
        `<option value="${esc(o.id)}" ${String(o.id) === String(selectedValue) ? "selected" : ""}>${esc(o.name)}</option>`).join("");
}

function branchChoices() {
    let list = [...state.branches].map(([id, name]) => ({ id, name }));
    if (list.length === 0) list = Object.entries(BRANCHES).map(([id, name]) => ({ id, name }));
    if (!state.canSwitch) list = list.filter(b => String(b.id) === String(state.branchId));
    return list;
}

// Daftar area untuk sebuah cabang. Jika tabel areas punya kolom branch_id, area
// disaring sesuai cabang (area tanpa branch_id tetap ditampilkan); jika tidak, semua area.
function areaChoices(branchId) {
    const hasBranchCol = state.areas.some(a => Object.prototype.hasOwnProperty.call(a, "branch_id"));
    return state.areas
        .filter(a => !hasBranchCol || a.branch_id === null || a.branch_id === undefined || String(a.branch_id) === String(branchId))
        .map(a => ({ id: a.id, name: a.area_name }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "id", { numeric: true }));
}

function fillAreaSelect(branchId, selectedId) {
    $("fArea").innerHTML = optionList(areaChoices(branchId), selectedId, "-- Pilih Area --");
}

function openForm(mode, titik) {
    state.form = { mode, id: titik ? titik.id : null };
    $("formError").textContent = "";
    $("btnFormSave").disabled = false;

    if (mode === "add") {
        $("modalFormTitle").textContent = "Tambah Titik Patroli";
        $("fKode").value = "";
        $("fNama").value = "";
        $("fBranch").innerHTML = optionList(branchChoices(), state.branchId);
        $("fBranch").disabled = !state.canSwitch;           // user biasa: terkunci di cabangnya
        fillAreaSelect(state.branchId, "");
        $("fArea").disabled = false;
    } else {
        $("modalFormTitle").textContent = "Edit Titik Patroli";
        $("fKode").value = titik.kode_titik || "";
        $("fNama").value = titik.titik_patroli || "";
        // Cabang & Area hanya ditampilkan (readonly), tidak bisa diubah
        $("fBranch").innerHTML = optionList([{ id: titik.branch_id, name: branchName(titik.branch_id) }], titik.branch_id);
        $("fArea").innerHTML = optionList([{ id: titik.area_id, name: areaName(titik.area_id) }], titik.area_id);
        $("fBranch").disabled = true;
        $("fArea").disabled = true;
    }
    $("modalForm").hidden = false;
    $("fKode").focus();
}

function closeForm() { $("modalForm").hidden = true; }

// Memeriksa apakah kode sudah dipakai titik AKTIF lain pada cabang yang sama
async function isKodeDuplicate(branchId, kode, excludeId) {
    let q = supabaseClient.schema(SCHEMA_SECURITY).from(TABLE_TITIK)
        .select("id")
        .eq("branch_id", branchId)
        .eq("kode_titik", kode)
        .or(FILTER_ACTIVE)
        .limit(1);
    if (excludeId) q = q.neq("id", excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).length > 0;
}

function friendlyError(err) {
    if (err && err.code === "23505") {
        return "Kode titik patroli sudah dipakai (bisa jadi oleh titik yang sudah dihapus).";
    }
    return (err && err.message) ? err.message : "Terjadi kesalahan.";
}

async function saveForm() {
    const kode = $("fKode").value.trim();
    const nama = $("fNama").value.trim();
    const isAdd = state.form.mode === "add";
    const branchId = isAdd ? parseInt($("fBranch").value, 10) : null;
    const areaId = isAdd ? parseInt($("fArea").value, 10) : null;
    const err = $("formError");
    err.textContent = "";

    if (!kode) { err.textContent = "Kode titik patroli wajib diisi."; return; }
    if (!nama) { err.textContent = "Nama titik patroli wajib diisi."; return; }
    if (isAdd && isNaN(branchId)) { err.textContent = "Cabang wajib dipilih."; return; }
    if (isAdd && isNaN(areaId)) { err.textContent = "Area wajib dipilih."; return; }

    const username = getUsername();
    if (!username) { err.textContent = "Username tidak ditemukan di sesi login. Silakan login ulang."; return; }

    const btn = $("btnFormSave");
    btn.disabled = true;

    try {
        if (isAdd) {
            if (await isKodeDuplicate(branchId, kode, null)) {
                err.textContent = "Kode titik patroli sudah dipakai di cabang ini."; btn.disabled = false; return;
            }
            const { data, error } = await supabaseClient.schema(SCHEMA_SECURITY).from(TABLE_TITIK)
                .insert({ kode_titik: kode, titik_patroli: nama, branch_id: branchId, area_id: areaId, created_by: username, is_active: true })
                .select("id");
            if (error) throw error;
            if (!data || data.length === 0) throw new Error("Data tidak tersimpan. Periksa hak akses (RLS) tabel titik_patroli.");

            closeForm();
            showToast("Titik patroli ditambahkan.");
            if (branchId !== state.branchId && state.canSwitch) switchBranch(branchId);
            else loadBranch();
        } else {
            const titik = state.titikList.find(t => String(t.id) === String(state.form.id));
            if (await isKodeDuplicate(titik.branch_id, kode, titik.id)) {
                err.textContent = "Kode titik patroli sudah dipakai titik lain di cabang ini."; btn.disabled = false; return;
            }
            // created_by diganti menjadi user yang melakukan edit (sesuai permintaan)
            const { data, error } = await supabaseClient.schema(SCHEMA_SECURITY).from(TABLE_TITIK)
                .update({ kode_titik: kode, titik_patroli: nama, created_by: username })
                .eq("id", titik.id)
                .select("id");
            if (error) throw error;
            if (!data || data.length === 0) throw new Error("Data tidak berubah. Periksa hak akses (RLS) tabel titik_patroli.");

            closeForm();
            showToast("Perubahan disimpan.");
            loadBranch();
        }
    } catch (e) {
        console.error("Gagal menyimpan titik patroli:", e);
        err.textContent = friendlyError(e);
        btn.disabled = false;
    }
}

// ===================================================
// KELOMPOK 9: HAPUS (SOFT DELETE)
// Fungsi: titik tidak dihapus dari database, hanya is_active diubah menjadi
// false. Titik itu hilang dari tabel ini, tetapi riwayat patroli yang
// terhubung ke titik tersebut tetap utuh.
// ===================================================
function setupDelete() {
    $("btnDeleteClose").addEventListener("click", closeDelete);
    $("btnDeleteCancel").addEventListener("click", closeDelete);
    $("btnDeleteConfirm").addEventListener("click", confirmDelete);
    $("modalDelete").addEventListener("click", (e) => { if (e.target === $("modalDelete")) closeDelete(); });
}

function openDelete(titik) {
    state.deleteTarget = titik;
    $("deleteError").textContent = "";
    $("btnDeleteConfirm").disabled = false;
    $("deleteText").innerHTML =
        `Hapus titik patroli <strong>${esc(titik.titik_patroli || titik.kode_titik)}</strong> (kode ${esc(titik.kode_titik)})?<br>` +
        `Titik akan dinonaktifkan. Riwayat patroli yang sudah tercatat tetap tersimpan.`;
    $("modalDelete").hidden = false;
}

function closeDelete() { $("modalDelete").hidden = true; }

async function confirmDelete() {
    const titik = state.deleteTarget;
    if (!titik) return;
    const btn = $("btnDeleteConfirm");
    btn.disabled = true;
    try {
        const { data, error } = await supabaseClient.schema(SCHEMA_SECURITY).from(TABLE_TITIK)
            .update({ is_active: false })
            .eq("id", titik.id)
            .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Data tidak berubah. Periksa hak akses (RLS) tabel titik_patroli.");
        closeDelete();
        showToast("Titik patroli dihapus.");
        loadBranch();
    } catch (e) {
        console.error("Gagal menghapus titik patroli:", e);
        $("deleteError").textContent = friendlyError(e);
        btn.disabled = false;
    }
}

// ===================================================
// KELOMPOK 10: PILIHAN BARIS (CHECKBOX)
// Fungsi: mencentang beberapa titik untuk diunduh labelnya sekaligus.
//  - Checkbox di header memilih / membatalkan semua baris yang SEDANG TAMPIL
//    (sesuai hasil pencarian). Setengah tercentang = sebagian terpilih.
//  - Pilihan tetap tersimpan saat pencarian diubah, sehingga bisa memilih
//    dari beberapa area. Pilihan dikosongkan saat pindah tab cabang.
//  - Tombol "Download Semua (N)" muncul hanya jika ada yang terpilih;
//    N = jumlah seluruh titik terpilih (termasuk yang sedang tersembunyi
//    oleh pencarian).
// ===================================================
function setupSelection() {
    $("titikTableBody").addEventListener("change", (e) => {
        const cb = e.target.closest(".row-check");
        if (!cb) return;
        if (cb.checked) state.selected.add(cb.dataset.id);
        else state.selected.delete(cb.dataset.id);
        updateSelectionUi();
    });

    $("chkAll").addEventListener("change", (e) => {
        const on = e.target.checked;
        visibleRows().forEach(t => {
            if (on) state.selected.add(String(t.id));
            else state.selected.delete(String(t.id));
        });
        document.querySelectorAll(".row-check").forEach(cb => { cb.checked = on; });
        updateSelectionUi();
    });

    $("btnDownloadAll").addEventListener("click", downloadSelectedLabels);
}

function updateSelectionUi() {
    const n = state.selected.size;
    const btn = $("btnDownloadAll");
    if (!btn.disabled) {      // saat PDF sedang dibuat, tulisan tombol dibiarkan
        btn.hidden = n === 0;
        btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Download Semua (${n})`;
    }

    const rows = visibleRows();
    const selVisible = rows.filter(t => state.selected.has(String(t.id))).length;
    const chk = $("chkAll");
    chk.disabled = rows.length === 0;
    chk.checked = rows.length > 0 && selVisible === rows.length;
    chk.indeterminate = selVisible > 0 && selVisible < rows.length;
}

// ===================================================
// KELOMPOK 11: LABEL QR CODE (PDF)
// Fungsi: membuat PDF A4 berisi label. Satu label =
//   - box luar 5 x 7 cm (border),
//   - kotak QR 4,5 x 4,5 cm dengan border; isi QR = id titik patroli (uuid),
//   - kode titik patroli di bawah QR: tengah, tebal, 12 pt.
// Tombol "Download" per baris: satu label di tengah lebar kertas.
// "Download Semua": label disusun dalam grid (LABEL.cols x LABEL.rows per
// lembar, default 3 x 3 = 9), halaman baru dibuat otomatis jika melebihi satu lembar.
// CETAK dengan skala 100% (Actual size), jangan "Fit to page".
// ===================================================
function libsReady() {
    if (!window.jspdf || typeof qrcode === "undefined") {
        alert("Library PDF / QR Code gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.");
        return false;
    }
    return true;
}

// Menggambar SATU label pada posisi (boxX, boxY) di halaman aktif
function drawLabel(doc, titik, boxX, boxY) {
    const qrX = boxX + (LABEL.boxW - LABEL.qrSize) / 2;
    const qrY = boxY + LABEL.qrTop;

    // Garis tepi: box luar dan kotak QR
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(LABEL.lineWidth);
    doc.rect(boxX, boxY, LABEL.boxW, LABEL.boxH);
    doc.rect(qrX, qrY, LABEL.qrSize, LABEL.qrSize);

    // Modul QR (level koreksi kesalahan M). Modul berurutan dalam satu baris
    // digabung menjadi satu persegi panjang agar tidak ada garis celah tipis.
    const qr = qrcode(0, "M");
    qr.addData(String(titik.id));
    qr.make();
    const n = qr.getModuleCount();
    const m = (LABEL.qrSize - 2 * LABEL.qrPadding) / n;
    const startX = qrX + LABEL.qrPadding;
    const startY = qrY + LABEL.qrPadding;
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < n) {
            if (qr.isDark(r, c)) {
                const begin = c;
                while (c < n && qr.isDark(r, c)) c++;
                doc.rect(startX + begin * m, startY + r * m, (c - begin) * m, m, "F");
            } else {
                c++;
            }
        }
    }

    // Kode titik patroli: tengah, tebal, 12 pt, di area di bawah QR
    doc.setFont("helvetica", "bold");
    doc.setFontSize(LABEL.fontSize);
    const lines = doc.splitTextToSize(String(titik.kode_titik || ""), LABEL.boxW - 0.4);
    const lineH = LABEL.fontSize * 1.15 * 2.54 / 72;           // tinggi satu baris dalam cm
    const areaTop = qrY + LABEL.qrSize;
    const areaH = boxY + LABEL.boxH - areaTop;
    const textY = areaTop + (areaH - lines.length * lineH) / 2 + lineH * 0.75;
    doc.text(lines, boxX + LABEL.boxW / 2, textY, { align: "center" });
}

function safeFileName(text) {
    return String(text || "").replace(/[^\w\-]+/g, "_");
}

// Satu label (tombol "Download" di tiap baris)
function downloadLabel(titik) {
    if (!libsReady()) return;
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "cm", format: "a4", orientation: "portrait" });
        const pageW = doc.internal.pageSize.getWidth();
        drawLabel(doc, titik, (pageW - LABEL.boxW) / 2, LABEL.pageTop);
        doc.save(`Label_${safeFileName(titik.kode_titik || "titik")}.pdf`);
    } catch (err) {
        console.error("Gagal membuat label PDF:", err);
        alert(`Gagal membuat label: ${err.message}`);
    }
}

// Banyak label sekaligus (tombol "Download Semua (N)")
async function downloadSelectedLabels() {
    if (!libsReady()) return;
    const items = sortTitik(state.titikList.filter(t => state.selected.has(String(t.id))));
    if (items.length === 0) return;

    const btn = $("btnDownloadAll");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`;
    await new Promise(r => setTimeout(r, 30));      // beri waktu layar menampilkan tulisan "Memproses..."

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "cm", format: "a4", orientation: "portrait" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        // Grid label diletakkan di tengah kertas
        const perPage = LABEL.cols * LABEL.rows;
        const gridW = LABEL.cols * LABEL.boxW + (LABEL.cols - 1) * LABEL.gapX;
        const gridH = LABEL.rows * LABEL.boxH + (LABEL.rows - 1) * LABEL.gapY;
        const marginX = (pageW - gridW) / 2;
        const marginY = (pageH - gridH) / 2;
        if (marginX < 0 || marginY < 0) {
            throw new Error("Susunan label melebihi ukuran kertas A4. Periksa pengaturan cols/rows/gap di LABEL.");
        }

        items.forEach((t, i) => {
            if (i > 0 && i % perPage === 0) doc.addPage();
            const pos = i % perPage;
            const col = pos % LABEL.cols;
            const row = Math.floor(pos / LABEL.cols);
            drawLabel(doc, t,
                marginX + col * (LABEL.boxW + LABEL.gapX),
                marginY + row * (LABEL.boxH + LABEL.gapY));
        });

        doc.save(`Label_${safeFileName(branchName(state.branchId))}_${items.length}_titik.pdf`);
        showToast(`${items.length} label diunduh (${Math.ceil(items.length / perPage)} lembar).`);
    } catch (err) {
        console.error("Gagal membuat label PDF:", err);
        alert(`Gagal membuat label: ${err.message}`);
    } finally {
        btn.disabled = false;
        updateSelectionUi();
    }
}