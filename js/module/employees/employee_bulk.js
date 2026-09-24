/**
 * ============================================================================
 * WEB ERP PT DUTA MAKMUR BERSAMA
 * Module: Employee Bulk Management
 * File: employee_bulk.js
 * Deskripsi: Penanganan Khusus Download Template & Upload Excel Data Bulk Karyawan
 * ============================================================================
 */

// ============================================================================
// HELPER: Ambil nilai dari baris Excel dengan toleransi variasi header
// (mencoba beberapa kemungkinan nama kolom, dan mengabaikan spasi
// berlebih di awal/akhir nama header maupun nilainya)
// ============================================================================
function getRowValue(row, possibleKeys) {
    // Bangun versi "dibersihkan" dari row: key di-trim, supaya header
    // dengan spasi tersembunyi (misal "Agama " dengan spasi di akhir)
    // tetap terbaca dengan benar.
    const cleanedRow = {};
    Object.keys(row).forEach(k => {
        cleanedRow[k.trim()] = row[k];
    });

    for (const key of possibleKeys) {
        const val = cleanedRow[key];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
            return String(val).trim();
        }
    }
    return null;
}

// ============================================================================
// HELPER: Hitung kode PTKP berdasarkan status pernikahan, jenis kelamin,
// dan jumlah anak. Contoh hasil: "TK/0", "K/3"
// ============================================================================
function hitungPtkp(statusPernikahan, jenisKelamin, jumlahAnak) {
    const status = (statusPernikahan || "").toLowerCase().trim();
    const gender = (jenisKelamin || "").toLowerCase().trim();
    const rawAnak = parseInt(jumlahAnak) || 0;
    const anakCount = Math.min(Math.max(rawAnak, 0), 3);

    let prefix;

    if (status === "lajang") {
        prefix = "TK";
    } else if (gender === "perempuan" && (status === "menikah" || status === "cerai")) {
        prefix = "TK";
    } else if (status === "menikah") {
        prefix = "K";
    } 
    else {
        prefix = "TK";
    }

    return `${prefix}/${anakCount}`;
}

document.addEventListener("DOMContentLoaded", () => {
    // Bind Event Listeners Bulk Upload
    const btnProcessBulk = document.getElementById("btnProcessBulk");
    if (btnProcessBulk) {
        btnProcessBulk.addEventListener("click", handleBulkExcelUpload);
    }

    const btnDownloadTemplate = document.getElementById("btnDownloadTemplate");
    if (btnDownloadTemplate) {
        btnDownloadTemplate.addEventListener("click", downloadBulkTemplate);
    }
});

