// ===================================================
// lamaran_borongan.js
// Halaman ERP "Data Lamaran Kerja Borongan"
// Semua data lewat FUNGSI DATABASE (schema hrd):
//   lamaran_list, lamaran_filter_options, panggil_lamaran
// WAJIB: jalankan lamaran_borongan.sql di Supabase terlebih dulu.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
const supabaseClient = window.supabaseClient;

const RPC_LIST = "lamaran_list";
const RPC_OPSI = "lamaran_filter_options";
const RPC_PANGGIL = "panggil_lamaran";
const ROWS_PER_PAGE = 50;
const LOGIN_PAGE = "../../login.html";   // PERLU DICEK: path login dari halaman ini

const JK_OPTS = [{ value: "Laki-laki", label: "Laki-laki" }, { value: "Perempuan", label: "Perempuan" }];
const PEND_OPTS = ["SD", "SMP", "SMA", "D3", "S1"].map(v => ({ value: v, label: v }));
const RIWAYAT_OPTS = [{ value: "true", label: "Pernah Bekerja" }, { value: "false", label: "Baru" }];
const PUNGLI_OPTS = [{ value: "true", label: "Ya" }, { value: "false", label: "Tidak" }];

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: search, filter, halaman, dan data dipisah per tab, jadi pindah
// tab tidak menghilangkan pengaturan tab lainnya.
// ===================================================
function newTabState() {
    return {
        search: "",
        filters: { jk: [], pendidikan: [], periode: [], riwayat: [], pungli: [], referensi: "" },
        page: 1, total: 0, rows: [], loaded: false, opsiPeriode: []
    };
}
const state = {
    tab: "waiting",
    waiting: newTabState(),
    history: newTabState(),
    selected: new Set(),    // id baris yang dicentang (khusus Waiting List, tetap tersimpan antar halaman)
    reqId: 0,
    calling: false
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// ===================================================
const $ = (id) => document.getElementById(id);
const rpc = (name, args) => supabaseClient.schema("hrd").rpc(name, args);

function esc(v) {
    return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const digits = (s) => String(s || "").replace(/\D/g, "");
const fmtKtp = (s) => { const d = digits(s); return [d.slice(0, 6), d.slice(6, 12), d.slice(12, 16)].filter(Boolean).join(" "); };
const fmtTelp = (s) => { const d = digits(s); return [d.slice(0, 4), d.slice(4, 8), d.slice(8)].filter(Boolean).join(" "); };
function fmtTgl(iso) {
    if (!iso) return "-";
    const p = String(iso).slice(0, 10).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "-";
}
function periodeLabel(v) {   // "2026-10" -> "Oktober 2026"
    const [y, m] = String(v).split("-");
    return `${BULAN[(parseInt(m, 10) || 1) - 1]} ${y}`;
}
function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function showToast(text) {
    const t = $("lbToast");
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { t.style.display = "none"; }, 2500);
}
const cur = () => state[state.tab];
const isWaiting = () => state.tab === "waiting";

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: memastikan sudah login, memasang semua tombol, lalu memuat tab awal.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const { data } = await supabaseClient.auth.getSession();
        if (!data || !data.session) { window.location.replace(LOGIN_PAGE); return; }
    } catch (err) {
        console.error("Gagal cek sesi:", err);
    }

    setupTabs();
    setupSearch();
    setupFilter();
    setupTable();
    setupPanggil();
    await switchTab("waiting", true);
});

// ===================================================
// KELOMPOK 5: TAB
// Fungsi: pindah Waiting List / History. Kolom pencarian dan filter
// ditampilkan sesuai pengaturan tab yang dibuka.
// ===================================================
function setupTabs() {
    document.querySelectorAll(".lb-tab").forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
}

async function switchTab(tab, force) {
    if (!force && tab === state.tab) return;
    state.tab = tab;
    document.querySelectorAll(".lb-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $("inputSearch").value = cur().search;
    $("filterPanel").hidden = true;
    updateFilterBadge();
    updatePanggilButton();
    renderTableHead();
    if (!cur().loaded) {
        loadPeriodeOptions(tab);   // pilihan periode diambil sekali per tab
        await loadPage();
    } else {
        renderBody();
        renderPagination();
    }
}

// ===================================================
// KELOMPOK 6: SEARCH
// Fungsi: mencari nama saja (dikerjakan di database).
// ===================================================
function setupSearch() {
    let timer = null;
    $("inputSearch").addEventListener("input", (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            cur().search = e.target.value.trim();
            cur().page = 1;
            loadPage();
        }, 400);
    });
}

