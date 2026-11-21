// ===================================================
// js/module/time/time_pola_karyawan.js
// Sub tab "Karyawan" pada tab Pola Jadwal: pola jadwal yang BERLAKU per karyawan
// (hanya teks), tombol "Jadwal Baru" dan "Edit".
// Memakai fungsi bantu dari time_settings.js (tsEl, tsDb, tsEsc, tsToast, tsModal,
// tsBusy, tsSetMsg, tsPesanError, tsRowKosong, tsNik, tsFormatTanggal, tsReload,
// tsState), jadi harus dimuat SETELAH file tersebut.
// Database (time_modul1.sql dan time_modul1i_pola_karyawan.sql):
//   view  hrd.v_karyawan_pola            daftar karyawan + pola yang berlaku
//   rpc   hrd.pasang_pola_karyawan       "Jadwal Baru" (menutup pola lama otomatis:
//                                        tanggal akhir = tanggal efektif baru - 1)
//   rpc   hrd.ubah_pola_karyawan         "Edit" pola terakhir karyawan
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN
// PK_PER_PAGE : baris per halaman di tabel Karyawan.
// ===================================================
const PK_PER_PAGE = 25;

// ===================================================
// KELOMPOK 2: STATE
//  modal.mode     : 'baru' atau 'edit'
//  modal.emp      : baris karyawan yang sedang dikerjakan
//  modal.riwayat  : semua penugasan pola milik karyawan itu (urut tanggal mulai)
// ===================================================
const pkState = {
    loaded: false,
    page: 1,
    total: 0,
    baris: [],
    modal: { mode: null, emp: null, riwayat: [] }
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU
// ===================================================
function pkClean(q) { return String(q || "").replace(/[%_,()]/g, "").trim(); }

function pkNamaCc(id) {
    if (id == null) return "-";
    const c = tsState.costCenters.find(x => Number(x.id) === Number(id));
    return c ? c.costcenter_name : `#${id}`;
}

function pkIsiOpsiCc() {
    const el = tsEl("pkKarCc");
    const lama = el.value;
    el.innerHTML = '<option value="">Semua cost center</option>' +
        tsState.costCenters.map(c => `<option value="${c.id}">${tsEsc(c.costcenter_name)}</option>`).join("");
    el.value = lama;
}

// Tanggal berbentuk "YYYY-MM-DD" dihitung sebagai teks agar tidak bergeser oleh zona waktu
function pkTambahHari(iso, n) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function pkHariIni() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function pkNamaPola(id) {
    const p = tsState.pola.find(x => x.id === id);
    return p ? p.nama : "(pola tidak dikenal)";
}

function pkPolaDipilih() {
    const id = tsEl("fPkPola").value;
    return tsState.pola.find(p => p.id === id) || null;
}

// Isi pola berbentuk "P P S O ..." (kode shift per posisi siklus)
function pkKodePola(p) { return String((p && p.isi) || "").split(" ").filter(Boolean); }

// ===================================================
// KELOMPOK 4: PEMASANGAN TOMBOL & EVENT
// ===================================================
function tsSetupPolaKaryawan() {
    // Sub tab: Pola Jadwal / Karyawan
    document.querySelectorAll("#polaTabs [data-polatab]").forEach(btn => {
        btn.addEventListener("click", () => {
            const t = btn.dataset.polatab;
            document.querySelectorAll("#polaTabs .nav-link").forEach(b => b.classList.toggle("active", b === btn));
            tsEl("pola-pane-daftar").classList.toggle("d-none", t !== "daftar");
            tsEl("pola-pane-karyawan").classList.toggle("d-none", t !== "karyawan");
            if (t === "karyawan") pkOnOpen();
        });
    });

    // Filter dan halaman
    let timer;
    tsEl("pkKarCari").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { pkState.page = 1; pkLoad(); }, 350); });
    tsEl("pkKarCc").addEventListener("change", () => { pkState.page = 1; pkLoad(); });
    tsEl("pkKarStatus").addEventListener("change", () => { pkState.page = 1; pkLoad(); });
    tsEl("pkKarPrev").addEventListener("click", () => { if (pkState.page > 1) { pkState.page--; pkLoad(); } });
    tsEl("pkKarNext").addEventListener("click", () => {
        if (pkState.page < Math.ceil(pkState.total / PK_PER_PAGE)) { pkState.page++; pkLoad(); }
    });

    // Tombol Edit / Jadwal Baru di dalam tabel (delegasi)
    tsEl("pkKarBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        pkBuka(btn.dataset.act === "edit" ? "edit" : "baru", btn.dataset.emp);
    });

    // Modal
    tsEl("formPolaKaryawan").addEventListener("submit", pkSimpan);
    tsEl("fPkPola").addEventListener("change", () => { pkIsiKode(""); pkPratinjau(); });
    tsEl("fPkKode").addEventListener("change", () => { pkSaranLibur(); });
    tsEl("fPkMulai").addEventListener("change", () => { pkSaranLibur(); pkPratinjau(); });
}

