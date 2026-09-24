// ===================================================
// LOGIKA TAMBAH KARYAWAN BARU (HIRING)
// Acuan File: js/module/employees/employee_create.js
// ===================================================

// Variable Global Master Data
let masterBranches = [];
let masterCostCenters = [];
let masterDepartments = [];
let masterAreas = [];
let masterBagians = [];
let masterJabatans = [];

let submitTarget = "return"; // "return" = kembali ke directory, "new" = reset form

// ==============================================================================
// HELPER: Hitung kode PTKP -- konsisten dengan logika di employee_bulk.js
// ==============================================================================
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
    } else {
        prefix = "TK";
    }

    return `${prefix}/${anakCount}`;
}

// Hitung ulang & tampilkan PTKP berdasarkan nilai form saat ini
function updatePtkpDisplay() {
    const status = document.getElementById("status_pernikahan")?.value;
    const gender = document.getElementById("jenis_kelamin")?.value;
    const anak = document.getElementById("anak")?.value;
    const ptkpInput = document.getElementById("ptkp");
    if (ptkpInput) {
        ptkpInput.value = hitungPtkp(status, gender, anak);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();
    setupHeaderUserProfile();
    await loadMasterDropdowns();
    setupEventListeners();
    setupCurrencyFormatters();

});

// ---------------------------------------------------
// SETUP HEADER USER PROFILE
// ---------------------------------------------------
function setupHeaderUserProfile() {
    try {
        const sessionData = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
        if (!sessionData) return;
        const user = JSON.parse(sessionData);

        const userNameEl = document.getElementById("headerUserName");
        const userRoleEl = document.getElementById("headerUserRole");

        if (userNameEl) userNameEl.innerText = user.fullName || user.nik || "Pengguna ERP";
        if (userRoleEl) userRoleEl.innerText = `${user.roleName || 'Admin HRD'}`;
    } catch (e) {
        console.warn("Gagal memuat profile header:", e);
    }
}

// ---------------------------------------------------
// 1. MEMUAT MASTER DROPDOWN DARI SUPABASE
// ---------------------------------------------------
async function loadMasterDropdowns() {
    if (typeof supabaseClient === "undefined") return;

    const fetchMaster = async (table) => {
        try {
            const { data } = await supabaseClient.from(table).select("*");
            return data || [];
        } catch (e) {
            console.error(`Gagal mengambil data ${table}:`, e);
            return [];
        }
    };

    // Ambil data paralel
    [masterBranches, masterCostCenters, masterDepartments, masterAreas, masterBagians, masterJabatans] = await Promise.all([
        fetchMaster("branches"),
        fetchMaster("cost_centers"),
        fetchMaster("departments"),
        fetchMaster("areas"),
        fetchMaster("bagians"),
        fetchMaster("jabatans")
    ]);

    // Populate dropdown statis
    populateSelect("branch_id", masterBranches, "id", "branch_name", "-- Pilih Cabang --");
    populateSelect("departemen_id", masterDepartments, "id", "department_name", "-- Pilih Departemen --");
    populateSelect("jabatan_id", masterJabatans, "id", "jabatan_name", "-- Pilih Jabatan --");

    // Reset dropdown terfilter (Cost Center, Area, Bagian) pada kondisi awal
    resetSelect("costcenter_id", "-- Pilih Cost Center --");
    resetSelect("area_id", "-- Pilih Area --");
    resetSelect("bagian_id", "-- Pilih Bagian --");
}

function populateSelect(elemId, items, valKey, textKey, defaultText) {
    const el = document.getElementById(elemId);
    if (!el) return;
    el.innerHTML = `<option value="">${defaultText}</option>`;
    items.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item[valKey];
        opt.textContent = item[textKey];
        el.appendChild(opt);
    });
}

function resetSelect(elemId, defaultText) {
    const el = document.getElementById(elemId);
    if (!el) return;
    el.innerHTML = `<option value="">${defaultText}</option>`;
    el.value = "";
}

// ---------------------------------------------------
// 2. SETUP EVENT LISTENERS
// ---------------------------------------------------
function setupEventListeners() {
    // Checkbox Domisili sama dengan KTP (Poin 1)
    const sameAsKtpCb = document.getElementById("same_as_ktp");
    if (sameAsKtpCb) {
        sameAsKtpCb.addEventListener("change", handleSameAsKtpChange);
    }

    const alamatKtpInput = document.getElementById("alamat_ktp");
    if (alamatKtpInput) {
        alamatKtpInput.addEventListener("input", handleAlamatKtpInput);
    }

    // Listener Perubahan Penempatan & Status (Poin 4, 6, 7, 8)
    const placementFields = ["branch_id", "costcenter_id", "departemen_id", "status_karyawan", "start_date"];
    placementFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", handlePlacementAndFiltering);
        }
    });

    // Form Action Buttons (Poin 9)
    document.getElementById("btnSaveAndReturn")?.addEventListener("click", () => { submitTarget = "return"; });
    document.getElementById("btnSaveAndNew")?.addEventListener("click", () => { submitTarget = "new"; });

    // Blur check NIK Duplicate
    document.getElementById("nik_karyawan")?.addEventListener("blur", handleCheckNikDuplicate);

    // Auto-hitung ulang PTKP saat field terkait berubah
    const ptkpTriggerFields = ["status_pernikahan", "jenis_kelamin", "anak"];
    ptkpTriggerFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", updatePtkpDisplay);
            el.addEventListener("input", updatePtkpDisplay);
        }
    });

    // Form Submit
    document.getElementById("formCreateEmployee")?.addEventListener("submit", handleFormSubmit);
}

