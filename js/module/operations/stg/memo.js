// ===================================================
// js/module/operations/stg/memo.js
// Halaman Data Memo (stg_public.memos_view)
// 2 tab: Data Memo (status=Disetujui) & Pending (status=Pending)
// Server-side pagination -- 100 baris per halaman.
// ===================================================

const supabaseClient = window.supabaseClient;
const ROWS_PER_PAGE = 100;

// Field checklist per tab -- beda antara Data Memo dan Pending
const CHECKLIST_FIELDS_DATAMEMO = [
    { key: "noAbsen", column: "no_absen", label: "No Absen" },
    { key: "jenisMemo", column: "jenis_memo", label: "Jenis Memo" },
    { key: "jenisPekerjaan", column: "jenis_pekerjaan", label: "Jenis Pekerjaan" }
];
const CHECKLIST_FIELDS_PENDING = [
    { key: "noAbsen", column: "no_absen", label: "No Absen" },
    { key: "jenisMemo", column: "jenis_memo", label: "Jenis Memo" }
];

const SHIFT_LABELS = { "1": "1 (Satu)", "2": "2 (Dua)", "3": "3 (Tiga)" };
const NAMA_BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// ===================================================
// ROLE & AKSES HALAMAN
// PENTING: ini pembatasan di sisi TAMPILAN saja (frontend),
// bukan di database. RLS untuk stg_public.memos_view masih
// terbuka untuk semua authenticated -- kalau butuh penegakan
// yang sesungguhnya, perlu RLS row-level tambahan terpisah.
// ===================================================
const ROLE_FULL_ACCESS = [1, 2, 4];   // Maintenance, Superadmin, Supervisor
const ROLE_KARU_STG = 8;              // Data Memo semua data, Pending hanya milik sendiri
const ROLE_ADMIN_STG = 6;             // Data Memo saja, Pending tidak bisa diakses

function getCurrentUserSession() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// Hitung hak akses berdasarkan role user yang sedang login.
// Mengembalikan flag yang dipakai untuk sembunyikan tab & filter query.
function resolveAccess() {
    const session = getCurrentUserSession();
    const roleId = session?.roleId;
    const userNik = session?.nik;

    const isFullAccess = ROLE_FULL_ACCESS.includes(roleId);
    const isKaruStg = roleId === ROLE_KARU_STG;
    const isAdminStg = roleId === ROLE_ADMIN_STG;

    const canAccessDataMemo = isFullAccess || isKaruStg || isAdminStg;
    const canAccessPending = isFullAccess || isKaruStg; // Admin STG dikecualikan
    const pendingScopedToOwnKaru = isKaruStg && !isFullAccess; // KARU non-fullaccess dibatasi ke miliknya sendiri

    return {
        roleId,
        userNik,
        canAccessDataMemo,
        canAccessPending,
        pendingScopedToOwnKaru,
        hasAnyAccess: canAccessDataMemo || canAccessPending
    };
}

// Terapkan hasil resolveAccess() ke tampilan: sembunyikan tab yang
// tidak boleh diakses, atau blokir seluruh halaman kalau role tidak
// dikenali / tidak punya akses sama sekali.
function applyRoleAccess() {
    const access = resolveAccess();

    if (!access.hasAnyAccess) {
        document.querySelector(".mm-tabs-wrapper").classList.add("d-none");
        document.querySelector(".mm-main").innerHTML = `
            <div class="text-center py-5" style="color: var(--mm-text-muted);">
                <i class="fa-solid fa-lock fa-2x mb-3"></i>
                <p>Anda tidak memiliki akses ke halaman ini.</p>
            </div>
        `;
        return access;
    }

    // Admin STG: tab Pending disembunyikan total dari tampilan
    if (!access.canAccessPending) {
        const pendingTabBtn = document.querySelector('[data-bs-target="#tabPending"]');
        pendingTabBtn?.closest(".nav-item")?.classList.add("d-none");
    }

    // Kalau ternyata cuma bisa akses Pending (skenario tidak dipakai
    // sekarang, tapi jaga-jaga) -- sembunyikan tab Data Memo juga
    if (!access.canAccessDataMemo) {
        const dataMemoTabBtn = document.querySelector('[data-bs-target="#tabDataMemo"]');
        dataMemoTabBtn?.closest(".nav-item")?.classList.add("d-none");
    }

    return access;
}

