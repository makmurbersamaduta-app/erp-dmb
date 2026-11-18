// ===================================================
// js/module/time/time_lokasi.js
// Tab "Lokasi Absen" pada halaman Time Settings.
// File ini memakai fungsi bantu dari time_settings.js (tsEl, tsDb, tsEsc,
// tsToast, tsModal, tsBusy, tsSetMsg, tsPesanError, tsRowKosong, tsNik,
// tsRadioGet, tsRadioSet) dan karena itu harus dimuat SETELAH file tersebut.
// Tabel: lokasi_absen_setting, lokasi_absen_titik, lokasi_absen_karyawan
// (lihat time_modul1c_lokasi.sql). Peta memakai Leaflet + OpenStreetMap.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN
// Fungsi: nilai tetap yang mudah diubah.
//  - LK_DEFAULT_CENTER / LK_DEFAULT_ZOOM : posisi awal peta bila belum ada titik
//    (angka awal = Surabaya, ubah sesuai lokasi usaha Anda).
//  - LK_NEGARA     : pencarian alamat dibatasi ke negara ini ("id" = Indonesia).
//  - LK_PER_PAGE   : baris per halaman di tabel Karyawan.
//  - LK_PICK_LIMIT : jumlah maksimal karyawan yang ditampilkan di daftar pilihan modal.
// ===================================================
const LK_DEFAULT_CENTER = [-7.2575, 112.7521];
const LK_DEFAULT_ZOOM = 12;
const LK_NEGARA = "id";
const LK_PER_PAGE = 25;
const LK_PICK_LIMIT = 100;