// ---------------------------------------------------
// LOGIKA CHECKBOX DOMISILI SAMA DENGAN KTP (Poin 1)
// ---------------------------------------------------
function handleSameAsKtpChange() {
    const checkbox = document.getElementById("same_as_ktp");
    const alamatKtp = document.getElementById("alamat_ktp");
    const alamatDomisili = document.getElementById("alamat_domisili");

    if (!checkbox || !alamatKtp || !alamatDomisili) return;

    if (checkbox.checked) {
        alamatDomisili.value = alamatKtp.value;
        alamatDomisili.setAttribute("readonly", "readonly");
        alamatDomisili.classList.add("bg-light");
    } else {
        alamatDomisili.removeAttribute("readonly");
        alamatDomisili.classList.remove("bg-light");
    }
}

function handleAlamatKtpInput() {
    const checkbox = document.getElementById("same_as_ktp");
    const alamatKtp = document.getElementById("alamat_ktp");
    const alamatDomisili = document.getElementById("alamat_domisili");

    if (checkbox && checkbox.checked && alamatDomisili) {
        alamatDomisili.value = alamatKtp.value;
    }
}

// ---------------------------------------------------
// LOGIKA PENEMPATAN, FILTERING DROPDOWN & AUTO NIK
// ---------------------------------------------------
async function handlePlacementAndFiltering() {
    const branchVal = document.getElementById("branch_id")?.value || "";
    const ccSelect = document.getElementById("costcenter_id");
    const ccVal = ccSelect?.value || "";
    const deptVal = document.getElementById("departemen_id")?.value || "";
    const statusVal = document.getElementById("status_karyawan")?.value || "";
    const startDateVal = document.getElementById("start_date")?.value || "";

    // Tambahkan baris ini untuk mengecek visibilitas No Absen STG
    toggleNoAbsenStgVisibility();

    // 1. FILTER COST CENTER BERDASARKAN BRANCH (Poin 6)
    if (!branchVal) {
        resetSelect("costcenter_id", "-- Pilih Cost Center --");
        resetSelect("area_id", "-- Pilih Area --");
    } else {
        const filteredCC = masterCostCenters.filter(cc => String(cc.branch_id) === String(branchVal));
        populateSelect("costcenter_id", filteredCC, "id", "costcenter_name", "-- Pilih Cost Center --");
        
        // Pertahankan nilai jika masih relevan
        if (filteredCC.some(cc => String(cc.id) === String(ccVal))) {
            ccSelect.value = ccVal;
        } else {
            resetSelect("area_id", "-- Pilih Area --");
        }
    }

    // 2. FILTER AREA BERDASARKAN BRANCH DAN COST CENTER (Poin 7)
    const currentCcVal = document.getElementById("costcenter_id")?.value || "";
    if (!branchVal || !currentCcVal) {
        resetSelect("area_id", "-- Pilih Area --");
    } else {
        const filteredAreas = masterAreas.filter(a => 
            String(a.branch_id) === String(branchVal) && 
            String(a.cost_center_id) === String(currentCcVal)
        );
        populateSelect("area_id", filteredAreas, "id", "area_name", "-- Pilih Area --");
    }

    // 3. FILTER BAGIAN BERDASARKAN STATUS KARYAWAN (Poin 8)
    // Jika status BUKAN "Borongan", jangan munculkan pilihan pada bagian
    if (statusVal === "Borongan") {
        populateSelect("bagian_id", masterBagians, "id", "bagian_name", "-- Pilih Bagian --");
    } else {
        resetSelect("bagian_id", "-- Pilih Bagian --");
    }

    // 4. AUTOFILL NIK KARYAWAN (Poin 2 & Poin 4)
    // Poin 2: NIK Karyawan TIDAK di-readonly (bisa diedit pengguna)
    const nikInput = document.getElementById("nik_karyawan");
    if (nikInput) {
        nikInput.removeAttribute("readonly");
        nikInput.classList.remove("bg-light");
    }

    await generateNikAuto(statusVal, branchVal, deptVal, startDateVal);

    // Refresh Fixed Salary jika payroll Fixed
    if (document.getElementById("payroll_type")?.value === "Fixed") {
        fetchFixedSalaryData();
    }
}