// ============================================================================
// 1. GENERATE TEMPLATE EXCEL BULK DENGAN NOTE PETUNJUK & ID MASTER
// ============================================================================
function downloadBulkTemplate() {
    if (typeof XLSX === "undefined") {
        alert("Library SheetJS (XLSX) belum dimuat pada halaman!");
        return;
    }

    // A. Contoh Row Data Template Excel Sesuai Kebutuhan Field
    const templateData = [
        {
            // -----------------------------------------------------------------
            // [MIGRASI PHASE] KOLOM NIK KARYAWAN
            // -----------------------------------------------------------------
            "NIK": "DMB112608001",
            // -----------------------------------------------------------------
            
            "No KTP": "3275012345670001",
            "Nama": "Budi Santoso",
            "Tempat Lahir": "Bekasi",
            "Tanggal Lahir": "1995-05-20",
            "Jenis Kelamin": "Laki-laki",
            "Pendidikan": "S1",
            "Agama": "Islam",
            "Status Pernikahan": "Menikah",
            "Jumlah Anak": 1,
            "Ibu Kandung": "Siti Aminah",
            "No Telp": "081234567890",
            "Alamat KTP": "Jl. Raya Serang Km 15, Cikarang",
            "Alamat Domisili": "Jl. Mawar No. 12, Bekasi",
            "NPWP": "12.345.678.9-012.000",
            "Nama Bank": "BCA",
            "No Rekening": "1234567890",
            "BPJS Ketenagakerjaan": "00012345678",
            "BPJS Kesehatan": "00098765432",
            "Status Karyawan": "PKWT",
            "Tanggal Masuk": "2026-08-01",
            "branch_id": 1,
            "costcenter_id": 1,
            "departemen_id": 1,
            "area_id": 1,
            "bagian_id": 1,
            "jabatan_id": 1
        }
    ];

    // B. Sheet Petunjuk / Note Acuan Pengisian Data (Panduan User)
    const guideData = [
        { "Kategori Field": "STATUS KARYAWAN (Mandatory)", "Pilihan Nilai / Format": "Tetap, PKWT, PKWTT, Borongan, Freelance, Harian" },
        { "Kategori Field": "JENIS KELAMIN (Mandatory)", "Pilihan Nilai / Format": "Laki-laki, Perempuan" },
        { "Kategori Field": "PENDIDIKAN (Mandatory)", "Pilihan Nilai / Format": "SD, SMP, SMA, D3, S1, S2" },
        { "Kategori Field": "AGAMA (Mandatory)", "Pilihan Nilai / Format": "Islam, Kristen, Katolik, Hindu, Buddha, Khonghucu" },
        { "Kategori Field": "STATUS PERNIKAHAN (Mandatory)", "Pilihan Nilai / Format": "Lajang, Menikah, Cerai" },
        { "Kategori Field": "NAMA BANK", "Pilihan Nilai / Format": "BCA, Mandiri, BNI, BRI, CIMB, Danamon, Permata, Lainnya" },
        { "Kategori Field": "FORMAT TANGGAL", "Pilihan Nilai / Format": "YYYY-MM-DD (Contoh: 2026-08-01)" },
        { "Kategori Field": "--- DAFTAR ID MASTER ---", "Pilihan Nilai / Format": "--- Ambil ID Angka dari Master Data ---" }
    ];

    // Sisipkan Daftar ID Master Cache jika tersedia
    if (typeof masterCache !== "undefined") {
        masterCache.branches.forEach(b => guideData.push({ "Kategori Field": "Cabang (branch_id)", "Pilihan Nilai / Format": `ID: ${b.id} -> ${b.branch_name}` }));
        masterCache.cost_centers.forEach(c => guideData.push({ "Kategori Field": "Cost Center (costcenter_id)", "Pilihan Nilai / Format": `ID: ${c.id} -> ${c.costcenter_name}` }));
        masterCache.departments.forEach(d => guideData.push({ "Kategori Field": "Departemen (departemen_id)", "Pilihan Nilai / Format": `ID: ${d.id} -> ${d.department_name}` }));
        masterCache.areas.forEach(a => guideData.push({ "Kategori Field": "Area (area_id)", "Pilihan Nilai / Format": `ID: ${a.id} -> ${a.area_name}` }));
        masterCache.bagians.forEach(bg => guideData.push({ "Kategori Field": "Bagian (bagian_id)", "Pilihan Nilai / Format": `ID: ${bg.id} -> ${bg.bagian_name}` }));
        masterCache.jabatans.forEach(j => guideData.push({ "Kategori Field": "Jabatan (jabatan_id)", "Pilihan Nilai / Format": `ID: ${j.id} -> ${j.jabatan_name}` }));
    }

    const wb = XLSX.utils.book_new();
    const wsTemplate = XLSX.utils.json_to_sheet(templateData);
    const wsGuide = XLSX.utils.json_to_sheet(guideData);

    XLSX.utils.book_append_sheet(wb, wsTemplate, "Template Bulk");
    XLSX.utils.book_append_sheet(wb, wsGuide, "Petunjuk & Master ID");

    XLSX.writeFile(wb, "Template_Upload_Bulk_Karyawan_DMB.xlsx");
}