// ===================================================
// KELOMPOK 2: STATE (data sementara di memori)
//  edit.titik     : daftar titik pada form yang sedang dibuka
//  edit.aktifIdx  : titik yang sedang dipilih (yang dipindahkan oleh klik peta)
//  edit.karyawan  : Map employee_id -> data karyawan yang dipilih untuk setting ini
// ===================================================
const lkState = {
    loaded: false,
    settings: [],
    map: null,
    layer: null,
    edit: { id: null, titik: [], aktifIdx: -1, karyawan: new Map() },
    pick: [],
    pickToken: 0,
    hasilCari: [],
    kar: { page: 1, total: 0, loaded: false }
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU
// ===================================================
// Membersihkan kata pencarian dari karakter khusus filter
function lkClean(q) { return String(q || "").replace(/[%_,()]/g, "").trim(); }

function lkNamaCc(id) {
    if (id == null) return "-";
    const c = tsState.costCenters.find(x => Number(x.id) === Number(id));
    return c ? c.costcenter_name : `#${id}`;
}

// Mengisi dropdown cost center (filter tabel Karyawan dan filter daftar pilihan modal)
function lkIsiOpsiCc() {
    const opsi = '<option value="">Semua cost center</option>' +
        tsState.costCenters.map(c => `<option value="${c.id}">${tsEsc(c.costcenter_name)}</option>`).join("");
    ["lkKarCc", "lkPickCc"].forEach(id => {
        const el = tsEl(id);
        const lama = el.value;
        el.innerHTML = opsi;
        el.value = lama;
    });
}

// Mengambil SEMUA baris (Supabase membatasi 1000 baris per permintaan)
async function lkFetchAll(buatQuery) {
    const hasil = [];
    const ukuran = 1000;
    for (let dari = 0; ; dari += ukuran) {
        const r = await buatQuery().range(dari, dari + ukuran - 1);
        if (r.error) throw r.error;
        hasil.push(...(r.data || []));
        if ((r.data || []).length < ukuran) break;
    }
    return hasil;
}

function lkMode() { return tsRadioGet("lkMode") || "lokasi"; }

function lkPesanPeta(teks, tipe) {
    const el = tsEl("lkMapMsg");
    el.textContent = teks;
    el.className = "form-text" + (tipe === "error" ? " text-danger" : "");
}

// ===================================================
// KELOMPOK 4: PEMASANGAN TOMBOL & EVENT
// ===================================================
function tsSetupLokasi() {
    // Sub-tab: Setting Lokasi / Karyawan
    document.querySelectorAll("#lkTabs [data-lktab]").forEach(btn => {
        btn.addEventListener("click", () => {
            const t = btn.dataset.lktab;
            document.querySelectorAll("#lkTabs .nav-link").forEach(b => b.classList.toggle("active", b === btn));
            tsEl("lk-pane-setting").classList.toggle("d-none", t !== "setting");
            tsEl("lk-pane-karyawan").classList.toggle("d-none", t !== "karyawan");
            if (t === "karyawan") lkLoadKaryawan();
        });
    });

    // Tabel setting
    tsEl("filterLokasi").addEventListener("change", lkRenderSettings);
    tsEl("btnTambahLokasi").addEventListener("click", () => lkOpen(null));
    tsEl("lokasiTableBody").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        if (btn.dataset.act === "edit") lkOpen(btn.dataset.id);
        else if (btn.dataset.act === "toggle") lkToggleSetting(btn.dataset.id);
    });

    // Modal
    tsEl("formLokasi").addEventListener("submit", lkSave);
    // Enter di kolom isian tidak boleh menyimpan form; di kolom alamat Enter berarti "Cari"
    tsEl("formLokasi").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.tagName === "INPUT") {
            e.preventDefault();
            if (e.target.id === "lkCari") lkCariAlamat();
        }
    });
    document.querySelectorAll('input[name="lkMode"]').forEach(r => r.addEventListener("change", lkToggleMode));
    tsEl("modalLokasi").addEventListener("shown.bs.modal", () => {
        lkInitMap();
        lkGambarPeta(true);
        lkCariKaryawanModal();
    });

    // Titik lokasi
    tsEl("btnTambahTitik").addEventListener("click", lkTambahTitik);
    tsEl("btnCariAlamat").addEventListener("click", lkCariAlamat);
    tsEl("lkCariHasil").addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (b) lkPilihHasilCari(Number(b.dataset.i));
    });
    const listTitik = tsEl("lkTitikList");
    listTitik.addEventListener("click", (e) => {
        const baris = e.target.closest(".lk-titik");
        if (!baris) return;
        const i = Number(baris.dataset.i);
        if (e.target.closest('[data-act="hapus"]')) lkHapusTitik(i);
        else lkPilihTitik(i);
    });
    listTitik.addEventListener("input", (e) => {
        const f = e.target.dataset.f;
        const baris = e.target.closest(".lk-titik");
        if (!f || !baris) return;
        const t = lkState.edit.titik[Number(baris.dataset.i)];
        if (!t) return;
        if (f === "nama") t.nama = e.target.value;
        else if (f === "radius_meter") t.radius_meter = e.target.value === "" ? "" : parseInt(e.target.value, 10);
        else if (f === "latitude") { t.latitude = e.target.value === "" ? null : parseFloat(e.target.value); t.alamat = ""; }
        else if (f === "longitude") { t.longitude = e.target.value === "" ? null : parseFloat(e.target.value); t.alamat = ""; }
    });
    // Peta digambar ulang setelah isian selesai diubah (bukan tiap ketikan)
    listTitik.addEventListener("change", () => lkGambarPeta());

    // Karyawan di dalam modal
    let timerPick;
    tsEl("lkPickCari").addEventListener("input", () => { clearTimeout(timerPick); timerPick = setTimeout(lkCariKaryawanModal, 350); });
    tsEl("lkPickCc").addEventListener("change", lkCariKaryawanModal);
    tsEl("lkSelFilter").addEventListener("input", lkRenderSel);
    tsEl("btnLkTambahSemua").addEventListener("click", () => {
        lkState.pick.forEach(r => lkState.edit.karyawan.set(r.employee_id, r));
        lkState.pick = [];
        lkRenderPick();
        lkRenderSel();
    });
    tsEl("lkPickList").addEventListener("click", (e) => {
        const b = e.target.closest("[data-id]");
        if (!b) return;
        const idx = lkState.pick.findIndex(x => x.employee_id === b.dataset.id);
        if (idx < 0) return;
        const [r] = lkState.pick.splice(idx, 1);
        lkState.edit.karyawan.set(r.employee_id, r);
        lkRenderPick();
        lkRenderSel();
    });
    tsEl("lkSelList").addEventListener("click", (e) => {
        const b = e.target.closest("[data-id]");
        if (!b) return;
        const r = lkState.edit.karyawan.get(b.dataset.id);
        lkState.edit.karyawan.delete(b.dataset.id);
        if (r) lkState.pick.unshift(r);
        lkRenderPick();
        lkRenderSel();
    });

    // Tabel Karyawan
    let timerKar;
    tsEl("lkKarCari").addEventListener("input", () => { clearTimeout(timerKar); timerKar = setTimeout(() => { lkState.kar.page = 1; lkLoadKaryawan(); }, 350); });
    tsEl("lkKarCc").addEventListener("change", () => { lkState.kar.page = 1; lkLoadKaryawan(); });
    tsEl("lkKarStatus").addEventListener("change", () => { lkState.kar.page = 1; lkLoadKaryawan(); });
    tsEl("lkKarPrev").addEventListener("click", () => { if (lkState.kar.page > 1) { lkState.kar.page--; lkLoadKaryawan(); } });
    tsEl("lkKarNext").addEventListener("click", () => {
        if (lkState.kar.page < Math.ceil(lkState.kar.total / LK_PER_PAGE)) { lkState.kar.page++; lkLoadKaryawan(); }
    });
    tsEl("lkKarBody").addEventListener("change", (e) => {
        const sel = e.target.closest("select[data-emp]");
        if (sel) lkUbahKaryawan(sel);
    });

    if (!tsState.canEdit) tsEl("lkKarBody").dataset.readonly = "1";
}

