// ===================================================
// js/module/time/time_settings.js
// Halaman Time Settings: Master Shift, Libur Nasional, Jenis Time Off, Pola Jadwal.
// Semua tabel ada di schema "hrd" (lihat time_modul1.sql).
// Catatan: variabel "supabaseClient" sudah dibuat oleh js/auth.js, jadi TIDAK
// dibuat ulang di sini (kalau dibuat lagi, halaman error "already declared").
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN
// Fungsi: nilai tetap yang mudah diubah.
//  - TS_ROLE_BOLEH_UBAH: roleId yang boleh menambah/mengubah data di halaman ini
//    (1 = Maintenance, 2 = Superadmin, 3 = Admin). Role lain hanya bisa melihat.
//    CATATAN: ini hanya pembatas tampilan, belum pembatas database.
//  - TS_MAX_CHIP: jumlah kode pola yang ditampilkan di tabel sebelum dipotong "...".
// ===================================================
const TS_SCHEMA = "hrd";
const TS_ROLE_BOLEH_UBAH = [1, 2, 3];
const TS_MAX_CHIP = 28;

// ===================================================
// KELOMPOK 2: STATE (data sementara di memori)
// ===================================================
const tsState = {
    canEdit: false,
    session: null,
    shifts: [],
    libur: [],
    timeOff: [],
    pola: [],
    shiftLocked: false,
    polaEditor: { locked: false, hari: [] }
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU
// ===================================================
const tsEl = (id) => document.getElementById(id);
const tsDb = () => supabaseClient.schema(TS_SCHEMA);

// Mengamankan teks sebelum dimasukkan ke HTML
function tsEsc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function tsGetSession() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function tsNik() {
    return tsState.session && tsState.session.nik ? String(tsState.session.nik) : null;
}

const TS_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const TS_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// "2026-08-17" -> "Senin, 17 Agu 2026"
function tsFormatTanggal(iso) {
    if (!iso) return "-";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    if (isNaN(dt)) return "-";
    return `${TS_HARI[dt.getDay()]}, ${String(dt.getDate()).padStart(2, "0")} ${TS_BULAN[dt.getMonth()]} ${dt.getFullYear()}`;
}

// "08:00:00" -> "08:00"
function tsJam(t) { return t ? String(t).slice(0, 5) : "-"; }

function tsRupiah(n) {
    return "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(n) || 0);
}

// Pesan galat dibuat mudah dibaca. Pesan dari database (aturan kunci, validasi) ditampilkan apa adanya.
function tsPesanError(err) {
    const msg = (err && err.message) ? err.message : String(err || "Terjadi kesalahan.");
    if (err && err.code === "23505") {
        if (/master_shift/.test(msg)) return "Kode shift sudah dipakai (huruf besar/kecil dianggap sama).";
        if (/master_time_off/.test(msg)) return "Kode time off sudah dipakai.";
        if (/libur_nasional/.test(msg)) return "Tanggal ini sudah terdaftar sebagai libur nasional.";
        if (/jadwal_pola_nama/.test(msg)) return "Nama pola sudah dipakai.";
        return "Data kembar: " + msg;
    }
    if (err && err.code === "23503") return "Data ini masih dipakai di tempat lain sehingga tidak bisa diubah/dihapus.";
    if (err && err.code === "42501") return "Akun Anda tidak punya izin untuk tindakan ini.";
    return msg;
}

function tsSetMsg(id, text, type) {
    const el = tsEl(id);
    if (!el) return;
    if (!text) { el.classList.add("d-none"); el.textContent = ""; return; }
    el.className = `alert alert-${type || "danger"} py-2 small`;
    el.textContent = text;
}

function tsBusy(btn, busy, busyText) {
    if (!btn) return;
    if (busy) {
        btn.dataset.origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${busyText}`;
    } else {
        btn.disabled = false;
        if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    }
}

function tsToast(message, type = "success") {
    const container = tsEl("toastContainer");
    const toastEl = document.createElement("div");
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    toastEl.setAttribute("role", "alert");
    toastEl.innerHTML = `<div class="d-flex"><div class="toast-body">${tsEsc(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    toast.show();
    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
}

function tsModal(id) { return bootstrap.Modal.getOrCreateInstance(tsEl(id)); }

function tsBadgeAktif(aktif) {
    return aktif
        ? `<span class="badge bg-success-subtle text-success">Aktif</span>`
        : `<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>`;
}

function tsRowKosong(cols, teks) {
    return `<tr><td colspan="${cols}" class="text-center text-muted py-4">${teks}</td></tr>`;
}

// Peta kode shift -> data shift (dipakai untuk warna kotak kode)
function tsShiftMap() {
    const m = new Map();
    tsState.shifts.forEach(s => m.set(s.kode, s));
    return m;
}

// ===================================================
// KELOMPOK 4: INISIALISASI
// Fungsi: dijalankan saat halaman dibuka. Menentukan hak ubah dari role di
// sesi login, memasang tombol, lalu memuat semua data.
// ===================================================
document.addEventListener("DOMContentLoaded", async () => {
    tsState.session = tsGetSession();
    tsState.canEdit = !!tsState.session && TS_ROLE_BOLEH_UBAH.includes(Number(tsState.session.roleId));

    if (!tsState.canEdit) {
        document.querySelectorAll(".ts-edit-only").forEach(el => el.classList.add("d-none"));
        tsEl("tsReadOnlyNote").classList.remove("d-none");
    }

    tsSetupTabs();
    tsSetupShift();
    tsSetupLibur();
    tsSetupTimeOff();
    tsSetupPola();
    await tsLoadAll();
});

function tsSetupTabs() {
    document.querySelectorAll("#tsTabs .nav-link").forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll("#tsTabs .nav-link").forEach(b => b.classList.toggle("active", b === btn));
            ["shift", "libur", "timeoff", "pola"].forEach(t => {
                tsEl("pane-" + t).classList.toggle("d-none", t !== tab);
            });
        });
    });
}

