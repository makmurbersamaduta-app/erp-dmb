// ===================================================
// js/module/operations/stg/artikel_bulk.js
// Handler Download Template & Upload Data Bulk Artikel
// ===================================================

// Header Standar Template Excel (A - BX)
const ARTIKEL_EXCEL_HEADERS = [
    "KODE ARTIKEL", "NAMA BARANG", "CUSTOMER", "Q-DB", "Q-DB2", "Q-BF", "Q-BF2", 
    "Q-BL", "Q-BL2", "Q-CF", "Q-CF2", "Q-CL", "Q-CL2", "FLUTE", "WIDTH", "LENGTH", 
    "P", "L", "T", "F1", "H", "F2", "K", "L1", "W1", "L2", "W2", "+/-", 
    "ITEM.TYPE", "LAYER TYPE", "PART.TYPE", "SHEET OUTPUT", "SHEET", "PCS", 
    "COLOURS #", "C1", "C2", "C3", "C4", "C5", "DIECUT", "STRIPPING", "JOINT", 
    "JOINT#", "STITCH WIRE", "DOUBLE STITCH", "TYING", "TYING TYPE", "PCS/BUNDLE", 
    "PALLET", "PCS/PALLET", "PACKING", "WRAPPING", "SCORING #", "SCR TYPE", 
    "SCORING DIRECTION", "TEAR TAPE", "STAMP", "WAX", "VENDOR", "DBS", "BFS", 
    "BLS", "CFS", "CLS", "OUT 1", "SIZE 1", "TRIM 1", "OUT 2", "SIZE 2", "TRIM 2", 
    "LIST QTTY", "KOLOM", "ITEM CODE", "ITEMTYPE"
];

// ---------------------------------------------------
// A. GENERATE TEMPLATE EXCEL (.xlsx)
// ---------------------------------------------------
function downloadArtikelTemplate() {
    try {
        if (typeof XLSX === "undefined") {
            alert("Library SheetJS (XLSX) belum dimuat! Pastikan koneksi internet aktif untuk memuat library XLSX.");
            return;
        }

        const sampleRow = {
            "KODE ARTIKEL": "B1-B1A060-0001A",
            "NAMA BARANG": "BOX DUS SAMPLE",
            "CUSTOMER": "PT DUTA MAKMUR BERSAMA",
            "FLUTE": "C",
            "WIDTH": 356,
            "LENGTH": 923,
            "P": 270,
            "L": 170,
            "T": 175,
            "PART.TYPE": "-",
            "JOINT": "GL",
            "PCS/PALLET": 500,
            "ITEMTYPE": "BA"
        };

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet([sampleRow], { header: ARTIKEL_EXCEL_HEADERS });

        XLSX.utils.book_append_sheet(wb, ws, "Database Artikel");
        XLSX.writeFile(wb, "Template_Upload_Artikel_DMB.xlsx");
    } catch (err) {
        console.error("Gagal mendownload template:", err);
        alert("Gagal mendownload template Excel: " + err.message);
    }
}

// Expose ke Scope Global (Window)
window.downloadArtikelTemplate = downloadArtikelTemplate;

// Helper Nilai Cell & Angka
function getRowValue(row, possibleKeys) {
    const cleanedRow = {};
    Object.keys(row).forEach(k => { cleanedRow[k.trim().toUpperCase()] = row[k]; });
    for (const key of possibleKeys) {
        const val = cleanedRow[key.toUpperCase()];
        if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
    }
    return null;
}

