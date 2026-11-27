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
// ATT_BARIS_PER_HALAMAN : jumlah BARIS per halaman tabel; ATT_CHUNK_LAPORAN : karyawan per permintaan data
// ATT_CHUNK_EXPORT      : jumlah karyawan per permintaan saat export (agar tidak kena batas waktu)
// ATT_MAKS_HARI         : batas rentang tanggal (hari, termasuk kedua ujung)
// ATT_ROLE_BOLEH_UBAH   : role yang boleh memakai tombol Edit (sama dengan Time Settings)
// ATT_WARNA_DEVICE_JIKA : baris berwarna biru bila device_berbeda sama dengan nilai ini.
//                         true  = baris biru bila device_berbeda = true (device BERBEDA).
//                         false = kebalikannya (menandai device yang SAMA).
// ===================================================
const ATT_BARIS_PER_HALAMAN = 25;   // baris per halaman tabel
const ATT_CHUNK_LAPORAN = 40;       // jumlah karyawan per permintaan laporan_absensi (kecilkan bila sering timeout)
const ATT_PARALEL = 3;              // jumlah permintaan yang dijalankan bersamaan
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
    semua: [],     // SELURUH baris laporan hasil filter (sudah diberi tanda dan diurutkan)
    flag: null,    // kotak informasi yang sedang dipilih sebagai filter (invalid/cuti/suspect/telat/cepat/lupa)
    baris: [],     // baris pada halaman yang sedang tampil
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
// KELOMPOK 6: TABEL LAPORAN + PANEL INFORMASI
// Alur: (1) minta daftar id karyawan yang punya penempatan pada rentang tanggal (sesuai filter),
// (2) minta laporan absensi per potongan karyawan, (3) filter ulang per baris, beri tanda, urutkan
// Cabang -> Cost Center -> Nama -> Tanggal, (4) hitung panel informasi, (5) gambar halaman tabel.
// Pindah halaman, klik kotak informasi, dan Atur Kolom TIDAK memuat ulang dari server.
// ===================================================
function attFilterUtama() {
    return {
        branch: att.filter.branch, cc: att.filter.cc, dept: att.filter.dept, area: att.filter.area,
        q: attBersihkanKata(attEl("attCari").value)
    };
}

function attGambarTanggal() { attEl("attTanggalTeks").textContent = attRentangTeks(att.dari, att.sampai); }

// Panel informasi. uji(r) = apakah baris termasuk kategori. Klik = tabel hanya menampilkan baris itu.
const ATT_INFO = [
    { id: "invalid", label: "Absensi Tidak Valid", ikon: "fa-location-crosshairs", warna: "#ea580c", uji: r => r._invalid },
    { id: "cuti", label: "Tidak Masuk (Time Off)", ikon: "fa-calendar-minus", warna: "#7c3aed", uji: r => r._cuti },
    { id: "suspect", label: "Suspect Absensi", ikon: "fa-mobile-screen", warna: "#0d6efd", uji: r => r._suspect },
    { id: "telat", label: "Terlambat", ikon: "fa-clock", warna: "#dc2626", uji: r => r._telat },
    { id: "cepat", label: "Pulang Cepat", ikon: "fa-door-open", warna: "#dc2626", uji: r => r._cepat },
    { id: "lupa", label: "Lupa Absen", ikon: "fa-circle-question", warna: "#64748b", uji: r => r._lupa }
];

// ---------------------------------------------------
// PEMUATAN BERTAHAP. Server mengurutkan karyawan (status, cost center, nama). Tabel hanya memuat laporan
// untuk potongan karyawan (ATT_CHUNK_LAPORAN) sampai halaman yang sedang dilihat terisi. Halaman berikutnya
// dimuat saat tombol Berikutnya ditekan. Karena karyawan tanpa jadwal/absen pada tanggal itu tidak
// menghasilkan baris, halaman dibentuk dari baris yang terkumpul (bukan dari jumlah karyawan).
// ATT_HITUNG_OTOMATIS = true : sisa karyawan dimuat pelan-pelan di latar belakang agar angka panel informasi
//                              lengkap. false = lebih ringan; angka hanya menghitung data yang sudah dimuat (tanda +).
// ---------------------------------------------------
const ATT_HITUNG_OTOMATIS = true;
const ATT_JEDA_LATAR = 300;          // jeda (ms) antar potongan di latar belakang

// Memberi tanda pada satu baris (dipakai panel informasi dan warna baris)
function attBeriTanda(r) {
    r._status = att.status.get(r.employee_id) || null;
    r._telat = attLateMenit(r) != null;
    r._cepat = r.early_menit != null && r.early_menit > 0;
    r._invalid = r.lokasi_tidak_valid === true;
    r._cuti = !!r.kode_time_off;
    r._suspect = r.device_berbeda === true;
    r._lupa = r.kode_absen === "nci" || r.kode_absen === "nco";
    r._cabang = attNama("branch", r.branch_id) || "-";
    r._cc = attNama("cc", r.costcenter_id) || "-";
    return r;
}

function attLolosFilter(r, f) {
    return (!f.branch.length || f.branch.includes(Number(r.branch_id)))
        && (!f.cc.length || f.cc.includes(Number(r.costcenter_id)))
        && (!f.area.length || f.area.includes(Number(r.area_id)))
        && (!f.dept.length || f.dept.includes(Number(r.departemen_id)));
}