async function tsLoadAll() {
    const bodies = ["shiftTableBody", "liburTableBody", "timeOffTableBody", "polaTableBody"];
    bodies.forEach(id => { tsEl(id).innerHTML = tsRowKosong(9, "Memuat data..."); });
    try {
        const [shifts, libur, timeOff, pola] = await Promise.all([
            tsDb().from("master_shift").select("*").order("kode"),
            tsDb().from("libur_nasional").select("*").order("tanggal"),
            tsDb().from("master_time_off").select("*").order("nama"),
            tsDb().from("v_jadwal_pola").select("*").order("nama")
        ]);
        [shifts, libur, timeOff, pola].forEach(r => { if (r.error) throw r.error; });
        tsState.shifts = shifts.data || [];
        tsState.libur = libur.data || [];
        tsState.timeOff = timeOff.data || [];
        tsState.pola = pola.data || [];
        tsRenderShift();
        tsFillTahunLibur();
        tsRenderLibur();
        tsRenderTimeOff();
        tsRenderPola();
    } catch (err) {
        console.error("Gagal memuat data Time Settings:", err);
        const pesan = `Gagal memuat data: ${tsEsc(tsPesanError(err))}. Pastikan time_modul1.sql sudah dijalankan.`;
        bodies.forEach(id => { tsEl(id).innerHTML = tsRowKosong(9, pesan); });
    }
}

// Muat ulang hanya sebagian data, lalu gambar ulang tampilan terkait
async function tsReload(which) {
    if (which === "shift") {
        const r = await tsDb().from("master_shift").select("*").order("kode");
        if (r.error) throw r.error;
        tsState.shifts = r.data || [];
        tsRenderShift();
        tsRenderPola();   // warna kotak kode di pola ikut jenis shift
    } else if (which === "libur") {
        const r = await tsDb().from("libur_nasional").select("*").order("tanggal");
        if (r.error) throw r.error;
        tsState.libur = r.data || [];
        tsFillTahunLibur();
        tsRenderLibur();
    } else if (which === "timeoff") {
        const r = await tsDb().from("master_time_off").select("*").order("nama");
        if (r.error) throw r.error;
        tsState.timeOff = r.data || [];
        tsRenderTimeOff();
    } else if (which === "pola") {
        const r = await tsDb().from("v_jadwal_pola").select("*").order("nama");
        if (r.error) throw r.error;
        tsState.pola = r.data || [];
        tsRenderPola();
    }
}

// ===================================================
// KELOMPOK 5: MASTER SHIFT
// Fungsi: daftar, tambah, ubah, aktif/nonaktifkan shift.
// Shift yang sudah dipakai di pola: jenis, jam, dan aturan terkunci
// (dijaga juga oleh database; di sini hanya agar pengguna tahu sebabnya).
// ===================================================
function tsSetupShift() {
    tsEl("filterShift").addEventListener("change", tsRenderShift);
    tsEl("btnTambahShift").addEventListener("click", () => tsOpenShift(null));
    tsEl("formShift").addEventListener("submit", tsSaveShift);
    tsEl("fShiftJenis").addEventListener("change", tsToggleJamShift);
    tsEl("shiftTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        if (btn.dataset.act === "edit") tsOpenShift(btn.dataset.kode);
        else if (btn.dataset.act === "toggle") tsToggleShift(btn.dataset.kode);
    });
}

function tsRenderShift() {
    const f = tsEl("filterShift").value;
    const rows = tsState.shifts
        .filter(s => f === "semua" ? true : (f === "aktif" ? s.is_active : !s.is_active))
        .sort((a, b) => {
            if (a.jenis !== b.jenis) return a.jenis === "kerja" ? -1 : 1;
            return String(a.kode).localeCompare(String(b.kode), "id", { numeric: true });
        });

    if (rows.length === 0) { tsEl("shiftTableBody").innerHTML = tsRowKosong(9, "Belum ada shift."); return; }

    tsEl("shiftTableBody").innerHTML = rows.map(s => {
        const kerja = s.jenis === "kerja";
        const jam = kerja
            ? `${tsJam(s.jam_masuk)} - ${tsJam(s.jam_pulang)}${s.lintas_hari ? ' <span class="badge bg-warning-subtle text-dark ms-1">lintas hari</span>' : ""}`
            : '<span class="text-muted">-</span>';
        const angka = (v) => kerja ? `${v} mnt` : '<span class="text-muted">-</span>';
        const aksi = tsState.canEdit ? `
            <button class="btn btn-sm btn-light text-primary me-1" data-act="edit" data-kode="${tsEsc(s.kode)}" title="Ubah"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-light ${s.is_active ? "text-danger" : "text-success"}" data-act="toggle" data-kode="${tsEsc(s.kode)}" title="${s.is_active ? "Nonaktifkan" : "Aktifkan"}"><i class="fa-solid ${s.is_active ? "fa-ban" : "fa-check"}"></i></button>` : "";
        return `<tr>
            <td><span class="ts-chip ${kerja ? "" : "libur"}">${tsEsc(s.kode)}</span></td>
            <td>${tsEsc(s.nama)}</td>
            <td>${kerja ? "Hari kerja" : "Libur / off"}</td>
            <td>${jam}</td>
            <td class="text-center">${angka(s.toleransi_telat_menit)}</td>
            <td class="text-center">${angka(s.batas_awal_masuk_menit)}</td>
            <td class="text-center">${angka(s.batas_akhir_pulang_menit)}</td>
            <td>${tsBadgeAktif(s.is_active)}</td>
            <td class="text-center">${aksi}</td>
        </tr>`;
    }).join("");
}