// ============================================================================
// 2. PROSES UPLOAD & VALIDASI EXCEL BULK
// ============================================================================
async function handleBulkExcelUpload() {
    const fileInput = document.getElementById("bulkExcelFile");
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert("Silakan pilih file Excel (.xlsx) terlebih dahulu!");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                alert("File Excel kosong atau format tidak sesuai.");
                return;
            }

            let successCount = 0;
            let failCount = 0;
            let errorLogs = [];

            const btnProcess = document.getElementById("btnProcessBulk");
            const origText = btnProcess ? btnProcess.innerHTML : "Proses Upload";
            if (btnProcess) {
                btnProcess.disabled = true;
                btnProcess.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Mengunggah & Memproses...`;
            }

            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const rowNum = i + 2; // Baris Excel (Header = 1)

                // =========================================================================
                // [MIGRASI PHASE] KHUSUS KOLOM NIK KARYAWAN
                // Saat ini NIK diambil dari data Excel yang di-upload untuk proses migrasi.
                // Setelah migrasi selesai, block ini dapat di-comment/dihapus 
                // dan digantikan dengan Auto-Generate NIK.
                // =========================================================================
                
                const nikKaryawanVal = getRowValue(row, ['nik_karyawan', 'NIK Karyawan', 'NIK']);

                // =========================================================================

                // Validasi Field Mandatory
                const nikKtp = getRowValue(row, ['nik_ktp', 'No KTP', 'NIK KTP']);
                const nama = getRowValue(row, ['nama', 'Nama']);
                const tempatLahir = getRowValue(row, ['tempat_lahir', 'Tempat Lahir']);
                const tanggalLahir = getRowValue(row, ['tanggal_lahir', 'Tanggal Lahir']);
                const jenisKelamin = getRowValue(row, ['jenis_kelamin', 'Jenis Kelamin']);
                const pendidikan = getRowValue(row, ['pendidikan', 'Pendidikan']);
                const agama = getRowValue(row, ['agama', 'Agama']);
                const statusPernikahan = getRowValue(row, ['status_pernikahan', 'Status Pernikahan']);
                const anakRaw = getRowValue(row, ['anak', 'Jumlah Anak']);
                const anak = anakRaw !== null ? anakRaw : undefined;
                const ibuKandung = getRowValue(row, ['ibu_kandung', 'Ibu Kandung']);
                const alamatKtp = getRowValue(row, ['alamat_ktp', 'Alamat KTP']);

                const branchId = getRowValue(row, ['branch_id', 'Cabang ID']);
                const costcenterId = getRowValue(row, ['costcenter_id', 'Cost Center ID']);
                const departemenId = getRowValue(row, ['departemen_id', 'department_id', 'Departemen ID']);
                const areaId = getRowValue(row, ['area_id', 'Area ID']);
                const jabatanId = getRowValue(row, ['jabatan_id', 'Jabatan ID']);
                const statusKaryawan = getRowValue(row, ['status_karyawan', 'Status Karyawan']);
                const startDate = getRowValue(row, ['start_date', 'Tanggal Masuk']);

                if (!nikKtp || !nama || !tempatLahir || !tanggalLahir || !jenisKelamin || 
                    !pendidikan || !agama || !statusPernikahan || anak === undefined || 
                    !ibuKandung || !alamatKtp || !branchId || !costcenterId || 
                    !departemenId || !areaId || !jabatanId || !statusKaryawan || !startDate) {
                    
                    failCount++;
                    errorLogs.push(`Baris ${rowNum}: Field Mandatory tidak lengkap.`);
                    continue;
                }

                // Payload Insert hrd.employees
                const empPayload = {
                    nik_karyawan: nikKaryawanVal ? String(nikKaryawanVal) : null,
                    email: nikKaryawanVal ? `${String(nikKaryawanVal).toLowerCase()}@supabase.mail` : null,
                    nik_ktp: String(nikKtp),
                    nama: String(nama),
                    tempat_lahir: String(tempatLahir),
                    tanggal_lahir: String(tanggalLahir),
                    jenis_kelamin: String(jenisKelamin),
                    pendidikan: String(pendidikan),
                    agama: String(agama),
                    status_pernikahan: String(statusPernikahan),
                    anak: parseInt(anak) || 0,
                    ibu_kandung: String(ibuKandung),
                    no_telp: getRowValue(row, ['no_telp', 'No Telp']),
                    alamat_ktp: String(alamatKtp),
                    alamat_domisili: getRowValue(row, ['alamat_domisili', 'Alamat Domisili']),
                    npwp: getRowValue(row, ['npwp', 'NPWP']),
                    bank: getRowValue(row, ['bank', 'Nama Bank']),
                    no_rekening: getRowValue(row, ['no_rekening', 'No Rekening']),
                    bpjs_ketenagakerjaan: getRowValue(row, ['bpjs_ketenagakerjaan', 'BPJS Ketenagakerjaan']),
                    bpjs_kesehatan: getRowValue(row, ['bpjs_kesehatan', 'BPJS Kesehatan']),
                    ptkp: hitungPtkp(statusPernikahan, jenisKelamin, anak),
                    is_active: true
                };

                const { data: insertedEmp, error: errEmp } = await supabaseClient.schema('hrd')
                    .from('employees')
                    .insert([empPayload])
                    .select()
                    .single();

                if (errEmp) {
                    failCount++;
                    errorLogs.push(`Baris ${rowNum} (Employees): ${errEmp.message}`);
                    continue;
                }

                // Payload Insert hrd.employee_assignments
                const assignPayload = {
                    employee_id: insertedEmp.id,
                    action_type: 'NEW_HIRE',
                    branch_id: parseInt(branchId),
                    costcenter_id: parseInt(costcenterId),
                    departemen_id: parseInt(departemenId),
                    area_id: parseInt(areaId),
                    bagian_id: row['bagian_id'] ? parseInt(row['bagian_id']) : null,
                    jabatan_id: parseInt(jabatanId),
                    status_karyawan: String(statusKaryawan),
                    start_date: String(startDate),
                    is_active: true
                };

                const { error: errAssign } = await supabaseClient.schema('hrd')
                    .from('employee_assignments')
                    .insert([assignPayload]);

                if (errAssign) {
                    failCount++;
                    errorLogs.push(`Baris ${rowNum} (Assignment): ${errAssign.message}`);
                } else {
                    successCount++;
                }
            }

            let msg = `Proses Bulk Upload Selesai!\n\nBerhasil: ${successCount} data\nGagal/Format Salah: ${failCount} data`;
            if (errorLogs.length > 0) {
                msg += `\n\nRincian Error:\n` + errorLogs.slice(0, 5).join("\n");
                if (errorLogs.length > 5) msg += `\n...dan ${errorLogs.length - 5} error lainnya.`;
            }
            alert(msg);

            const modalEl = document.getElementById("modalBulkData");
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
            fileInput.value = "";

            if (typeof loadDirectoryData === "function") {
                await loadDirectoryData();
            }

            if (btnProcess) {
                btnProcess.disabled = false;
                btnProcess.innerHTML = origText;
            }

        } catch (parseErr) {
            alert("Gagal memproses file Excel: " + parseErr.message);
            const btnProcess = document.getElementById("btnProcessBulk");
            if (btnProcess) {
                btnProcess.disabled = false;
                btnProcess.innerHTML = "Proses Upload";
            }
        }
    };

    reader.readAsArrayBuffer(file);
}