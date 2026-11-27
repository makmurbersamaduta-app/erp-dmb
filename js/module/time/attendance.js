// ===================================================
// js/module/time/attendance.js
// Halaman "Laporan Absensi" (attendance.html).
// Data dari database (time_modul1n_laporan_absensi.sql):
//   view  hrd.v_karyawan_laporan    daftar karyawan + filter
//   rpc   hrd.laporan_absensi       satu baris per karyawan per tanggal
//   rpc   hrd.koreksi_absen_admin   tombol Edit
//   tabel hrd.absensi               History Log dan detail
// "supabaseClient" dibuat oleh js/auth.js (tidak dideklarasikan ulang di sini).
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN
// ATT_PER_HALAMAN       : jumlah KARYAWAN per halaman tabel (bukan jumlah baris)
// ATT_CHUNK_EXPORT      : jumlah karyawan per permintaan saat export (agar tidak kena batas waktu)
// ATT_MAKS_HARI         : batas rentang tanggal (hari, termasuk kedua ujung)
// ATT_ROLE_BOLEH_UBAH   : role yang boleh memakai tombol Edit (sama dengan Time Settings)
// ATT_WARNA_DEVICE_JIKA : baris berwarna biru bila device_berbeda sama dengan nilai ini.
//                         true  = baris biru bila device_berbeda = true (device BERBEDA).
//                         false = kebalikannya (menandai device yang SAMA).
// ===================================================
const ATT_PER_HALAMAN = 25;
const ATT_PER_HALAMAN_PILIH = 15;
const ATT_CHUNK_EXPORT = 20;
const ATT_MAKS_HARI = 31;
const ATT_ROLE_BOLEH_UBAH = [1, 2, 3];
const ATT_WARNA_DEVICE_JIKA = true;
const ATT_STORAGE_KOLOM = "att_kolom_v1";
const ATT_PETA_AWAL = [-2.5, 118];
const ATT_LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const ATT_LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const ATT_XLSX_JS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