// ---------------------------------------------------
// GENERATE NIK OTOMATIS BERDASARKAN 3 ATURAN (Poin 4)
// ---------------------------------------------------
async function generateNikAuto(statusKaryawan, branchId, deptId, startDateVal) {
    const nikInput = document.getElementById("nik_karyawan");
    if (!nikInput) return;

    try {
        let generatedNik = "";

        // a. STATUS = "Borongan" (Format: A001 -> A999 -> B001)
        if (statusKaryawan === "Borongan") {
            const { data: emps } = await supabaseClient
                .schema('hrd')
                .from('employees')
                .select('nik_karyawan');

            let currentLetter = 'A';
            let maxSeq = 0;

            (emps || []).forEach(e => {
                const nik = (e.nik_karyawan || "").trim();
                const match = nik.match(/^([A-Z])(\d{3})$/);
                if (match) {
                    const letter = match[1];
                    const seq = parseInt(match[2], 10);
                    if (letter > currentLetter) {
                        currentLetter = letter;
                        maxSeq = seq;
                    } else if (letter === currentLetter && seq > maxSeq) {
                        maxSeq = seq;
                    }
                }
            });

            if (maxSeq >= 999) {
                currentLetter = String.fromCharCode(currentLetter.charCodeAt(0) + 1);
                maxSeq = 1;
            } else {
                maxSeq += 1;
            }

            generatedNik = `${currentLetter}${String(maxSeq).padStart(3, '0')}`;
        } 
        // b. STATUS = "Reliver" (Format: DMBR + branch_id + dept_id + YY + MM + Seq 001)
        else if (statusKaryawan === "Reliver") {
            if (!branchId || !deptId) return;

            const d = startDateVal ? new Date(startDateVal) : new Date();
            const yy = String(d.getFullYear()).slice(-2);
            const mm = String(d.getMonth() + 1).padStart(2, '0');

            const prefix = `DMBR${branchId}${deptId}${yy}${mm}`;

            const { data: emps } = await supabaseClient
                .schema('hrd')
                .from('employees')
                .select('nik_karyawan')
                .like('nik_karyawan', `${prefix}%`);

            let maxSeq = 0;
            (emps || []).forEach(e => {
                const nik = (e.nik_karyawan || "").trim();
                const seqStr = nik.replace(prefix, "");
                const seq = parseInt(seqStr, 10);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            });

            const nextSeq = maxSeq >= 999 ? 1 : maxSeq + 1;
            generatedNik = `${prefix}${String(nextSeq).padStart(3, '0')}`;
        } 
        // c. STATUS KARYAWAN LAINNYA (PKWTT, PKWT, DLL) (Format: DMB + branch_id + dept_id + YY + MM + Seq 001)
        else if (statusKaryawan !== "") {
            if (!branchId || !deptId) return;

            const d = startDateVal ? new Date(startDateVal) : new Date();
            const yy = String(d.getFullYear()).slice(-2);
            const mm = String(d.getMonth() + 1).padStart(2, '0');

            const prefix = `DMB${branchId}${deptId}${yy}${mm}`;

            const { data: emps } = await supabaseClient
                .schema('hrd')
                .from('employees')
                .select('nik_karyawan')
                .like('nik_karyawan', `${prefix}%`);

            let maxSeq = 0;
            (emps || []).forEach(e => {
                const nik = (e.nik_karyawan || "").trim();
                const seqStr = nik.replace(prefix, "");
                const seq = parseInt(seqStr, 10);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            });

            const nextSeq = maxSeq >= 999 ? 1 : maxSeq + 1;
            generatedNik = `${prefix}${String(nextSeq).padStart(3, '0')}`;
        }

        if (generatedNik) {
            nikInput.value = generatedNik;
            nikInput.classList.remove("is-invalid");
        }
    } catch (err) {
        console.error("Gagal generate NIK otomatis:", err);
    }
}

// Check NIK Duplikat saat OnBlur
async function handleCheckNikDuplicate(e) {
    const nik = e.target.value.trim();
    if (!nik) return;

    try {
        const { data } = await supabaseClient
            .schema('hrd')
            .from('employees')
            .select('id, nama')
            .eq('nik_karyawan', nik)
            .maybeSingle();

        if (data) {
            alert(`PERINGATAN: NIK '${nik}' sudah terdaftar atas nama ${data.nama}! Harap gunakan NIK lain.`);
            e.target.classList.add("is-invalid");
        } else {
            e.target.classList.remove("is-invalid");
        }
    } catch (err) {
        console.error("Error checking NIK duplicate:", err);
    }
}