// Tampilkan / sembunyikan isian jam sesuai jenis (libur tidak punya jam)
function tsToggleJamShift() {
    const kerja = tsEl("fShiftJenis").value === "kerja";
    document.querySelectorAll("#formShift [data-jam]").forEach(el => el.classList.toggle("d-none", !kerja));
}

function tsSetShiftLocked(locked) {
    tsState.shiftLocked = locked;
    ["fShiftJenis", "fShiftJamMasuk", "fShiftJamPulang", "fShiftToleransi", "fShiftBatasAwal", "fShiftBatasAkhir"]
        .forEach(id => { tsEl(id).disabled = locked; });
    tsEl("shiftLockNote").classList.toggle("d-none", !locked);
}

async function tsOpenShift(kode) {
    const baru = !kode;
    const s = baru ? null : tsState.shifts.find(x => x.kode === kode);
    if (!baru && !s) return;

    tsEl("formShift").reset();
    tsSetMsg("shiftMsg", "");
    tsEl("shiftEditKode").value = baru ? "" : s.kode;
    tsEl("modalShiftTitle").textContent = baru ? "Tambah Shift" : `Ubah Shift ${s.kode}`;
    tsEl("fShiftKode").value = baru ? "" : s.kode;
    tsEl("fShiftKode").readOnly = !baru;
    tsEl("fShiftNama").value = baru ? "" : s.nama;
    tsEl("fShiftJenis").value = baru ? "kerja" : s.jenis;
    tsEl("fShiftJamMasuk").value = baru ? "" : tsJam(s.jam_masuk).replace("-", "");
    tsEl("fShiftJamPulang").value = baru ? "" : tsJam(s.jam_pulang).replace("-", "");
    tsEl("fShiftToleransi").value = baru ? 0 : s.toleransi_telat_menit;
    tsEl("fShiftBatasAwal").value = baru ? 120 : s.batas_awal_masuk_menit;
    tsEl("fShiftBatasAkhir").value = baru ? 240 : s.batas_akhir_pulang_menit;
    tsToggleJamShift();

    // Cek apakah shift sudah dipakai di pola; kalau ya, kunci isian utamanya
    let dipakai = false;
    if (!baru) {
        const r = await tsDb().from("jadwal_pola_hari").select("pola_id", { count: "exact", head: true }).eq("kode", kode);
        dipakai = !r.error && (r.count || 0) > 0;
    }
    tsSetShiftLocked(dipakai);
    tsModal("modalShift").show();
}

async function tsSaveShift(e) {
    e.preventDefault();
    const editKode = tsEl("shiftEditKode").value;
    const baru = !editKode;
    const kode = tsEl("fShiftKode").value.trim();
    const nama = tsEl("fShiftNama").value.trim();
    const jenis = tsEl("fShiftJenis").value;
    const kerja = jenis === "kerja";
    const jamMasuk = tsEl("fShiftJamMasuk").value;
    const jamPulang = tsEl("fShiftJamPulang").value;
    const toleransi = parseInt(tsEl("fShiftToleransi").value, 10);
    const batasAwal = parseInt(tsEl("fShiftBatasAwal").value, 10);
    const batasAkhir = parseInt(tsEl("fShiftBatasAkhir").value, 10);

    if (!/^\S{1,10}$/.test(kode)) { tsSetMsg("shiftMsg", "Kode wajib diisi, maksimal 10 karakter, tanpa spasi."); return; }
    if (!nama) { tsSetMsg("shiftMsg", "Nama wajib diisi."); return; }
    if (!tsState.shiftLocked && kerja) {
        if (!jamMasuk || !jamPulang) { tsSetMsg("shiftMsg", "Jam masuk dan jam pulang wajib diisi untuk hari kerja."); return; }
        if (jamMasuk === jamPulang) { tsSetMsg("shiftMsg", "Jam masuk dan jam pulang tidak boleh sama."); return; }
        if ([toleransi, batasAwal, batasAkhir].some(v => isNaN(v) || v < 0)) { tsSetMsg("shiftMsg", "Toleransi dan batas waktu harus berupa angka 0 atau lebih."); return; }
    }

    const btn = tsEl("btnSimpanShift");
    tsBusy(btn, true, "Menyimpan...");
    try {
        let error;
        if (baru) {
            ({ error } = await tsDb().from("master_shift").insert({
                kode, nama, jenis,
                jam_masuk: kerja ? jamMasuk : null,
                jam_pulang: kerja ? jamPulang : null,
                toleransi_telat_menit: kerja ? toleransi : 0,
                batas_awal_masuk_menit: kerja ? batasAwal : 120,
                batas_akhir_pulang_menit: kerja ? batasAkhir : 240,
                created_by: tsNik()
            }));
        } else if (tsState.shiftLocked) {
            ({ error } = await tsDb().from("master_shift").update({ nama }).eq("kode", editKode));
        } else {
            ({ error } = await tsDb().from("master_shift").update({
                nama, jenis,
                jam_masuk: kerja ? jamMasuk : null,
                jam_pulang: kerja ? jamPulang : null,
                toleransi_telat_menit: kerja ? toleransi : 0,
                batas_awal_masuk_menit: kerja ? batasAwal : 120,
                batas_akhir_pulang_menit: kerja ? batasAkhir : 240
            }).eq("kode", editKode));
        }
        if (error) throw error;
        tsModal("modalShift").hide();
        await tsReload("shift");
        tsToast(baru ? "Shift ditambahkan." : "Shift diperbarui.");
    } catch (err) {
        console.error("Gagal menyimpan shift:", err);
        tsSetMsg("shiftMsg", tsPesanError(err));
    } finally {
        tsBusy(btn, false);
    }
}

