/**
 * ==============================================================================
 * DMB ERP SYSTEM - Module Employee Management (Edit Karyawan)
 * File   : js/module/employees/employee_edit.js
 * Schema : hrd (employees, employee_assignments), public (branches, cost_centers, areas, departments, bagians, jabatans)
 * ==============================================================================
 */

// Global State
let currentEmpId = null;
let currentAssignmentId = null;
let hasCareerHistory = false; // Flag penanda apakah karyawan punya riwayat Mutasi / Resign
let originalNikKaryawan = ""; // NIK saat data pertama kali dimuat, untuk deteksi perubahan NIK

let masterBranches = [];
let masterCostCenters = [];
let masterAreas = [];
let masterDepartments = [];
let masterBagians = [];
let masterJabatans = [];

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
    // 1. Auth Guard
    if (typeof checkAuthGuard === "function") {
        checkAuthGuard();
    }

    // 2. Tampilkan Profil User di Header Top-Right
    await loadHeaderUserProfile();

    // 3. Ambil ID Karyawan dari Query String URL (?id=xxx)
    const urlParams = new URLSearchParams(window.location.search);
    currentEmpId = urlParams.get("id");

    if (!currentEmpId) {
        alert("ID Karyawan tidak ditemukan atau URL tidak valid.");
        window.location.href = "directory.html";
        return;
    }

    // 4. Setup Event Listeners UI
    setupEventListeners();

    // 5. Load Master Data & Detail Karyawan
    try {
        await loadMasterData();
        await loadEmployeeData(currentEmpId);
    } catch (err) {
        console.error("Gagal memuat data awal edit karyawan:", err);
        alert("Terjadi kesalahan saat memuat data karyawan: " + (err.message || err));
    }
});

// ==============================================================================
// 1. HEADER PROFIL PENGGUNA (FIXED)
// ==============================================================================
async function loadHeaderUserProfile() {
    try {
        let userName = "";
        let userRole = "";

        // Pengecekan via local/session storage "erp_session"
        const sessionData = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
        if (sessionData) {
            const parsed = JSON.parse(sessionData);
            userName = parsed.fullName || parsed.nama || parsed.nik || "";
            userRole = parsed.roleName || parsed.role || "";
        }

        // Fallback via Supabase Auth jika session lokal tidak ada / incomplete
        if (!userName && typeof supabaseClient !== "undefined") {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                userName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "";
                userRole = session.user.user_metadata?.role || "Admin HRD";
            }
        }

        const nameEl = document.getElementById("headerUserName");
        const roleEl = document.getElementById("headerUserRole");

        if (nameEl) nameEl.innerText = userName || "Pengguna ERP";
        if (roleEl) roleEl.innerText = userRole || "Admin HRD";
    } catch (e) {
        console.warn("Gagal memuat profil header:", e);
    }
}

// ==============================================================================
// 2. MEMUAT DATA MASTER DROPDOWN
// ==============================================================================
async function loadMasterData() {
    const fetchMaster = async (table) => {
        try {
            const { data } = await supabaseClient.schema("public").from(table).select("*");
            return data || [];
        } catch (e) {
            console.error(`Gagal mengambil data master ${table}:`, e);
            return [];
        }
    };

    [masterBranches, masterCostCenters, masterAreas, masterDepartments, masterBagians, masterJabatans] = await Promise.all([
        fetchMaster("branches"),
        fetchMaster("cost_centers"),
        fetchMaster("areas"),
        fetchMaster("departments"),
        fetchMaster("bagians"),
        fetchMaster("jabatans")
    ]);

    // Populate dropdown statis
    populateSelect("branch_id", masterBranches, "id", "branch_name", "-- Pilih Cabang --");
    populateSelect("departemen_id", masterDepartments, "id", "department_name", "-- Pilih Departemen --");
    populateSelect("jabatan_id", masterJabatans, "id", "jabatan_name", "-- Pilih Jabatan --");

    resetSelect("costcenter_id", "-- Pilih Cost Center --");
    resetSelect("area_id", "-- Pilih Area --");
    resetSelect("bagian_id", "-- Pilih Bagian --");
}