// Diisi sekali di awal DOMContentLoaded, dipakai oleh loadDataMemoPage
// dan loadPendingPage untuk tahu batasan akses yang berlaku.
let currentAccess = null;

// ===================================================
// 1. STATE GLOBAL
// ===================================================
let referenceData = { no_absen: [], jenis_memo: [], jenis_pekerjaan: [] };

let dataMemoState = {
    filters: { noAbsen: [], jenisMemo: [], jenisPekerjaan: [], tglDari: "", tglSampai: "", periode: "" },
    page: 1,
    totalRows: 0,
    data: []
};

let pendingState = {
    filters: { noAbsen: [], jenisMemo: [], tglDari: "", tglSampai: "" },
    page: 1,
    totalRows: 0,
    data: []
};

// ===================================================
// 2. INISIALISASI
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    currentAccess = applyRoleAccess();

    if (!currentAccess.hasAnyAccess) {
        return; // Halaman sudah diganti pesan "tidak punya akses" oleh applyRoleAccess()
    }

    setupFilterToggle("DataMemo");
    setupFilterToggle("Pending");
    setupFilterApply("DataMemo");
    setupFilterApply("Pending");
    setupFilterReset("DataMemo");
    setupFilterReset("Pending");
    setupPeriodeDropdown();
    setupModal();
    setupDownloadDataMemo();

    try {
        await loadReferenceData();
    } catch (err) {
        console.error("Gagal memuat data referensi filter:", err);
    }

    renderFieldFilterGroups("DataMemo", CHECKLIST_FIELDS_DATAMEMO);
    renderFieldFilterGroups("Pending", CHECKLIST_FIELDS_PENDING);
    populatePeriodeOptions();

    if (currentAccess.canAccessDataMemo) {
        await loadDataMemoPage();
    }

    if (currentAccess.canAccessPending) {
        await loadPendingPage();
    }

    // Buka tab tertentu otomatis kalau halaman diakses lewat link
    // berisi hash, misal dari dashboard: memo.html#tabPending
    openTabFromUrlHash();
});

// Buka tab Bootstrap sesuai window.location.hash (dipanggil sekali saat load)
function openTabFromUrlHash() {
    const hash = window.location.hash; // contoh: "#tabPending"
    if (!hash) return;

    const tabButton = document.querySelector(`[data-bs-target="${hash}"]`);
    if (tabButton && !tabButton.closest(".nav-item")?.classList.contains("d-none")) {
        bootstrap.Tab.getOrCreateInstance(tabButton).show();
    }
}

// ===================================================
// 3. DATA REFERENSI (No Absen, Jenis Memo, Jenis Pekerjaan)
// Diambil gabungan dari seluruh status (bukan dipisah per tab)
// supaya cukup 1 RPC -- dipakai untuk mengisi checklist di kedua tab.
// ===================================================
async function loadReferenceData() {
    const { data, error } = await supabaseClient
        .schema("stg_public")
        .rpc("get_memos_filter_options");

    if (error) {
        console.error("Gagal memuat opsi filter:", error.message);
        return;
    }

    referenceData.no_absen = data?.no_absen || [];
    referenceData.jenis_memo = data?.jenis_memo || [];
    referenceData.jenis_pekerjaan = data?.jenis_pekerjaan || [];
}