async function tsToggleShift(kode) {
    const s = tsState.shifts.find(x => x.kode === kode);
    if (!s) return;
    const aksi = s.is_active ? "menonaktifkan" : "mengaktifkan";
    if (!confirm(`Yakin ingin ${aksi} shift ${s.kode} (${s.nama})?${s.is_active ? "\n\nShift nonaktif tidak bisa dipilih untuk pola baru. Pola lama yang memakainya tetap berjalan." : ""}`)) return;
    try {
        const { error } = await tsDb().from("master_shift").update({ is_active: !s.is_active }).eq("kode", kode);
        if (error) throw error;
        await tsReload("shift");
    } catch (err) {
        alert("Gagal mengubah status: " + tsPesanError(err));
    }
}

// ===================================================
// KELOMPOK 6: LIBUR NASIONAL
// Fungsi: daftar per tahun, tambah, ubah keterangan, hapus.
// Tanggal tidak bisa diubah (itu kunci data): untuk memindah tanggal,
// hapus lalu tambah baru.
// ===================================================
function tsSetupLibur() {
    tsEl("filterLiburTahun").addEventListener("change", tsRenderLibur);
    tsEl("btnTambahLibur").addEventListener("click", () => tsOpenLibur(null));
    tsEl("formLibur").addEventListener("submit", tsSaveLibur);
    tsEl("liburTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        if (btn.dataset.act === "edit") tsOpenLibur(btn.dataset.tanggal);
        else if (btn.dataset.act === "hapus") tsDeleteLibur(btn.dataset.tanggal);
    });
}

// Isi pilihan tahun dari data yang ada + tahun ini (pilihan yang sedang dipakai dipertahankan)
function tsFillTahunLibur() {
    const sel = tsEl("filterLiburTahun");
    const sekarang = new Date().getFullYear();
    const tahun = new Set([sekarang, sekarang + 1]);
    tsState.libur.forEach(l => tahun.add(Number(String(l.tanggal).slice(0, 4))));
    const urut = Array.from(tahun).sort((a, b) => b - a);
    const dipilih = sel.value || String(sekarang);
    sel.innerHTML = urut.map(t => `<option value="${t}">${t}</option>`).join("");
    sel.value = urut.map(String).includes(dipilih) ? dipilih : String(sekarang);
}

function tsRenderLibur() {
    const tahun = tsEl("filterLiburTahun").value;
    const rows = tsState.libur.filter(l => String(l.tanggal).startsWith(tahun));
    tsEl("liburJumlah").textContent = `(${rows.length} hari pada ${tahun})`;
    if (rows.length === 0) { tsEl("liburTableBody").innerHTML = tsRowKosong(4, `Belum ada libur nasional pada tahun ${tahun}.`); return; }
    tsEl("liburTableBody").innerHTML = rows.map((l, i) => {
        const aksi = tsState.canEdit ? `
            <button class="btn btn-sm btn-light text-primary me-1" data-act="edit" data-tanggal="${tsEsc(l.tanggal)}" title="Ubah keterangan"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-light text-danger" data-act="hapus" data-tanggal="${tsEsc(l.tanggal)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>` : "";
        return `<tr>
            <td class="text-center">${i + 1}</td>
            <td class="fw-semibold">${tsEsc(tsFormatTanggal(l.tanggal))}</td>
            <td>${tsEsc(l.keterangan)}</td>
            <td class="text-center">${aksi}</td>
        </tr>`;
    }).join("");
}

function tsOpenLibur(tanggal) {
    const baru = !tanggal;
    const l = baru ? null : tsState.libur.find(x => x.tanggal === tanggal);
    if (!baru && !l) return;
    tsEl("formLibur").reset();
    tsSetMsg("liburMsg", "");
    tsEl("liburEditTanggal").value = baru ? "" : l.tanggal;
    tsEl("modalLiburTitle").textContent = baru ? "Tambah Libur Nasional" : "Ubah Libur Nasional";
    tsEl("fLiburTanggal").value = baru ? "" : l.tanggal;
    tsEl("fLiburTanggal").readOnly = !baru;
    tsEl("fLiburKeterangan").value = baru ? "" : l.keterangan;
    tsModal("modalLibur").show();
}