// Panel informasi: dibuat sekali, setelah itu hanya angkanya yang diperbarui (tombol tidak digambar ulang)
function attRenderInfo() {
    const grid = attEl("attInfoGrid");
    if (grid.children.length !== ATT_INFO.length) {
        grid.innerHTML = ATT_INFO.map(x => `<button type="button" class="att-info-box" data-flag="${x.id}" title="Klik untuk menampilkan hanya data ini">
            <span class="att-info-ikon" style="background:${x.warna}1a;color:${x.warna};"><i class="fa-solid ${x.ikon}"></i></span>
            <span><span class="att-info-angka">-</span><br><span class="att-info-label">${attEsc(x.label)}</span></span></button>`).join("");
    }
    const ada = att.semua.length > 0 || att.selesai;
    ATT_INFO.forEach((x, n) => {
        const kotak = grid.children[n];
        kotak.classList.toggle("aktif", att.flag === x.id);
        kotak.querySelector(".att-info-angka").textContent = ada ? att.semua.filter(x.uji).length + (att.selesai ? "" : "+") : "-";
    });
}

// Jumlah baris yang cocok dengan kotak informasi yang dipilih (atau semua baris bila tidak ada yang dipilih)
function attJumlahTerpilih() {
    const kat = att.flag ? ATT_INFO.find(x => x.id === att.flag) : null;
    return kat ? att.semua.filter(kat.uji).length : att.semua.length;
}