function populateSelect(elemId, items, valKey, textKey, defaultText) {
    const el = document.getElementById(elemId);
    if (!el) return;
    el.innerHTML = `<option value="">${defaultText}</option>`;
    (items || []).forEach(item => {
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

// ==============================================================================
// 3. LOAD DATA DETAIL KARYAWAN & PENGECEKAN RIWAYAT MUTASI/RESIGN
// ==============================================================================
async function loadEmployeeData(empId) {
    // A. Fetch Data Personal Karyawan
    const { data: emp, error: empErr } = await supabaseClient
        .schema("hrd")
        .from("employees")
        .select("*")
        .eq("id", empId)
        .single();

    if (empErr || !emp) {
        throw new Error("Data karyawan tidak ditemukan.");
    }

    // Isikan Field Personal
    setInputValue("nik_ktp", emp.nik_ktp);
    setInputValue("nama", emp.nama);
    setInputValue("tempat_lahir", emp.tempat_lahir);
    setInputValue("tanggal_lahir", emp.tanggal_lahir);
    setInputValue("jenis_kelamin", emp.jenis_kelamin);
    setInputValue("agama", emp.agama);
    setInputValue("pendidikan", emp.pendidikan);
    setInputValue("ibu_kandung", emp.ibu_kandung);
    setInputValue("status_pernikahan", emp.status_pernikahan);
    setInputValue("anak", emp.anak ?? 0);
    setInputValue("no_telp", emp.no_telp);
    setInputValue("npwp", emp.npwp);
    setInputValue("bank", emp.bank);
    setInputValue("no_rekening", emp.no_rekening);
    setInputValue("alamat_ktp", emp.alamat_ktp);
    setInputValue("alamat_domisili", emp.alamat_domisili);
    setInputValue("nik_karyawan", emp.nik_karyawan);
    originalNikKaryawan = emp.nik_karyawan || "";
    setInputValue("bpjs_ketenagakerjaan", emp.bpjs_ketenagakerjaan);
    setInputValue("bpjs_kesehatan", emp.bpjs_kesehatan);
    setInputValue("ptkp", emp.ptkp);

    // Sync Alamat Domisili & KTP
    const sameChk = document.getElementById("same_as_ktp");
    const domisiliInput = document.getElementById("alamat_domisili");
    if (emp.alamat_ktp && emp.alamat_domisili && emp.alamat_ktp.trim() === emp.alamat_domisili.trim()) {
        if (sameChk) sameChk.checked = true;
        if (domisiliInput) {
            domisiliInput.setAttribute("readonly", "readonly");
            domisiliInput.classList.add("bg-light");
        }
    } else {
        if (sameChk) sameChk.checked = false;
        if (domisiliInput) {
            domisiliInput.removeAttribute("readonly");
            domisiliInput.classList.remove("bg-light");
        }
    }

    // B. Pengecekan Riwayat Assignment (Mutasi & Resign)
    const { data: allAssignments } = await supabaseClient
        .schema("hrd")
        .from("employee_assignments")
        .select("*")
        .eq("employee_id", empId);

    // Cek apakah ada record yang memiliki action_type Mutasi atau Resign
    hasCareerHistory = (allAssignments || []).some(a => {
        const action = String(a.action_type || "").toUpperCase();
        return action.includes("MUTASI") || action.includes("RESIGN");
    });

    // Atur Status Readonly NIK Karyawan berdasarkan ada/tidaknya riwayat Mutasi / Resign
    const nikInput = document.getElementById("nik_karyawan");
    if (nikInput) {
        if (hasCareerHistory) {
            nikInput.setAttribute("readonly", "readonly");
            nikInput.classList.add("bg-light");
        } else {
            nikInput.removeAttribute("readonly");
            nikInput.classList.remove("bg-light");
        }
    }

    // C. Ambil Record Assignment Aktif Karyawan
    const activeAssign = (allAssignments || []).find(a => a.is_active) || 
        (allAssignments && allAssignments.length > 0 ? allAssignments[allAssignments.length - 1] : null);

    if (activeAssign) {
        currentAssignmentId = activeAssign.id;

        setInputValue("status_karyawan", activeAssign.status_karyawan);
        setInputValue("branch_id", activeAssign.branch_id);
        // --- TAMBAHAN PARSIAL UNTUK EDIT ---
    setInputValue("no_absen_stg", emp.no_absen_stg); // Mengisi nilai no_absen_stg
    toggleNoAbsenStgVisibility();                            // Menampilkan/menyembunyikan field

        // Jalankan filter penempatan & bagian secara berjenjang
        handlePlacementAndFiltering(false);

        setInputValue("costcenter_id", activeAssign.costcenter_id);

        // Re-filter area berdasarkan cost center yang telah terpilih
        handleAreaFiltering();
        setInputValue("area_id", activeAssign.area_id);

        setInputValue("departemen_id", activeAssign.departemen_id);
        if (activeAssign.status_karyawan === "Borongan") {
            setInputValue("bagian_id", activeAssign.bagian_id);
        }
        setInputValue("jabatan_id", activeAssign.jabatan_id);
        setInputValue("start_date", activeAssign.start_date);
    }
}

function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) {
        el.value = val !== null && val !== undefined ? val : "";
    }
}

// ==============================================================================
// 4. LOGIKA PENEMPATAN, FILTERING DROPDOWN & GENERATE NIK
// ==============================================================================
function handleAreaFiltering() {
    const branchVal = document.getElementById("branch_id")?.value || "";
    const ccVal = document.getElementById("costcenter_id")?.value || "";

    if (!branchVal || !ccVal) {
        resetSelect("area_id", "-- Pilih Area --");
        return;
    }

    const filteredAreas = masterAreas.filter(a =>
        String(a.branch_id) === String(branchVal) &&
        String(a.cost_center_id) === String(ccVal)
    );
    populateSelect("area_id", filteredAreas, "id", "area_name", "-- Pilih Area --");
}

async function handlePlacementAndFiltering(triggerAutoNik = true) {
    const branchVal = document.getElementById("branch_id")?.value || "";
    const ccSelect = document.getElementById("costcenter_id");
    const ccVal = ccSelect?.value || "";
    const deptVal = document.getElementById("departemen_id")?.value || "";
    const statusVal = document.getElementById("status_karyawan")?.value || "";
    const startDateVal = document.getElementById("start_date")?.value || "";

    // Jalankan pengecekan tampilan No Absen STG
    toggleNoAbsenStgVisibility();
    // 1. Filter Cost Center berdasarkan Branch
    if (!branchVal) {
        resetSelect("costcenter_id", "-- Pilih Cost Center --");
        resetSelect("area_id", "-- Pilih Area --");
    } else {
        const filteredCC = masterCostCenters.filter(cc => String(cc.branch_id) === String(branchVal));
        populateSelect("costcenter_id", filteredCC, "id", "costcenter_name", "-- Pilih Cost Center --");

        if (filteredCC.some(cc => String(cc.id) === String(ccVal))) {
            ccSelect.value = ccVal;
        } else {
            resetSelect("area_id", "-- Pilih Area --");
        }
    }

    // 2. Filter Area berdasarkan Branch & Cost Center
    handleAreaFiltering();

    // 3. Filter Bagian khusus Status "Borongan" (POIN 3)
    if (statusVal === "Borongan") {
        populateSelect("bagian_id", masterBagians, "id", "bagian_name", "-- Pilih Bagian --");
    } else {
        resetSelect("bagian_id", "-- Pilih Bagian --");
    }

    // 4. Update NIK Otomatis (HANYA JIKA BELUM ADA DATA MUTASI / RESIGN) (POIN 1b & POIN 2)
    if (!hasCareerHistory && triggerAutoNik) {
        await generateNikAuto(statusVal, branchVal, deptVal, startDateVal);
    }
}

// Generate NIK Otomatis berdasarkan 3 Aturan Format NIK
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

// ==============================================================================
// 5. EVENT LISTENERS
// ==============================================================================
function setupEventListeners() {
    // Checkbox Domisili = KTP
    const sameAsKtpCb = document.getElementById("same_as_ktp");
    if (sameAsKtpCb) {
        sameAsKtpCb.addEventListener("change", handleSameAsKtpChange);
    }

    const alamatKtpInput = document.getElementById("alamat_ktp");
    if (alamatKtpInput) {
        alamatKtpInput.addEventListener("input", handleAlamatKtpInput);
    }

    // Listener Perubahan Penempatan & Status untuk Update Cascading & Auto NIK
    const placementFields = ["branch_id", "costcenter_id", "departemen_id", "status_karyawan", "start_date"];
    placementFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => handlePlacementAndFiltering(true));
        }
    });

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