// Dipanggil time_settings.js saat tab "Lokasi Absen" dibuka
async function tsLokasiOnOpen() {
    lkIsiOpsiCc();
    if (!lkState.loaded) await lkLoadSettings();
}

// ===================================================
// KELOMPOK 5: DAFTAR SETTING LOKASI
// ===================================================
async function lkLoadSettings() {
    tsEl("lokasiTableBody").innerHTML = tsRowKosong(6, "Memuat data...");
    try {
        const r = await tsDb().from("v_lokasi_setting").select("*").order("nama");
        if (r.error) throw r.error;
        lkState.settings = r.data || [];
        lkState.loaded = true;
        lkRenderSettings();
    } catch (err) {
        console.error("Gagal memuat setting lokasi:", err);
        tsEl("lokasiTableBody").innerHTML = tsRowKosong(6, `Gagal memuat data: ${tsEsc(tsPesanError(err))}. Pastikan time_modul1c_lokasi.sql sudah dijalankan.`);
    }
}

function lkRenderSettings() {
    const f = tsEl("filterLokasi").value;
    const rows = lkState.settings.filter(s => f === "semua" ? true : (f === "aktif" ? s.is_active : !s.is_active));
    if (rows.length === 0) { tsEl("lokasiTableBody").innerHTML = tsRowKosong(6, "Belum ada setting lokasi."); return; }
    tsEl("lokasiTableBody").innerHTML = rows.map(s => {
        const flex = s.mode === "flexible";
        const mode = flex
            ? '<span class="badge bg-info-subtle text-info-emphasis">GPS Flexible</span>'
            : '<span class="badge bg-primary-subtle text-primary">Set Lokasi</span>';
        const titik = flex
            ? '<span class="text-muted">Bebas, tanpa titik</span>'
            : `${tsEsc(s.daftar_titik || "-")}<div class="small text-muted">${Number(s.jumlah_titik)} titik</div>`;
        const aksi = tsState.canEdit ? `
            <button class="btn btn-sm btn-light text-primary me-1" data-act="edit" data-id="${tsEsc(s.id)}" title="Ubah"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-light ${s.is_active ? "text-danger" : "text-success"}" data-act="toggle" data-id="${tsEsc(s.id)}" title="${s.is_active ? "Nonaktifkan" : "Aktifkan"}"><i class="fa-solid ${s.is_active ? "fa-ban" : "fa-check"}"></i></button>` : "";
        return `<tr>
            <td class="fw-semibold">${tsEsc(s.nama)}</td>
            <td>${mode}</td>
            <td>${titik}</td>
            <td class="text-center">${Number(s.jumlah_karyawan)}</td>
            <td>${tsBadgeAktif(s.is_active)}</td>
            <td class="text-center">${aksi}</td>
        </tr>`;
    }).join("");
}

async function lkToggleSetting(id) {
    const s = lkState.settings.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`Yakin ingin ${s.is_active ? "menonaktifkan" : "mengaktifkan"} setting lokasi "${s.nama}"?`)) return;
    try {
        const { error } = await tsDb().from("lokasi_absen_setting").update({ is_active: !s.is_active }).eq("id", id);
        if (error) throw error;
        await lkLoadSettings();
    } catch (err) {
        alert("Gagal mengubah status: " + tsPesanError(err));
    }
}

