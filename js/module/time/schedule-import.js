// =====================================================================
// js/module/settings/schedule-import.js
// Import Jadwal: pilih karyawan, pilih tanggal, download template,
// upload file, submit.
//
// Dimuat SETELAH schedule.js dan memakai variabel/fungsi globalnya
// (S, $, supabaseClient, openCalendar, createFilterPanel, fmt, dll).
//
// ATURAN UPLOAD
//  * Employee ID di template = NIK karyawan. Saat upload, NIK diubah
//    menjadi employee_id (uuid) sebelum dikirim ke database.
//  * Semua sel wajib terisi. Satu sel kosong = upload gagal.
//  * Upload ATOMIK: dikirim dalam 1 permintaan; jika ada 1 baris gagal,
//    tidak ada data yang tersimpan sama sekali.
//  * Jumlah sel (karyawan x hari) dibatasi S.limit (dari database).
// =====================================================================

// ---------- 1. HELPER IMPORT ----------
const pick = { sel: new Set() };
let pickGroup; // filter modal pilih karyawan (aturan sama dengan filter halaman utama)
let pickReady = false;

const impDays = () => (S.imp.start ? diffDays(S.imp.start, S.imp.end) + 1 : 0);
const impCells = () => S.imp.ids.size * impDays();
const fmtNum = (n) => Number(n).toLocaleString('id-ID');

function resetUpload() {
    S.imp.rows = null;
    $('impFile').value = '';
    $('impResult').innerHTML = '';
}

// ---------- 2. TAMPILAN MODAL IMPORT ----------
// Dipanggil setiap ada perubahan pilihan karyawan / tanggal / file.
function updateImportUI() {
    const n = S.imp.ids.size;
    const days = impDays();
    const cells = impCells();
    const over = n > 0 && days > 0 && cells > S.limit;

    $('impRule').innerHTML =
        `<b>Batas upload: ${fmtNum(S.limit)} sel per file</b> (jumlah karyawan x jumlah hari). ` +
        'Upload bersifat <b>semua atau tidak sama sekali</b>: jika ada 1 baris yang gagal, ' +
        'tidak ada data yang tersimpan, jadi tidak ada data yang masuk sebagian.';

    $('empSummary').innerHTML = n
        ? `<b>${fmtNum(n)} karyawan terpilih</b><div class="sch-emp-list">${S.employees
            .filter((e) => S.imp.ids.has(e.employee_id))
            .map((e) => `<div>${esc(e.nama)} - ${esc(e.nik)}</div>`).join('')}</div>`
        : 'Belum ada karyawan dipilih.';

    $('impDate').innerHTML = days
        ? `Periode: <b>${fmt(S.imp.start)} s/d ${fmt(S.imp.end)}</b> (${days} hari)`
        : 'Belum ada periode dipilih (maksimal 1 bulan).';

    const q = $('impQuota');
    if (n > 0 && days > 0) {
        q.hidden = false;
        q.className = 'sch-quota' + (over ? ' over' : '');
        q.textContent = over
            ? `${fmtNum(n)} karyawan x ${days} hari = ${fmtNum(cells)} sel, melebihi batas ${fmtNum(S.limit)}. ` +
              `Untuk ${days} hari, maksimal ${fmtNum(Math.floor(S.limit / days))} karyawan per upload. Kurangi karyawan atau pendekkan periode.`
            : `${fmtNum(n)} karyawan x ${days} hari = ${fmtNum(cells)} sel (batas ${fmtNum(S.limit)}).`;
    } else {
        q.hidden = true;
    }

    const ready = n > 0 && days > 0 && !over;
    $('btnTpl').disabled = !ready;
    $('impFile').disabled = !ready;
    $('btnSubmit').disabled = !(ready && S.imp.rows);
}