// ==============================================================================
// 6. SUBMIT HANDLER FORM PERBARUI DATA
// ==============================================================================
async function handleFormSubmit(e) {
    e.preventDefault();

    const btnSubmit = document.getElementById("btnSubmit");
    if (!btnSubmit) return;
    const originalText = btnSubmit.innerHTML;

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Memperbarui...`;

    try {
        const nikVal = document.getElementById("nik_karyawan").value.trim();
        if (!nikVal) throw new Error("NIK Karyawan wajib diisi!");

        // Payload Update hrd.employees
        const employeePayload = {
            nik_karyawan: nikVal,
            nik_ktp: document.getElementById("nik_ktp").value.trim(),
            nama: document.getElementById("nama").value.trim(),
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
            ptkp: hitungPtkp(
                document.getElementById("status_pernikahan").value,
                document.getElementById("jenis_kelamin").value,
                document.getElementById("anak").value
            ),
            no_absen_stg: document.getElementById("status_karyawan").value === "Borongan" ? (document.getElementById("no_absen_stg")?.value.trim() || null) : null
        };

        // Payload Update hrd.employee_assignments
        const statusKaryawanVal = document.getElementById("status_karyawan").value;
        const assignmentPayload = {
            branch_id: document.getElementById("branch_id").value || null,
            costcenter_id: document.getElementById("costcenter_id").value || null,
            departemen_id: document.getElementById("departemen_id").value || null,
            area_id: document.getElementById("area_id").value || null,
            bagian_id: statusKaryawanVal === "Borongan" ? (document.getElementById("bagian_id").value || null) : null,
            jabatan_id: document.getElementById("jabatan_id").value || null,
            status_karyawan: statusKaryawanVal,
            start_date: document.getElementById("start_date").value || null
        };

        // Deteksi apakah NIK diubah dari nilai awal -- kalau ya, beri
        // peringatan eksplisit karena sinkronisasi ke public.users.username
        // dan auth.users.email BELUM otomatis (Edge Function belum dibangun).
        // Tanpa ini, karyawan tersebut tidak akan bisa login pakai NIK barunya.
        const nikBerubah = nikVal !== originalNikKaryawan;

        // Panggil RPC -- employees + employee_assignments (kalau ada)
        // dieksekusi dalam 1 transaksi. Kalau salah satu gagal, semuanya
        // dibatalkan (all-or-nothing).
        const { data: rpcResult, error: rpcError } = await supabaseClient
            .schema("hrd")
            .rpc("update_employee_with_assignment", {
                p_employee_id: currentEmpId,
                p_assignment_id: currentAssignmentId || null,
                employee_data: employeePayload,
                assignment_data: assignmentPayload
            });

        if (rpcError) throw rpcError;

        if (nikBerubah) {
            alert(
                "Data Karyawan Berhasil Diperbarui!\n\n" +
                "PERHATIAN: NIK karyawan ini diubah dari '" + originalNikKaryawan + "' menjadi '" + nikVal + "'.\n" +
                "Akun login (username & auth) karyawan ini BELUM otomatis mengikuti perubahan ini " +
                "dan perlu disesuaikan manual oleh Administrator, atau karyawan akan gagal login."
            );
        } else {
            alert("Data Karyawan Berhasil Diperbarui!");
        }

        window.location.href = "directory.html";

    } catch (err) {
        console.error("Gagal memperbarui data karyawan:", err);
        alert("Gagal memperbarui data: " + err.message);
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