// ===================================================
// KELOMPOK 6: MODAL SETTING LOKASI (buka, mode, simpan)
// ===================================================
async function lkOpen(id) {
    const s = id ? lkState.settings.find(x => x.id === id) : null;
    if (id && !s) return;

    const ed = { id: id || null, titik: [], aktifIdx: -1, karyawan: new Map() };
    if (id) {
        try {
            const [t, kar] = await Promise.all([
                tsDb().from("lokasi_absen_titik").select("*").eq("setting_id", id).order("urutan"),
                lkFetchAll(() => tsDb().from("v_karyawan_lokasi")
                    .select("employee_id, nik_karyawan, nama, costcenter_id")
                    .eq("setting_id", id).order("nama").order("employee_id"))
            ]);
            if (t.error) throw t.error;
            ed.titik = (t.data || []).map(x => ({
                nama: x.nama, radius_meter: x.radius_meter,
                latitude: Number(x.latitude), longitude: Number(x.longitude), alamat: x.alamat || ""
            }));
            kar.forEach(r => ed.karyawan.set(r.employee_id, r));
        } catch (err) {
            alert("Gagal memuat setting lokasi: " + tsPesanError(err));
            return;
        }
    }
    if (ed.titik.length) ed.aktifIdx = 0;
    lkState.edit = ed;
    lkState.pick = [];
    lkState.hasilCari = [];

    tsEl("formLokasi").reset();
    tsSetMsg("lokasiMsg", "");
    lkIsiOpsiCc();
    tsEl("lokasiEditId").value = id || "";
    tsEl("modalLokasiTitle").textContent = id ? `Ubah Setting Lokasi` : "Tambah Setting Lokasi";
    tsEl("fLokasiNama").value = s ? s.nama : "";
    tsRadioSet("lkMode", s ? s.mode : "lokasi");
    tsEl("fLokasiAktif").checked = s ? !!s.is_active : true;
    tsEl("wrapLokasiAktif").classList.toggle("d-none", !id);
    tsEl("lkCari").value = "";
    tsEl("lkCariHasil").innerHTML = "";
    tsEl("lkPickCari").value = "";
    tsEl("lkSelFilter").value = "";
    lkPesanPeta("Pilih satu titik di daftar, lalu klik peta, seret pin, atau pilih hasil pencarian alamat untuk menentukan koordinatnya.");

    lkToggleMode();
    lkRenderTitik();
    lkRenderPick();
    lkRenderSel();
    tsModal("modalLokasi").show();
}

// Bagian titik & peta hanya muncul untuk mode Set Lokasi
function lkToggleMode() {
    const lokasi = lkMode() === "lokasi";
    tsEl("lkLokasiSection").classList.toggle("d-none", !lokasi);
    if (lokasi && lkState.map) {
        setTimeout(() => { lkState.map.invalidateSize(); lkGambarPeta(true); }, 50);
    }
}

async function lkSave(e) {
    e.preventDefault();
    const ed = lkState.edit;
    const nama = tsEl("fLokasiNama").value.trim();
    const mode = lkMode();
    const aktif = ed.id ? tsEl("fLokasiAktif").checked : true;

    if (!nama) { tsSetMsg("lokasiMsg", "Nama setting wajib diisi."); return; }

    let titik = [];
    if (mode === "lokasi") {
        if (ed.titik.length === 0) { tsSetMsg("lokasiMsg", "Mode Set Lokasi wajib punya minimal satu titik."); return; }
        for (let i = 0; i < ed.titik.length; i++) {
            const t = ed.titik[i];
            const no = `Titik ${i + 1}`;
            if (!String(t.nama || "").trim()) { tsSetMsg("lokasiMsg", `${no}: nama lokasi wajib diisi.`); return; }
            if (!Number.isInteger(t.radius_meter) || t.radius_meter < 1 || t.radius_meter > 10000) { tsSetMsg("lokasiMsg", `${no}: radius harus angka bulat 1 sampai 10.000 meter.`); return; }
            if (!Number.isFinite(t.latitude) || t.latitude < -90 || t.latitude > 90) { tsSetMsg("lokasiMsg", `${no}: latitude belum diisi atau di luar rentang -90 sampai 90.`); return; }
            if (!Number.isFinite(t.longitude) || t.longitude < -180 || t.longitude > 180) { tsSetMsg("lokasiMsg", `${no}: longitude belum diisi atau di luar rentang -180 sampai 180.`); return; }
        }
        titik = ed.titik.map(t => ({
            nama: String(t.nama).trim(),
            radius_meter: t.radius_meter,
            latitude: Number(t.latitude.toFixed(6)),
            longitude: Number(t.longitude.toFixed(6)),
            alamat: t.alamat || ""
        }));
    }
    if (!aktif && ed.karyawan.size > 0) {
        tsSetMsg("lokasiMsg", "Setting nonaktif tidak boleh memiliki karyawan. Lepas karyawannya dulu atau biarkan setting tetap aktif.");
        return;
    }

    const btn = tsEl("btnSimpanLokasi");
    tsBusy(btn, true, "Menyimpan...");
    try {
        const { error } = await tsDb().rpc("simpan_lokasi_setting", {
            p_data: {
                id: ed.id,
                nama,
                mode,
                is_active: aktif,
                oleh: tsNik(),
                titik,
                employee_ids: Array.from(ed.karyawan.keys())
            }
        });
        if (error) throw error;
        tsModal("modalLokasi").hide();
        await lkLoadSettings();
        if (lkState.kar.loaded) await lkLoadKaryawan();
        tsToast(ed.id ? "Setting lokasi diperbarui." : "Setting lokasi ditambahkan.");
    } catch (err) {
        console.error("Gagal menyimpan setting lokasi:", err);
        tsSetMsg("lokasiMsg", tsPesanError(err));
    } finally {
        tsBusy(btn, false);
    }
}