// ===================================================
// 4. RENDER GRUP FILTER CHECKLIST + SEARCH (generik per tab)
// ===================================================
function renderFieldFilterGroups(tabName, fieldsList) {
    const container = document.getElementById(`filterFieldGroups${tabName}`);
    if (!container) return;

    const state = tabName === "DataMemo" ? dataMemoState : pendingState;

    container.innerHTML = fieldsList.map(field => {
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

    fieldsList.forEach(field => {
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
        searchInput.addEventListener("click", (e) => e.stopPropagation());
    });
}

// ===================================================
// 5. HELPER: format tanggal, shift, upah
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

function formatShift(val) {
    return SHIFT_LABELS[String(val)] || val || "-";
}

function formatUpah(val) {
    if (val === null || val === undefined) return null;
    return "Rp " + Number(val).toLocaleString("id-ID");
}

// ===================================================
// 6. PERHITUNGAN PERIODE (cutoff tanggal 21 - 20)
// Periode diberi nama sesuai bulan AKHIR rentangnya.
// Contoh: 21 Juli s.d 20 Agustus = Periode Agustus.
// ===================================================

// Hitung {year, month} (month 1-12) periode untuk 1 tanggal tertentu
function getPeriodeForDate(dateObj) {
    const day = dateObj.getDate();
    let month = dateObj.getMonth() + 1; // 1-12
    let year = dateObj.getFullYear();

    if (day >= 21) {
        month += 1;
        if (month > 12) { month = 1; year += 1; }
    }
    return { year, month };
}

// Hitung rentang tanggal (ISO string) untuk periode {year, month} tertentu
function getPeriodeDateRange(year, month) {
    // Awal periode: tanggal 21 bulan SEBELUM "month"
    let startMonth = month - 1;
    let startYear = year;
    if (startMonth < 1) { startMonth = 12; startYear -= 1; }

    const start = new Date(startYear, startMonth - 1, 21);
    const end = new Date(year, month - 1, 20);

    return {
        start: toIsoDate(start),
        end: toIsoDate(end)
    };
}

function toIsoDate(dateObj) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

// Rentang tanggal periode SAAT INI (dipakai sebagai default kalau
// user belum pilih periode/tanggal apapun)
function getCurrentPeriodeRange() {
    const today = new Date();
    const current = getPeriodeForDate(today);
    return getPeriodeDateRange(current.year, current.month);
}

// Isi dropdown Periode dengan 3 periode terakhir (rolling dari hari ini)
function populatePeriodeOptions() {
    const select = document.getElementById("filterPeriodeDataMemo");
    if (!select) return;

    const today = new Date();
    const current = getPeriodeForDate(today);

    let year = current.year;
    let month = current.month;

    for (let i = 0; i < 3; i++) {
        const opt = document.createElement("option");
        opt.value = `${year}-${String(month).padStart(2, "0")}`;
        opt.textContent = `Periode ${NAMA_BULAN_ID[month - 1]} ${year}`;
        select.appendChild(opt);

        month -= 1;
        if (month < 1) { month = 12; year -= 1; }
    }
}

function setupPeriodeDropdown() {
    // Tidak perlu listener khusus -- nilainya dibaca saat tombol
    // "Terapkan" filter DataMemo diklik (lihat setupFilterApply)
}

// ===================================================
// 7. TAB DATA MEMO -- ambil data (status = Disetujui)
// ===================================================
async function loadDataMemoPage() {
    if (!currentAccess?.canAccessDataMemo) return;

    const tbody = document.getElementById("dataMemoTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="12"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("memos_view")
            .select("*", { count: "exact" })
            .eq("status", "Disetujui");

        const f = dataMemoState.filters;
        if (f.noAbsen.length > 0) query = query.in("no_absen", f.noAbsen);
        if (f.jenisMemo.length > 0) query = query.in("jenis_memo", f.jenisMemo);
        if (f.jenisPekerjaan.length > 0) query = query.in("jenis_pekerjaan", f.jenisPekerjaan);

        // Prioritas: kalau Periode dipilih eksplisit, pakai rentang periode itu.
        // Kalau tidak, dan tanggal manual (dari/sampai) juga tidak diisi,
        // default-nya adalah 3 periode terakhir (sesuai requirement awal).
        if (f.periode) {
            const [py, pm] = f.periode.split("-").map(Number);
            const range = getPeriodeDateRange(py, pm);
            query = query.gte("tanggal", range.start).lte("tanggal", range.end);
        } else if (f.tglDari || f.tglSampai) {
            if (f.tglDari) query = query.gte("tanggal", f.tglDari);
            if (f.tglSampai) query = query.lte("tanggal", f.tglSampai);
        } else {
            // Default: HANYA periode terbaru (bukan 3 periode terakhir)
            const range = getCurrentPeriodeRange();
            query = query.gte("tanggal", range.start).lte("tanggal", range.end);
        }

        const start = (dataMemoState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("tanggal", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
        if (error) throw error;

        dataMemoState.data = data || [];
        dataMemoState.totalRows = count || 0;

        renderDataMemoTable();
        renderPagination("dataMemoPagination", dataMemoState, loadDataMemoPage);

    } catch (err) {
        console.error("Gagal memuat data memo:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="12">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

function renderDataMemoTable() {
    const tbody = document.getElementById("dataMemoTableBody");
    if (dataMemoState.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="12">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (dataMemoState.page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = dataMemoState.data.map((row, index) => `
        <tr>
            <td class="col-no">${start + index + 1}</td>
            <td>${row.jenis_memo || "-"}</td>
            <td>${row.no_absen || "-"}</td>
            <td>${row.nama_karyawan || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.bagian || '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatTanggal(row.tanggal) || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.jam_kerja ?? '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatShift(row.shift_kerja)}</td>
            <td>${row.jenis_pekerjaan || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.note_kerja || '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatUpah(row.upah) || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.nama_karu || '<span class="data-empty-cell">-</span>'}</td>
        </tr>
    `).join("");
}

// ===================================================
// 8. TAB PENDING -- ambil data (status = Pending)
// ===================================================
async function loadPendingPage() {
    if (!currentAccess?.canAccessPending) return;

    const tbody = document.getElementById("pendingTableBody");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="10"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("memos_view")
            .select("*", { count: "exact" })
            .eq("status", "pending");

        // ===============================================================
        // PEMBATASAN AKSES: role KARU STG hanya boleh lihat pengajuan
        // yang KARU-nya adalah dirinya sendiri (nip_karu = NIK miliknya).
        // Role full-access (Maintenance/Superadmin/Supervisor) tidak
        // kena batasan ini, tetap lihat semua data.
        // ===============================================================
        if (currentAccess.pendingScopedToOwnKaru && currentAccess.userNik) {
            query = query.eq("nip_karu", currentAccess.userNik);
        }

        const f = pendingState.filters;
        if (f.noAbsen.length > 0) query = query.in("no_absen", f.noAbsen);
        if (f.jenisMemo.length > 0) query = query.in("jenis_memo", f.jenisMemo);
        if (f.tglDari) query = query.gte("tanggal", f.tglDari);
        if (f.tglSampai) query = query.lte("tanggal", f.tglSampai);

        const start = (pendingState.page - 1) * ROWS_PER_PAGE;
        const end = start + ROWS_PER_PAGE - 1;
        query = query.order("created_at", { ascending: false }).range(start, end);

        const { data, error, count } = await query;
        if (error) throw error;

        pendingState.data = data || [];
        pendingState.totalRows = count || 0;

        renderPendingTable();
        renderPagination("pendingPagination", pendingState, loadPendingPage);
        updatePendingBadge();

    } catch (err) {
        console.error("Gagal memuat data pending:", err);
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Gagal memuat data: ${err.message}</td></tr>`;
    }
}

function renderPendingTable() {
    const tbody = document.getElementById("pendingTableBody");
    if (pendingState.data.length === 0) {
        tbody.innerHTML = `<tr class="row-empty"><td colspan="10">Tidak ada data ditemukan.</td></tr>`;
        return;
    }

    const start = (pendingState.page - 1) * ROWS_PER_PAGE;

    tbody.innerHTML = pendingState.data.map((row, index) => `
        <tr class="row-clickable" data-id="${row.id}">
            <td class="col-no">${start + index + 1}</td>
            <td>${row.jenis_memo || "-"}</td>
            <td>${row.no_absen || "-"}</td>
            <td>${row.nama_karyawan || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.bagian || '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatTanggal(row.tanggal) || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.jam_kerja ?? '<span class="data-empty-cell">-</span>'}</td>
            <td>${formatShift(row.shift_kerja)}</td>
            <td>${row.note_kerja || '<span class="data-empty-cell">-</span>'}</td>
            <td>${row.nama_karu || '<span class="data-empty-cell">-</span>'}</td>
        </tr>
    `).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(tr => {
        tr.addEventListener("click", () => {
            const id = tr.getAttribute("data-id");
            openPendingModal(id);
        });
    });
}

function updatePendingBadge() {
    const badge = document.getElementById("pendingCountBadge");
    if (!badge) return;
    if (pendingState.totalRows > 0) {
        badge.textContent = pendingState.totalRows;
        badge.classList.remove("d-none");
    } else {
        badge.classList.add("d-none");
    }
}

// ===================================================
// 9. MODAL: Detail & Setujui Pending Memo
// ===================================================
function setupModal() {
    const selectJenisMemo = document.getElementById("modalJenisMemo");
    const selectJenisPekerjaan = document.getElementById("modalJenisPekerjaan");

    // Pastikan opsi "Tidak Ditagihkan" tersedia di dropdown Jenis Pekerjaan
    // (dipakai otomatis kalau Jenis Memo = Tidak Ditagihkan)
    if (!Array.from(selectJenisPekerjaan.options).some(o => o.value === "Tidak Ditagihkan")) {
        const opt = document.createElement("option");
        opt.value = "Tidak Ditagihkan";
        opt.textContent = "Tidak Ditagihkan";
        selectJenisPekerjaan.appendChild(opt);
    }

    // Aturan: kalau Jenis Memo diubah jadi "Tidak Ditagihkan", Jenis
    // Pekerjaan otomatis ikut "Tidak Ditagihkan" dan tidak bisa diedit.
    selectJenisMemo.addEventListener("change", () => {
        if (selectJenisMemo.value === "Tidak Ditagihkan") {
            selectJenisPekerjaan.value = "Tidak Ditagihkan";
            selectJenisPekerjaan.disabled = true;
        } else {
            selectJenisPekerjaan.disabled = false;
            if (selectJenisPekerjaan.value === "Tidak Ditagihkan") {
                selectJenisPekerjaan.value = ""; // kosongkan, user pilih ulang jenis pekerjaan asli
            }
        }
    });

    document.getElementById("btnSetujuiMemo").addEventListener("click", handleSetujuiMemo);
}

function openPendingModal(id) {
    const row = pendingState.data.find(r => String(r.id) === String(id));
    if (!row) {
        alert("Data tidak ditemukan pada halaman saat ini.");
        return;
    }

    document.getElementById("modalMemoId").value = row.id;
    document.getElementById("modalJenisMemo").value = row.jenis_memo || "Ditagihkan";
    document.getElementById("modalNoAbsen").value = row.no_absen || "";
    document.getElementById("modalNamaKaryawan").value = row.nama_karyawan || "-";
    document.getElementById("modalBagian").value = row.bagian || "-";
    document.getElementById("modalTanggal").value = formatTanggal(row.tanggal) || "-";
    document.getElementById("modalJamKerja").value = row.jam_kerja ?? "";
    document.getElementById("modalShift").value = formatShift(row.shift_kerja);
    document.getElementById("modalDeskripsi").value = row.note_kerja || "";

    const selectJenisPekerjaan = document.getElementById("modalJenisPekerjaan");
    if (row.jenis_memo === "Tidak Ditagihkan") {
        selectJenisPekerjaan.value = "Tidak Ditagihkan";
        selectJenisPekerjaan.disabled = true;
    } else {
        selectJenisPekerjaan.disabled = false;
        selectJenisPekerjaan.value = row.jenis_pekerjaan || "";
    }

    const modalEl = document.getElementById("modalPendingMemo");
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();
}

async function handleSetujuiMemo() {
    const btn = document.getElementById("btnSetujuiMemo");
    const id = document.getElementById("modalMemoId").value;
    if (!id) return;

    const jenisMemoVal = document.getElementById("modalJenisMemo").value;
    const jamKerjaVal = document.getElementById("modalJamKerja").value.trim();
    const jenisPekerjaanVal = document.getElementById("modalJenisPekerjaan").value;

    // Validasi wajib isi
    if (!jenisMemoVal) {
        alert("Jenis Memo wajib diisi.");
        return;
    }
    if (!jamKerjaVal) {
        alert("Jam Kerja wajib diisi.");
        return;
    }
    if (!jenisPekerjaanVal) {
        alert("Jenis Pekerjaan wajib diisi.");
        return;
    }

    const payload = {
        jenis_memo: jenisMemoVal,
        jam_kerja: parseFloat(jamKerjaVal),
        jenis_pekerjaan: jenisPekerjaanVal,
        note_kerja: document.getElementById("modalDeskripsi").value.trim() || null,
        status: "Disetujui"
    };

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`;

    try {
        const { error } = await supabaseClient
            .schema("stg_public")
            .from("memos")
            .update(payload)
            .eq("id", id);

        if (error) throw error;

        const modalEl = document.getElementById("modalPendingMemo");
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();

        // Refresh kedua tab -- data pindah dari Pending ke Data Memo
        await loadPendingPage();
        await loadDataMemoPage();

    } catch (err) {
        console.error("Gagal menyetujui memo:", err);
        alert("Gagal menyetujui memo: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check me-1"></i> Setujui`;
    }
}

// ===================================================
// 10. FILTER PANEL -- toggle, apply, reset
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

    const fieldsList = tabName === "DataMemo" ? CHECKLIST_FIELDS_DATAMEMO : CHECKLIST_FIELDS_PENDING;

    btnApply.addEventListener("click", () => {
        const state = tabName === "DataMemo" ? dataMemoState : pendingState;

        fieldsList.forEach(field => {
            const listId = `filterList_${field.key}_${tabName}`;
            const checked = Array.from(
                document.querySelectorAll(`#${listId} input[type="checkbox"]:checked`)
            ).map(cb => cb.value);
            state.filters[field.key] = checked;
        });

        state.filters.tglDari = document.getElementById(`filterTglDari${tabName}`).value;
        state.filters.tglSampai = document.getElementById(`filterTglSampai${tabName}`).value;

        if (tabName === "DataMemo") {
            state.filters.periode = document.getElementById("filterPeriodeDataMemo").value;
        }

        state.page = 1;
        updateFilterBadge(tabName, fieldsList);
        document.getElementById(`filterPanel${tabName}`).classList.add("d-none");

        if (tabName === "DataMemo") loadDataMemoPage();
        else loadPendingPage();
    });
}

function setupFilterReset(tabName) {
    const btnReset = document.getElementById(`btnFilterReset${tabName}`);
    if (!btnReset) return;

    const fieldsList = tabName === "DataMemo" ? CHECKLIST_FIELDS_DATAMEMO : CHECKLIST_FIELDS_PENDING;

    btnReset.addEventListener("click", () => {
        const state = tabName === "DataMemo" ? dataMemoState : pendingState;

        fieldsList.forEach(field => {
            const listId = `filterList_${field.key}_${tabName}`;
            const searchId = `filterSearch_${field.key}_${tabName}`;
            document.querySelectorAll(`#${listId} input[type="checkbox"]`).forEach(cb => cb.checked = false);
            document.querySelectorAll(`#${listId} .filter-checkbox-item`).forEach(item => item.style.display = "flex");
            const searchInput = document.getElementById(searchId);
            if (searchInput) searchInput.value = "";
        });

        document.getElementById(`filterTglDari${tabName}`).value = "";
        document.getElementById(`filterTglSampai${tabName}`).value = "";

        if (tabName === "DataMemo") {
            document.getElementById("filterPeriodeDataMemo").value = "";
            state.filters = { noAbsen: [], jenisMemo: [], jenisPekerjaan: [], tglDari: "", tglSampai: "", periode: "" };
        } else {
            state.filters = { noAbsen: [], jenisMemo: [], tglDari: "", tglSampai: "" };
        }

        state.page = 1;
        updateFilterBadge(tabName, fieldsList);

        if (tabName === "DataMemo") loadDataMemoPage();
        else loadPendingPage();
    });
}

function updateFilterBadge(tabName, fieldsList) {
    const state = tabName === "DataMemo" ? dataMemoState : pendingState;
    const f = state.filters;

    let total = 0;
    fieldsList.forEach(field => total += f[field.key].length);
    if (f.tglDari) total++;
    if (f.tglSampai) total++;
    if (tabName === "DataMemo" && f.periode) total++;

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
// 11. DOWNLOAD EXCEL (tab Data Memo) -- ambil SELURUH
// data sesuai filter aktif, TIDAK dibatasi pagination 100 baris.
// ===================================================
function setupDownloadDataMemo() {
    const btn = document.getElementById("btnDownloadDataMemo");
    if (btn) btn.addEventListener("click", handleDownloadDataMemo);
}

async function handleDownloadDataMemo() {
    const btn = document.getElementById("btnDownloadDataMemo");
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Menyiapkan...</span>`;

    try {
        let query = supabaseClient
            .schema("stg_public")
            .from("memos_view")
            .select("*")
            .eq("status", "Disetujui");

        const f = dataMemoState.filters;
        if (f.noAbsen.length > 0) query = query.in("no_absen", f.noAbsen);
        if (f.jenisMemo.length > 0) query = query.in("jenis_memo", f.jenisMemo);
        if (f.jenisPekerjaan.length > 0) query = query.in("jenis_pekerjaan", f.jenisPekerjaan);

        // Terapkan aturan periode yang SAMA PERSIS dengan tampilan tabel
        if (f.periode) {
            const [py, pm] = f.periode.split("-").map(Number);
            const range = getPeriodeDateRange(py, pm);
            query = query.gte("tanggal", range.start).lte("tanggal", range.end);
        } else if (f.tglDari || f.tglSampai) {
            if (f.tglDari) query = query.gte("tanggal", f.tglDari);
            if (f.tglSampai) query = query.lte("tanggal", f.tglSampai);
        } else {
            const range = getCurrentPeriodeRange();
            query = query.gte("tanggal", range.start).lte("tanggal", range.end);
        }

        query = query.order("tanggal", { ascending: false });

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
            "Tanggal": formatTanggal(r.tanggal),
            "No Absen": r.no_absen,
            "Nama Karyawan": r.nama_karyawan,
            "Bagian": r.bagian,
            "Jam Kerja": r.jam_kerja,
            "Shift": formatShift(r.shift_kerja),
            "Jenis Pekerjaan": r.jenis_pekerjaan,
            "Deskripsi": r.note_kerja,
            "Jenis Memo": r.jenis_memo
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Data Memo");

        const namaFile = `Data_Memo_${toIsoDate(new Date())}.xlsx`;
        XLSX.writeFile(wb, namaFile);

    } catch (err) {
        console.error("Gagal download data memo:", err);
        alert("Gagal menyiapkan file download: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
}
// ===================================================
// 12. PAGINATION (generik, dipakai kedua tab)
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