// Memuat SATU potongan karyawan berikutnya. Hanya satu potongan berjalan pada satu waktu.
async function attMuatPotongan(token) {
    while (att.sedangMuat) await att.sedangMuat;
    if (token !== att.token || att.selesai) return;
    const ids = att.urut.slice(att.sudah, att.sudah + ATT_CHUNK_LAPORAN);
    const kerja = (async () => {
        const r = await attDb().rpc("laporan_absensi", { p_dari: att.periode.dari, p_sampai: att.periode.sampai, p_employee_ids: ids });
        if (r.error) throw r.error;
        return r.data || [];
    })();
    att.sedangMuat = kerja.catch(() => {});
    let rows;
    try { rows = await kerja; } finally { att.sedangMuat = null; }
    if (token !== att.token) return;
    const baru = rows.filter(r => attLolosFilter(r, att.fm)).map(attBeriTanda);
    baru.sort((a, b) => (att.indeks.get(a.employee_id) - att.indeks.get(b.employee_id)) || (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
    att.semua.push(...baru);
    att.sudah += ids.length;
    if (att.sudah >= att.urut.length) att.selesai = true;
}

// Memuat potongan demi potongan sampai terkumpul sedikitnya `target` baris (atau semua karyawan sudah dimuat)
async function attIsiSampai(token, target) {
    while (token === att.token && !att.selesai && attJumlahTerpilih() < target) await attMuatPotongan(token);
}

// Memuat sisa karyawan di latar belakang (angka panel informasi menjadi lengkap)
async function attLanjutLatar(token) {
    if (att.latar) return;
    att.latar = true;
    try {
        while (token === att.token && !att.selesai) {
            await attMuatPotongan(token);
            if (token !== att.token) return;
            attRenderInfo(); attPerbaruiFooter();
            await new Promise(ok => setTimeout(ok, ATT_JEDA_LATAR));
        }
    } catch (err) {
        console.warn("Pemuatan latar belakang berhenti:", err);
        if (token === att.token) { att.galat = attPesanError(err); attPerbaruiFooter(); }
    } finally {
        if (token === att.token) att.latar = false;
    }
}

async function attMuat() {
    const token = ++att.token;
    Object.assign(att, { semua: [], baris: [], urut: [], indeks: new Map(), status: new Map(), sudah: 0, selesai: false, sedangMuat: null, latar: false, galat: null, page: 1 });
    att.periode = { dari: att.dari, sampai: att.sampai };
    att.fm = attFilterUtama();
    attRenderInfo();
    attEl("attBody").innerHTML = `<tr><td colspan="30" class="text-center text-muted py-4">Memuat data...</td></tr>`;
    attEl("attInfo").textContent = "";
    attEl("attPrev").disabled = true; attEl("attNext").disabled = true;
    try {
        const f = att.fm;
        const k = await attDb().rpc("karyawan_laporan_urut", {
            p_dari: att.periode.dari, p_sampai: att.periode.sampai, p_branch: f.branch, p_cc: f.cc, p_area: f.area, p_dept: f.dept, p_cari: f.q
        });
        if (k.error) throw k.error;
        if (token !== att.token) return;
        const daftar = k.data || [];
        att.urut = daftar.map(x => x.id);
        att.indeks = new Map(att.urut.map((id, n) => [id, n]));
        daftar.forEach(x => att.status.set(x.id, x.status));
        if (!att.urut.length) att.selesai = true;
        await attIsiSampai(token, ATT_BARIS_PER_HALAMAN);
        if (token !== att.token) return;
        attTampilkan();
        if (ATT_HITUNG_OTOMATIS && !att.selesai) attLanjutLatar(token);
    } catch (err) {
        if (token !== att.token) return;
        console.error("Gagal memuat laporan:", err);
        attEl("attBody").innerHTML = `<tr><td colspan="30" class="text-center text-danger py-4">Gagal memuat data: ${attEsc(attPesanError(err))}. Pastikan time_modul1o dan time_modul1r sudah dijalankan.</td></tr>`;
    }
}

// Pindah ke halaman n: memuat potongan tambahan bila baris yang terkumpul belum cukup
async function attKeHalaman(n) {
    const token = att.token;
    att.page = n;
    attEl("attInfo").textContent = "Memuat halaman...";
    attEl("attPrev").disabled = true; attEl("attNext").disabled = true;
    try {
        await attIsiSampai(token, n * ATT_BARIS_PER_HALAMAN);
    } catch (err) {
        console.error("Gagal memuat halaman:", err);
        attToast("Gagal memuat halaman: " + attPesanError(err), "danger");
    }
    if (token !== att.token) return;
    attTampilkan();
}

// Menggambar halaman saat ini dari data yang sudah dimuat (tanpa memanggil server)
function attTampilkan() {
    const kat = att.flag ? ATT_INFO.find(x => x.id === att.flag) : null;
    const terpilih = kat ? att.semua.filter(kat.uji) : att.semua;
    const maks = Math.max(1, Math.ceil(terpilih.length / ATT_BARIS_PER_HALAMAN));
    if (att.page > maks) att.page = maks;
    const dari = (att.page - 1) * ATT_BARIS_PER_HALAMAN;
    att.baris = terpilih.slice(dari, dari + ATT_BARIS_PER_HALAMAN);
    att.total = terpilih.length;
    attRenderInfo();
    attRender();
    attPerbaruiFooter();
}

function attPerbaruiFooter() {
    const kat = att.flag ? ATT_INFO.find(x => x.id === att.flag) : null;
    const total = attJumlahTerpilih();
    const dari = (att.page - 1) * ATT_BARIS_PER_HALAMAN;
    let teks = att.baris.length === 0 ? (att.selesai ? "Tidak ada data" : "Memuat...")
        : `Baris ${dari + 1}-${dari + att.baris.length}` + (att.selesai ? ` dari ${total}` : ` | ${total}+ baris dimuat`);
    teks += att.selesai ? ` | ${att.urut.length} karyawan` : ` | ${att.sudah} dari ${att.urut.length} karyawan diperiksa`;
    if (kat) teks += ` | kategori: ${kat.label}`;
    if (att.galat) teks += ` | pemuatan berhenti: ${att.galat}`;
    attEl("attInfo").textContent = teks;
    attEl("attPrev").disabled = att.page <= 1;
    attEl("attNext").disabled = att.selesai && dari + ATT_BARIS_PER_HALAMAN >= total;
}

function attRender() {
    const kolom = ATT_KOLOM.filter(k => att.kolom.has(k.id));
    attEl("attHead").innerHTML = `<tr><th class="att-kiri">Nama<br><span class="att-nik">NIK | Jabatan</span></th>` +
        kolom.map(k => `<th>${attEsc(k.label)}</th>`).join("") + `<th class="att-kanan">Aksi</th></tr>`;

    if (att.baris.length === 0) {
        attEl("attBody").innerHTML = `<tr><td colspan="${kolom.length + 2}" class="text-center text-muted py-4">${!att.selesai ? "Mencari data..." : att.flag ? "Tidak ada data pada kategori ini untuk periode dan filter yang dipilih." : "Tidak ada karyawan aktif atau data jadwal/absensi pada periode dan filter yang dipilih."}</td></tr>`;
        return;
    }
    attEl("attBody").innerHTML = att.baris.map((r, i) => {
        const kelas = [];
        if (r._invalid) kelas.push("att-row-invalid");
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
function attBukaKalender({ judul, dari, sampai, onTerapkan, kembaliKe, satu }) {
    const k = att.cal;
    k.dari = dari || null;
    k.sampai = sampai || dari || null;
    k.tahap = "awal";
    k.onTerapkan = onTerapkan;
    k.kembaliKe = kembaliKe || null;
    k.satu = !!satu;     // true = pilih SATU tanggal: begitu diklik langsung diterapkan dan kalender menutup (tanpa tombol Terapkan)
    attEl("btnKalTerapkan").classList.toggle("d-none", k.satu);
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
    attEl("kalRingkas").textContent = !k.dari ? (k.satu ? "Pilih satu tanggal" : "Belum ada tanggal dipilih")
        : (k.satu ? attTgl(k.dari) : `${attRentangTeks(k.dari, k.sampai)} (${n} hari)`);
    attEl("btnKalTerapkan").disabled = !k.dari;
}

// Menerapkan tanggal yang dipilih di kalender lalu menutupnya
function attKalTerapkan() {
    const k = att.cal;
    if (!k.dari) return;
    if (typeof k.onTerapkan === "function") k.onTerapkan(k.dari, k.sampai || k.dari);
    attModal("modalKalender").hide();
}

function attKalPilih(iso) {
    const k = att.cal;
    attEl("kalPesan").textContent = "";
    if (k.satu) {        // mode satu tanggal: klik = langsung jalan
        k.dari = iso; k.sampai = iso; k.tahap = "awal";
        attKalRender();
        attKalTerapkan();
        return;
    }
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
            judul: "Pilih Tanggal", dari: att.dari, sampai: att.dari, satu: true,
            onTerapkan: (dari) => { att.dari = dari; att.sampai = dari; att.page = 1; attGambarTanggal(); attMuat(); }
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
        if (att.cal.satu) attKalTerapkan();      // mode satu tanggal: "Hari Ini" langsung diterapkan
    });
    attEl("btnKalTerapkan").addEventListener("click", attKalTerapkan);
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
    attEl("attPrev").addEventListener("click", () => { if (att.page > 1) { att.page--; attTampilkan(); } });   // halaman sebelumnya sudah ada di memori
    attEl("attNext").addEventListener("click", () => attKeHalaman(att.page + 1));                            // halaman berikutnya dimuat bila perlu

    // Kotak informasi: klik = tampilkan hanya data kategori itu; klik lagi = tampilkan semua
    attEl("attInfoGrid").addEventListener("click", (e) => {
        const kotak = e.target.closest("[data-flag]");
        if (!kotak) return;
        att.flag = att.flag === kotak.dataset.flag ? null : kotak.dataset.flag;
        attKeHalaman(1);
    });

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
        ["Departemen", attNama("dept", r.departemen_id)], ["Area", attNama("area", r.area_id)], ["Status Karyawan", r._status],
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
    attIsiRiwayatKoreksi(r);
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

// Riwayat koreksi jadwal, time off, dan lembur pada tanggal itu (tabel kedua di modal History Log)
function attStatusKoreksi(x) {
    const s = String(x.status || "").toLowerCase();
    if (s === "approved" || s === "disetujui") return x.is_active ? "Berlaku" : "Diganti";
    if (s === "pending" || s === "diajukan" || s === "koreksi") return "Menunggu";
    if (s === "rejected" || s === "ditolak") return "Ditolak";
    if (s === "dibatalkan") return "Dibatalkan";
    return x.status || "-";
}

async function attIsiRiwayatKoreksi(r) {
    attEl("logBody2").innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">Memuat...</td></tr>`;
    attEl("logJumlah2").textContent = "";
    try {
        const q = await attDb().rpc("riwayat_koreksi", { p_employee_id: r.employee_id, p_tanggal: r.tanggal });
        if (q.error) throw q.error;
        const data = q.data || [];
        attEl("logJumlah2").textContent = `(${data.length})`;
        attEl("logBody2").innerHTML = data.length ? data.map(x => {
            const st = attStatusKoreksi(x);
            const redup = st === "Berlaku" || st === "Menunggu" ? "" : "text-muted";
            const setuju = x.disetujui_nama ? `${attEsc(x.disetujui_nama)}${x.disetujui_pada ? `<br><span class="text-muted">${attEsc(attWaktuLokal(x.disetujui_pada, r.zona_waktu))}</span>` : ""}` : "";
            return `<tr class="${redup}"><td>${x.id}</td><td>${attEsc(x.jenis)}</td><td>${attEsc(x.ringkas)}</td><td>${attEsc(x.source)}</td><td>${attEsc(st)}</td>
                <td>${attEsc(x.keterangan)}</td><td>${attEsc(x.petugas)}</td><td>${setuju}</td><td>${attEsc(attWaktuLokal(x.dicatat, r.zona_waktu))}</td></tr>`;
        }).join("") : `<tr><td colspan="9" class="text-center text-muted py-3">Belum ada koreksi jadwal, time off, atau lembur pada tanggal ini.</td></tr>`;
    } catch (err) {
        console.error("Gagal memuat riwayat koreksi:", err);
        attEl("logBody2").innerHTML = `<tr><td colspan="9" class="text-center text-danger py-3">Gagal memuat: ${attEsc(attPesanError(err))}. Pastikan time_modul1p_koreksi_laporan.sql sudah dijalankan.</td></tr>`;
    }
}

// ===================================================
// KELOMPOK 13: MODAL EDIT / KOREKSI (Jadwal, Time Off, Absensi, Overtime)
// Alur: (1) modal dibuka, data yang SUDAH ada dipanggil dulu (koreksi_data_awal, daftar shift, daftar time off),
// (2) admin mengubah bagian yang perlu, (3) Simpan mengirim HANYA bagian yang berubah ke
// hrd.koreksi_laporan_admin dalam satu transaksi. Satu kolom Keterangan dipakai untuk semua bagian.
// Disetujui otomatis; data lama dinonaktifkan (tidak dihapus) dan tampil di View History Log.
// Role 1 dan 2: semua bagian. Role lain (mis. 3): hanya bagian Absensi.
// ===================================================
const ATT_ROLE_KOREKSI_PENUH = [1, 2];
const ATT_OT_MAKS_MENIT = 12 * 60;      // durasi lembur maksimum (sama dengan halaman Lembur)
const ATT_BREAK_MAKS_MENIT = 3 * 60;    // durasi istirahat maksimum

const attEd = { r: null, awal: null, penuh: false, shiftAwal: "", toAwal: "", masukAwal: "", pulangAwal: "", otAwal: null, pengganti: null, menyimpan: false, ccStruct: [] };

function attGeserTgl(s, n) { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function attMenit(hhmm) { const [h, m] = String(hhmm || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function attJam5(v) { return v ? String(v).slice(0, 5) : "00:00"; }

function attUntukInput(iso, tz) {
    const t = attWaktuLokal(iso, tz);          // "YYYY-MM-DD HH:MM:SS"
    return t ? t.replace(" ", "T").slice(0, 16) : "";
}

function attEdPesan(teks) {
    const m = attEl("editMsg");
    m.textContent = teks || "";
    m.classList.toggle("d-none", !teks);
}

// ----- Jadwal -----
function attIsiJadwal(res) {
    const awal = attEd.awal, sel = attEl("fEditShift"), info = attEl("editInfoJadwal");
    const cur = (awal.jadwal && awal.jadwal.kode_shift) || "";
    attEd.shiftAwal = cur;
    if (res.error) { sel.innerHTML = `<option value="">Gagal memuat daftar shift</option>`; sel.disabled = true; info.textContent = attPesanError(res.error); return; }
    const list = res.data || [];
    const opsi = list.map(s => `<option value="${attEsc(s.kode)}">${attEsc(s.kode)} - ${attEsc(s.nama)} (${attEsc(s.jam_masuk || "-")} - ${attEsc(s.jam_pulang || "-")})</option>`);
    if (cur && !list.some(s => s.kode === cur)) opsi.unshift(`<option value="${attEsc(cur)}">${attEsc(cur)} (shift saat ini)</option>`);
    sel.innerHTML = (cur ? "" : `<option value="">- Belum ada jadwal -</option>`) + opsi.join("");
    sel.value = cur;
    sel.disabled = !!(awal.pending && awal.pending.jadwal);
    info.textContent = awal.pending && awal.pending.jadwal
        ? "Ada pengajuan perubahan shift yang menunggu persetujuan. Selesaikan atau tolak dulu."
        : (awal.jadwal ? `Shift saat ini: ${awal.jadwal.kode_shift} (sumber: ${awal.jadwal.sumber}).` : "Belum ada jadwal pada tanggal ini.");
}

// ----- Time Off -----
function attIsiTimeOff(res) {
    const awal = attEd.awal, sel = attEl("fEditTimeOff"), info = attEl("editInfoTimeOff");
    const ada = awal.time_off;
    attEd.toAwal = ada ? String(ada.time_off_id) : "";
    if (res.error) {
        sel.innerHTML = `<option value="">${ada ? attEsc(ada.nama) : "-"}</option>`; sel.disabled = true;
        info.textContent = "Daftar time off tidak dapat dimuat: " + attPesanError(res.error);
        return;
    }
    const list = res.data || [];
    const opsi = list.map(m => `<option value="${m.id}">${attEsc(m.nama)}</option>`);
    if (ada && !list.some(m => String(m.id) === attEd.toAwal)) opsi.unshift(`<option value="${ada.time_off_id}">${attEsc(ada.nama)}</option>`);
    sel.innerHTML = `<option value="">- Tidak ada time off -</option>` + opsi.join("");
    sel.value = attEd.toAwal;
    const banyakHari = ada && ada.start_date !== ada.end_date;
    const menunggu = !!(awal.pending && awal.pending.time_off);
    sel.disabled = banyakHari || menunggu;
    info.textContent = menunggu ? "Ada pengajuan time off yang menunggu persetujuan. Selesaikan atau tolak dulu."
        : banyakHari ? `Time off ini berlaku ${attTgl(ada.start_date)} s/d ${attTgl(ada.end_date)}. Ubah lewat halaman Cuti.`
        : (ada ? `Time off saat ini: ${ada.nama}. Pilih "Tidak ada" untuk menghapusnya.` : "Belum ada time off pada tanggal ini.");
}

// ----- Overtime -----
function attIsiLembur() {
    const o = attEd.awal.lembur;
    attEd.otAwal = o;
    attEd.pengganti = o && o.type_ot === "Pengganti" && o.karyawan_absen_id ? { id: o.karyawan_absen_id, nama: o.karyawan_absen_nama, nik: o.karyawan_absen_nik } : null;
    attEl("fEditJenisOt").value = (o && o.type_ot) || "Overtime";
    attEl("fEditObOt").value = attJam5(o && o.ot_before); attEl("fEditObBrk").value = attJam5(o && o.break_before);
    attEl("fEditOaOt").value = attJam5(o && o.ot_after);  attEl("fEditOaBrk").value = attJam5(o && o.break_after);
    attRenderTipeExtra();
    const menunggu = !!(attEd.awal.pending && attEd.awal.pending.lembur);
    ["fEditJenisOt", "fEditObOt", "fEditObBrk", "fEditOaOt", "fEditOaBrk"].forEach(id => { attEl(id).disabled = menunggu; });
    attEl("editTipeExtra").querySelectorAll("input,select").forEach(x => { x.disabled = menunggu; });
    attEl("editInfoLembur").textContent = menunggu ? "Ada pengajuan lembur yang menunggu persetujuan. Selesaikan atau tolak dulu."
        : (o ? `Lembur saat ini: ${o.type_ot || "Overtime"}. Perubahan akan membuat lembur baru dan menonaktifkan yang lama.` : "Belum ada lembur pada tanggal ini.");
}

// Isian tambahan sesuai Jenis Lembur (aturan sama dengan Lembur oleh admin)
function attRenderTipeExtra() {
    const tipe = attEl("fEditJenisOt").value, box = attEl("editTipeExtra"), r = attEd.r, o = attEd.otAwal;
    if (tipe === "Pengganti") {
        box.innerHTML = `<div class="mb-2"><label class="ts-label">Menggantikan <span class="text-danger">*</span></label>
            <div class="att-combo"><input type="text" id="fEditGanti" class="form-control form-control-sm" autocomplete="off" placeholder="Ketik nama atau NIK..."><div class="att-combo-list d-none" id="fEditGantiList"></div></div>
            <div class="form-text">Karyawan PKWT/PKWTT yang aktif pada tanggal kerja (semua departemen dan cost center).</div></div>`;
        const input = attEl("fEditGanti"), list = attEl("fEditGantiList");
        if (attEd.pengganti) input.value = `${attEd.pengganti.nama} (${attEd.pengganti.nik})`;
        let tunda = null, req = 0;
        const cari = () => {
            clearTimeout(tunda);
            tunda = setTimeout(async () => {
                const my = ++req;
                list.classList.remove("d-none");
                list.innerHTML = `<div class="att-combo-kosong">Mencari...</div>`;
                const res = await attDb().rpc("overtime_cari_karyawan", { p: { tanggal: r.tanggal, q: input.value, exclude_id: r.employee_id } });
                if (my !== req) return;
                if (res.error) { list.innerHTML = `<div class="att-combo-kosong">${attEsc(attPesanError(res.error))}</div>`; return; }
                const data = res.data || [];
                list.innerHTML = data.length ? data.map((k, n) => `<div class="att-combo-item" data-n="${n}"><div class="fw-semibold">${attEsc(k.nama)}</div><div class="text-muted">${attEsc(k.nik)} | ${attEsc(k.area || "-")}</div></div>`).join("")
                    : `<div class="att-combo-kosong">Tidak ada karyawan yang sesuai.</div>`;
                list._data = data;
            }, 250);
        };
        input.addEventListener("focus", cari);
        input.addEventListener("input", () => { attEd.pengganti = null; cari(); });          // mengetik ulang = batalkan pilihan
        list.addEventListener("mousedown", (e) => {
            const it = e.target.closest(".att-combo-item");
            if (!it || !list._data) return;
            const k = list._data[Number(it.dataset.n)];
            attEd.pengganti = { id: k.id, nama: k.nama, nik: k.nik };
            input.value = `${k.nama} (${k.nik})`;
            list.classList.add("d-none");
        });
        input.addEventListener("blur", () => setTimeout(() => list.classList.add("d-none"), 150));
    } else if (tipe === "Casual") {
        const mitra = att.master.cc.filter(c => Number(c.branch_id) === Number(r.branch_id));     // Mitra harus satu cabang dengan karyawan
        box.innerHTML = `<div class="mb-2"><label class="ts-label" for="fEditMitra">Mitra <span class="text-danger">*</span></label>
                <select id="fEditMitra" class="form-select form-select-sm"><option value="">Pilih Mitra</option>${mitra.map(c => `<option value="${c.id}">${attEsc(c.nama)}</option>`).join("")}</select></div>
            <div class="row g-2 mb-2">
                <div class="col-6"><label class="ts-label" for="fEditArea">Area <span class="text-danger">*</span></label><select id="fEditArea" class="form-select form-select-sm" disabled><option value="">Pilih Mitra dulu</option></select></div>
                <div class="col-6"><label class="ts-label" for="fEditDept">Departemen <span class="text-danger">*</span></label><select id="fEditDept" class="form-select form-select-sm" disabled><option value="">Pilih Area dulu</option></select></div>
            </div>
            <div class="form-text mb-2">Area dan Departemen mengikuti struktur cost center Mitra yang dipilih.</div>`;
        const isiArea = (ccId, pilih) => {
            const struktur = att.struct.filter(s => String(s.cost_center_id) === String(ccId));
            const ids = new Set(struktur.map(s => String(s.area_id)));
            const areas = att.master.area.filter(a => ids.has(String(a.id)));
            attEl("fEditArea").innerHTML = areas.length ? `<option value="">Pilih Area</option>` + areas.map(a => `<option value="${a.id}">${attEsc(a.nama)}</option>`).join("") : `<option value="">Mitra ini belum punya struktur area</option>`;
            attEl("fEditArea").disabled = !areas.length;
            attEl("fEditDept").innerHTML = `<option value="">Pilih Area dulu</option>`; attEl("fEditDept").disabled = true;
            if (pilih) attEl("fEditArea").value = String(pilih);
        };
        const isiDept = (ccId, areaId, pilih) => {
            const ids = new Set(att.struct.filter(s => String(s.cost_center_id) === String(ccId) && String(s.area_id) === String(areaId)).map(s => String(s.dept_id)));
            const depts = att.master.dept.filter(d => ids.has(String(d.id)));
            attEl("fEditDept").innerHTML = depts.length ? `<option value="">Pilih Departemen</option>` + depts.map(d => `<option value="${d.id}">${attEsc(d.nama)}</option>`).join("") : `<option value="">Area ini belum punya departemen</option>`;
            attEl("fEditDept").disabled = !depts.length;
            if (pilih) attEl("fEditDept").value = String(pilih);
        };
        attEl("fEditMitra").addEventListener("change", () => { const v = attEl("fEditMitra").value; if (v) isiArea(v); else { attEl("fEditArea").innerHTML = `<option value="">Pilih Mitra dulu</option>`; attEl("fEditArea").disabled = true; attEl("fEditDept").innerHTML = `<option value="">Pilih Area dulu</option>`; attEl("fEditDept").disabled = true; } });
        attEl("fEditArea").addEventListener("change", () => { const v = attEl("fEditArea").value; if (v) isiDept(attEl("fEditMitra").value, v); else { attEl("fEditDept").innerHTML = `<option value="">Pilih Area dulu</option>`; attEl("fEditDept").disabled = true; } });
        if (o && o.type_ot === "Casual" && o.absen_costcenter_id) {
            attEl("fEditMitra").value = String(o.absen_costcenter_id);
            isiArea(o.absen_costcenter_id, o.absen_area_id);
            if (o.absen_area_id) isiDept(o.absen_costcenter_id, o.absen_area_id, o.absen_dept_id);
        }
    } else {
        box.innerHTML = "";
    }
}

// Mengumpulkan isian Overtime. Hasil null = tidak berubah. Melempar Error bila isian salah.
function attKumpulLembur() {
    const o = attEd.otAwal;
    const tipe = attEl("fEditJenisOt").value;
    const ob = attEl("fEditObOt").value || "00:00", bb = attEl("fEditObBrk").value || "00:00";
    const oa = attEl("fEditOaOt").value || "00:00", ba = attEl("fEditOaBrk").value || "00:00";
    const mitra = attEl("fEditMitra") ? attEl("fEditMitra").value : "", area = attEl("fEditArea") ? attEl("fEditArea").value : "", dept = attEl("fEditDept") ? attEl("fEditDept").value : "";
    const gantiId = attEd.pengganti ? attEd.pengganti.id : "";
    let berubah;
    if (!o) berubah = tipe !== "Overtime" || attMenit(ob) > 0 || attMenit(oa) > 0;
    else berubah = tipe !== (o.type_ot || "Overtime") || ob !== attJam5(o.ot_before) || bb !== attJam5(o.break_before) || oa !== attJam5(o.ot_after) || ba !== attJam5(o.break_after)
        || (tipe === "Pengganti" && String(gantiId) !== String(o.karyawan_absen_id || ""))
        || (tipe === "Casual" && (mitra !== String(o.absen_costcenter_id || "") || area !== String(o.absen_area_id || "") || dept !== String(o.absen_dept_id || "")));
    if (!berubah) return null;

    if (attMenit(ob) === 0 && attMenit(oa) === 0) throw new Error("Isi durasi lembur sebelum atau setelah shift.");
    if (attMenit(ob) > ATT_OT_MAKS_MENIT || attMenit(oa) > ATT_OT_MAKS_MENIT) throw new Error(`Durasi lembur maksimal ${ATT_OT_MAKS_MENIT / 60} jam.`);
    if (attMenit(bb) > ATT_BREAK_MAKS_MENIT || attMenit(ba) > ATT_BREAK_MAKS_MENIT) throw new Error(`Durasi istirahat maksimal ${ATT_BREAK_MAKS_MENIT / 60} jam.`);
    if (attMenit(ob) === 0 && attMenit(bb) > 0) throw new Error("Istirahat sebelum shift tidak boleh diisi tanpa durasi lembur.");
    if (attMenit(oa) === 0 && attMenit(ba) > 0) throw new Error("Istirahat setelah shift tidak boleh diisi tanpa durasi lembur.");
    if (attMenit(bb) > 0 && attMenit(bb) >= attMenit(ob)) throw new Error("Istirahat sebelum shift harus lebih kecil dari durasi lembur.");
    if (attMenit(ba) > 0 && attMenit(ba) >= attMenit(oa)) throw new Error("Istirahat setelah shift harus lebih kecil dari durasi lembur.");
    const payload = { type_ot: tipe, ot_before: ob, break_before: bb, ot_after: oa, break_after: ba };
    if (tipe === "Pengganti") {
        if (!gantiId) throw new Error("Pilih karyawan yang digantikan dari daftar.");
        payload.karyawan_absen_id = gantiId;
    } else if (tipe === "Casual") {
        if (!mitra) throw new Error("Pilih Mitra.");
        if (!area) throw new Error("Pilih Area.");
        if (!dept) throw new Error("Pilih Departemen.");
        payload.absen_costcenter_id = Number(mitra); payload.absen_area_id = Number(area); payload.absen_dept_id = Number(dept);
    }
    return payload;
}

async function attBukaEdit(i) {
    const r = att.baris[i];
    if (!r || !att.canEdit) return;
    attEd.r = r; attEd.awal = null; attEd.pengganti = null; attEd.otAwal = null;
    attEd.penuh = ATT_ROLE_KOREKSI_PENUH.includes(Number(att.session && att.session.roleId));
    attEl("editKaryawan").textContent = `${r.nama} (${r.nik_karyawan})`;
    attEl("editTanggal").textContent = `Tanggal kerja: ${attTgl(r.tanggal)}`;
    attEl("editJadwal").textContent = r.kode_shift ? `Shift ${r.kode_shift} | ${r.jadwal_masuk || "-"} - ${r.jadwal_pulang || "-"}` : "Tidak ada jadwal";
    attEdPesan("");
    attEl("fEditAlasan").value = "";
    ["editSecJadwal", "editSecTimeOff", "editSecLembur"].forEach(id => attEl(id).classList.toggle("d-none", !attEd.penuh));
    // Absensi: tanggal dikunci. Clock In = kemarin atau tanggal kerja. Clock Out = tanggal kerja atau besok.
    attEd.masukAwal = attUntukInput(r.waktu_masuk, r.zona_waktu);
    attEd.pulangAwal = attUntukInput(r.waktu_keluar, r.zona_waktu);
    attEl("fEditMasuk").min = `${attGeserTgl(r.tanggal, -1)}T00:00`; attEl("fEditMasuk").max = `${r.tanggal}T23:59`;
    attEl("fEditPulang").min = `${r.tanggal}T00:00`; attEl("fEditPulang").max = `${attGeserTgl(r.tanggal, 1)}T23:59`;
    attEl("fEditMasuk").value = attEd.masukAwal; attEl("fEditPulang").value = attEd.pulangAwal;
    attEl("editMemuat").classList.remove("d-none");
    attEl("btnSimpanEdit").disabled = true;
    attModal("modalEdit").show();
    try {
        const [awal, shifts, jenis] = await Promise.all([
            attDb().rpc("koreksi_data_awal", { p_employee_id: r.employee_id, p_tanggal: r.tanggal }),
            attEd.penuh ? attDb().rpc("pengajuan_daftar_shift") : Promise.resolve(null),
            attEd.penuh ? attDb().rpc("cuti_jenis", { p_emp: r.employee_id, p_mulai: r.tanggal, p_akhir: r.tanggal }) : Promise.resolve(null)
        ]);
        if (attEd.r !== r) return;
        if (awal.error) throw awal.error;
        attEd.awal = awal.data || { pending: {} };
        if (!attEd.awal.pending) attEd.awal.pending = {};
        if (attEd.penuh) { attIsiJadwal(shifts); attIsiTimeOff(jenis); attIsiLembur(); }
        attEl("btnSimpanEdit").disabled = false;
    } catch (err) {
        console.error("Gagal memuat data koreksi:", err);
        attEdPesan("Gagal memuat data yang sudah ada: " + attPesanError(err) + ". Pastikan time_modul1p_koreksi_laporan.sql sudah dijalankan.");
    } finally {
        attEl("editMemuat").classList.add("d-none");
    }
}

attEl("fEditJenisOt").addEventListener("change", () => { attEd.pengganti = null; attRenderTipeExtra(); });

attEl("formEdit").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = attEd.r;
    if (!r || attEd.menyimpan || !attEd.awal) return;
    attEdPesan("");
    const p = { employee_id: r.employee_id, tanggal: r.tanggal, keterangan: attEl("fEditAlasan").value.trim() };
    try {
        if (attEd.penuh) {
            const sh = attEl("fEditShift");
            if (!sh.disabled && sh.value && sh.value !== attEd.shiftAwal) p.jadwal = { kode_shift: sh.value };
            const to = attEl("fEditTimeOff");
            if (!to.disabled && to.value !== attEd.toAwal) p.time_off = { time_off_id: to.value ? Number(to.value) : null };
        }
        const masuk = attEl("fEditMasuk").value, pulang = attEl("fEditPulang").value;
        if (masuk !== attEd.masukAwal || pulang !== attEd.pulangAwal) {
            if (masuk && (masuk.slice(0, 10) < attGeserTgl(r.tanggal, -1) || masuk.slice(0, 10) > r.tanggal)) throw new Error("Clock In hanya boleh tanggal kemarin atau tanggal kerja.");
            if (pulang && (pulang.slice(0, 10) < r.tanggal || pulang.slice(0, 10) > attGeserTgl(r.tanggal, 1))) throw new Error("Clock Out hanya boleh tanggal kerja atau besoknya.");
            p.absensi = { clock_in: masuk, clock_out: pulang };
        }
        if (attEd.penuh && !attEl("fEditJenisOt").disabled) {
            const l = attKumpulLembur();
            if (l) p.lembur = l;
        }
        if (!p.jadwal && !p.time_off && !p.absensi && !p.lembur) throw new Error("Belum ada yang diubah.");
        if (!p.keterangan) throw new Error("Keterangan wajib diisi.");
    } catch (err) { attEdPesan(err.message); return; }

    attEd.menyimpan = true;
    const tombol = attEl("btnSimpanEdit");
    tombol.disabled = true;
    try {
        const res = await attDb().rpc("koreksi_laporan_admin", { p });
        if (res.error) throw res.error;
        attModal("modalEdit").hide();
        const bagian = (res.data && res.data.bagian) || [];
        attToast(`Koreksi disimpan${bagian.length ? " (" + bagian.join(", ").replace("time_off", "time off") + ")" : ""}.`);
        attMuat();
    } catch (err) {
        attEdPesan(attPesanError(err));
    } finally {
        attEd.menyimpan = false;
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

// Rentang yang dipakai modal: periode export bila sudah dipilih, kalau belum mengikuti tanggal tabel
function attEpRentang() {
    return { p_dari: att.exp.dari || att.dari, p_sampai: att.exp.sampai || att.exp.dari || att.sampai };
}

async function attEpMuat() {
    const token = ++att.ep.token;
    attEl("epBody").innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Memuat...</td></tr>`;
    try {
        const dari = (att.ep.page - 1) * ATT_PER_HALAMAN_PILIH;
        const f = attEpFilter();
        const k = await attDb().rpc("karyawan_laporan_daftar", {
            ...attEpRentang(), p_branch: f.branch, p_cc: f.cc, p_area: f.area, p_dept: f.dept, p_cari: f.q,
            p_limit: ATT_PER_HALAMAN_PILIH, p_offset: dari
        });
        if (k.error) throw k.error;
        if (token !== att.ep.token) return;
        att.ep.baris = k.data || [];
        att.ep.total = att.ep.baris.length ? Number(att.ep.baris[0].total) : 0;
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

// Memilih SEMUA karyawan hasil filter (bukan hanya halaman ini) lewat satu array id
async function attEpPilihSemua() {
    const tombol = attEl("btnEpSemua");
    tombol.disabled = true;
    try {
        const f = attEpFilter();
        const r = await attDb().rpc("karyawan_laporan_ids", {
            ...attEpRentang(), p_branch: f.branch, p_cc: f.cc, p_area: f.area, p_dept: f.dept, p_cari: f.q
        });
        if (r.error) throw r.error;
        (r.data || []).forEach(id => att.exp.ids.add(id));
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