// ---------- 3. MODAL PILIH KARYAWAN ----------
function pickList() {
    const q = $('pkSearch').value.trim().toLowerCase();
    return S.employees.filter((e) => pickGroup.match(e) && matchQ(e, q));
}
function renderPick() {
    const list = pickList();
    $('pkBody').innerHTML = list.map((e) =>
        `<tr><td><input type="checkbox" data-id="${esc(e.employee_id)}" ${pick.sel.has(e.employee_id) ? 'checked' : ''}></td>` +
        `<td>${esc(e.nama)}</td><td>${esc(e.nik)}</td><td>${esc(e.departemen_name)}</td><td>${esc(e.area_name)}</td><td>${esc(e.jabatan_name)}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="sch-empty">Tidak ada karyawan.</td></tr>';
    $('pkAll').checked = list.length > 0 && list.every((e) => pick.sel.has(e.employee_id));

    // Jika tanggal sudah dipilih, tampilkan sisa kuota sel
    const days = impDays();
    const over = days > 0 && pick.sel.size * days > S.limit;
    $('pkCount').innerHTML = `${fmtNum(pick.sel.size)} karyawan dipilih (${fmtNum(list.length)} tampil)` +
        (days > 0 ? ` - maks ${fmtNum(Math.floor(S.limit / days))} karyawan untuk ${days} hari` : '');
    $('pkCount').style.color = over ? '#b42318' : '';
    $('pkOk').disabled = over;
}

// ---------- 4. DOWNLOAD TEMPLATE ----------
// Baris = karyawan terpilih. Kolom tanggal = jadwal aktif saat ini
// (assignment / libur nasional / pola). Employee ID diisi NIK.
async function downloadTemplate() {
    const btn = $('btnTpl');
    btn.disabled = true;
    try {
        const emps = S.employees.filter((e) => S.imp.ids.has(e.employee_id));
        const jd = await fetchSchedule(emps.map((e) => e.employee_id), S.imp.start, S.imp.end);
        const days = listDays(S.imp.start, S.imp.end);
        const aoa = [['Employee ID', 'Full Name', 'Departemen', 'Area', 'Jabatan', ...days]];
        emps.forEach((e) => aoa.push([
            String(e.nik), e.nama, e.departemen_name || '', e.area_name || '', e.jabatan_name || '',
            ...days.map((d) => ((jd[e.employee_id] || {})[d] || {}).kode || ''),
        ]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        // Kolom NIK dipaksa format Teks agar angka nol di depan tidak hilang
        for (let r = 2; r <= aoa.length; r++) { if (ws['A' + r]) { ws['A' + r].t = 's'; ws['A' + r].z = '@'; } }
        ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, ...days.map(() => ({ wch: 13 }))];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Jadwal');
        XLSX.writeFile(wb, `template_jadwal_${S.imp.start}_${S.imp.end}.xlsx`);
    } catch (err) {
        showToast(`Gagal membuat template: ${err.message}`, 'danger');
    } finally {
        updateImportUI();
    }
}

// ---------- 5. VALIDASI FILE UPLOAD ----------
// Semua kesalahan dikumpulkan. Ada 1 error = upload ditolak.
// NIK diubah menjadi employee_id di sini.
function validateSheet(aoa) {
    const errs = [];
    if (aoa.length < 2) return { errs: ['File kosong atau tidak ada baris data.'] };

    const header = aoa[0].map((h) => String(h ?? '').trim());
    ['Employee ID', 'Full Name', 'Departemen', 'Area', 'Jabatan'].forEach((h, i) => {
        if (header[i] !== h) errs.push(`Header kolom ${i + 1} harus "${h}".`);
    });
    const days = listDays(S.imp.start, S.imp.end);
    const dh = header.slice(5);
    if (dh.length !== days.length || dh.some((h, i) => h !== days[i])) {
        errs.push(`Kolom tanggal harus ${days[0]} s/d ${days[days.length - 1]} (format YYYY-MM-DD), sesuai periode yang dipilih.`);
    }
    if (errs.length) return { errs };

    // Peta NIK -> employee_id, hanya untuk karyawan terpilih
    const nikToId = new Map();
    S.employees.filter((e) => S.imp.ids.has(e.employee_id)).forEach((e) => {
        const k = String(e.nik).trim();
        if (nikToId.has(k)) errs.push(`NIK ${k} dipakai lebih dari satu karyawan terpilih. Hubungi admin data karyawan.`);
        nikToId.set(k, e.employee_id);
    });

    const rows = [], seen = new Set();
    aoa.slice(1).forEach((row, i) => {
        if (row.every((c) => String(c ?? '').trim() === '')) return; // baris benar-benar kosong (sisa Excel) dilewati
        const n = i + 2; // nomor baris seperti di Excel
        const nik = String(row[0] ?? '').trim();
        if (!nik) { errs.push(`Baris ${n}: Employee ID (NIK) kosong.`); return; }
        const empId = nikToId.get(nik);
        if (!empId) { errs.push(`Baris ${n}: NIK "${nik}" bukan karyawan yang dipilih (pastikan kolom NIK berformat Teks, angka nol di depan jangan hilang).`); return; }
        if (seen.has(nik)) { errs.push(`Baris ${n}: NIK "${nik}" muncul lebih dari sekali.`); return; }
        seen.add(nik);
        days.forEach((d, j) => {
            const v = String(row[5 + j] ?? '').trim();
            if (!v) { errs.push(`Baris ${n}, ${d}: sel jadwal kosong.`); return; }
            const kode = S.masterUpper.get(v.toUpperCase());
            if (!kode) { errs.push(`Baris ${n}, ${d}: kode "${v}" tidak dikenal.`); return; }
            rows.push({ employee_id: empId, tanggal: d, kode });
        });
    });
    if (!errs.length && rows.length === 0) errs.push('Tidak ada baris data pada file.');
    if (!errs.length && rows.length > S.limit) errs.push(`Jumlah sel ${fmtNum(rows.length)} melebihi batas ${fmtNum(S.limit)} per upload.`);
    return errs.length ? { errs } : { rows, jumlahKaryawan: seen.size };
}

async function onFileChosen(e) {
    S.imp.rows = null;
    const f = e.target.files[0];
    if (!f) { $('impResult').innerHTML = ''; updateImportUI(); return; }
    try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        const res = validateSheet(aoa);
        if (res.errs) {
            const shown = res.errs.slice(0, 20).map((x) => `<li>${esc(x)}</li>`).join('');
            const more = res.errs.length > 20 ? `<li>...dan ${res.errs.length - 20} error lain</li>` : '';
            $('impResult').innerHTML = `<div class="sch-box err"><b>Upload gagal (${res.errs.length} error). Tidak ada data yang tersimpan. Perbaiki file lalu upload ulang.</b><ul>${shown}${more}</ul></div>`;
        } else {
            S.imp.rows = res.rows;
            $('impResult').innerHTML = `<div class="sch-box ok">File valid: ${fmtNum(res.jumlahKaryawan)} karyawan, ${fmtNum(res.rows.length)} sel jadwal. Klik Submit untuk menyimpan.</div>`;
        }
    } catch (err) {
        $('impResult').innerHTML = `<div class="sch-box err">File tidak bisa dibaca: ${esc(err.message)}</div>`;
    }
    updateImportUI();
}

// ---------- 6. SUBMIT (1 permintaan, atomik) ----------
async function submitImport() {
    const rows = S.imp.rows;
    if (!rows) return;
    $('btnSubmit').disabled = true;
    $('impProg').textContent = `Menyimpan ${fmtNum(rows.length)} sel...`;
    try {
        const { data, error } = await supabaseClient.rpc('jadwal_import', { p_rows: rows });
        if (error) throw error;
        showToast(`Import berhasil: ${fmtNum(data.diubah)} sel diubah, ${fmtNum(data.sama)} sel sama dengan jadwal aktif (tidak ditulis).`);
        closeM('mImport');
        resetUpload();
        S.imp.ids = new Set();
        await refresh();
    } catch (err) {
        // Ganti uuid pada pesan error menjadi NIK agar mudah dicari di file
        const idToNik = new Map(S.employees.map((x) => [x.employee_id, x.nik]));
        const msg = String(err.message || err).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            (id) => (idToNik.has(id) ? `NIK ${idToNik.get(id)}` : id));
        $('impResult').innerHTML = `<div class="sch-box err"><b>Gagal menyimpan. Tidak ada data yang tersimpan.</b><br>${esc(msg)}</div>`;
    } finally {
        $('impProg').textContent = '';
        updateImportUI();
    }
}

// ---------- 7. PASANG EVENT ----------
function initImport() {
    pickGroup = createFilterPanel($('pickFilterWrap'), () => renderPick(), true);
    $('btnImport').onclick = () => { $('impProg').textContent = ''; updateImportUI(); openM('mImport'); };
    $('btnSelEmp').onclick = () => { pick.sel = new Set(S.imp.ids); if (!pickReady) { pickGroup.refresh(); pickReady = true; } renderPick(); openM('mPick'); };
    $('btnSelDate').onclick = () => openCalendar(S.imp.start, S.imp.end, (s, e) => {
        S.imp.start = s; S.imp.end = e; resetUpload(); updateImportUI();
    });
    $('pkBody').addEventListener('change', (e) => {
        const id = e.target.dataset.id; if (!id) return;
        e.target.checked ? pick.sel.add(id) : pick.sel.delete(id);
        renderPick();
    });
    $('pkAll').addEventListener('change', (e) => {
        pickList().forEach((x) => (e.target.checked ? pick.sel.add(x.employee_id) : pick.sel.delete(x.employee_id)));
        renderPick();
    });
    $('pkSearch').addEventListener('input', renderPick);
    $('pkOk').onclick = () => { S.imp.ids = new Set(pick.sel); resetUpload(); closeM('mPick'); updateImportUI(); };
    $('btnTpl').onclick = downloadTemplate;
    $('impFile').addEventListener('change', onFileChosen);
    $('btnSubmit').onclick = submitImport;
}