// ===================================================
// KELOMPOK 7: TITIK LOKASI (daftar di kiri)
// Setiap titik: nama lokasi, radius (meter), latitude, longitude.
// Titik "aktif" = yang akan dipindahkan oleh klik peta / pencarian alamat.
// ===================================================
function lkRenderTitik() {
    const ed = lkState.edit;
    const box = tsEl("lkTitikList");
    if (ed.titik.length === 0) {
        box.innerHTML = '<div class="text-muted small p-2">Belum ada titik. Klik "Tambah Titik".</div>';
        return;
    }
    box.innerHTML = ed.titik.map((t, i) => `
        <div class="lk-titik ${i === ed.aktifIdx ? "active" : ""}" data-i="${i}">
            <div class="row g-1 align-items-end">
                <div class="col-7">
                    <div class="ts-label">Nama Lokasi</div>
                    <input type="text" class="form-control form-control-sm" data-f="nama" maxlength="100" value="${tsEsc(t.nama)}" placeholder="mis. Gudang Utama">
                </div>
                <div class="col-4">
                    <div class="ts-label">Radius (m)</div>
                    <input type="number" class="form-control form-control-sm" data-f="radius_meter" min="1" max="10000" value="${tsEsc(t.radius_meter)}">
                </div>
                <div class="col-1 text-end">
                    <button type="button" class="btn btn-sm btn-light text-danger" data-act="hapus" title="Hapus titik"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="col-6">
                    <div class="ts-label">Latitude</div>
                    <input type="number" step="any" class="form-control form-control-sm" data-f="latitude" value="${t.latitude ?? ""}" placeholder="belum ditentukan">
                </div>
                <div class="col-6">
                    <div class="ts-label">Longitude</div>
                    <input type="number" step="any" class="form-control form-control-sm" data-f="longitude" value="${t.longitude ?? ""}" placeholder="belum ditentukan">
                </div>
            </div>
            ${t.alamat ? `<div class="small text-muted mt-1">${tsEsc(t.alamat)}</div>` : ""}
        </div>`).join("");
}

function lkTambahTitik() {
    const ed = lkState.edit;
    ed.titik.push({ nama: "", radius_meter: 100, latitude: null, longitude: null, alamat: "" });
    ed.aktifIdx = ed.titik.length - 1;
    lkRenderTitik();
    lkGambarPeta();
    const kolom = tsEl("lkTitikList").querySelector(`.lk-titik[data-i="${ed.aktifIdx}"] [data-f="nama"]`);
    if (kolom) kolom.focus();
    lkPesanPeta("Titik baru belum punya koordinat. Klik peta, seret pin, atau cari alamat untuk menentukannya.");
}

function lkHapusTitik(i) {
    const ed = lkState.edit;
    ed.titik.splice(i, 1);
    ed.aktifIdx = ed.titik.length ? Math.min(i, ed.titik.length - 1) : -1;
    lkRenderTitik();
    lkGambarPeta();
}