// ===================================================
// KELOMPOK 7: FILTER
// Fungsi: panel filter berisi Jenis Kelamin, Pendidikan, Periode
// (Lamaran / Pemanggilan, sesuai tab), Riwayat, Potensi Pungli, dan Referensi
// (kolom ketik; database mencari teks yang mengandung ATAU mirip, jadi salah
// ketik ringan seperti "abul" tetap menemukan "Abdul").
// Filter baru berlaku setelah tombol "Terapkan".
// ===================================================
async function loadPeriodeOptions(tab) {
    try {
        const { data, error } = await rpc(RPC_OPSI, { p_tab: tab });
        if (error) throw error;
        state[tab].opsiPeriode = (data && data.periode) || [];
        if (state.tab === tab) renderFilterGroups();
    } catch (err) {
        console.error("Gagal memuat pilihan periode:", err);
    }
}

function filterGroupDefs() {
    return [
        { key: "jk", label: "Jenis Kelamin", opts: JK_OPTS },
        { key: "pendidikan", label: "Pendidikan", opts: PEND_OPTS },
        { key: "periode", label: isWaiting() ? "Periode Lamaran" : "Periode Pemanggilan", opts: cur().opsiPeriode.map(v => ({ value: v, label: periodeLabel(v) })) },
        { key: "riwayat", label: "Riwayat", opts: RIWAYAT_OPTS },
        { key: "pungli", label: "Potensi Pungli", opts: PUNGLI_OPTS }
    ];
}

function renderFilterGroups() {
    const f = cur().filters;
    const groups = filterGroupDefs().map(g => {
        const items = g.opts.map(o => `
            <label class="lb-fg-item"><input type="checkbox" data-key="${g.key}" value="${esc(o.value)}" ${f[g.key].includes(o.value) ? "checked" : ""}><span>${esc(o.label)}</span></label>`).join("");
        return `
            <div class="lb-fg">
                <button type="button" class="lb-fg-head" data-fg="${g.key}"><span>${esc(g.label)}</span><i class="fa-solid fa-chevron-down"></i></button>
                <div class="lb-fg-body" id="fgb_${g.key}">${items || '<span class="lb-dash">Belum ada data</span>'}</div>
            </div>`;
    }).join("");

    const refGroup = `
        <div class="lb-fg">
            <button type="button" class="lb-fg-head" data-fg="referensi"><span>Referensi</span><i class="fa-solid fa-chevron-down"></i></button>
            <div class="lb-fg-body" id="fgb_referensi">
                <input type="text" class="lb-fg-input" id="fltReferensi" placeholder="Ketik nama referensi..." value="${esc(f.referensi)}" autocomplete="off">
                <div class="lb-fg-hint">Toleran salah ketik. Contoh: "abul" tetap menemukan "Abdul".</div>
            </div>
        </div>`;

    $("filterGroups").innerHTML = groups + refGroup;
}

function setupFilter() {
    $("btnFilter").addEventListener("click", (e) => {
        e.stopPropagation();
        const open = $("filterPanel").hidden;
        if (open) renderFilterGroups();     // selalu tampilkan nilai filter tab aktif
        $("filterPanel").hidden = !open;
    });
    document.addEventListener("click", (e) => {
        if (!$("filterPanel").hidden && !e.target.closest(".lb-filter-wrap")) $("filterPanel").hidden = true;
    });
    $("filterGroups").addEventListener("click", (e) => {
        const head = e.target.closest(".lb-fg-head");
        if (!head) return;
        head.classList.toggle("open");
        $("fgb_" + head.dataset.fg).classList.toggle("open");
    });

    $("btnFilterApply").addEventListener("click", () => {
        const f = cur().filters;
        ["jk", "pendidikan", "periode", "riwayat", "pungli"].forEach(k => {
            f[k] = Array.from(document.querySelectorAll(`#filterGroups input[data-key="${k}"]:checked`)).map(c => c.value);
        });
        f.referensi = ($("fltReferensi")?.value || "").trim();
        cur().page = 1;
        $("filterPanel").hidden = true;
        updateFilterBadge();
        loadPage();
    });

    $("btnFilterReset").addEventListener("click", () => {
        cur().filters = { jk: [], pendidikan: [], periode: [], riwayat: [], pungli: [], referensi: "" };
        cur().page = 1;
        renderFilterGroups();
        updateFilterBadge();
        loadPage();
    });
}

function updateFilterBadge() {
    const f = cur().filters;
    const n = ["jk", "pendidikan", "periode", "riwayat", "pungli"].reduce((s, k) => s + f[k].length, 0) + (f.referensi ? 1 : 0);
    $("filterBadge").textContent = n;
    $("filterBadge").hidden = n === 0;
}