// ===================================================
// KELOMPOK 2: STATE (data sementara di memori)
// ===================================================
const att = {
    session: null,
    canEdit: false,
    master: { branch: [], cc: [], dept: [], area: [], jabatan: [] },   // untuk isi dropdown (yang aktif)
    nama: { branch: new Map(), cc: new Map(), dept: new Map(), area: new Map(), jabatan: new Map() },
    struct: [],                                           // isi cost_center_structures (cost_center_id, area_id, dept_id) untuk filter berantai
    filter: { branch: [], cc: [], area: [], dept: [] },   // filter yang SUDAH diterapkan (angka id)
    dari: "",
    sampai: "",
    page: 1,
    total: 0,
    token: 0,
    baris: [],
    kolom: new Set(),
    cal: { bulan: null, dari: null, sampai: null, tahap: "awal", onTerapkan: null, kembaliKe: null },
    exp: { ids: new Set(), info: new Map(), dari: null, sampai: null },
    ep: { page: 1, total: 0, token: 0, baris: [] },
    map: null,
    peta: null
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU
// ===================================================
function attEl(id) { return document.getElementById(id); }

function attEsc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function attClient() {
    return window.supabaseClient || (typeof supabaseClient !== "undefined" ? supabaseClient : null);
}

// Tabel/fungsi di schema "hrd"
function attDb() {
    const c = attClient();
    if (!c) throw new Error("Koneksi database belum siap.");
    return c.schema("hrd");
}

function attGetSession() {
    try {
        const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function attModal(id) { return bootstrap.Modal.getOrCreateInstance(attEl(id)); }

// Menutup satu modal lalu membuka modal lain setelah yang pertama selesai tertutup
function attGanti(dari, ke) {
    attEl(dari).addEventListener("hidden.bs.modal", () => attModal(ke).show(), { once: true });
    attModal(dari).hide();
}

function attToast(teks, tipe) {
    const d = document.createElement("div");
    d.className = "toast align-items-center text-bg-" + (tipe || "success") + " border-0";
    d.innerHTML = `<div class="d-flex"><div class="toast-body">${attEsc(teks)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    attEl("attToastWadah").appendChild(d);
    d.addEventListener("hidden.bs.toast", () => d.remove());
    new bootstrap.Toast(d, { delay: 3500 }).show();
}

function attPesanError(err) {
    const m = (err && (err.message || err.details)) || "Terjadi kesalahan.";
    return String(m);
}

// ----- tanggal (teks "YYYY-MM-DD" dihitung sebagai teks agar tidak bergeser oleh zona waktu) -----
function attPad(n) { return String(n).padStart(2, "0"); }
function attIso(d) { return `${d.getFullYear()}-${attPad(d.getMonth() + 1)}-${attPad(d.getDate())}`; }
function attParse(iso) { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
function attHariIni() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); }
function attTambah(iso, n) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function attSelisih(a, b) {
    const u = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((u(b) - u(a)) / 86400000);
}
function attTgl(iso) {
    return iso ? attParse(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "";
}
function attRentangTeks(dari, sampai) {
    if (!dari) return "Pilih tanggal";
    if (!sampai || sampai === dari) return attTgl(dari);
    return `${attTgl(dari)} - ${attTgl(sampai)}`;
}
// Late In memperhitungkan toleransi: keterlambatan <= toleransi dianggap tidak terlambat (kosong);
// bila melewati toleransi, yang tampil adalah keterlambatan PENUH (jam masuk jadwal - Check In).
// Dipakai tabel, detail, dan export agar angkanya selalu sama.
function attLateMenit(r) {
    return r.late_menit != null && r.late_menit > (r.toleransi_menit || 0) ? r.late_menit : null;
}
// menit -> "hh:mm" (kosong bila tidak ada)
function attHHMM(menit) {
    if (menit == null || menit === "") return "";
    const m = Math.round(Number(menit));
    return `${attPad(Math.floor(m / 60))}:${attPad(m % 60)}`;
}
// "YYYY-MM-DD HH:MM:SS" menurut zona waktu karyawan
function attWaktuLokal(iso, tz) {
    return iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: tz || "Asia/Jakarta" }) : "";
}

// nama dari tabel master (cabang, cost center, dst.) berdasarkan id
function attNama(kunci, id) {
    if (id == null) return "";
    return att.nama[kunci].get(Number(id)) || `#${id}`;
}

// ===================================================
// KELOMPOK 4: DEFINISI KOLOM TABEL
// Kolom "Nama / NIK | Jabatan" (kiri) dan "Aksi" (kanan) selalu tampil.
// Kolom lain bisa disembunyikan lewat Atur Kolom (pilihan tersimpan di browser).
// merah(r) = true -> teks jam menjadi merah tebal (terlambat / pulang cepat).
// ===================================================
const ATT_KOLOM = [
    { id: "tanggal", label: "Tanggal", nilai: r => attTgl(r.tanggal) },
    { id: "cabang", label: "Cabang", nilai: r => attNama("branch", r.branch_id) },
    { id: "cc", label: "Cost Center", nilai: r => attNama("cc", r.costcenter_id) },
    { id: "area", label: "Area", nilai: r => attNama("area", r.area_id) },
    { id: "shift", label: "Shift", nilai: r => r.kode_shift || "" },
    { id: "jadwal_masuk", label: "Schedule Check In", nilai: r => r.jadwal_masuk || "" },
    { id: "jadwal_pulang", label: "Schedule Check Out", nilai: r => r.jadwal_pulang || "" },
    { id: "kode_absen", label: "Attendance Code", nilai: r => r.kode_absen || "" },
    { id: "kode_cuti", label: "Time Off Code", nilai: r => r.kode_time_off || "" },
    { id: "check_in", label: "Check In", nilai: r => r.check_in || "", merah: r => r._telat },
    { id: "check_out", label: "Check Out", nilai: r => r.check_out || "", merah: r => r._cepat },
    { id: "late", label: "Late In", nilai: r => attHHMM(attLateMenit(r)) },
    { id: "early", label: "Early Out", nilai: r => attHHMM(r.early_menit) },
    { id: "ot_sebelum", label: "Overtime Duration Before", nilai: r => attHHMM(r.ot_sebelum_menit) },
    { id: "ot_sesudah", label: "Overtime Duration After", nilai: r => attHHMM(r.ot_sesudah_menit) },
    { id: "ot_total", label: "Total Overtime", nilai: r => attHHMM(r.ot_total_menit) }
];

function attMuatKolom() {
    let simpan = null;
    try { simpan = JSON.parse(localStorage.getItem(ATT_STORAGE_KOLOM) || "null"); } catch (e) { simpan = null; }
    const valid = Array.isArray(simpan) ? simpan.filter(id => ATT_KOLOM.some(k => k.id === id)) : null;
    att.kolom = new Set(valid && valid.length ? valid : ATT_KOLOM.map(k => k.id));
}

function attSimpanKolom() {
    try { localStorage.setItem(ATT_STORAGE_KOLOM, JSON.stringify(Array.from(att.kolom))); } catch (e) { /* abaikan */ }
}

// ===================================================
// KELOMPOK 5: DATA MASTER DAN FILTER
// Tabel master ada di schema public: branches, cost_centers, departments, areas, jabatans.
// Dropdown hanya memuat yang aktif; nama untuk id yang sudah nonaktif tetap dikenali di tabel.
// ===================================================
async function attMuatMaster() {
    const c = attClient();
    const defs = [
        ["branch", "branches", "branch_name"],
        ["cc", "cost_centers", "costcenter_name"],
        ["dept", "departments", "department_name"],
        ["area", "areas", "area_name"],
        ["jabatan", "jabatans", "jabatan_name"]
    ];
    await Promise.all(defs.map(async ([kunci, tabel, kolomNama]) => {
        const r = await c.from(tabel).select("*").limit(5000);
        if (r.error) { console.error(`Gagal memuat ${tabel}:`, r.error); return; }
        const semua = (r.data || []).map(x => ({ id: Number(x.id), nama: x[kolomNama] || x.nama || x.name || `#${x.id}`, aktif: x.is_active !== false, branch_id: x.branch_id == null ? null : Number(x.branch_id) }));
        att.nama[kunci] = new Map(semua.map(x => [x.id, x.nama]));
        att.master[kunci] = semua.filter(x => x.aktif).sort((a, b) => String(a.nama).localeCompare(String(b.nama), "id"));
    }));
}

function attIsiFilter(idSelect, kunci, labelSemua) {
    const el = attEl(idSelect);
    const lama = el.value;
    el.innerHTML = `<option value="">${labelSemua}</option>` +
        att.master[kunci].map(x => `<option value="${x.id}">${attEsc(x.nama)}</option>`).join("");
    el.value = lama;
}

// Dropdown di sub modal "Pilih Karyawan" (export). Filter halaman utama memakai panel Filter (di bawah).
// (Dropdown lama di sub modal Pilih Karyawan diganti panel Filter berstruktur; fungsi ini dibiarkan kosong.)
function attIsiSemuaFilter() { }

// Menambahkan filter ke query pada view v_karyawan_laporan.
// f.branch / f.cc / f.dept / f.area berupa ARRAY id (kosong = tidak difilter).
function attTerapkanFilter(query, f) {
    if (f.branch && f.branch.length) query = query.in("branch_id", f.branch);
    if (f.cc && f.cc.length) query = query.in("costcenter_id", f.cc);
    if (f.dept && f.dept.length) query = query.in("departemen_id", f.dept);
    if (f.area && f.area.length) query = query.in("area_id", f.area);
    if (f.q) query = query.ilike("cari", `%${f.q}%`);
    return query;
}

// Ambil SEMUA baris struktur cost center (Supabase membatasi 1 permintaan = 1000 baris).
async function attAmbilStruktur() {
    const semua = [];
    let dari = 0;
    while (true) {
        const { data, error } = await attClient().from("cost_center_structures")
            .select("cost_center_id, area_id, dept_id").order("id", { ascending: true }).range(dari, dari + 999);
        if (error) { console.error("Gagal memuat cost_center_structures:", error); break; }
        semua.push(...(data || []));
        if (!data || data.length < 1000) break;
        dari += 1000;
    }
    return semua;
}

// ===================================================
// PANEL FILTER (1 tombol): Cabang -> Cost Center -> Area -> Departemen, berupa kotak centang.
// Tanpa centang di induk = daftar anak tidak dibatasi oleh induk itu. Area dan Departemen mengikuti
// tabel cost_center_structures. Pilihan baru dipakai setelah tombol "Terapkan".
// ===================================================
const ATT_FILTER_GRUP = [
    { kunci: "branch", el: "attFBranch" },
    { kunci: "cc", el: "attFCc" },
    { kunci: "area", el: "attFArea" },
    { kunci: "dept", el: "attFDept" }
];

function attCentang(elId) {
    return Array.from(attEl(elId).querySelectorAll("input:checked")).map(i => i.value);
}

function attGambarCek(elId, items, dicentang) {
    attEl(elId).innerHTML = items.map(it => `<label class="att-fcek"><input type="checkbox" class="form-check-input mt-0" value="${it.id}" ${dicentang.includes(String(it.id)) ? "checked" : ""}><span>${attEsc(it.nama)}</span></label>`).join("")
        || `<div class="att-fkosong">Tidak ada data</div>`;
}

// changed = indeks grup yang baru diubah user; hanya grup DI BAWAHNYA yang digambar ulang.
// Centang anak yang masih valid dipertahankan, yang tidak valid hilang.
function attCascade(changed, grup = ATT_FILTER_GRUP) {
    const prev = grup.map(g => attCentang(g.el));          // dibaca SEBELUM ada yang digambar ulang
    const gambar = (lv, items) => { if (lv > changed) attGambarCek(grup[lv].el, items, prev[lv]); };
    const kini = (lv) => (lv <= changed ? prev[lv] : attCentang(grup[lv].el));

    // 1. Cost Center <- Cabang
    const brPilih = prev[0];
    const ccList = brPilih.length ? att.master.cc.filter(c => brPilih.includes(String(c.branch_id))) : att.master.cc;
    gambar(1, ccList);
    const ccKini = kini(1);
    const ccSet = ccKini.length ? ccKini : (brPilih.length ? ccList.map(c => String(c.id)) : null);

    // 2. Area <- Cost Center
    let rows = att.struct;
    if (ccSet) rows = rows.filter(r => ccSet.includes(String(r.cost_center_id)));
    const areaIds = new Set(rows.map(r => String(r.area_id)));
    gambar(2, ccSet ? att.master.area.filter(a => areaIds.has(String(a.id))) : att.master.area);
    const areaKini = kini(2);
    if (areaKini.length) rows = rows.filter(r => areaKini.includes(String(r.area_id)));

    // 3. Departemen <- Cost Center + Area
    const deptIds = new Set(rows.map(r => String(r.dept_id)));
    gambar(3, (ccSet || areaKini.length) ? att.master.dept.filter(d => deptIds.has(String(d.id))) : att.master.dept);
}

// Menggambar panel dari awal sesuai filter yang sedang diterapkan (dipakai saat halaman dibuka dan saat Reset)
function attBangunFilter() {
    attGambarCek("attFBranch", att.master.branch, att.filter.branch.map(String));
    ["attFCc", "attFArea", "attFDept"].forEach(id => { attEl(id).innerHTML = ""; });
    attCascade(0);
    attBadgeFilter();
}

function attBadgeFilter() {
    const f = att.filter;
    const n = f.branch.length + f.cc.length + f.area.length + f.dept.length;
    attEl("attFilterBadge").textContent = n;
    attEl("attFilterBadge").classList.toggle("d-none", n === 0);
}

function attFilterDiterapkan() {
    att.filter = {
        branch: attCentang("attFBranch").map(Number), cc: attCentang("attFCc").map(Number),
        area: attCentang("attFArea").map(Number), dept: attCentang("attFDept").map(Number)
    };
    att.page = 1;
    attBadgeFilter();
    attEl("attFilterPanel").classList.add("d-none");
    attMuat();
}

function attFilterReset() {
    att.filter = { branch: [], cc: [], area: [], dept: [] };
    attBangunFilter();
    att.page = 1;
    attEl("attFilterPanel").classList.add("d-none");
    attMuat();
}

function attBersihkanKata(q) { return String(q || "").replace(/[%_,()]/g, "").trim().toLowerCase(); }

// ===================================================
// KELOMPOK 6: TABEL LAPORAN
// Alur: (1) ambil satu halaman KARYAWAN sesuai filter, (2) minta laporan absensi untuk
// karyawan itu pada rentang tanggal, (3) gambar tabel.
// ===================================================
function attFilterUtama() {
    return {
        branch: att.filter.branch, cc: att.filter.cc, dept: att.filter.dept, area: att.filter.area,
        q: attBersihkanKata(attEl("attCari").value)
    };
}

function attGambarTanggal() { attEl("attTanggalTeks").textContent = attRentangTeks(att.dari, att.sampai); }

async function attMuat() {
    const token = ++att.token;
    attEl("attBody").innerHTML = `<tr><td colspan="30" class="text-center text-muted py-4">Memuat data...</td></tr>`;
    try {
        const dari = (att.page - 1) * ATT_PER_HALAMAN;
        let q = attDb().from("v_karyawan_laporan").select("*", { count: "exact" })
            .order("nama").order("employee_id").range(dari, dari + ATT_PER_HALAMAN - 1);
        q = attTerapkanFilter(q, attFilterUtama());
        const k = await q;
        if (k.error) throw k.error;
        const ids = (k.data || []).map(x => x.employee_id);

        let rows = [];
        if (ids.length) {
            const r = await attDb().rpc("laporan_absensi", { p_dari: att.dari, p_sampai: att.sampai, p_employee_ids: ids });
            if (r.error) throw r.error;
            rows = r.data || [];
        }
        if (token !== att.token) return;   // ada permintaan yang lebih baru

        att.total = k.count || 0;
        att.baris = rows.map(r => {
            r._telat = attLateMenit(r) != null;
            r._cepat = r.early_menit != null && r.early_menit > 0;
            return r;
        });
        attRender();

        const awal = att.total === 0 ? 0 : dari + 1;
        const akhir = Math.min(dari + ATT_PER_HALAMAN, att.total);
        attEl("attInfo").textContent = `Karyawan ${awal}-${akhir} dari ${att.total} | ${att.baris.length} baris`;
        attEl("attPrev").disabled = att.page <= 1;
        attEl("attNext").disabled = att.page >= Math.ceil(att.total / ATT_PER_HALAMAN);
    } catch (err) {
        if (token !== att.token) return;
        console.error("Gagal memuat laporan:", err);
        attEl("attBody").innerHTML = `<tr><td colspan="30" class="text-center text-danger py-4">Gagal memuat data: ${attEsc(attPesanError(err))}. Pastikan time_modul1n_laporan_absensi.sql sudah dijalankan.</td></tr>`;
    }
}

function attRender() {
    const kolom = ATT_KOLOM.filter(k => att.kolom.has(k.id));
    attEl("attHead").innerHTML = `<tr><th class="att-kiri">Nama<br><span class="att-nik">NIK | Jabatan</span></th>` +
        kolom.map(k => `<th>${attEsc(k.label)}</th>`).join("") + `<th class="att-kanan">Aksi</th></tr>`;

    if (att.baris.length === 0) {
        attEl("attBody").innerHTML = `<tr><td colspan="${kolom.length + 2}" class="text-center text-muted py-4">Tidak ada data jadwal atau absensi pada rentang tanggal ini untuk karyawan di halaman ini.</td></tr>`;
        return;
    }
    attEl("attBody").innerHTML = att.baris.map((r, i) => {
        const kelas = [];
        if (r.lokasi_tidak_valid) kelas.push("att-row-invalid");
        if (r.device_berbeda === ATT_WARNA_DEVICE_JIKA) kelas.push("att-row-device");
        const aksi = (att.canEdit
            ? `<button type="button" class="btn btn-sm btn-light text-primary me-1" data-act="edit" data-i="${i}" title="Edit absensi"><i class="fa-solid fa-pen me-1"></i>Edit</button>` : "") +
            `<button type="button" class="btn btn-sm btn-light text-secondary" data-act="log" data-i="${i}" title="View History Log"><i class="fa-solid fa-clock-rotate-left me-1"></i>History Log</button>`;
        return `<tr data-i="${i}" class="${kelas.join(" ")}">
            <td class="att-kiri"><div class="fw-semibold">${attEsc(r.nama)}</div>
                <div class="att-nik">${attEsc(r.nik_karyawan)} | ${attEsc(attNama("jabatan", r.jabatan_id) || "-")}</div></td>
            ${kolom.map(k => `<td class="${k.merah && k.merah(r) ? "att-merah" : ""}">${attEsc(k.nilai(r))}</td>`).join("")}
            <td class="att-kanan att-aksi">${aksi}</td>
        </tr>`;
    }).join("");
}

// ===================================================
// KELOMPOK 7: KALENDER PILIH RENTANG TANGGAL
// Dipakai kotak tanggal (filter) dan langkah "Select Date" pada export.
// Klik tanggal awal lalu tanggal akhir (maksimal 31 hari); rentang ditandai garis warna.
// ===================================================
function attBukaKalender({ judul, dari, sampai, onTerapkan, kembaliKe }) {
    const k = att.cal;
    k.dari = dari || null;
    k.sampai = sampai || dari || null;
    k.tahap = "awal";
    k.onTerapkan = onTerapkan;
    k.kembaliKe = kembaliKe || null;
    k.bulan = attParse(dari || attHariIni());
    k.bulan.setDate(1);
    attEl("kalJudul").textContent = judul;
    attEl("kalPesan").textContent = "";
    attKalRender();
}

function attKalRender() {
    const k = att.cal;
    const th = k.bulan.getFullYear(), bl = k.bulan.getMonth();
    attEl("kalBulanTeks").textContent = new Date(th, bl, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    const geser = (new Date(th, bl, 1).getDay() + 6) % 7;   // minggu dimulai Senin
    const hariIni = attHariIni();
    const judulHari = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(h => `<div class="att-cal-judul">${h}</div>`).join("");
    let sel = "";
    for (let i = 0; i < 42; i++) {
        const d = new Date(th, bl, 1 - geser + i);
        const iso = attIso(d);
        const kelas = ["att-cal-hari"];
        if (d.getMonth() !== bl) kelas.push("luar");
        if (iso === hariIni) kelas.push("hari-ini");
        if (k.dari && k.sampai && iso >= k.dari && iso <= k.sampai) kelas.push("dalam");
        if (iso === k.dari) kelas.push("awal");
        if (iso === k.sampai) kelas.push("akhir");
        sel += `<div class="${kelas.join(" ")}" data-tgl="${iso}"><span>${d.getDate()}</span></div>`;
    }
    attEl("kalGrid").innerHTML = judulHari + sel;
    const n = k.dari ? attSelisih(k.dari, k.sampai || k.dari) + 1 : 0;
    attEl("kalRingkas").textContent = k.dari ? `${attRentangTeks(k.dari, k.sampai)} (${n} hari)` : "Belum ada tanggal dipilih";
    attEl("btnKalTerapkan").disabled = !k.dari;
}

function attKalPilih(iso) {
    const k = att.cal;
    attEl("kalPesan").textContent = "";
    if (k.tahap === "akhir") {
        let a = k.dari, b = iso;
        if (b < a) [a, b] = [b, a];
        if (attSelisih(a, b) + 1 > ATT_MAKS_HARI) {
            attEl("kalPesan").textContent = `Rentang maksimal ${ATT_MAKS_HARI} hari.`;
            return;
        }
        k.dari = a; k.sampai = b; k.tahap = "awal";
    } else {
        k.dari = iso; k.sampai = iso; k.tahap = "akhir";
    }
    attKalRender();
}

// ===================================================
// KELOMPOK 8: ATUR KOLOM
// ===================================================
function attBukaKolom() {
    attEl("kolDaftar").innerHTML = ATT_KOLOM.map(k =>
        `<label class="ts-check"><input type="checkbox" class="form-check-input mt-0" value="${k.id}" ${att.kolom.has(k.id) ? "checked" : ""}><span>${attEsc(k.label)}</span></label>`).join("");
    attModal("modalKolom").show();
}

function attTerapkanKolom() {
    const pilih = Array.from(attEl("kolDaftar").querySelectorAll("input:checked")).map(x => x.value);
    if (pilih.length === 0) { attToast("Pilih minimal satu kolom.", "warning"); return; }
    att.kolom = new Set(pilih);
    attSimpanKolom();
    attModal("modalKolom").hide();
    attRender();
}

// ===================================================
// KELOMPOK 9: AKSI TOMBOL (daftar pintu untuk Edit, History Log, Detail, Export)
// Fungsi di kelompok berikutnya mendaftar dirinya di sini, contoh:  ATT_AKSI.edit = (i) => {...};
// i = nomor baris pada att.baris. Bila belum terdaftar, tombol menampilkan pemberitahuan.
// ===================================================
const ATT_AKSI = {};
function attJalankan(nama, i) {
    if (typeof ATT_AKSI[nama] !== "function") { attToast("Fitur ini belum tersedia.", "warning"); return; }
    ATT_AKSI[nama](i);
}

// ===================================================
// KELOMPOK 10: INISIALISASI
// Fungsi: dijalankan sekali saat halaman selesai dimuat. Membaca login, menyiapkan kolom dan tanggal
// (bawaan hari ini), memasang semua tombol, memuat master dan struktur, lalu memuat tabel pertama.
// Bila ada langkah yang gagal, pesannya ditampilkan di tabel (tidak diam).
// ===================================================
function attResetKolom() {
    att.kolom = new Set(ATT_KOLOM.map(k => k.id));
    attSimpanKolom();
    attModal("modalKolom").hide();
    attRender();
}

function attPasangTombol() {
    attEl("btnKembali").addEventListener("click", () => history.back());
    attEl("btnExport").addEventListener("click", () => attJalankan("export"));

    // Kotak tanggal -> modal kalender
    attEl("attTanggalBox").addEventListener("click", () => {
        attBukaKalender({
            judul: "Pilih Tanggal", dari: att.dari, sampai: att.sampai,
            onTerapkan: (dari, sampai) => { att.dari = dari; att.sampai = sampai; att.page = 1; attGambarTanggal(); attMuat(); }
        });
        attModal("modalKalender").show();
    });
    attEl("kalPrev").addEventListener("click", () => { att.cal.bulan.setMonth(att.cal.bulan.getMonth() - 1); attKalRender(); });
    attEl("kalNext").addEventListener("click", () => { att.cal.bulan.setMonth(att.cal.bulan.getMonth() + 1); attKalRender(); });
    attEl("kalGrid").addEventListener("click", (e) => { const c = e.target.closest("[data-tgl]"); if (c) attKalPilih(c.dataset.tgl); });
    attEl("btnKalHariIni").addEventListener("click", () => {
        const h = attHariIni();
        att.cal.dari = h; att.cal.sampai = h; att.cal.tahap = "awal";
        att.cal.bulan = attParse(h); att.cal.bulan.setDate(1);
        attEl("kalPesan").textContent = "";
        attKalRender();
    });
    attEl("btnKalTerapkan").addEventListener("click", () => {
        const k = att.cal;
        if (!k.dari) return;
        if (typeof k.onTerapkan === "function") k.onTerapkan(k.dari, k.sampai || k.dari);
        attModal("modalKalender").hide();
    });
    // Bila kalender dibuka dari modal lain (export), kembali ke modal itu setelah kalender tertutup
    attEl("modalKalender").addEventListener("hidden.bs.modal", () => {
        const ke = att.cal.kembaliKe;
        att.cal.kembaliKe = null;
        if (ke) attModal(ke).show();
    });

    // Panel Filter (1 tombol)
    attEl("attFilterBtn").addEventListener("click", () => attEl("attFilterPanel").classList.toggle("d-none"));
    attEl("attFilterPanel").addEventListener("click", (e) => {
        const head = e.target.closest(".att-fg-head");
        if (head) { head.classList.toggle("expanded"); attEl(head.dataset.target).classList.toggle("expanded"); }
    });
    ATT_FILTER_GRUP.slice(0, 3).forEach((g, level) => {
        attEl(g.el).addEventListener("change", () => attCascade(level));      // centang induk -> perbarui daftar di bawahnya
    });
    attEl("attFApply").addEventListener("click", attFilterDiterapkan);
    attEl("attFReset").addEventListener("click", attFilterReset);
    // Tutup panel bila klik di luar. composedPath() dipakai karena daftar centang digambar ulang saat klik.
    document.addEventListener("click", (e) => {
        if (!e.composedPath().includes(document.querySelector(".att-filter-wrap"))) attEl("attFilterPanel").classList.add("d-none");
    });

    // Pencarian NIK / nama (ditunda 350 ms agar tidak memuat ulang di setiap ketikan)
    let tunda = null;
    attEl("attCari").addEventListener("input", () => {
        clearTimeout(tunda);
        tunda = setTimeout(() => { att.page = 1; attMuat(); }, 350);
    });

    // Atur Kolom
    attEl("btnAturKolom").addEventListener("click", attBukaKolom);
    attEl("btnKolTerapkan").addEventListener("click", attTerapkanKolom);
    attEl("btnKolReset").addEventListener("click", attResetKolom);

    // Halaman
    attEl("attPrev").addEventListener("click", () => { if (att.page > 1) { att.page--; attMuat(); } });
    attEl("attNext").addEventListener("click", () => { att.page++; attMuat(); });

    // Tabel: tombol Edit / History Log, atau klik baris untuk detail + peta
    attEl("attBody").addEventListener("click", (e) => {
        const tombol = e.target.closest("[data-act]");
        if (tombol) { e.stopPropagation(); attJalankan(tombol.dataset.act, Number(tombol.dataset.i)); return; }
        const baris = e.target.closest("tr[data-i]");
        if (baris) attJalankan("detail", Number(baris.dataset.i));
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        att.session = attGetSession();
        att.canEdit = ATT_ROLE_BOLEH_UBAH.includes(Number(att.session && att.session.roleId));
        attEl("attReadOnlyNote").classList.toggle("d-none", att.canEdit);

        attMuatKolom();
        att.dari = attHariIni();
        att.sampai = att.dari;
        attGambarTanggal();
        attPasangTombol();

        await attMuatMaster();
        att.struct = await attAmbilStruktur();
        attIsiSemuaFilter();
        attBangunFilter();
        await attMuat();
    } catch (err) {
        console.error("Gagal menyiapkan halaman:", err);
        attEl("attBody").innerHTML = `<tr><td class="text-center text-danger py-4">Gagal menyiapkan halaman: ${attEsc(attPesanError(err))}</td></tr>`;
    }
});

// ===================================================
// KELOMPOK 11: DETAIL BARIS + PETA LOKASI ABSEN
// Klik baris -> modal detail. Peta (Leaflet) baru diunduh saat pertama kali dibutuhkan.
// Peta menampilkan: titik Check In (biru), titik Check Out (merah), dan titik lokasi absen
// karyawan (hijau, lingkaran = radius) dari hrd.lokasi_absen_karyawan -> hrd.lokasi_absen_titik.
// ===================================================
let attLeafletJanji = null;
function attMuatLeaflet() {
    if (window.L) return Promise.resolve();
    if (!attLeafletJanji) {
        attLeafletJanji = new Promise((ok, gagal) => {
            const css = document.createElement("link");
            css.rel = "stylesheet"; css.href = ATT_LEAFLET_CSS; document.head.appendChild(css);
            const s = document.createElement("script");
            s.src = ATT_LEAFLET_JS; s.onload = ok;
            s.onerror = () => { attLeafletJanji = null; gagal(new Error("Peta gagal dimuat (cek koneksi internet).")); };
            document.head.appendChild(s);
        });
    }
    return attLeafletJanji;
}

// Nama karyawan dari daftar id (untuk kolom Petugas / Disetujui)
async function attNamaKaryawan(ids) {
    const unik = Array.from(new Set(ids.filter(Boolean)));
    if (!unik.length) return new Map();
    const r = await attDb().from("employees").select("id, nama").in("id", unik);
    if (r.error) throw r.error;
    return new Map((r.data || []).map(x => [x.id, x.nama]));
}

function attPin(warna) {
    return L.divIcon({ className: "", html: `<i class="fa-solid fa-location-dot" style="color:${warna};font-size:30px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.4));"></i>`, iconSize: [24, 30], iconAnchor: [12, 30], popupAnchor: [0, -28] });
}

function attBarisDetail(r) {
    const ya = (v) => v ? "Ya" : "Tidak";
    return [
        ["Nama", r.nama], ["NIK", r.nik_karyawan], ["Jabatan", attNama("jabatan", r.jabatan_id)],
        ["Tanggal", attTgl(r.tanggal)], ["Cabang", attNama("branch", r.branch_id)], ["Cost Center", attNama("cc", r.costcenter_id)],
        ["Departemen", attNama("dept", r.departemen_id)], ["Area", attNama("area", r.area_id)],
        ["Shift", r.kode_shift ? `${r.kode_shift}${r.nama_shift ? " - " + r.nama_shift : ""}` : ""],
        ["Schedule Check In", r.jadwal_masuk], ["Schedule Check Out", r.jadwal_pulang],
        ["Attendance Code", r.kode_absen], ["Time Off Code", r.kode_time_off],
        ["Check In", r.check_in], ["Check Out", r.check_out],
        ["Late In", attHHMM(attLateMenit(r))], ["Early Out", attHHMM(r.early_menit)],
        ["Overtime Before", attHHMM(r.ot_sebelum_menit)], ["Overtime After", attHHMM(r.ot_sesudah_menit)], ["Total Overtime", attHHMM(r.ot_total_menit)],
        ["Lokasi valid", r.lokasi_tidak_valid ? "Tidak valid" : "Valid"], ["Device berbeda", ya(r.device_berbeda)]
    ];
}

async function attBukaDetail(i) {
    const r = att.baris[i];
    if (!r) return;
    const token = ++att.ep.token;   // penanda permintaan terbaru (dipakai bersama agar klik cepat tidak saling timpa)
    attEl("detJudul").textContent = `Detail Absensi - ${r.nama} (${attTgl(r.tanggal)})`;
    attEl("detTabel").innerHTML = attBarisDetail(r).map(([k, v]) => `<tr><th>${attEsc(k)}</th><td>${attEsc(v == null || v === "" ? "-" : v)}</td></tr>`).join("");
    attEl("detPetaPesan").textContent = "Memuat peta...";
    const modalEl = attEl("modalDetail");
    const terbuka = new Promise(ok => modalEl.addEventListener("shown.bs.modal", ok, { once: true }));
    attModal("modalDetail").show();
    try {
        const ids = [r.masuk_id, r.keluar_id].filter(Boolean);
        const ambil = async () => {
            const abs = ids.length
                ? await attDb().from("absensi").select("id, type_absen, latitude, longitude, titik_nama, radius_meter, jarak_meter, is_valid, device_berbeda").in("id", ids)
                : { data: [] };
            if (abs.error) throw abs.error;
            const kar = await attDb().from("lokasi_absen_karyawan").select("setting_id").eq("employee_id", r.employee_id);
            if (kar.error) throw kar.error;
            const sid = (kar.data || []).map(x => x.setting_id);
            let titik = [];
            if (sid.length) {
                const t = await attDb().from("lokasi_absen_titik").select("id, nama, latitude, longitude, radius_meter, alamat").in("setting_id", sid).order("urutan");
                if (t.error) throw t.error;
                titik = t.data || [];
            }
            return { abs: abs.data || [], titik };
        };
        const [data] = await Promise.all([ambil(), terbuka, attMuatLeaflet()]);
        if (token !== att.ep.token) return;
        attGambarPeta(data.abs, data.titik);
    } catch (err) {
        console.error("Gagal memuat peta:", err);
        attEl("detPetaPesan").textContent = "Peta tidak dapat ditampilkan: " + attPesanError(err);
    }
}

function attGambarPeta(abs, titik) {
    if (att.peta) { att.peta.remove(); att.peta = null; }
    const peta = L.map("detPeta").setView(ATT_PETA_AWAL, 5);
    att.peta = peta;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(peta);
    const kumpul = [];
    const ket = [];
    titik.forEach(t => {
        if (t.latitude == null || t.longitude == null) return;
        const p = [Number(t.latitude), Number(t.longitude)];
        L.marker(p, { icon: attPin("#16a34a") }).addTo(peta).bindPopup(`<b>${attEsc(t.nama)}</b><br>Radius ${attEsc(t.radius_meter)} m${t.alamat ? "<br>" + attEsc(t.alamat) : ""}`);
        L.circle(p, { radius: Number(t.radius_meter) || 0, color: "#16a34a", fillOpacity: 0.08, weight: 1.5 }).addTo(peta);
        kumpul.push(p);
    });
    abs.forEach(a => {
        const masuk = a.type_absen === "clock_in";
        if (a.latitude != null && a.longitude != null) {
            const p = [Number(a.latitude), Number(a.longitude)];
            L.marker(p, { icon: attPin(masuk ? "#0d6efd" : "#dc2626") }).addTo(peta)
                .bindPopup(`<b>${masuk ? "Check In" : "Check Out"}</b>${a.titik_nama ? "<br>" + attEsc(a.titik_nama) : ""}<br>Jarak ${a.jarak_meter == null ? "-" : attEsc(a.jarak_meter) + " m"}`);
            kumpul.push(p);
        }
        ket.push(`${masuk ? "Check In" : "Check Out"}: ${a.latitude == null ? "tanpa koordinat" : `jarak ${a.jarak_meter == null ? "-" : a.jarak_meter + " m"} dari ${a.titik_nama || "titik absen"} (radius ${a.radius_meter == null ? "-" : a.radius_meter + " m"}), ${a.is_valid === false ? "TIDAK valid" : "valid"}`}`);
    });
    if (kumpul.length) peta.fitBounds(L.latLngBounds(kumpul), { padding: [30, 30], maxZoom: 17 });
    peta.invalidateSize();
    const catatan = [];
    if (!titik.length) catatan.push("Karyawan ini belum punya setting titik lokasi khusus.");
    if (!abs.length) catatan.push("Tidak ada absen pada tanggal ini.");
    attEl("detPetaPesan").innerHTML = attEsc(ket.concat(catatan).join(" | "));
}
attEl("modalDetail").addEventListener("hidden.bs.modal", () => { if (att.peta) { att.peta.remove(); att.peta = null; } });
ATT_AKSI.detail = attBukaDetail;

// ===================================================
// KELOMPOK 12: VIEW HISTORY LOG
// Semua baris hrd.absensi karyawan pada tanggal kerja itu (termasuk absen yang sudah diganti/dibatalkan),
// supaya terlihat siapa mengubah apa dan kapan.
// ===================================================
async function attBukaLog(i) {
    const r = att.baris[i];
    if (!r) return;
    attEl("logJudul").textContent = `History Log - ${r.nama} (${attTgl(r.tanggal)})`;
    attEl("logBody").innerHTML = `<tr><td colspan="11" class="text-center text-muted py-3">Memuat...</td></tr>`;
    attEl("logInfo").textContent = "";
    attModal("modalLog").show();
    try {
        const q = await attDb().from("absensi")
            .select("id, created_at, type_absen, waktu_absen, source, status, keterangan, petugas_id, disetujui_oleh, disetujui_pada, menggantikan_id, batal, is_active, titik_nama, jarak_meter, radius_meter, is_valid")
            .eq("employee_id", r.employee_id).eq("tanggal_kerja", r.tanggal).order("waktu_absen").order("id");
        if (q.error) throw q.error;
        const data = q.data || [];
        const nama = await attNamaKaryawan(data.flatMap(x => [x.petugas_id, x.disetujui_oleh]));
        if (!data.length) { attEl("logBody").innerHTML = `<tr><td colspan="11" class="text-center text-muted py-3">Belum ada catatan absensi.</td></tr>`; return; }
        attEl("logBody").innerHTML = data.map(x => {
            const berlaku = x.batal ? "Dibatalkan" : (x.is_active === false ? "Tidak" : "Ya");
            const jenis = x.type_absen === "clock_in" ? "Clock In" : (x.type_absen === "clock_out" ? "Clock Out" : x.type_absen);
            const lokasi = x.titik_nama ? `${x.titik_nama}${x.jarak_meter == null ? "" : ` (${x.jarak_meter} m)`}${x.is_valid === false ? " - tidak valid" : ""}` : "";
            const setuju = x.disetujui_oleh ? `${nama.get(x.disetujui_oleh) || "-"}${x.disetujui_pada ? "<br><span class=\"text-muted\">" + attEsc(attWaktuLokal(x.disetujui_pada, r.zona_waktu)) + "</span>" : ""}` : "";
            return `<tr class="${berlaku === "Ya" ? "" : "text-muted"}"><td>${x.id}</td><td>${attEsc(attWaktuLokal(x.waktu_absen, r.zona_waktu))}</td><td>${attEsc(jenis)}</td>
                <td>${attEsc(x.source)}</td><td>${attEsc(x.status)}</td><td>${berlaku}${x.menggantikan_id ? `<br><span class="text-muted">mengganti #${x.menggantikan_id}</span>` : ""}</td>
                <td>${attEsc(x.keterangan)}</td><td>${attEsc(nama.get(x.petugas_id) || "")}</td><td>${setuju}</td><td>${attEsc(lokasi)}</td><td>${attEsc(attWaktuLokal(x.created_at, r.zona_waktu))}</td></tr>`;
        }).join("");
        attEl("logInfo").textContent = `${data.length} catatan | jam memakai zona waktu ${r.zona_waktu || "Asia/Jakarta"}`;
    } catch (err) {
        console.error("Gagal memuat history log:", err);
        attEl("logBody").innerHTML = `<tr><td colspan="11" class="text-center text-danger py-3">Gagal memuat: ${attEsc(attPesanError(err))}</td></tr>`;
    }
}
ATT_AKSI.log = attBukaLog;

// ===================================================
// KELOMPOK 13: MODAL EDIT ABSENSI
// Koreksi jam masuk/pulang lewat rpc hrd.koreksi_absen_admin. Absen asli tidak dihapus;
// koreksi tercatat sebagai absen admin (lihat History Log). Alasan wajib diisi.
// Jam yang diisi adalah jam LOKAL karyawan (zona waktu cabang).
// ===================================================
let attEditBaris = null;

function attUntukInput(iso, tz) {
    const t = attWaktuLokal(iso, tz);          // "YYYY-MM-DD HH:MM:SS"
    return t ? t.replace(" ", "T").slice(0, 16) : "";
}

function attBukaEdit(i) {
    const r = att.baris[i];
    if (!r || !att.canEdit) return;
    attEditBaris = r;
    attEl("editKaryawan").textContent = `${r.nama} (${r.nik_karyawan})`;
    attEl("editTanggal").textContent = `Tanggal kerja: ${attTgl(r.tanggal)}`;
    attEl("editJadwal").textContent = r.kode_shift ? `Shift ${r.kode_shift} | ${r.jadwal_masuk || "-"} - ${r.jadwal_pulang || "-"}` : "Tidak ada jadwal";
    attEl("fEditMasuk").value = attUntukInput(r.waktu_masuk, r.zona_waktu);
    attEl("fEditPulang").value = attUntukInput(r.waktu_keluar, r.zona_waktu);
    attEl("fEditAlasan").value = "";
    attEl("editMsg").classList.add("d-none");
    attModal("modalEdit").show();
}

attEl("formEdit").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = attEditBaris;
    const msg = attEl("editMsg");
    msg.classList.add("d-none");
    const alasan = attEl("fEditAlasan").value.trim();
    if (!r) return;
    if (!alasan) { msg.textContent = "Alasan koreksi wajib diisi."; msg.classList.remove("d-none"); return; }
    const tombol = attEl("btnSimpanEdit");
    tombol.disabled = true;
    try {
        const res = await attDb().rpc("koreksi_absen_admin", { p_data: {
            employee_id: r.employee_id, tanggal_kerja: r.tanggal,
            clock_in: attEl("fEditMasuk").value || "", clock_out: attEl("fEditPulang").value || "", alasan
        } });
        if (res.error) throw res.error;
        attModal("modalEdit").hide();
        attToast("Koreksi absensi disimpan.");
        attMuat();
    } catch (err) {
        msg.textContent = attPesanError(err);
        msg.classList.remove("d-none");
    } finally {
        tombol.disabled = false;
    }
});
ATT_AKSI.edit = attBukaEdit;

// ===================================================
// KELOMPOK 14: EXPORT ATTENDANCE (3 tahap)
// Tahap 1 Select Employee : sub modal pilih karyawan (filter Branch, Cost Center, Departemen, Area + cari)
// Tahap 2 Select Date     : modal kalender, maksimal 31 hari (rentang ditandai garis warna)
// Tahap 3 Download        : mengambil laporan per kelompok karyawan (ATT_CHUNK_EXPORT) lalu membuat file
//                           Excel (.xlsx); bila library Excel gagal dimuat, otomatis jadi CSV.
// Pilihan karyawan tetap tersimpan walau pindah halaman di sub modal.
// ===================================================
const ATT_HEADER_EXPORT = ["Employee ID", "Full Name", "Job Position", "Date", "Shift", "Schedule Check In", "Schedule Check Out",
    "Attendance Code", "Time Off Code", "Check In", "Check Out", "Late In", "Early Out",
    "Overtime Duration Before", "Overtime Duration After", "Total Overtime"];

function attBarisExport(r) {
    return [r.nik_karyawan, r.nama, attNama("jabatan", r.jabatan_id), r.tanggal, r.kode_shift || "", r.jadwal_masuk || "", r.jadwal_pulang || "",
        r.kode_absen || "", r.kode_time_off || "", r.check_in || "", r.check_out || "",
        attHHMM(attLateMenit(r)), attHHMM(r.early_menit), attHHMM(r.ot_sebelum_menit), attHHMM(r.ot_sesudah_menit), attHHMM(r.ot_total_menit)];
}

// ----- modal utama export -----
function attExpRingkas() {
    const n = att.exp.ids.size;
    attEl("expRingkasKaryawan").textContent = n ? `${n} karyawan dipilih` : "Belum dipilih";
    attEl("expRingkasTanggal").textContent = att.exp.dari ? attRentangTeks(att.exp.dari, att.exp.sampai) : "Belum dipilih";
    attEl("btnExpUnduh").disabled = !(n && att.exp.dari);
}

function attBukaExport() {
    if (!att.exp.dari) { att.exp.dari = att.dari; att.exp.sampai = att.sampai; }   // awalnya mengikuti tanggal tabel, bisa diganti
    attEl("expPesan").textContent = "";
    attEl("expProgres").classList.add("d-none");
    attExpRingkas();
    attModal("modalExport").show();
}
ATT_AKSI.export = attBukaExport;

attEl("btnExpTanggal").addEventListener("click", () => {
    attBukaKalender({
        judul: "Pilih Periode Export", dari: att.exp.dari, sampai: att.exp.sampai,
        onTerapkan: (dari, sampai) => { att.exp.dari = dari; att.exp.sampai = sampai; attExpRingkas(); },
        kembaliKe: "modalExport"
    });
    attGanti("modalExport", "modalKalender");
});

// ----- tahap 1: pilih karyawan -----
// Filter sub modal memakai struktur yang sama dengan filter tabel: Cabang -> Cost Center -> Area -> Departemen
const ATT_EP_GRUP = [
    { kunci: "branch", el: "epFBranch" }, { kunci: "cc", el: "epFCc" }, { kunci: "area", el: "epFArea" }, { kunci: "dept", el: "epFDept" }
];
att.ep.filter = { branch: [], cc: [], area: [], dept: [] };

function attEpFilter() {
    const f = att.ep.filter;
    return { branch: f.branch, cc: f.cc, dept: f.dept, area: f.area, q: attBersihkanKata(attEl("epCari").value) };
}

function attEpBadge() {
    const f = att.ep.filter;
    const n = f.branch.length + f.cc.length + f.area.length + f.dept.length;
    attEl("epFilterBadge").textContent = n;
    attEl("epFilterBadge").classList.toggle("d-none", n === 0);
}

function attEpBangunFilter() {
    attGambarCek("epFBranch", att.master.branch, att.ep.filter.branch.map(String));
    ["epFCc", "epFArea", "epFDept"].forEach(id => { attEl(id).innerHTML = ""; });
    attCascade(0, ATT_EP_GRUP);
    attEpBadge();
}

function attEpTerapkan() {
    att.ep.filter = {
        branch: attCentang("epFBranch").map(Number), cc: attCentang("epFCc").map(Number),
        area: attCentang("epFArea").map(Number), dept: attCentang("epFDept").map(Number)
    };
    att.ep.page = 1;
    attEpBadge();
    attEl("epFilterPanel").classList.add("d-none");
    attEpMuat();
}

function attEpResetFilter() {
    att.ep.filter = { branch: [], cc: [], area: [], dept: [] };
    attEpBangunFilter();
    att.ep.page = 1;
    attEl("epFilterPanel").classList.add("d-none");
    attEpMuat();
}

function attEpJumlah() { attEl("epJumlah").textContent = att.exp.ids.size; }

async function attEpMuat() {
    const token = ++att.ep.token;
    attEl("epBody").innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Memuat...</td></tr>`;
    try {
        const dari = (att.ep.page - 1) * ATT_PER_HALAMAN_PILIH;
        let q = attDb().from("v_karyawan_laporan").select("employee_id, nik_karyawan, nama, costcenter_id, area_id", { count: "exact" })
            .order("nama").order("employee_id").range(dari, dari + ATT_PER_HALAMAN_PILIH - 1);
        q = attTerapkanFilter(q, attEpFilter());
        const k = await q;
        if (k.error) throw k.error;
        if (token !== att.ep.token) return;
        att.ep.total = k.count || 0;
        att.ep.baris = k.data || [];
        att.ep.baris.forEach(x => att.exp.info.set(x.employee_id, x));
        attEpGambar();
        const awal = att.ep.total === 0 ? 0 : dari + 1;
        attEl("epInfo").textContent = `${awal}-${Math.min(dari + ATT_PER_HALAMAN_PILIH, att.ep.total)} dari ${att.ep.total}`;
        attEl("epPrev").disabled = att.ep.page <= 1;
        attEl("epNext").disabled = att.ep.page >= Math.ceil(att.ep.total / ATT_PER_HALAMAN_PILIH);
    } catch (err) {
        if (token !== att.ep.token) return;
        attEl("epBody").innerHTML = `<tr><td colspan="5" class="text-center text-danger py-3">Gagal memuat: ${attEsc(attPesanError(err))}</td></tr>`;
    }
}

function attEpGambar() {
    attEl("epBody").innerHTML = att.ep.baris.length ? att.ep.baris.map(x => `<tr>
        <td class="text-center"><input type="checkbox" class="form-check-input ep-cek" value="${x.employee_id}" ${att.exp.ids.has(x.employee_id) ? "checked" : ""}></td>
        <td>${attEsc(x.nik_karyawan)}</td><td>${attEsc(x.nama)}</td><td>${attEsc(attNama("cc", x.costcenter_id))}</td><td>${attEsc(attNama("area", x.area_id))}</td></tr>`).join("")
        : `<tr><td colspan="5" class="text-center text-muted py-3">Tidak ada karyawan.</td></tr>`;
    attEl("epCekHalaman").checked = att.ep.baris.length > 0 && att.ep.baris.every(x => att.exp.ids.has(x.employee_id));
    attEpJumlah();
}

function attEpBuka() {
    att.ep.page = 1;
    attEpBangunFilter();
    attGanti("modalExport", "modalPilihKaryawan");
    attEpMuat();
}

function attEpTutup() {
    attExpRingkas();
    attGanti("modalPilihKaryawan", "modalExport");
}

// Memilih SEMUA karyawan hasil filter (bukan hanya halaman ini), diambil per 1000 baris
async function attEpPilihSemua() {
    const tombol = attEl("btnEpSemua");
    tombol.disabled = true;
    try {
        let dari = 0;
        while (true) {
            let q = attDb().from("v_karyawan_laporan").select("employee_id, nik_karyawan, nama, costcenter_id, area_id")
                .order("nama").order("employee_id").range(dari, dari + 999);
            q = attTerapkanFilter(q, attEpFilter());
            const r = await q;
            if (r.error) throw r.error;
            (r.data || []).forEach(x => { att.exp.ids.add(x.employee_id); att.exp.info.set(x.employee_id, x); });
            if (!r.data || r.data.length < 1000) break;
            dari += 1000;
        }
        attEpGambar();
    } catch (err) {
        attToast("Gagal memilih semua: " + attPesanError(err), "danger");
    } finally {
        tombol.disabled = false;
    }
}

attEl("btnExpKaryawan").addEventListener("click", attEpBuka);
attEl("btnEpSelesai").addEventListener("click", attEpTutup);
attEl("btnEpTutupX").addEventListener("click", attEpTutup);
attEl("btnEpSemua").addEventListener("click", attEpPilihSemua);
attEl("btnEpKosong").addEventListener("click", () => { att.exp.ids.clear(); attEpGambar(); });
attEl("epPrev").addEventListener("click", () => { if (att.ep.page > 1) { att.ep.page--; attEpMuat(); } });
attEl("epNext").addEventListener("click", () => { att.ep.page++; attEpMuat(); });
attEl("epFilterBtn").addEventListener("click", () => attEl("epFilterPanel").classList.toggle("d-none"));
attEl("epFilterPanel").addEventListener("click", (e) => {
    const head = e.target.closest(".att-fg-head");
    if (head) { head.classList.toggle("expanded"); attEl(head.dataset.target).classList.toggle("expanded"); }
});
ATT_EP_GRUP.slice(0, 3).forEach((g, level) => attEl(g.el).addEventListener("change", () => attCascade(level, ATT_EP_GRUP)));
attEl("epFApply").addEventListener("click", attEpTerapkan);
attEl("epFReset").addEventListener("click", attEpResetFilter);
let attEpTunda = null;
attEl("epCari").addEventListener("input", () => { clearTimeout(attEpTunda); attEpTunda = setTimeout(() => { att.ep.page = 1; attEpMuat(); }, 350); });
attEl("epBody").addEventListener("change", (e) => {
    if (!e.target.classList.contains("ep-cek")) return;
    if (e.target.checked) att.exp.ids.add(e.target.value); else att.exp.ids.delete(e.target.value);
    attEl("epCekHalaman").checked = att.ep.baris.every(x => att.exp.ids.has(x.employee_id));
    attEpJumlah();
});
attEl("epCekHalaman").addEventListener("change", (e) => {
    att.ep.baris.forEach(x => { if (e.target.checked) att.exp.ids.add(x.employee_id); else att.exp.ids.delete(x.employee_id); });
    attEpGambar();
});

// ----- tahap 3: unduh -----
// Setelah file terunduh: semua pilihan (karyawan, tanggal, filter, pencarian) dihapus dan modal ditutup.
function attExpReset() {
    att.exp.ids.clear(); att.exp.info.clear();
    att.exp.dari = null; att.exp.sampai = null;
    att.ep.filter = { branch: [], cc: [], area: [], dept: [] };
    att.ep.page = 1; att.ep.baris = [];
    attEl("epCari").value = "";
    attEpBadge();
    attEl("expPesan").textContent = "";
    attEl("expProgres").classList.add("d-none");
    attExpRingkas();
}

function attMuatXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, gagal) => {
        const s = document.createElement("script");
        s.src = ATT_XLSX_JS; s.onload = ok; s.onerror = () => gagal(new Error("Library Excel gagal dimuat."));
        document.head.appendChild(s);
    });
}

function attUnduhBlob(blob, nama) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nama;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function attBuatCsv(aoa) {
    const sel = (v) => { const t = String(v == null ? "" : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return "\uFEFF" + aoa.map(b => b.map(sel).join(",")).join("\r\n");
}

async function attExpUnduh() {
    const tombol = attEl("btnExpUnduh"), pesan = attEl("expPesan"), bar = attEl("expProgresBar");
    const ids = Array.from(att.exp.ids);
    if (!ids.length || !att.exp.dari) return;
    tombol.disabled = true;
    attEl("expProgres").classList.remove("d-none");
    bar.style.width = "0%";
    pesan.className = "small mt-2";
    try {
        const semua = [];
        for (let i = 0; i < ids.length; i += ATT_CHUNK_EXPORT) {
            pesan.textContent = `Mengambil data ${Math.min(i + ATT_CHUNK_EXPORT, ids.length)} dari ${ids.length} karyawan...`;
            const r = await attDb().rpc("laporan_absensi", { p_dari: att.exp.dari, p_sampai: att.exp.sampai || att.exp.dari, p_employee_ids: ids.slice(i, i + ATT_CHUNK_EXPORT) });
            if (r.error) throw r.error;
            semua.push(...(r.data || []));
            bar.style.width = Math.round(Math.min(i + ATT_CHUNK_EXPORT, ids.length) / ids.length * 100) + "%";
        }
        if (!semua.length) { pesan.className = "small mt-2 text-warning"; pesan.textContent = "Tidak ada data jadwal atau absensi pada periode dan karyawan yang dipilih."; return; }
        semua.sort((a, b) => String(a.nama).localeCompare(String(b.nama), "id") || String(a.employee_id).localeCompare(String(b.employee_id)) || (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
        const aoa = [ATT_HEADER_EXPORT].concat(semua.map(attBarisExport));
        const nama = `Attendance_${att.exp.dari}_sd_${att.exp.sampai || att.exp.dari}`;
        try {
            await attMuatXlsx();
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws["!cols"] = ATT_HEADER_EXPORT.map(h => ({ wch: Math.max(12, h.length + 2) }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Attendance");
            XLSX.writeFile(wb, nama + ".xlsx");
            attToast(`Selesai: ${semua.length} baris diunduh (${nama}.xlsx).`);
            attExpReset();
            attModal("modalExport").hide();
        } catch (e) {
            attUnduhBlob(new Blob([attBuatCsv(aoa)], { type: "text/csv;charset=utf-8" }), nama + ".csv");
            attToast(`Library Excel tidak tersedia, file diunduh sebagai CSV: ${semua.length} baris (${nama}.csv).`, "warning");
            attExpReset();
            attModal("modalExport").hide();
        }
    } catch (err) {
        console.error("Gagal export:", err);
        pesan.className = "small mt-2 text-danger";
        pesan.textContent = "Gagal export: " + attPesanError(err);
    } finally {
        attExpRingkas();      // tombol Download aktif lagi hanya bila karyawan dan tanggal masih terpilih
    }
}
attEl("btnExpUnduh").addEventListener("click", attExpUnduh);