// Memilih titik aktif tanpa menggambar ulang daftar (agar kursor di isian tidak hilang)
function lkPilihTitik(i) {
    const ed = lkState.edit;
    ed.aktifIdx = i;
    tsEl("lkTitikList").querySelectorAll(".lk-titik").forEach(el => el.classList.toggle("active", Number(el.dataset.i) === i));
    lkGambarPeta();
    const t = ed.titik[i];
    if (lkState.map && t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) lkState.map.panTo([t.latitude, t.longitude]);
}

function lkSetKoordinat(i, lat, lng, alamat) {
    const t = lkState.edit.titik[i];
    if (!t) {
        lkPesanPeta("Tambahkan atau pilih titik di daftar terlebih dahulu.", "error");
        return;
    }
    t.latitude = Number(lat.toFixed(6));
    t.longitude = Number(lng.toFixed(6));
    t.alamat = alamat || "";
    lkPesanPeta("Koordinat titik diperbarui.");
    lkRenderTitik();
    lkGambarPeta();
}

// ===================================================
// KELOMPOK 8: PETA (Leaflet) & PENCARIAN ALAMAT (Nominatim)
// Pin aktif bisa diseret; lingkaran = radius absensi.
// Pencarian alamat memakai layanan gratis Nominatim (OpenStreetMap):
// dibatasi sekitar 1 permintaan per detik, cukup untuk penggunaan admin.
// ===================================================
function lkInitMap() {
    if (lkState.map) { lkState.map.invalidateSize(); return; }
    if (typeof L === "undefined") {
        lkPesanPeta("Peta gagal dimuat (Leaflet tidak tersedia). Koordinat tetap bisa diisi manual.", "error");
        return;
    }
    const map = L.map("lkMap").setView(LK_DEFAULT_CENTER, LK_DEFAULT_ZOOM);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    lkState.layer = L.layerGroup().addTo(map);
    map.on("click", (e) => lkSetKoordinat(lkState.edit.aktifIdx, e.latlng.lat, e.latlng.lng, ""));
    lkState.map = map;
}

// fit = true: zoom peta agar semua titik terlihat
function lkGambarPeta(fit) {
    const map = lkState.map;
    if (!map) return;
    lkState.layer.clearLayers();
    const semua = [];
    lkState.edit.titik.forEach((t, i) => {
        if (!Number.isFinite(t.latitude) || !Number.isFinite(t.longitude)) return;
        const aktif = i === lkState.edit.aktifIdx;
        const ll = [t.latitude, t.longitude];
        if (Number(t.radius_meter) > 0) {
            // interactive:false supaya klik di dalam lingkaran tetap menggeser pin ke titik klik
            semua.push(L.circle(ll, {
                radius: Number(t.radius_meter), interactive: false,
                color: aktif ? "#0d6efd" : "#64748b", weight: aktif ? 2 : 1, fillOpacity: 0.12
            }).addTo(lkState.layer));
        }
        const m = L.marker(ll, { draggable: aktif, title: t.nama || `Titik ${i + 1}` }).addTo(lkState.layer);
        m.on("click", () => lkPilihTitik(i));
        m.on("dragend", (e) => { const p = e.target.getLatLng(); lkSetKoordinat(i, p.lat, p.lng, ""); });
        semua.push(m);
    });
    if (fit) {
        if (semua.length) map.fitBounds(L.featureGroup(semua).getBounds().pad(0.2), { maxZoom: 17 });
        else map.setView(LK_DEFAULT_CENTER, LK_DEFAULT_ZOOM);
    }
}