// ===================================================
// KELOMPOK 8: MEMUAT DATA
// Fungsi: mengambil 50 baris untuk halaman aktif lewat fungsi database.
// Urutan diatur database: Waiting List = tanggal lamaran terlama di atas,
// History = tanggal pemanggilan terbaru di atas.
// ===================================================
async function loadPage() {
    const tab = state.tab;
    const st = state[tab];
    const my = ++state.reqId;
    $("tblBody").innerHTML = `<tr class="lb-empty"><td colspan="11"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        const f = st.filters;
        const { data, error } = await rpc(RPC_LIST, {
            p: {
                tab, search: st.search,
                jk: f.jk, pendidikan: f.pendidikan, periode: f.periode,
                riwayat: f.riwayat, pungli: f.pungli, referensi: f.referensi,
                page: st.page, page_size: ROWS_PER_PAGE
            }
        });
        if (my !== state.reqId) return;
        if (error) throw error;

        st.rows = (data && data.rows) || [];
        st.total = Number((data && data.total) || 0);
        st.loaded = true;

        const totalPages = Math.ceil(st.total / ROWS_PER_PAGE);
        if (totalPages > 0 && st.page > totalPages) { st.page = totalPages; return loadPage(); }

        $(tab === "waiting" ? "cntWaiting" : "cntHistory").textContent = `(${st.total})`;
        renderTableHead();
        renderBody();
        renderPagination();
    } catch (err) {
        if (my !== state.reqId) return;
        console.error("Gagal memuat data lamaran:", err);
        $("tblBody").innerHTML = `<tr class="lb-empty"><td colspan="11">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

// ===================================================
// KELOMPOK 9: TAMPILAN TABEL
// Fungsi: kolom dibuat sesuai tab. Tabel memakai lebar tetap mengikuti layar
// (tanpa scroll samping); di layar kecil kolom Alamat/Referensi (<1000px)
// lalu Jenis Kelamin/Pendidikan/Usia (<640px) disembunyikan supaya Nama dan
// No Telp tetap terlihat. Data lengkap ada di modal detail.
// Klik No Telp = salin nomor; klik baris = modal detail.
// ===================================================
function columnDefs() {
    const cols = [];
    if (isWaiting()) cols.push({ k: "chk", w: "38px", cls: "lb-c" });
    cols.push({ k: "no", label: "No", w: "42px", cls: "lb-c" });
    if (!isWaiting()) cols.push({ k: "tgl", label: "Tgl Pemanggilan", w: "112px" });
    cols.push({ k: "nama", label: "Nama" });
    cols.push({ k: "alamat", label: "Alamat", cls: "hide-md" });
    cols.push({ k: "jk", label: "Jenis Kelamin", w: "96px", cls: "hide-sm" });
    cols.push({ k: "pend", label: "Pendidikan", w: "84px", cls: "hide-sm" });
    cols.push({ k: "usia", label: "Usia", w: "52px", cls: "hide-sm lb-c" });
    cols.push({ k: "ref", label: "Referensi", cls: "hide-md" });
    cols.push({ k: "telp", label: "No Telp", w: "122px" });
    cols.push({ k: "riw", label: "Riwayat Kerja", w: "78px", cls: "lb-c" });
    return cols;
}

function renderTableHead() {
    const cols = columnDefs();
    $("tblCols").innerHTML = cols.map(c => `<col class="${(c.cls || "").replace("lb-c", "")}" ${c.w ? `style="width:${c.w}"` : ""}>`).join("");
    $("tblHead").innerHTML = cols.map(c => {
        if (c.k === "chk") return `<th class="${c.cls}"><input type="checkbox" id="chkAll" title="Pilih semua baris di halaman ini"></th>`;
        return `<th class="${c.cls || ""}" title="${esc(c.label)}">${esc(c.label)}</th>`;
    }).join("");
}

function renderBody() {
    const st = cur();
    const cols = columnDefs();
    const tbody = $("tblBody");
    if (st.rows.length === 0) {
        const filtered = st.search || Object.values(st.filters).some(v => Array.isArray(v) ? v.length : v);
        tbody.innerHTML = `<tr class="lb-empty"><td colspan="${cols.length}">${filtered ? "Tidak ada data yang cocok dengan pencarian / filter." : (isWaiting() ? "Belum ada pelamar di Waiting List." : "Belum ada riwayat pemanggilan.")}</td></tr>`;
        syncCheckAll();
        return;
    }

    const start = (st.page - 1) * ROWS_PER_PAGE;
    const dash = `<span class="lb-dash">-</span>`;
    tbody.innerHTML = st.rows.map((r, i) => {
        const sel = state.selected.has(String(r.id));
        const cells = cols.map(c => {
            const cl = c.cls || "";
            switch (c.k) {
                case "chk": return `<td class="${cl}"><input type="checkbox" class="row-chk" data-id="${esc(r.id)}" ${sel ? "checked" : ""}></td>`;
                case "no": return `<td class="${cl}">${start + i + 1}</td>`;
                case "tgl": return `<td>${esc(fmtTgl(r.tanggal_pemanggilan))}</td>`;
                case "nama": return `<td title="${esc(r.nama)}">${esc(r.nama)}</td>`;
                case "alamat": return `<td class="${cl}" title="${esc(r.alamat)}">${esc(r.alamat)}</td>`;
                case "jk": return `<td class="${cl}">${esc(r.jenis_kelamin)}</td>`;
                case "pend": return `<td class="${cl}">${esc(r.pendidikan)}</td>`;
                case "usia": return `<td class="${cl}">${esc(r.usia)}</td>`;
                case "ref": return `<td class="${cl}" title="${esc(r.referensi || "")}">${r.referensi ? esc(r.referensi) : dash}</td>`;
                case "telp": return `<td class="lb-telp" data-telp="${esc(digits(r.no_telp))}" title="Klik untuk menyalin">${esc(fmtTelp(r.no_telp))}</td>`;
                case "riw": return `<td class="${cl}">${r.pernah_di_dmb ? '<i class="fa-solid fa-check lb-ok"></i>' : dash}</td>`;
                default: return "<td></td>";
            }
        }).join("");
        return `<tr class="lb-row${sel ? " sel" : ""}" data-id="${esc(r.id)}">${cells}</tr>`;
    }).join("");
    syncCheckAll();
}

function setupTable() {
    $("tblBody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr.lb-row");
        if (!tr) return;

        // Centang baris
        if (e.target.classList.contains("row-chk")) {
            const id = e.target.dataset.id;
            if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
            tr.classList.toggle("sel", e.target.checked);
            syncCheckAll();
            updatePanggilButton();
            return;
        }
        // Salin No Telp
        const telp = e.target.closest(".lb-telp");
        if (telp) { copyText(telp.dataset.telp); return; }

        const row = cur().rows.find(r => String(r.id) === tr.dataset.id);
        if (row) openDetail(row);
    });

    // Centang semua baris di halaman yang tampil (header tabel dibuat ulang JS, jadi pakai delegasi)
    $("tblHead").addEventListener("change", (e) => {
        if (e.target.id !== "chkAll") return;
        cur().rows.forEach(r => {
            if (e.target.checked) state.selected.add(String(r.id)); else state.selected.delete(String(r.id));
        });
        renderBody();
        updatePanggilButton();
    });
}