async function tsSaveLibur(e) {
    e.preventDefault();
    const edit = tsEl("liburEditTanggal").value;
    const tanggal = tsEl("fLiburTanggal").value;
    const keterangan = tsEl("fLiburKeterangan").value.trim();
    if (!tanggal) { tsSetMsg("liburMsg", "Tanggal wajib diisi."); return; }
    if (!keterangan) { tsSetMsg("liburMsg", "Keterangan wajib diisi."); return; }

    const btn = tsEl("btnSimpanLibur");
    tsBusy(btn, true, "Menyimpan...");
    try {
        let error;
        if (edit) ({ error } = await tsDb().from("libur_nasional").update({ keterangan }).eq("tanggal", edit));
        else ({ error } = await tsDb().from("libur_nasional").insert({ tanggal, keterangan, created_by: tsNik() }));
        if (error) throw error;
        tsModal("modalLibur").hide();
        await tsReload("libur");
        if (!edit) tsEl("filterLiburTahun").value = tanggal.slice(0, 4), tsRenderLibur();
        tsToast(edit ? "Libur nasional diperbarui." : "Libur nasional ditambahkan.");
    } catch (err) {
        console.error("Gagal menyimpan libur nasional:", err);
        tsSetMsg("liburMsg", tsPesanError(err));
    } finally {
        tsBusy(btn, false);
    }
}

async function tsDeleteLibur(tanggal) {
    const l = tsState.libur.find(x => x.tanggal === tanggal);
    if (!l) return;
    if (!confirm(`Hapus libur nasional ini?\n\n${tsFormatTanggal(l.tanggal)}\n${l.keterangan}`)) return;
    try {
        const { error } = await tsDb().from("libur_nasional").delete().eq("tanggal", tanggal);
        if (error) throw error;
        await tsReload("libur");
        tsToast("Libur nasional dihapus.");
    } catch (err) {
        alert("Gagal menghapus: " + tsPesanError(err));
    }
}

// ===================================================
// KELOMPOK 7: JENIS TIME OFF
// Fungsi: daftar jenis izin/sakit/cuti beserta nominal potongan per hari.
// Ini hanya DAFTAR JENIS; pencatatan izin karyawan ada di tahap pengajuan.
// ===================================================
function tsSetupTimeOff() {
    tsEl("filterTimeOff").addEventListener("change", tsRenderTimeOff);
    tsEl("btnTambahTimeOff").addEventListener("click", () => tsOpenTimeOff(null));
    tsEl("formTimeOff").addEventListener("submit", tsSaveTimeOff);
    tsEl("timeOffTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        if (btn.dataset.act === "edit") tsOpenTimeOff(btn.dataset.id);
        else if (btn.dataset.act === "toggle") tsToggleTimeOff(btn.dataset.id);
    });
}

function tsRenderTimeOff() {
    const f = tsEl("filterTimeOff").value;
    const rows = tsState.timeOff.filter(t => f === "semua" ? true : (f === "aktif" ? t.is_active : !t.is_active));
    if (rows.length === 0) { tsEl("timeOffTableBody").innerHTML = tsRowKosong(5, "Belum ada jenis time off."); return; }
    tsEl("timeOffTableBody").innerHTML = rows.map(t => {
        const potong = Number(t.potongan_nominal) > 0 ? tsRupiah(t.potongan_nominal) : '<span class="text-muted">Tidak dipotong</span>';
        const aksi = tsState.canEdit ? `
            <button class="btn btn-sm btn-light text-primary me-1" data-act="edit" data-id="${tsEsc(t.id)}" title="Ubah"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-light ${t.is_active ? "text-danger" : "text-success"}" data-act="toggle" data-id="${tsEsc(t.id)}" title="${t.is_active ? "Nonaktifkan" : "Aktifkan"}"><i class="fa-solid ${t.is_active ? "fa-ban" : "fa-check"}"></i></button>` : "";
        return `<tr>
            <td><code>${tsEsc(t.kode)}</code></td>
            <td>${tsEsc(t.nama)}</td>
            <td class="text-end">${potong}</td>
            <td>${tsBadgeAktif(t.is_active)}</td>
            <td class="text-center">${aksi}</td>
        </tr>`;
    }).join("");
}

function tsOpenTimeOff(id) {
    const baru = !id;
    const t = baru ? null : tsState.timeOff.find(x => String(x.id) === String(id));
    if (!baru && !t) return;
    tsEl("formTimeOff").reset();
    tsSetMsg("timeOffMsg", "");
    tsEl("timeOffEditId").value = baru ? "" : t.id;
    tsEl("modalTimeOffTitle").textContent = baru ? "Tambah Jenis Time Off" : "Ubah Jenis Time Off";
    tsEl("fTimeOffKode").value = baru ? "" : t.kode;
    tsEl("fTimeOffNama").value = baru ? "" : t.nama;
    tsEl("fTimeOffPotongan").value = baru ? 0 : Number(t.potongan_nominal);
    tsModal("modalTimeOff").show();
}