async function lkCariAlamat() {
    const q = tsEl("lkCari").value.trim();
    const box = tsEl("lkCariHasil");
    if (!q) return;
    const btn = tsEl("btnCariAlamat");
    tsBusy(btn, true, "Mencari...");
    box.innerHTML = "";
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=${LK_NEGARA}&accept-language=id&q=${encodeURIComponent(q)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Layanan pencarian alamat tidak merespons (kode ${res.status}). Coba lagi sebentar.`);
        const data = await res.json();
        lkState.hasilCari = data;
        box.innerHTML = data.length
            ? data.map((d, i) => `<button type="button" class="list-group-item list-group-item-action small" data-i="${i}">${tsEsc(d.display_name)}</button>`).join("")
            : '<div class="small text-muted p-2">Alamat tidak ditemukan. Coba kata kunci lebih umum (nama jalan, kota) atau klik langsung pada peta.</div>';
    } catch (err) {
        box.innerHTML = `<div class="small text-danger p-2">${tsEsc(err.message || "Gagal mencari alamat.")}</div>`;
    } finally {
        tsBusy(btn, false);
    }
}

function lkPilihHasilCari(i) {
    const d = lkState.hasilCari[i];
    const ed = lkState.edit;
    if (!d) return;
    if (ed.titik.length === 0) lkTambahTitik();
    if (ed.aktifIdx < 0) ed.aktifIdx = 0;
    const lat = parseFloat(d.lat), lng = parseFloat(d.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    lkSetKoordinat(ed.aktifIdx, lat, lng, d.display_name);
    if (lkState.map) lkState.map.setView([lat, lng], 17);
    tsEl("lkCariHasil").innerHTML = "";
}

// ===================================================
// KELOMPOK 9: KARYAWAN DI DALAM MODAL
// Daftar kiri = karyawan yang BELUM punya setting lokasi (ditambah yang sudah
// memakai setting ini saat diubah). Daftar kanan = karyawan terpilih.
// Perubahan baru tersimpan saat tombol Simpan ditekan.
// ===================================================
async function lkCariKaryawanModal() {
    const ed = lkState.edit;
    const q = lkClean(tsEl("lkPickCari").value).toLowerCase();
    const cc = tsEl("lkPickCc").value;
    const token = ++lkState.pickToken;
    tsEl("lkPickList").innerHTML = '<div class="small text-muted p-2">Memuat...</div>';
    try {
        let query = tsDb().from("v_karyawan_lokasi")
            .select("employee_id, nik_karyawan, nama, costcenter_id, setting_id")
            .order("nama").order("employee_id").limit(LK_PICK_LIMIT);
        query = ed.id ? query.or(`setting_id.is.null,setting_id.eq.${ed.id}`) : query.is("setting_id", null);
        if (q) query = query.ilike("cari", `%${q}%`);
        if (cc) query = query.eq("costcenter_id", cc);
        const r = await query;
        if (token !== lkState.pickToken) return; // ada pencarian yang lebih baru
        if (r.error) throw r.error;
        lkState.pick = (r.data || []).filter(x => !ed.karyawan.has(x.employee_id));
        lkRenderPick();
    } catch (err) {
        console.error("Gagal memuat karyawan:", err);
        tsEl("lkPickList").innerHTML = `<div class="small text-danger p-2">Gagal memuat karyawan: ${tsEsc(tsPesanError(err))}</div>`;
    }
}

function lkRenderPick() {
    const rows = lkState.pick;
    tsEl("lkPickInfo").textContent = rows.length ? `${rows.length} karyawan tersedia (maks. ${LK_PICK_LIMIT} ditampilkan)` : "";
    tsEl("btnLkTambahSemua").disabled = rows.length === 0;
    tsEl("lkPickList").innerHTML = rows.length
        ? rows.map(r => `<div class="ts-row">
              <span><span class="fw-semibold">${tsEsc(r.nik_karyawan)}</span> ${tsEsc(r.nama)}<span class="text-muted small"> · ${tsEsc(lkNamaCc(r.costcenter_id))}</span></span>
              <button type="button" class="btn btn-sm btn-outline-primary py-0" data-id="${tsEsc(r.employee_id)}"><i class="fa-solid fa-plus"></i></button>
          </div>`).join("")
        : '<div class="small text-muted p-2">Tidak ada karyawan yang tersedia untuk pencarian ini.</div>';
}

function lkRenderSel() {
    const MAKS = 200;
    const q = lkClean(tsEl("lkSelFilter").value).toLowerCase();
    const semua = Array.from(lkState.edit.karyawan.values());
    const rows = semua.filter(r => !q || `${r.nik_karyawan} ${r.nama}`.toLowerCase().includes(q));
    tsEl("lkSelCount").textContent = `(${semua.length} dipilih)`;
    tsEl("lkSelList").innerHTML = rows.length
        ? rows.slice(0, MAKS).map(r => `<div class="ts-row">
              <span><span class="fw-semibold">${tsEsc(r.nik_karyawan)}</span> ${tsEsc(r.nama)}</span>
              <button type="button" class="btn btn-sm btn-light text-danger py-0" data-id="${tsEsc(r.employee_id)}" title="Lepas"><i class="fa-solid fa-xmark"></i></button>
          </div>`).join("") + (rows.length > MAKS ? `<div class="small text-muted p-2">dan ${rows.length - MAKS} lainnya (gunakan filter untuk mempersempit).</div>` : "")
        : '<div class="small text-muted p-2">Belum ada karyawan terpilih.</div>';
}

// ===================================================
// KELOMPOK 10: TABEL KARYAWAN
// Fungsi: semua karyawan aktif (tidak blacklist), dibagi per halaman dari server.
// Memilih setting di kolom paling kanan LANGSUNG tersimpan dan langsung berlaku.
// Karyawan hanya bisa punya satu setting; memilih setting lain berarti memindahkan.
// ===================================================
async function lkLoadKaryawan() {
    const body = tsEl("lkKarBody");
    const kar = lkState.kar;
    lkIsiOpsiCc();
    body.innerHTML = tsRowKosong(5, "Memuat data...");
    const q = lkClean(tsEl("lkKarCari").value).toLowerCase();
    const cc = tsEl("lkKarCc").value;
    const st = tsEl("lkKarStatus").value;
    try {
        const dari = (kar.page - 1) * LK_PER_PAGE;
        let query = tsDb().from("v_karyawan_lokasi")
            .select("employee_id, nik_karyawan, nama, costcenter_id, setting_id, setting_nama", { count: "exact" })
            .order("nama").order("employee_id")
            .range(dari, dari + LK_PER_PAGE - 1);
        if (q) query = query.ilike("cari", `%${q}%`);
        if (cc) query = query.eq("costcenter_id", cc);
        if (st === "belum") query = query.is("setting_id", null);
        if (st === "sudah") query = query.not("setting_id", "is", null);
        const r = await query;
        if (r.error) throw r.error;
        kar.total = r.count || 0;
        kar.loaded = true;

        const aktif = lkState.settings.filter(s => s.is_active);
        const disabled = tsState.canEdit ? "" : "disabled";
        body.innerHTML = (r.data || []).length
            ? r.data.map((k, i) => {
                const adaDiAktif = aktif.some(s => s.id === k.setting_id);
                const opsi = '<option value="">- Belum diatur -</option>'
                    + aktif.map(s => `<option value="${tsEsc(s.id)}" ${s.id === k.setting_id ? "selected" : ""}>${tsEsc(s.nama)}${s.mode === "flexible" ? " (GPS Flexible)" : ""}</option>`).join("")
                    + (k.setting_id && !adaDiAktif ? `<option value="${tsEsc(k.setting_id)}" selected>${tsEsc(k.setting_nama)} (nonaktif)</option>` : "");
                return `<tr>
                    <td class="text-center">${dari + i + 1}</td>
                    <td>${tsEsc(k.nik_karyawan)}</td>
                    <td>${tsEsc(k.nama)}</td>
                    <td>${tsEsc(lkNamaCc(k.costcenter_id))}</td>
                    <td><select class="form-select form-select-sm" data-emp="${tsEsc(k.employee_id)}" data-lama="${tsEsc(k.setting_id || "")}" ${disabled}>${opsi}</select></td>
                </tr>`;
            }).join("")
            : tsRowKosong(5, "Tidak ada karyawan yang cocok.");

        const awal = kar.total === 0 ? 0 : dari + 1;
        const akhir = Math.min(dari + LK_PER_PAGE, kar.total);
        tsEl("lkKarInfo").textContent = `Menampilkan ${awal}-${akhir} dari ${kar.total} karyawan`;
        tsEl("lkKarPrev").disabled = kar.page <= 1;
        tsEl("lkKarNext").disabled = kar.page >= Math.ceil(kar.total / LK_PER_PAGE);
    } catch (err) {
        console.error("Gagal memuat karyawan:", err);
        body.innerHTML = tsRowKosong(5, `Gagal memuat data: ${tsEsc(tsPesanError(err))}. Pastikan time_modul1c_lokasi.sql sudah dijalankan.`);
    }
}

async function lkUbahKaryawan(sel) {
    const lama = sel.dataset.lama || "";
    const baru = sel.value;
    if (baru === lama) return;
    sel.disabled = true;
    try {
        const { error } = await tsDb().rpc("set_lokasi_karyawan", {
            p_employee_id: sel.dataset.emp,
            p_setting_id: baru || null,
            p_oleh: tsNik()
        });
        if (error) throw error;
        tsToast(baru ? "Setting lokasi karyawan disimpan." : "Setting lokasi karyawan dilepas.");
        await lkLoadSettings();   // jumlah karyawan di tabel setting ikut diperbarui
        await lkLoadKaryawan();   // posisi baris bisa berubah bila filter status aktif
    } catch (err) {
        sel.value = lama;
        sel.disabled = false;
        alert("Gagal menyimpan: " + tsPesanError(err));
    }
}