function syncCheckAll() {
    const all = $("chkAll");
    if (!all) return;
    const rows = cur().rows;
    const n = rows.filter(r => state.selected.has(String(r.id))).length;
    all.checked = rows.length > 0 && n === rows.length;
    all.indeterminate = n > 0 && n < rows.length;
    all.disabled = rows.length === 0;
}

async function copyText(text) {
    if (!text) return;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement("textarea");   // cadangan untuk browser/koneksi non-HTTPS
            ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        }
        showToast(`Nomor ${fmtTelp(text)} disalin`);
    } catch (err) {
        console.error("Gagal menyalin:", err);
        showToast("Gagal menyalin nomor");
    }
}

// ===================================================
// KELOMPOK 10: PAGINATION (maks 50 baris per halaman)
// ===================================================
function renderPagination() {
    const st = cur();
    const box = $("pagination");
    const totalPages = Math.ceil(st.total / ROWS_PER_PAGE);
    if (totalPages <= 1) {
        box.innerHTML = st.total > 0 ? `<span class="lb-pag-info">${st.total} data</span>` : "";
        return;
    }
    let html = `<button data-nav="prev" ${st.page === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>`;
    const maxVisible = 5;
    let a = Math.max(1, st.page - Math.floor(maxVisible / 2));
    let b = Math.min(totalPages, a + maxVisible - 1);
    if (b - a < maxVisible - 1) a = Math.max(1, b - maxVisible + 1);
    for (let i = a; i <= b; i++) html += `<button data-page="${i}" class="${i === st.page ? "active" : ""}">${i}</button>`;
    html += `<button data-nav="next" ${st.page === totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>`;
    html += `<span class="lb-pag-info">${st.total} data</span>`;
    box.innerHTML = html;

    box.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => { st.page = parseInt(btn.dataset.page, 10); loadPage(); }));
    box.querySelector('[data-nav="prev"]').onclick = () => { if (st.page > 1) { st.page--; loadPage(); } };
    box.querySelector('[data-nav="next"]').onclick = () => { if (st.page < totalPages) { st.page++; loadPage(); } };
}