function parseNumber(val) {
    if (val === null || val === undefined) return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

// ---------------------------------------------------
// Otomatis hitung wrapping_ml berdasarkan aturan:
// a. PCS/PALLET harus > 0
// b. Nama Barang mengandung angka diikuti "ml"/"ML"
//    (contoh: "1500ML", "600 ML", "1500ml")
// c. Angka yang diambil adalah angka tepat sebelum "ml" itu
// Kalau salah satu syarat tidak terpenuhi -> null
// ---------------------------------------------------
function extractWrappingMl(namaBarang, pcsPalletVal) {
    if (!(pcsPalletVal > 0)) return null;
    if (!namaBarang) return null;

    // \b memastikan "ml" berdiri sebagai kata/singkatan sendiri,
    // bukan bagian dari kata lain (misal "Formal")
    const match = String(namaBarang).match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
    if (!match) return null;

    const rawNumber = match[1].replace(",", "."); // jaga-jaga kalau desimal pakai koma
    const num = parseFloat(rawNumber);
    return isNaN(num) ? null : num;
}

// ---------------------------------------------------
// B. PROSES UPLOAD EXCEL DARI MODAL
// ---------------------------------------------------
async function handleArtikelBulkUpload() {
    const fileInput = document.getElementById("uploadArtikelFileInput");
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert("Silakan pilih file Excel (.xlsx) terlebih dahulu!");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();
    const btnProcess = document.getElementById("btnProcessUpload");
    const origBtnText = btnProcess ? btnProcess.innerHTML : "Proses Upload";

    reader.onload = async function(e) {
        try {
            if (btnProcess) {
                btnProcess.disabled = true;
                btnProcess.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-2"></i> Mengunggah...`;
            }

            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

            if (jsonData.length === 0) {
                alert("File Excel kosong atau format tidak sesuai.");
                return;
            }

            const payloadList = [];
            let skippedCount = 0;

            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const kodeArtikel = getRowValue(row, ['KODE ARTIKEL', 'kode_artikel']);
                
                if (!kodeArtikel) {
                    skippedCount++;
                    continue;
                }

                const namaBarangVal = getRowValue(row, ['NAMA BARANG', 'nama_barang']);
                const pcsPalletVal = parseNumber(getRowValue(row, ['PCS/PALLET', 'pcs_pallet']));

                payloadList.push({
                    kode_artikel: kodeArtikel,
                    nama_barang: namaBarangVal,
                    customer: getRowValue(row, ['CUSTOMER', 'customer']),
                    flute: getRowValue(row, ['FLUTE', 'flute']),
                    width: parseNumber(getRowValue(row, ['WIDTH', 'width'])),
                    length: parseNumber(getRowValue(row, ['LENGTH', 'length'])),
                    panjang_box: parseNumber(getRowValue(row, ['P', 'panjang_box'])),
                    lebar_box: parseNumber(getRowValue(row, ['L', 'lebar_box'])),
                    tinggi_box: parseNumber(getRowValue(row, ['T', 'tinggi_box'])),
                    tipe_partisi: getRowValue(row, ['PART.TYPE', 'tipe_partisi']),
                    joint: getRowValue(row, ['JOINT', 'joint']),
                    pcs_pallet: pcsPalletVal,
                    item_type: getRowValue(row, ['ITEMTYPE', 'item_type']),
                    wrapping_ml: extractWrappingMl(namaBarangVal, pcsPalletVal)
                });
            }

            if (payloadList.length === 0) {
                alert("Tidak ada baris data valid yang memiliki 'KODE ARTIKEL'.");
                return;
            }

            // Upsert ke Supabase per Batch (200 data/batch)
            const BATCH_SIZE = 200;
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < payloadList.length; i += BATCH_SIZE) {
                const batch = payloadList.slice(i, i + BATCH_SIZE);
                const { error } = await window.supabaseClient
                    .schema("stg_public")
                    .from("artikel")
                    .upsert(batch, { onConflict: 'kode_artikel' });

                if (error) {
                    console.error("Gagal upsert batch:", error);
                    failCount += batch.length;
                } else {
                    successCount += batch.length;
                }
            }

            alert(`Proses Bulk Upload Selesai!\n\n` +
                  `• Berhasil: ${successCount} data\n` +
                  `• Gagal: ${failCount} data\n` +
                  (skippedCount > 0 ? `• Dilewati (tanpa Kode Artikel): ${skippedCount} baris` : ""));

            // Sembunyikan Modal & Reset Input File
            const modalEl = document.getElementById("modalUploadArtikel");
            if (modalEl && typeof bootstrap !== "undefined") {
                const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                if (modalInstance) modalInstance.hide();
            }
            fileInput.value = "";

            // Refresh Tabel & Filter Panel
            if (typeof reloadArtikelTable === "function") await reloadArtikelTable();
            if (typeof loadReferenceData === "function" && typeof renderFilterPanel === "function") {
                await loadReferenceData();
                renderFilterPanel();
            }

        } catch (err) {
            alert("Gagal memproses file Excel: " + err.message);
        } finally {
            if (btnProcess) {
                btnProcess.disabled = false;
                btnProcess.innerHTML = origBtnText;
            }
        }
    };

    reader.readAsArrayBuffer(file);
}

window.handleArtikelBulkUpload = handleArtikelBulkUpload;

// Inisialisasi Event Listener
function initBulkActions() {
    const btnDownloadTemplate = document.getElementById("btnDownloadTemplate");
    if (btnDownloadTemplate && !btnDownloadTemplate.dataset.bound) {
        btnDownloadTemplate.addEventListener("click", downloadArtikelTemplate);
        btnDownloadTemplate.dataset.bound = "true";
    }

    const btnProcessUpload = document.getElementById("btnProcessUpload");
    if (btnProcessUpload && !btnProcessUpload.dataset.bound) {
        btnProcessUpload.addEventListener("click", handleArtikelBulkUpload);
        btnProcessUpload.dataset.bound = "true";
    }
}

document.addEventListener("DOMContentLoaded", initBulkActions);
if (document.readyState === "interactive" || document.readyState === "complete") {
    initBulkActions();
}