async function tsSaveTimeOff(e) {
    e.preventDefault();
    const id = tsEl("timeOffEditId").value;
    const kode = tsEl("fTimeOffKode").value.trim();
    const nama = tsEl("fTimeOffNama").value.trim();
    const potongan = Number(tsEl("fTimeOffPotongan").value);
    if (!/^\S{1,10}$/.test(kode)) { tsSetMsg("timeOffMsg", "Kode wajib diisi, maksimal 10 karakter, tanpa spasi."); return; }
    if (!nama) { tsSetMsg("timeOffMsg", "Nama wajib diisi."); return; }
    if (isNaN(potongan) || potongan < 0) { tsSetMsg("timeOffMsg", "Potongan harus angka 0 atau lebih."); return; }

    const btn = tsEl("btnSimpanTimeOff");
    tsBusy(btn, true, "Menyimpan...");
    try {
        let error;
        if (id) ({ error } = await tsDb().from("master_time_off").update({ kode, nama, potongan_nominal: potongan }).eq("id", id));
        else ({ error } = await tsDb().from("master_time_off").insert({ kode, nama, potongan_nominal: potongan, created_by: tsNik() }));
        if (error) throw error;
        tsModal("modalTimeOff").hide();
        await tsReload("timeoff");
        tsToast(id ? "Jenis time off diperbarui." : "Jenis time off ditambahkan.");
    } catch (err) {
        console.error("Gagal menyimpan jenis time off:", err);
        tsSetMsg("timeOffMsg", tsPesanError(err));
    } finally {
        tsBusy(btn, false);
    }
}

async function tsToggleTimeOff(id) {
    const t = tsState.timeOff.find(x => String(x.id) === String(id));
    if (!t) return;
    if (!confirm(`Yakin ingin ${t.is_active ? "menonaktifkan" : "mengaktifkan"} jenis time off ${t.kode} (${t.nama})?`)) return;
    try {
        const { error } = await tsDb().from("master_time_off").update({ is_active: !t.is_active }).eq("id", t.id);
        if (error) throw error;
        await tsReload("timeoff");
    } catch (err) {
        alert("Gagal mengubah status: " + tsPesanError(err));
    }
}

// ===================================================
// KELOMPOK 8: POLA JADWAL - DAFTAR
// Fungsi: tabel pola. Kolom "Dipakai" = jumlah karyawan yang memakai.
// Tanda "Terkunci" = ada penugasan aktif (karyawan atau default), isi pola
// tidak bisa diubah lagi.
// ===================================================
function tsSetupPola() {
    tsEl("filterPola").addEventListener("change", tsRenderPola);
    tsEl("btnTambahPola").addEventListener("click", () => tsOpenPola(null, "baru"));
    tsEl("formPola").addEventListener("submit", tsSavePola);
    tsEl("polaTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        if (btn.dataset.act === "edit") tsOpenPola(btn.dataset.id, "edit");
        else if (btn.dataset.act === "salin") tsOpenPola(btn.dataset.id, "salin");
        else if (btn.dataset.act === "toggle") tsTogglePola(btn.dataset.id);
    });
    tsEl("fPolaSiklus").addEventListener("input", tsOnSiklusChange);
    tsEl("polaGrid").addEventListener("change", tsOnGridChange);
    tsEl("btnIsiSemua").addEventListener("click", tsIsiSemua);
    tsEl("btnTerapkanPaste").addEventListener("click", tsTerapkanPaste);
    tsEl("btnDuplikatPola").addEventListener("click", () => {
        const id = tsEl("polaEditId").value;
        if (id) tsOpenPola(id, "salin");
    });
}

// Kotak-kotak kode untuk satu pola (dipotong bila terlalu panjang)
function tsChips(isi) {
    if (!isi) return '<span class="text-muted">-</span>';
    const peta = tsShiftMap();
    const arr = String(isi).split(" ");
    const tampil = arr.slice(0, TS_MAX_CHIP).map(k => {
        const s = peta.get(k);
        return `<span class="ts-chip ${s && s.jenis === "libur" ? "libur" : ""}">${tsEsc(k)}</span>`;
    }).join("");
    return tampil + (arr.length > TS_MAX_CHIP ? ` <span class="text-muted small">... (+${arr.length - TS_MAX_CHIP})</span>` : "");
}

function tsRenderPola() {
    const f = tsEl("filterPola").value;
    const rows = tsState.pola.filter(p => f === "semua" ? true : (f === "aktif" ? p.is_active : !p.is_active));
    if (rows.length === 0) { tsEl("polaTableBody").innerHTML = tsRowKosong(7, "Belum ada pola jadwal."); return; }
    tsEl("polaTableBody").innerHTML = rows.map(p => {
        const terkunci = Number(p.jumlah_penugasan) > 0;
        const aksi = tsState.canEdit ? `
            <button class="btn btn-sm btn-light text-primary me-1" data-act="edit" data-id="${tsEsc(p.id)}" title="${terkunci ? "Lihat / ubah nama" : "Ubah"}"><i class="fa-solid ${terkunci ? "fa-eye" : "fa-pen"}"></i></button>
            <button class="btn btn-sm btn-light text-secondary me-1" data-act="salin" data-id="${tsEsc(p.id)}" title="Duplikat"><i class="fa-regular fa-copy"></i></button>
            <button class="btn btn-sm btn-light ${p.is_active ? "text-danger" : "text-success"}" data-act="toggle" data-id="${tsEsc(p.id)}" title="${p.is_active ? "Nonaktifkan" : "Aktifkan"}"><i class="fa-solid ${p.is_active ? "fa-ban" : "fa-check"}"></i></button>`
            : `<button class="btn btn-sm btn-light text-primary" data-act="edit" data-id="${tsEsc(p.id)}" title="Lihat"><i class="fa-solid fa-eye"></i></button>`;
        return `<tr>
            <td class="fw-semibold">${tsEsc(p.nama)}${p.keterangan ? `<div class="small text-muted fw-normal">${tsEsc(p.keterangan)}</div>` : ""}</td>
            <td class="text-center">${p.panjang_siklus} hari</td>
            <td>${tsChips(p.isi)}</td>
            <td class="text-center">${p.ikut_libur_nasional ? "Ya" : "Tidak"}</td>
            <td class="text-center">${Number(p.jumlah_karyawan)} karyawan${terkunci ? ' <i class="fa-solid fa-lock text-warning ms-1" title="Terkunci: sudah dipakai"></i>' : ""}</td>
            <td>${tsBadgeAktif(p.is_active)}</td>
            <td class="text-center">${aksi}</td>
        </tr>`;
    }).join("");
}