// ===================================================
// KELOMPOK 11: MODAL DETAIL PELAMAR
// Fungsi: menampilkan data lengkap. Deskripsi dan Referensi hanya tampil
// jika ada isinya; Tanggal Pemanggilan hanya di tab History.
// ===================================================
function openDetail(r) {
    const rows = [
        ["No KTP", fmtKtp(r.nik_ktp)],
        ["Nama", r.nama],
        ["Alamat", r.alamat],
        ["Jenis Kelamin", r.jenis_kelamin],
        ["Pendidikan", r.pendidikan],
        ["Usia", `${r.usia} tahun`],
        ["Riwayat Kerja", r.pernah_di_dmb ? "Pernah Bekerja" : "Baru"]
    ];
    if (r.deskripsi_pernah_di_dmb) rows.push(["Deskripsi Riwayat Kerja", r.deskripsi_pernah_di_dmb]);
    if (r.referensi) rows.push(["Referensi", r.referensi]);
    if (r.deskripsi_referensi) rows.push(["Deskripsi Referensi", r.deskripsi_referensi]);

    let html = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    html += `<dt>Potensi Pungli</dt><dd>${r.is_pungli ? '<span class="lb-tag lb-tag-red">Ya</span>' : '<span class="lb-tag lb-tag-green">Tidak</span>'}</dd>`;
    if (r.deskripsi_is_pungli) html += `<dt>Deskripsi Pungli</dt><dd>${esc(r.deskripsi_is_pungli)}</dd>`;
    if (!isWaiting()) html += `<dt>Tanggal Pemanggilan</dt><dd>${esc(fmtTgl(r.tanggal_pemanggilan))}</dd>`;

    $("detailBody").innerHTML = html;
    bootstrap.Modal.getOrCreateInstance($("modalDetail")).show();
}

// ===================================================
// KELOMPOK 12: PANGGIL KARYAWAN (khusus Waiting List)
// Fungsi: tombol muncul saat ada baris dicentang. Modal meminta tanggal
// pemanggilan yang berlaku untuk SEMUA baris terpilih. Database mengubah
// is_active menjadi false dan mengisi tanggal pemanggilan dalam satu transaksi.
// ===================================================
function updatePanggilButton() {
    const n = state.selected.size;
    $("btnPanggil").hidden = !(isWaiting() && n > 0);
    $("btnPanggilText").textContent = `Panggil Karyawan (${n})`;
}

function setupPanggil() {
    $("btnPanggil").addEventListener("click", () => {
        const n = state.selected.size;
        if (n === 0) return;
        $("panggilInfo").textContent = `${n} pelamar terpilih akan dipindahkan ke History dengan tanggal pemanggilan yang sama.`;
        $("inputTglPanggil").value = todayIso();
        $("panggilMsg").classList.add("d-none");
        bootstrap.Modal.getOrCreateInstance($("modalPanggil")).show();
    });
    $("btnPanggilSubmit").addEventListener("click", submitPanggil);
}

async function submitPanggil() {
    if (state.calling) return;
    const tgl = $("inputTglPanggil").value;
    const box = $("panggilMsg");
    if (!tgl) { box.textContent = "Tanggal pemanggilan wajib diisi."; box.classList.remove("d-none"); return; }

    const ids = Array.from(state.selected).map(Number);
    const btn = $("btnPanggilSubmit");
    const orig = btn.innerHTML;
    state.calling = true;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`;
    box.classList.add("d-none");

    try {
        const { data, error } = await rpc(RPC_PANGGIL, { p: { ids, tanggal: tgl } });
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.message || "Gagal memproses.");

        bootstrap.Modal.getOrCreateInstance($("modalPanggil")).hide();
        state.selected.clear();
        state.history.loaded = false;          // History dimuat ulang saat dibuka
        state.history.opsiPeriode = [];
        updatePanggilButton();
        showToast(`${(data && data.jumlah) ?? ids.length} pelamar dipanggil`);
        await loadPage();
        loadPeriodeOptions("waiting");
    } catch (err) {
        console.error("Gagal memproses panggilan:", err);
        box.textContent = "Gagal memproses: " + (err.message || err);
        box.classList.remove("d-none");
    } finally {
        state.calling = false;
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}