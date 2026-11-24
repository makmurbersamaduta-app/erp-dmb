// ===================================================
// konfirmasi_lamaran_borongan.js
// Halaman ERP "Konfirmasi Lamaran Kerja Borongan" (modules/operations/stg)
// 3 tab: Panggil (belum dikonfirmasi), Hadir, Tidak Hadir.
// Semua data lewat FUNGSI DATABASE (schema hrd):
//   konfirmasi_list, konfirmasi_set_hadir, blacklist_lamaran
// WAJIB: jalankan lamaran_borongan_update.sql di Supabase terlebih dulu.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// ===================================================
const supabaseClient = window.supabaseClient;

const RPC_LIST = "konfirmasi_list";
const RPC_SET = "konfirmasi_set_hadir";
const RPC_BLACKLIST = "blacklist_lamaran";
const ROWS_PER_PAGE = 50;
const LOGIN_PAGE = "../../../login.html";   // PERLU DICEK: path login dari halaman ini

const JK_OPTS = [{ value: "Laki-laki", label: "Laki-laki" }, { value: "Perempuan", label: "Perempuan" }];
const PEND_OPTS = ["SD", "SMP", "SMA", "D3", "S1"].map(v => ({ value: v, label: v }));
const RIWAYAT_OPTS = [{ value: "true", label: "Pernah Bekerja" }, { value: "false", label: "Baru" }];
const PUNGLI_OPTS = [{ value: "true", label: "Ya" }, { value: "false", label: "Tidak" }];

// ===================================================
// KELOMPOK 2: STATE
// Fungsi: search, filter, halaman, data, dan baris terpilih dipisah per tab.
// ===================================================
function newTabState() {
    return {
        search: "",
        filters: { jk: [], pendidikan: [], riwayat: [], pungli: [], referensi: "", dari: "", sampai: "" },
        page: 1, total: 0, rows: [], loaded: false,
        selected: new Set()
    };
}
const state = {
    tab: "panggil",
    panggil: newTabState(),
    hadir: newTabState(),
    tidak: newTabState(),
    reqId: 0,
    busy: false
};
const COUNT_IDS = { panggil: "cntPanggil", hadir: "cntHadir", tidak: "cntTidak" };

// ===================================================
// KELOMPOK 3: FUNGSI BANTU
// ===================================================
const $ = (id) => document.getElementById(id);
const rpc = (name, args) => supabaseClient.schema("hrd").rpc(name, args);
const cur = () => state[state.tab];
const hasChecklist = () => state.tab === "panggil" || state.tab === "hadir";