async function tsTogglePola(id) {
    const p = tsState.pola.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Yakin ingin ${p.is_active ? "menonaktifkan" : "mengaktifkan"} pola "${p.nama}"?${p.is_active ? "\n\nPola nonaktif tidak bisa dipilih untuk penugasan baru. Karyawan yang sudah memakainya tetap berjalan." : ""}`)) return;
    try {
        const { error } = await tsDb().from("jadwal_pola").update({ is_active: !p.is_active }).eq("id", id);
        if (error) throw error;
        await tsReload("pola");
    } catch (err) {
        alert("Gagal mengubah status: " + tsPesanError(err));
    }
}

// ===================================================
// KELOMPOK 9: POLA JADWAL - EDITOR
// Fungsi: modal untuk membuat/mengubah/menduplikat pola.
// Isi pola disimpan di tsState.polaEditor.hari (daftar kode urut hari 1..n)
// dan digambar sebagai satu kotak pilihan per hari.
// Mode: "baru", "edit", "salin" (isi disalin, jadi pola baru).
// Pola terkunci: kotak isi dinonaktifkan, hanya nama/keterangan/status bisa diubah.
// ===================================================

// Pilihan kode untuk satu kotak. Kode nonaktif yang sedang terpilih tetap ditampilkan.
function tsOpsiShift(terpilih) {
    const aktif = tsState.shifts
        .filter(s => s.is_active)
        .sort((a, b) => {
            if (a.jenis !== b.jenis) return a.jenis === "kerja" ? -1 : 1;
            return String(a.kode).localeCompare(String(b.kode), "id", { numeric: true });
        });
    let html = `<option value="">-</option>` + aktif.map(s =>
        `<option value="${tsEsc(s.kode)}" ${s.kode === terpilih ? "selected" : ""}>${tsEsc(s.kode)}</option>`).join("");
    if (terpilih && !aktif.some(s => s.kode === terpilih)) {
        html += `<option value="${tsEsc(terpilih)}" selected>${tsEsc(terpilih)} (nonaktif)</option>`;
    }
    return html;
}

function tsGambarGrid() {
    const ed = tsState.polaEditor;
    const peta = tsShiftMap();
    tsEl("polaGrid").innerHTML = ed.hari.map((kode, i) => {
        const s = peta.get(kode);
        const kelas = !kode ? "kosong" : (s && s.jenis === "libur" ? "libur" : "");
        return `<div class="ts-cell">
            <label>Hari ${i + 1}</label>
            <select class="form-select form-select-sm ${kelas}" data-i="${i}" ${ed.locked ? "disabled" : ""}>${tsOpsiShift(kode)}</select>
        </div>`;
    }).join("");
}

function tsOnGridChange(e) {
    const sel = e.target.closest("select[data-i]");
    if (!sel) return;
    const i = Number(sel.dataset.i);
    tsState.polaEditor.hari[i] = sel.value;
    const s = tsShiftMap().get(sel.value);
    sel.classList.toggle("kosong", !sel.value);
    sel.classList.toggle("libur", !!(s && s.jenis === "libur"));
}

// Mengubah panjang siklus: isi yang sudah ada dipertahankan, hari baru kosong
function tsOnSiklusChange() {
    const ed = tsState.polaEditor;
    if (ed.locked) return;
    let n = parseInt(tsEl("fPolaSiklus").value, 10);
    if (isNaN(n) || n < 1) return;
    if (n > 366) n = 366;
    while (ed.hari.length < n) ed.hari.push("");
    ed.hari.length = n;
    tsGambarGrid();
}

function tsIsiSemua() {
    const ed = tsState.polaEditor;
    if (ed.locked) return;
    const kode = tsEl("polaFillKode").value;
    if (!kode) { tsSetMsg("polaMsg", "Pilih kode yang akan dipakai untuk mengisi semua hari."); return; }
    tsSetMsg("polaMsg", "");
    ed.hari = ed.hari.map(() => kode);
    tsGambarGrid();
}

// Tempel urutan kode (mis. dari Excel): "PG PG PG PG PG PG O" -> panjang siklus dan isi ikut berubah
function tsTerapkanPaste() {
    const ed = tsState.polaEditor;
    if (ed.locked) return;
    const teks = tsEl("polaPaste").value.trim();
    if (!teks) { tsSetMsg("polaMsg", "Isi dulu urutan kode yang akan ditempel."); return; }
    const token = teks.split(/[\s,;]+/).filter(Boolean);
    if (token.length > 366) { tsSetMsg("polaMsg", "Maksimal 366 hari."); return; }
    const peta = new Map(tsState.shifts.filter(s => s.is_active).map(s => [s.kode.toUpperCase(), s.kode]));
    const tidakDikenal = [];
    const hasil = token.map(t => {
        const k = peta.get(t.toUpperCase());
        if (!k) tidakDikenal.push(t);
        return k || "";
    });
    if (tidakDikenal.length > 0) {
        tsSetMsg("polaMsg", `Kode tidak dikenal atau nonaktif: ${[...new Set(tidakDikenal)].join(", ")}. Tambahkan dulu di Master Shift.`);
        return;
    }
    tsSetMsg("polaMsg", "");
    ed.hari = hasil;
    tsEl("fPolaSiklus").value = hasil.length;
    tsGambarGrid();
}

async function tsOpenPola(id, mode) {
    const p = id ? tsState.pola.find(x => x.id === id) : null;
    if (id && !p) return;

    tsEl("formPola").reset();
    tsSetMsg("polaMsg", "");
    tsEl("polaPaste").value = "";

    // Pilihan "isi semua dengan"
    tsEl("polaFillKode").innerHTML = tsOpsiShift("");

    let hari = [];
    if (p) {
        const r = await tsDb().from("jadwal_pola_hari").select("posisi, kode").eq("pola_id", id).order("posisi");
        if (r.error) { alert("Gagal memuat isi pola: " + tsPesanError(r.error)); return; }
        hari = (r.data || []).map(x => x.kode);
    }

    const salin = mode === "salin";
    const baru = mode === "baru";
    const locked = mode === "edit" && Number(p.jumlah_penugasan) > 0;
    // Pengguna tanpa hak ubah hanya melihat
    const lihatSaja = !tsState.canEdit;

    tsState.polaEditor = { locked: locked || lihatSaja, hari: baru ? Array(7).fill("") : hari };

    tsEl("polaEditId").value = (mode === "edit") ? p.id : "";
    tsEl("modalPolaTitle").textContent = baru ? "Tambah Pola" : (salin ? "Duplikat Pola" : (locked ? "Pola (terkunci)" : "Ubah Pola"));
    tsEl("fPolaNama").value = baru ? "" : (salin ? `${p.nama} (salinan)` : p.nama);
    tsEl("fPolaKet").value = baru ? "" : (p.keterangan || "");
    tsEl("fPolaSiklus").value = tsState.polaEditor.hari.length;
    tsEl("fPolaLiburNasional").checked = baru ? false : !!p.ikut_libur_nasional;
    tsEl("fPolaAktif").checked = (baru || salin) ? true : !!p.is_active;
    tsEl("wrapPolaAktif").classList.toggle("d-none", baru || salin);

    const kunciIsi = tsState.polaEditor.locked;
    ["fPolaSiklus", "fPolaLiburNasional", "polaFillKode", "polaPaste", "btnIsiSemua", "btnTerapkanPaste"]
        .forEach(x => { tsEl(x).disabled = kunciIsi; });
    ["fPolaNama", "fPolaKet", "fPolaAktif"].forEach(x => { tsEl(x).disabled = lihatSaja; });
    tsEl("polaTools").classList.toggle("d-none", kunciIsi);
    tsEl("polaLockNote").classList.toggle("d-none", !locked);
    tsEl("btnDuplikatPola").classList.toggle("d-none", !(mode === "edit" && tsState.canEdit));
    tsEl("btnSimpanPola").classList.toggle("d-none", lihatSaja);

    tsGambarGrid();
    tsModal("modalPola").show();
}

async function tsSavePola(e) {
    e.preventDefault();
    const ed = tsState.polaEditor;
    const id = tsEl("polaEditId").value;
    const nama = tsEl("fPolaNama").value.trim();
    const n = parseInt(tsEl("fPolaSiklus").value, 10);

    if (!nama) { tsSetMsg("polaMsg", "Nama pola wajib diisi."); return; }
    if (isNaN(n) || n < 1 || n > 366) { tsSetMsg("polaMsg", "Panjang siklus harus antara 1 dan 366 hari."); return; }
    if (ed.hari.length !== n) { tsSetMsg("polaMsg", "Jumlah isi pola tidak sama dengan panjang siklus."); return; }
    const kosong = ed.hari.findIndex(k => !k);
    if (kosong >= 0) { tsSetMsg("polaMsg", `Hari ${kosong + 1} belum diisi.`); return; }

    const btn = tsEl("btnSimpanPola");
    tsBusy(btn, true, "Menyimpan...");
    try {
        const { error } = await tsDb().rpc("simpan_pola", {
            p_data: {
                id: id || null,
                nama,
                keterangan: tsEl("fPolaKet").value.trim(),
                panjang_siklus: n,
                ikut_libur_nasional: tsEl("fPolaLiburNasional").checked,
                is_active: tsEl("fPolaAktif").checked,
                oleh: tsNik(),
                hari: ed.hari
            }
        });
        if (error) throw error;
        tsModal("modalPola").hide();
        await tsReload("pola");
        tsToast(id ? "Pola diperbarui." : "Pola disimpan.");
    } catch (err) {
        console.error("Gagal menyimpan pola:", err);
        tsSetMsg("polaMsg", tsPesanError(err));
    } finally {
        tsBusy(btn, false);
    }
}