function pkOnOpen() {
    pkIsiOpsiCc();
    if (!pkState.loaded) pkLoad();
}

// ===================================================
// KELOMPOK 5: TABEL KARYAWAN
// Fungsi: semua karyawan aktif (tidak blacklist) per halaman dari server.
// Kolom "Pola Jadwal" hanya teks: pola yang berlaku hari ini (pola milik karyawan
// didahulukan, lalu default), tanggal berlakunya, dan pola berikutnya bila ada.
// Tombol "Jadwal Baru" selalu ada. Tombol "Edit" hanya muncul bila karyawan sudah
// punya LEBIH DARI SATU penugasan pola, dan mengedit penugasan terakhir.
// ===================================================
async function pkLoad() {
    const body = tsEl("pkKarBody");
    body.innerHTML = tsRowKosong(5, "Memuat data...");
    const q = pkClean(tsEl("pkKarCari").value).toLowerCase();
    const cc = tsEl("pkKarCc").value;
    const st = tsEl("pkKarStatus").value;
    try {
        const dari = (pkState.page - 1) * PK_PER_PAGE;
        let query = tsDb().from("v_karyawan_pola").select("*", { count: "exact" })
            .order("nama").order("employee_id")
            .range(dari, dari + PK_PER_PAGE - 1);
        if (q) query = query.ilike("cari", `%${q}%`);
        if (cc) query = query.eq("costcenter_id", cc);
        if (st === "sendiri") query = query.eq("sumber", "sendiri");
        if (st === "default") query = query.eq("sumber", "default");
        if (st === "belum") query = query.is("sumber", null);
        const r = await query;
        if (r.error) throw r.error;
        pkState.total = r.count || 0;
        pkState.baris = r.data || [];
        pkState.loaded = true;

        body.innerHTML = pkState.baris.length
            ? pkState.baris.map((k, i) => `<tr>
                <td class="text-center">${dari + i + 1}</td>
                <td>${tsEsc(k.nik_karyawan)}</td>
                <td>${tsEsc(k.nama)}</td>
                <td>${tsEsc(pkNamaCc(k.costcenter_id))}</td>
                <td>${pkHtmlPola(k)}</td>
            </tr>`).join("")
            : tsRowKosong(5, "Tidak ada karyawan yang cocok.");

        const awal = pkState.total === 0 ? 0 : dari + 1;
        const akhir = Math.min(dari + PK_PER_PAGE, pkState.total);
        tsEl("pkKarInfo").textContent = `Menampilkan ${awal}-${akhir} dari ${pkState.total} karyawan`;
        tsEl("pkKarPrev").disabled = pkState.page <= 1;
        tsEl("pkKarNext").disabled = pkState.page >= Math.ceil(pkState.total / PK_PER_PAGE);
    } catch (err) {
        console.error("Gagal memuat karyawan dan pola:", err);
        body.innerHTML = tsRowKosong(5, `Gagal memuat data: ${tsEsc(tsPesanError(err))}. Pastikan time_modul1i_pola_karyawan.sql sudah dijalankan.`);
    }
}