// ---------------------------------------------------
// 5. SUBMIT HANDLER FORM SIMPAN DATA
// ---------------------------------------------------
async function handleFormSubmit(e) {
    e.preventDefault();

    const btnSubmit = submitTarget === "return" 
        ? document.getElementById("btnSaveAndReturn") 
        : document.getElementById("btnSaveAndNew");
    
    if (!btnSubmit) return;
    const originalText = btnSubmit.innerHTML;

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...`;

    try {
        const nikVal = document.getElementById("nik_karyawan").value.trim();
        if (!nikVal) throw new Error("NIK Karyawan wajib diisi/dihasilkan!");

        // Payload hrd.employees
        const employeePayload = {
            nik_karyawan: nikVal,
            nik_ktp: document.getElementById("nik_ktp").value.trim(),
            nama: document.getElementById("nama").value.trim(),
            email: `${nikVal.toLowerCase()}@supabase.mail`,
            tempat_lahir: document.getElementById("tempat_lahir").value.trim(),
            tanggal_lahir: document.getElementById("tanggal_lahir").value,
            jenis_kelamin: document.getElementById("jenis_kelamin").value,
            agama: document.getElementById("agama").value,
            pendidikan: document.getElementById("pendidikan").value || null,
            status_pernikahan: document.getElementById("status_pernikahan").value,
            anak: parseInt(document.getElementById("anak").value || 0, 10),
            ibu_kandung: document.getElementById("ibu_kandung").value.trim(),
            no_telp: document.getElementById("no_telp").value.trim() || null,
            alamat_ktp: document.getElementById("alamat_ktp").value.trim(),
            alamat_domisili: document.getElementById("alamat_domisili").value.trim() || null,
            npwp: document.getElementById("npwp").value.trim() || null,
            bank: document.getElementById("bank").value || null,
            no_rekening: document.getElementById("no_rekening").value.trim() || null,
            bpjs_ketenagakerjaan: document.getElementById("bpjs_ketenagakerjaan").value.trim() || null,
            bpjs_kesehatan: document.getElementById("bpjs_kesehatan").value.trim() || null,
            is_active: true,
            blacklist: false,
            ptkp: hitungPtkp(
                document.getElementById("status_pernikahan").value,
                document.getElementById("jenis_kelamin").value,
                document.getElementById("anak").value
            ),
            no_absen_stg: document.getElementById("status_karyawan").value === "Borongan" ? (document.getElementById("no_absen_stg")?.value.trim() || null) : null
            };

        // Payload hrd.employee_assignments
        // Poin 3: action_type diisi "New Hire"
        const statusKaryawanVal2 = document.getElementById("status_karyawan").value;
        const assignmentPayload = {
            action_type: "NEW_HIRE",
            branch_id: document.getElementById("branch_id").value || null,
            costcenter_id: document.getElementById("costcenter_id").value || null,
            departemen_id: document.getElementById("departemen_id").value || null,
            area_id: document.getElementById("area_id").value || null,
            bagian_id: document.getElementById("bagian_id").value || null,
            jabatan_id: document.getElementById("jabatan_id").value || null,
            status_karyawan: statusKaryawanVal2,
            start_date: document.getElementById("start_date").value || null,
            is_active: true
        };

        // Panggil RPC -- employees + employee_assignments (+ trigger
        // auto-create users) semuanya dieksekusi dalam 1 transaksi.
        // Kalau salah satu gagal, semuanya dibatalkan (all-or-nothing).
        const { data: rpcResult, error: rpcError } = await supabaseClient
            .schema("hrd")
            .rpc("create_employee_with_assignment", {
                employee_data: employeePayload,
                assignment_data: assignmentPayload
            });

        if (rpcError) throw rpcError;

        alert("Data Karyawan Baru Berhasil Disimpan!");

        if (submitTarget === "return") {
            window.location.href = "directory.html";
        } else {
            document.getElementById("formCreateEmployee").reset();
            handleSameAsKtpChange();
            handlePlacementAndFiltering();
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalText;
        }

    } catch (err) {
        console.error("Gagal menyimpan data karyawan:", err);
        alert("Gagal menyimpan data: " + err.message);
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalText;
    }
}

// Fungsi untuk Menampilkan/Sembunyikan Kolom No. Absen STG
function toggleNoAbsenStgVisibility() {
    const statusVal = document.getElementById("status_karyawan")?.value;
    const containerStg = document.getElementById("container_no_absen_stg");
    const inputStg = document.getElementById("no_absen_stg");

    if (containerStg) {
        if (statusVal === "Borongan") {
            containerStg.style.display = "block"; // Tampilkan jika Borongan
        } else {
            containerStg.style.display = "none";  // Sembunyikan jika bukan Borongan
            if (inputStg) inputStg.value = "";    // Kosongkan nilainya
        }
    }
}