function esc(v) {
    return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Tampilan nama: huruf depan tiap kata kapital (hanya tampilan)
const titleCase = (s) => String(s ?? "").toLowerCase().replace(/(^|[\s.'\-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const digits = (s) => String(s || "").replace(/\D/g, "");
const fmtKtp = (s) => { const d = digits(s); return [d.slice(0, 6), d.slice(6, 12), d.slice(12, 16)].filter(Boolean).join(" "); };
function fmtTgl(iso) {
    if (!iso) return "-";
    const p = String(iso).slice(0, 10).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "-";
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function showToast(text) {
    const t = $("lbToast");
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { t.style.display = "none"; }, 2500);
}

// ===================================================
// KELOMPOK 4: INISIALISASI
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
    setupActions();
    await switchTab("panggil", true);
});

// ===================================================
// KELOMPOK 5: TAB
// Fungsi: pindah Panggil / Hadir / Tidak Hadir. Tombol Filter hanya
// tampil di tab Hadir dan Tidak Hadir.
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
    $("filterWrap").hidden = (tab === "panggil");
    updateFilterBadge();
    updateActionButtons();
    renderTableHead();
    if (!cur().loaded) await loadPage();
    else { renderBody(); renderPagination(); }
}

// ===================================================
// KELOMPOK 6: SEARCH (nama saja, semua tab)
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
// KELOMPOK 7: FILTER (tab Hadir dan Tidak Hadir)
// Jenis Kelamin, Pendidikan, Tanggal (tanggal pemanggilan, dipilih langsung
// di kalender), Riwayat, Potensi Pungli, Referensi (toleran salah ketik).
// ===================================================
let fpTanggal = null;
let tglPending = { dari: "", sampai: "" };

function updateTglInfo() {
    const a = tglPending.dari, b = tglPending.sampai;
    $("tglInfo").textContent = !a ? "Belum ada tanggal dipilih." : (a === b ? `Dipilih: ${fmtTgl(a)}` : `Dipilih: ${fmtTgl(a)} s/d ${fmtTgl(b)}`);
}

function filterGroupDefs() {
    return [
        { key: "jk", label: "Jenis Kelamin", opts: JK_OPTS },
        { key: "pendidikan", label: "Pendidikan", opts: PEND_OPTS },
        { key: "riwayat", label: "Riwayat", opts: RIWAYAT_OPTS },
        { key: "pungli", label: "Potensi Pungli", opts: PUNGLI_OPTS }
    ];
}

function renderFilterGroups() {
    if (fpTanggal) { fpTanggal.destroy(); fpTanggal = null; }
    const f = cur().filters;
    const html = {};
    filterGroupDefs().forEach(g => {
        const items = g.opts.map(o => `
            <label class="lb-fg-item"><input type="checkbox" data-key="${g.key}" value="${esc(o.value)}" ${f[g.key].includes(o.value) ? "checked" : ""}><span>${esc(o.label)}</span></label>`).join("");
        html[g.key] = `
            <div class="lb-fg">
                <button type="button" class="lb-fg-head" data-fg="${g.key}"><span>${esc(g.label)}</span><i class="fa-solid fa-chevron-down"></i></button>
                <div class="lb-fg-body" id="fgb_${g.key}">${items}</div>
            </div>`;
    });

    const tglGroup = `
        <div class="lb-fg">
            <button type="button" class="lb-fg-head" data-fg="tanggal"><span>Tanggal</span><i class="fa-solid fa-chevron-down"></i></button>
            <div class="lb-fg-body lb-fg-cal" id="fgb_tanggal">
                <input type="text" class="lb-cal-input" id="fltTgl">
                <div class="lb-fg-hint" id="tglInfo"></div>
                <div class="lb-fg-hint">Berdasarkan tanggal pemanggilan. Klik tanggal awal, lalu tanggal akhir. Satu klik saja = satu hari.</div>
                <button type="button" class="lb-link" id="btnTglClear">Hapus tanggal</button>
            </div>
        </div>`;

    const refGroup = `
        <div class="lb-fg">
            <button type="button" class="lb-fg-head" data-fg="referensi"><span>Referensi</span><i class="fa-solid fa-chevron-down"></i></button>
            <div class="lb-fg-body" id="fgb_referensi">
                <input type="text" class="lb-fg-input" id="fltReferensi" placeholder="Ketik nama referensi..." value="${esc(f.referensi)}" autocomplete="off">
                <div class="lb-fg-hint">Toleran salah ketik. Contoh: "abul" tetap menemukan "Abdul".</div>
            </div>
        </div>`;

    $("filterGroups").innerHTML = html.jk + html.pendidikan + tglGroup + html.riwayat + html.pungli + refGroup;

    tglPending = { dari: f.dari, sampai: f.sampai };
    if (window.flatpickr) {
        const loc = (flatpickr.l10ns && flatpickr.l10ns.id) ? "id" : "default";
        fpTanggal = flatpickr($("fltTgl"), {
            mode: "range", inline: true, dateFormat: "Y-m-d", locale: loc,
            defaultDate: [f.dari, f.sampai].filter(Boolean),
            onChange(sel) {
                if (sel.length === 0) tglPending = { dari: "", sampai: "" };
                else if (sel.length === 1) tglPending = { dari: ymd(sel[0]), sampai: ymd(sel[0]) };
                else tglPending = { dari: ymd(sel[0]), sampai: ymd(sel[1]) };
                updateTglInfo();
            }
        });
        $("btnTglClear").addEventListener("click", () => { fpTanggal.clear(); });
    } else {
        $("tglInfo").textContent = "Kalender gagal dimuat. Periksa koneksi internet.";
    }
    updateTglInfo();
}

function setupFilter() {
    $("btnFilter").addEventListener("click", (e) => {
        e.stopPropagation();
        const open = $("filterPanel").hidden;
        if (open) renderFilterGroups();
        $("filterPanel").hidden = !open;
    });
    // composedPath dipakai karena kalender menggambar ulang isinya saat diklik
    document.addEventListener("click", (e) => {
        if ($("filterPanel").hidden) return;
        if (!e.composedPath().includes($("filterWrap"))) $("filterPanel").hidden = true;
    });
    $("filterGroups").addEventListener("click", (e) => {
        const head = e.target.closest(".lb-fg-head");
        if (!head) return;
        head.classList.toggle("open");
        $("fgb_" + head.dataset.fg).classList.toggle("open");
    });

    $("btnFilterApply").addEventListener("click", () => {
        const f = cur().filters;
        ["jk", "pendidikan", "riwayat", "pungli"].forEach(k => {
            f[k] = Array.from(document.querySelectorAll(`#filterGroups input[data-key="${k}"]:checked`)).map(c => c.value);
        });
        f.referensi = ($("fltReferensi")?.value || "").trim();
        f.dari = tglPending.dari;
        f.sampai = tglPending.sampai;
        cur().page = 1;
        $("filterPanel").hidden = true;
        updateFilterBadge();
        loadPage();
    });

    $("btnFilterReset").addEventListener("click", () => {
        cur().filters = { jk: [], pendidikan: [], riwayat: [], pungli: [], referensi: "", dari: "", sampai: "" };
        cur().page = 1;
        renderFilterGroups();
        updateFilterBadge();
        loadPage();
    });
}

function updateFilterBadge() {
    const f = cur().filters;
    const n = ["jk", "pendidikan", "riwayat", "pungli"].reduce((s, k) => s + f[k].length, 0) + (f.referensi ? 1 : 0) + ((f.dari || f.sampai) ? 1 : 0);
    $("filterBadge").textContent = n;
    $("filterBadge").hidden = n === 0;
}

// ===================================================
// KELOMPOK 8: MEMUAT DATA
// Fungsi: 50 baris per halaman lewat fungsi database. Urutan: tanggal
// pemanggilan terbaru di atas.
// ===================================================
async function loadPage() {
    const tab = state.tab;
    const st = state[tab];
    const my = ++state.reqId;
    $("tblBody").innerHTML = `<tr class="lb-empty"><td colspan="9"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    try {
        const f = st.filters;
        const { data, error } = await rpc(RPC_LIST, {
            p: {
                tab, search: st.search,
                jk: f.jk, pendidikan: f.pendidikan, dari: f.dari, sampai: f.sampai,
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

        $(COUNT_IDS[tab]).textContent = `(${st.total})`;
        renderTableHead();
        renderBody();
        renderPagination();
    } catch (err) {
        if (my !== state.reqId) return;
        console.error("Gagal memuat data konfirmasi:", err);
        $("tblBody").innerHTML = `<tr class="lb-empty"><td colspan="9">Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

// ===================================================
// KELOMPOK 9: TAMPILAN TABEL
// Kolom: (centang), No, Tanggal Pemanggilan, No KTP, Nama, Alamat,
// Jenis Kelamin, Pendidikan. Alamat melebar ke bawah; kolom lain pas isi.
// Di tab Hadir, pelamar yang sudah diblacklist diberi tanda "Blacklist".
// ===================================================
function columnDefs() {
    const cols = [];
    if (hasChecklist()) cols.push({ k: "chk", cls: "lb-c" });
    cols.push({ k: "no", label: "No", cls: "lb-c" });
    cols.push({ k: "tgl", label: "Tanggal Pemanggilan", cls: "lb-c" });
    cols.push({ k: "ktp", label: "No KTP", cls: "lb-c" });
    cols.push({ k: "nama", label: "Nama" });
    cols.push({ k: "alamat", label: "Alamat", cls: "hide-md lb-alamat" });
    cols.push({ k: "jk", label: "Jenis Kelamin", cls: "hide-sm lb-c" });
    cols.push({ k: "pend", label: "Pendidikan", cls: "hide-sm lb-c" });
    return cols;
}

function renderTableHead() {
    const cols = columnDefs();
    $("tblCols").innerHTML = "";
    $("tblHead").innerHTML = cols.map(c => {
        if (c.k === "chk") return `<th class="${c.cls}"><input type="checkbox" id="chkAll" title="Pilih semua baris di halaman ini"></th>`;
        return `<th class="${c.cls || ""}">${esc(c.label)}</th>`;
    }).join("");
}

const EMPTY_TEXT = {
    panggil: "Tidak ada pelamar yang menunggu konfirmasi kehadiran.",
    hadir: "Belum ada pelamar yang hadir.",
    tidak: "Belum ada pelamar yang tidak hadir."
};

function renderBody() {
    const st = cur();
    const cols = columnDefs();
    const tbody = $("tblBody");
    if (st.rows.length === 0) {
        const filtered = st.search || Object.values(st.filters).some(v => Array.isArray(v) ? v.length : v);
        tbody.innerHTML = `<tr class="lb-empty"><td colspan="${cols.length}">${filtered ? "Tidak ada data yang cocok dengan pencarian / filter." : EMPTY_TEXT[state.tab]}</td></tr>`;
        syncCheckAll();
        return;
    }

    const start = (st.page - 1) * ROWS_PER_PAGE;
    tbody.innerHTML = st.rows.map((r, i) => {
        const sel = st.selected.has(String(r.id));
        const badge = (state.tab === "hadir" && r.is_blacklist) ? ` <span class="lb-tag lb-tag-red" title="${esc(r.reason_blacklist || "")}">Blacklist</span>` : "";
        const cells = cols.map(c => {
            const cl = c.cls || "";
            switch (c.k) {
                case "chk": return `<td class="${cl}"><input type="checkbox" class="row-chk" data-id="${esc(r.id)}" ${sel ? "checked" : ""}></td>`;
                case "no": return `<td class="${cl}">${start + i + 1}</td>`;
                case "tgl": return `<td class="${cl}">${esc(fmtTgl(r.tanggal_pemanggilan))}</td>`;
                case "ktp": return `<td class="${cl}">${esc(fmtKtp(r.nik_ktp))}</td>`;
                case "nama": return `<td>${esc(titleCase(r.nama))}${badge}</td>`;
                case "alamat": return `<td class="${cl}">${esc(r.alamat)}</td>`;
                case "jk": return `<td class="${cl}">${esc(r.jenis_kelamin)}</td>`;
                case "pend": return `<td class="${cl}">${esc(r.pendidikan)}</td>`;
                default: return "<td></td>";
            }
        }).join("");
        return `<tr class="lb-row${sel ? " sel" : ""}" data-id="${esc(r.id)}">${cells}</tr>`;
    }).join("");
    syncCheckAll();
}

function setupTable() {
    $("tblBody").addEventListener("click", (e) => {
        if (!e.target.classList.contains("row-chk")) return;
        const st = cur();
        const tr = e.target.closest("tr.lb-row");
        const id = e.target.dataset.id;
        if (e.target.checked) st.selected.add(id); else st.selected.delete(id);
        tr.classList.toggle("sel", e.target.checked);
        syncCheckAll();
        updateActionButtons();
    });

    // Centang semua baris di halaman yang tampil
    $("tblHead").addEventListener("change", (e) => {
        if (e.target.id !== "chkAll") return;
        const st = cur();
        st.rows.forEach(r => {
            if (e.target.checked) st.selected.add(String(r.id)); else st.selected.delete(String(r.id));
        });
        renderBody();
        updateActionButtons();
    });
}

function syncCheckAll() {
    const all = $("chkAll");
    if (!all) return;
    const st = cur();
    const n = st.rows.filter(r => st.selected.has(String(r.id))).length;
    all.checked = st.rows.length > 0 && n === st.rows.length;
    all.indeterminate = n > 0 && n < st.rows.length;
    all.disabled = st.rows.length === 0;
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
// KELOMPOK 11: TOMBOL AKSI
// Tab Panggil : "Hadir" (biru) dan "Tidak Hadir" (merah).
//   Hadir       -> is_hadir true,  is_blacklist false
//   Tidak Hadir -> is_hadir false, is_blacklist true
// Tab Hadir   : "Blacklist" (merah), membuka form Alasan Blacklist ->
//   is_blacklist true dan reason_blacklist terisi.
// Tombol hanya muncul bila ada baris dicentang di tab aktif.
// ===================================================
function updateActionButtons() {
    const n = cur().selected.size;
    const p = state.tab === "panggil" && n > 0;
    $("btnHadir").hidden = !p;
    $("btnTidak").hidden = !p;
    $("btnBlacklist").hidden = !(state.tab === "hadir" && n > 0);
    $("btnHadirText").textContent = `Hadir (${n})`;
    $("btnTidakText").textContent = `Tidak Hadir (${n})`;
    $("btnBlacklistText").textContent = `Blacklist (${n})`;
}

// Tab lain dimuat ulang saat dibuka, jadi hitungan lama dikosongkan
function invalidateOthers(except) {
    Object.keys(COUNT_IDS).forEach(t => {
        if (t === except) return;
        state[t].loaded = false;
        $(COUNT_IDS[t]).textContent = "";
    });
}

function setupActions() {
    $("btnHadir").addEventListener("click", () => setHadir(true));
    $("btnTidak").addEventListener("click", () => setHadir(false));

    $("btnBlacklist").addEventListener("click", () => {
        const n = cur().selected.size;
        if (n === 0) return;
        $("blacklistInfo").textContent = `${n} pelamar terpilih akan diblacklist dengan alasan yang sama.`;
        $("inputAlasan").value = "";
        $("blacklistMsg").classList.add("d-none");
        bootstrap.Modal.getOrCreateInstance($("modalBlacklist")).show();
    });
    $("btnBlacklistSubmit").addEventListener("click", submitBlacklist);
}

async function setHadir(hadir) {
    const st = cur();
    const n = st.selected.size;
    if (n === 0 || state.busy) return;
    const label = hadir ? "Hadir" : "Tidak Hadir";
    const extra = hadir ? "" : "\n\nPelamar yang Tidak Hadir otomatis berstatus blacklist.";
    if (!confirm(`Tandai ${n} pelamar sebagai "${label}"?${extra}`)) return;

    const btn = hadir ? $("btnHadir") : $("btnTidak");
    state.busy = true;
    btn.disabled = true;
    try {
        const ids = Array.from(st.selected).map(Number);
        const { data, error } = await rpc(RPC_SET, { p: { ids, hadir } });
        if (error) throw error;
        st.selected.clear();
        invalidateOthers(state.tab);
        updateActionButtons();
        showToast(`${(data && data.jumlah) ?? ids.length} pelamar ditandai ${label}`);
        await loadPage();
    } catch (err) {
        console.error("Gagal menandai kehadiran:", err);
        alert("Gagal memproses: " + (err.message || err));
    } finally {
        state.busy = false;
        btn.disabled = false;
    }
}

async function submitBlacklist() {
    if (state.busy) return;
    const alasan = $("inputAlasan").value.trim();
    const box = $("blacklistMsg");
    if (alasan.length < 3) { box.textContent = "Alasan blacklist wajib diisi."; box.classList.remove("d-none"); return; }

    const st = cur();
    const ids = Array.from(st.selected).map(Number);
    const btn = $("btnBlacklistSubmit");
    const orig = btn.innerHTML;
    state.busy = true;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses...`;
    box.classList.add("d-none");

    try {
        const { data, error } = await rpc(RPC_BLACKLIST, { p: { ids, alasan } });
        if (error) throw error;
        bootstrap.Modal.getOrCreateInstance($("modalBlacklist")).hide();
        st.selected.clear();
        updateActionButtons();
        const jumlah = (data && data.jumlah) ?? ids.length;
        showToast(jumlah < ids.length ? `${jumlah} diblacklist (${ids.length - jumlah} sudah diblacklist sebelumnya)` : `${jumlah} pelamar diblacklist`);
        await loadPage();
    } catch (err) {
        console.error("Gagal blacklist:", err);
        box.textContent = "Gagal memproses: " + (err.message || err);
        box.classList.remove("d-none");
    } finally {
        state.busy = false;
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}