function pkHtmlPola(k) {
    let teks;
    if (!k.sumber) {
        teks = '<div class="text-muted">Belum ada pola</div>';
    } else {
        const sampai = k.berlaku_sampai ? ` s/d ${tsFormatTanggal(k.berlaku_sampai)}` : "";
        teks = `<div class="fw-semibold">${tsEsc(k.pola_nama)}${k.sumber === "default" ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">default</span>' : ""}</div>
                <div class="small text-muted">Berlaku sejak ${tsEsc(tsFormatTanggal(k.berlaku_mulai))}${tsEsc(sampai)}</div>`;
    }
    if (k.berikutnya_pola_nama) {
        teks += `<div class="small text-primary">Berikutnya: ${tsEsc(k.berikutnya_pola_nama)} mulai ${tsEsc(tsFormatTanggal(k.berikutnya_mulai))}</div>`;
    }
    const emp = tsEsc(k.employee_id);
    const edit = Number(k.jumlah_pola) >= 2
        ? `<button type="button" class="btn btn-sm btn-light text-primary" data-act="edit" data-emp="${emp}" title="Edit pola terakhir: ${tsEsc(k.terakhir_pola_nama)}"><i class="fa-solid fa-pen me-1"></i>Edit</button>`
        : "";
    const aksi = tsState.canEdit
        ? `<div class="d-flex gap-1 flex-shrink-0">${edit}<button type="button" class="btn btn-sm btn-outline-primary" data-act="baru" data-emp="${emp}"><i class="fa-solid fa-plus me-1"></i>Jadwal Baru</button></div>`
        : "";
    return `<div class="d-flex justify-content-between align-items-center gap-2"><div>${teks}</div>${aksi}</div>`;
}

// ===================================================
// KELOMPOK 6: MODAL JADWAL BARU / EDIT
// Isian: pola, tanggal efektif, shift awal, tanggal libur pertama.
// "Shift awal" dan "libur pertama" diwajibkan sistem pola (modul 1) untuk
// menentukan posisi awal dalam siklus. Tanggal libur pertama terisi otomatis dari
// pola dan shift awal yang dipilih, dan boleh diubah.
// Mode Jadwal Baru : pola lama ditutup otomatis, tanggal akhirnya = efektif - 1.
// Mode Edit        : mengedit penugasan TERAKHIR; bila ada pola sebelumnya,
//                    tanggal akhirnya ikut menjadi (efektif baru - 1).
// ===================================================
async function pkBuka(mode, empId) {
    const k = pkState.baris.find(x => x.employee_id === empId);
    if (!k) return;

    let riwayat = [];
    try {
        const r = await tsDb().from("jadwal_pola_karyawan").select("*")
            .eq("employee_id", empId).eq("is_active", true).order("berlaku_mulai");
        if (r.error) throw r.error;
        riwayat = r.data || [];
    } catch (err) {
        alert("Gagal memuat riwayat pola: " + tsPesanError(err));
        return;
    }
    const terakhir = riwayat[riwayat.length - 1] || null;
    if (mode === "edit" && !terakhir) return;

    pkState.modal = { mode, emp: k, riwayat };
    tsEl("formPolaKaryawan").reset();
    tsSetMsg("pkMsg", "");
    tsEl("modalPolaKaryawanTitle").textContent = mode === "edit" ? "Edit Pola Jadwal" : "Jadwal Baru";
    tsEl("pkKaryawanTeks").textContent = `${k.nik_karyawan} - ${k.nama}`;
    tsEl("pkEditId").value = mode === "edit" ? terakhir.id : "";

    pkIsiPola(mode === "edit" ? terakhir.pola_id : "");
    if (mode === "edit") {
        tsEl("fPkMulai").value = String(terakhir.berlaku_mulai).slice(0, 10);
        pkIsiKode("");
        const p = pkPolaDipilih();
        const kode = p ? pkKodePola(p)[Number(terakhir.posisi_awal) - 1] : "";
        if (kode) tsEl("fPkKode").value = kode;
        pkSaranLibur(Number(terakhir.posisi_awal));
    } else {
        pkIsiKode("");
    }
    pkRenderRiwayat();
    pkPratinjau();
    tsModal("modalPolaKaryawan").show();
}

function pkIsiPola(terpilih) {
    const daftar = tsState.pola
        .filter(p => p.is_active || p.id === terpilih)
        .sort((a, b) => String(a.nama).localeCompare(String(b.nama), "id"));
    tsEl("fPkPola").innerHTML = '<option value="">Pilih pola...</option>' + daftar.map(p =>
        `<option value="${tsEsc(p.id)}">${tsEsc(p.nama)} (siklus ${p.panjang_siklus} hari)${p.is_active ? "" : " - nonaktif"}</option>`).join("");
    tsEl("fPkPola").value = terpilih || "";
}

function pkIsiKode(terpilih) {
    const sel = tsEl("fPkKode");
    const p = pkPolaDipilih();
    if (!p) { sel.innerHTML = '<option value="">Pilih pola dulu...</option>'; return; }
    const unik = Array.from(new Set(pkKodePola(p)));
    sel.innerHTML = '<option value="">Pilih shift awal...</option>' + unik.map(kode => {
        const s = tsState.shifts.find(x => x.kode === kode);
        const label = s ? `${kode} - ${s.nama}${s.jenis === "libur" ? " (libur)" : ""}` : kode;
        return `<option value="${tsEsc(kode)}">${tsEsc(label)}</option>`;
    }).join("");
    sel.value = terpilih || "";
}

// Mengisi tanggal libur pertama: dari posisi awal siklus, berapa hari sampai shift
// bertipe libur pertama. posisiPaksa dipakai saat Edit (posisi tersimpan);
// selain itu dipakai posisi terkecil yang memiliki shift awal tersebut.
function pkSaranLibur(posisiPaksa) {
    const p = pkPolaDipilih();
    const kode = tsEl("fPkKode").value;
    const mulai = tsEl("fPkMulai").value;
    if (!p || !kode || !mulai) return;
    const arr = pkKodePola(p);
    const n = arr.length;
    const pos = posisiPaksa || (arr.indexOf(kode) + 1);
    if (pos < 1) return;
    const libur = new Set(tsState.shifts.filter(s => s.jenis === "libur").map(s => s.kode));
    for (let i = 0; i < n; i++) {
        if (libur.has(arr[(pos - 1 + i) % n])) {
            tsEl("fPkLibur").value = pkTambahHari(mulai, i);
            return;
        }
    }
}

function pkRenderRiwayat() {
    const m = pkState.modal;
    const hariIni = pkHariIni();
    const editId = tsEl("pkEditId").value;
    if (!m.riwayat.length) {
        tsEl("pkRiwayat").innerHTML = '<div class="text-muted small p-2">Karyawan ini belum punya pola sendiri. Selama belum ada, pola default (bila ada) yang berlaku.</div>';
        return;
    }
    tsEl("pkRiwayat").innerHTML = m.riwayat.map(r => {
        const mulai = String(r.berlaku_mulai).slice(0, 10);
        const sampai = r.berlaku_sampai ? String(r.berlaku_sampai).slice(0, 10) : "";
        const status = mulai > hariIni ? ["Akan datang", "bg-info-subtle text-info-emphasis"]
            : (!sampai || sampai >= hariIni) ? ["Berlaku", "bg-success-subtle text-success-emphasis"]
            : ["Selesai", "bg-secondary-subtle text-secondary-emphasis"];
        const diedit = r.id === editId;
        return `<div class="ts-row">
            <span>${diedit ? "<b>" : ""}${tsEsc(pkNamaPola(r.pola_id))}${diedit ? "</b> (diedit)" : ""}
                <span class="text-muted small">· ${tsEsc(tsFormatTanggal(mulai))} s/d ${sampai ? tsEsc(tsFormatTanggal(sampai)) : "seterusnya"}</span></span>
            <span class="badge ${status[1]}">${status[0]}</span>
        </div>`;
    }).join("");
}

// Pratinjau akibat perubahan, dan peringatan bila tanggal efektif di masa lalu
function pkPratinjau() {
    const m = pkState.modal;
    const mulai = tsEl("fPkMulai").value;
    const info = tsEl("pkPratinjau");
    const peringatan = tsEl("pkPeringatan");
    info.hidden = true;
    peringatan.hidden = true;
    if (!m.emp || !mulai) return;

    let sebelumnya = null;
    if (m.mode === "edit") {
        sebelumnya = m.riwayat.length >= 2 ? m.riwayat[m.riwayat.length - 2] : null;
    } else {
        const kena = m.riwayat.filter(r => String(r.berlaku_mulai).slice(0, 10) < mulai
            && (!r.berlaku_sampai || String(r.berlaku_sampai).slice(0, 10) >= mulai));
        sebelumnya = kena[kena.length - 1] || null;
    }
    if (sebelumnya) {
        info.hidden = false;
        info.innerHTML = `Pola sebelumnya <b>${tsEsc(pkNamaPola(sebelumnya.pola_id))}</b> (mulai ${tsEsc(tsFormatTanggal(sebelumnya.berlaku_mulai))}) akan berakhir pada <b>${tsEsc(tsFormatTanggal(pkTambahHari(mulai, -1)))}</b>.`;
    }
    if (mulai < pkHariIni()) {
        peringatan.hidden = false;
        peringatan.textContent = "Tanggal efektif di masa lalu ikut mengubah jadwal pola yang dibaca untuk tanggal-tanggal yang sudah lewat (yang tidak punya jadwal assignment), sehingga hasil absensi dan laporan hari-hari itu bisa berubah.";
    }
}

async function pkSimpan(e) {
    e.preventDefault();
    const m = pkState.modal;
    const editId = tsEl("pkEditId").value;
    const pola = tsEl("fPkPola").value;
    const mulai = tsEl("fPkMulai").value;
    const kode = tsEl("fPkKode").value;
    const libur = tsEl("fPkLibur").value;

    if (!pola) { tsSetMsg("pkMsg", "Pilih pola jadwal."); return; }
    if (!mulai) { tsSetMsg("pkMsg", "Tanggal efektif wajib diisi."); return; }
    if (!kode) { tsSetMsg("pkMsg", "Pilih shift awal (shift pada tanggal efektif)."); return; }
    if (!libur) { tsSetMsg("pkMsg", "Tanggal libur pertama wajib diisi."); return; }
    if (libur < mulai) { tsSetMsg("pkMsg", "Tanggal libur pertama tidak boleh sebelum tanggal efektif."); return; }

    if (editId) {
        const sebelumnya = m.riwayat.length >= 2 ? m.riwayat[m.riwayat.length - 2] : null;
        if (sebelumnya && mulai <= String(sebelumnya.berlaku_mulai).slice(0, 10)) {
            tsSetMsg("pkMsg", `Tanggal efektif harus setelah tanggal mulai pola sebelumnya (${tsFormatTanggal(sebelumnya.berlaku_mulai)}).`);
            return;
        }
    } else {
        const bentrok = m.riwayat.find(r => String(r.berlaku_mulai).slice(0, 10) >= mulai);
        if (bentrok) {
            tsSetMsg("pkMsg", `Sudah ada pola yang mulai berlaku pada atau setelah tanggal ini (mulai ${tsFormatTanggal(bentrok.berlaku_mulai)}). Pilih tanggal yang lebih akhir, atau gunakan Edit untuk mengubah pola terakhir.`);
            return;
        }
    }

    const btn = tsEl("btnSimpanPk");
    tsBusy(btn, true, "Menyimpan...");
    try {
        const res = editId
            ? await tsDb().rpc("ubah_pola_karyawan", {
                p_data: { id: editId, pola_id: pola, berlaku_mulai: mulai, kode_awal: kode, libur_pertama: libur }
            })
            : await tsDb().rpc("pasang_pola_karyawan", {
                p_data: { employee_id: m.emp.employee_id, pola_id: pola, berlaku_mulai: mulai, kode_awal: kode, libur_pertama: libur, oleh: tsNik() }
            });
        if (res.error) throw res.error;
        const hasil = res.data || {};

        tsModal("modalPolaKaryawan").hide();
        await pkLoad();
        tsReload("pola").catch(() => {});   // jumlah pemakai di daftar pola ikut diperbarui
        let pesan = editId ? "Pola karyawan diperbarui." : "Jadwal baru dipasang.";
        if (hasil.ada_kandidat_lain) pesan += ` Ada lebih dari satu posisi siklus yang cocok; dipakai posisi ${hasil.posisi_awal}.`;
        tsToast(pesan);
    } catch (err) {
        console.error("Gagal menyimpan pola karyawan:", err);
        tsSetMsg("pkMsg", tsPesanError(err));
    } finally {
        tsBusy(btn, false);
    }
}