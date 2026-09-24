/**
 * ==============================================================================
 * DMB ERP SYSTEM - Module Employee Management (Rehire Karyawan)
 * File   : js/module/employees/employee_rehire.js
 * Schema : hrd (employees, employee_assignments), public (branches, cost_centers, areas, departments, bagians, jabatans)
 * ==============================================================================
 */

// Global State
let currentEmpId = null;

let masterBranches = [];
let masterCostCenters = [];
let masterAreas = [];
let masterDepartments = [];
let masterBagians = [];
let masterJabatans = [];

// ==============================================================================
// HELPER: Hitung kode PTKP
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

    // 5. Load Master Data & Detail Data Pribadi Karyawan
    try {
        await loadMasterData();
        await loadRehireEmployeeData(currentEmpId);
    } catch (err) {
        console.error("Gagal memuat data awal rehire karyawan:", err);
        alert("Terjadi kesalahan saat memuat data karyawan: " + (err.message || err));
    }
});

// ==============================================================================
// 1. HEADER PROFIL PENGGUNA
// ==============================================================================
async function loadHeaderUserProfile() {
    try {
        let userName = "";
        let userRole = "";

        const sessionData = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
        if (sessionData) {
            const parsed = JSON.parse(sessionData);
            userName = parsed.fullName || parsed.nama || parsed.nik || "";
            userRole = parsed.roleName || parsed.role || "";
        }

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

    // Populate dropdown
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
// 3. LOAD 15 DATA PRIBADI KARYAWAN LAMA
// ==============================================================================
async function loadRehireEmployeeData(empId) {
    const { data: emp, error: empErr } = await supabaseClient
        .schema("hrd")
        .from("employees")
        .select("*")
        .eq("id", empId)
        .single();

    if (empErr || !emp) {
        throw new Error("Data karyawan lama tidak ditemukan.");
    }

    // Isikan TEPAT 15 Data Pribadi Karyawan Lama dari hrd.employees
    setInputValue("nik_ktp", emp.nik_ktp);                   // 1. No KTP
    setInputValue("nama", emp.nama);                         // 2. Nama
    setInputValue("tempat_lahir", emp.tempat_lahir);         // 3. Tempat Lahir
    setInputValue("tanggal_lahir", emp.tanggal_lahir);       // 4. Tanggal Lahir
    setInputValue("jenis_kelamin", emp.jenis_kelamin);       // 5. Jenis Kelamin
    setInputValue("agama", emp.agama);                       // 6. Agama
    setInputValue("pendidikan", emp.pendidikan);             // 7. Pendidikan
    setInputValue("ibu_kandung", emp.ibu_kandung);           // 8. Nama Ibu Kandung
    setInputValue("status_pernikahan", emp.status_pernikahan);// 9. Status Pernikahan
    setInputValue("anak", emp.anak ?? 0);                    // 10. Jumlah Anak
    setInputValue("no_telp", emp.no_telp);                   // 11. No Telp
    setInputValue("npwp", emp.npwp);                         // 12. NPWP
    setInputValue("bank", emp.bank);                         // 13. Nama Bank
    setInputValue("no_rekening", emp.no_rekening);           // 14. No Rekening
    setInputValue("alamat_ktp", emp.alamat_ktp);             // 15. Alamat KTP
    setInputValue("alamat_domisili", emp.alamat_domisili);   // 15. Alamat Domisili

    // Catatan: BPJS Ketenagakerjaan & BPJS Kesehatan sengaja DIBIARKAN KOSONG saat awal load Rehire
    setInputValue("bpjs_ketenagakerjaan", "");
    setInputValue("bpjs_kesehatan", "");

    // Catatan: NIK Karyawan Lama DIBIARKAN KOSONG, akan terisi otomatis saat Penempatan dipilih
    setInputValue("nik_karyawan", "");

    // Sync Checkbox Alamat Domisili & KTP
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

    // Hitung PTKP Awal
    updatePtkpDisplay();
}

function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) {
        el.value = val !== null && val !== undefined ? val : "";
    }
}

// ==============================================================================
// 4. LOGIKA FILTERING PENEMPATAN & GENERATE NIK BARU
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

async function handlePlacementAndFiltering() {
    const branchVal = document.getElementById("branch_id")?.value || "";
    const ccSelect = document.getElementById("costcenter_id");
    const ccVal = ccSelect?.value || "";
    const deptVal = document.getElementById("departemen_id")?.value || "";
    const statusVal = document.getElementById("status_karyawan")?.value || "";
    const startDateVal = document.getElementById("start_date")?.value || "";

    toggleNoAbsenStgVisibility();

    // Filter Cost Center berdasarkan Branch
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

    // Filter Area
    handleAreaFiltering();

    // Filter Bagian khusus Status "Borongan"
    if (statusVal === "Borongan") {
        populateSelect("bagian_id", masterBagians, "id", "bagian_name", "-- Pilih Bagian --");
    } else {
        resetSelect("bagian_id", "-- Pilih Bagian --");
    }

    // Generate NIK Karyawan BARU berdasarkan penempatan baru
    await generateNikAuto(statusVal, branchVal, deptVal, startDateVal);
}

// Generate NIK Otomatis berdasarkan Aturan Penomoran
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

function toggleNoAbsenStgVisibility() {
    const statusVal = document.getElementById("status_karyawan")?.value;
    const containerStg = document.getElementById("container_no_absen_stg");
    const inputStg = document.getElementById("no_absen_stg");

    if (containerStg) {
        if (statusVal === "Borongan") {
            containerStg.style.display = "block";
        } else {
            containerStg.style.display = "none";
            if (inputStg) inputStg.value = "";
        }
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

    // Listener Perubahan Penempatan untuk Update Cascading & Auto-Generate NIK
    const placementFields = ["branch_id", "costcenter_id", "departemen_id", "status_karyawan", "start_date"];
    placementFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", handlePlacementAndFiltering);
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

    // Form Submit Rehire
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
// 6. SUBMIT HANDLER PROSES REHIRE
// ==============================================================================
async function handleFormSubmit(e) {
    e.preventDefault();

    const btnSubmit = document.getElementById("btnSubmit");
    if (!btnSubmit) return;
    const originalText = btnSubmit.innerHTML;

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Memproses Rehire...`;

    try {
        const nikVal = document.getElementById("nik_karyawan").value.trim();
        if (!nikVal) throw new Error("NIK Karyawan Baru wajib terisi/digenerate!");

        // Ambil input BPJS: Jika kosong maka bernilai null (Tereset)
        const bpjsTkInput = document.getElementById("bpjs_ketenagakerjaan").value.trim();
        const bpjsKesInput = document.getElementById("bpjs_kesehatan").value.trim();

        // 1. Payload Update untuk hrd.employees (Aktivasi Kembali & Update Data)
        const employeePayload = {
            is_active: true, // Mengaktifkan kembali status karyawan
            nik_karyawan: nikVal, // NIK Baru
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
            
            // BPJS tereset / null jika tidak diisi pada form rehire
            bpjs_ketenagakerjaan: bpjsTkInput !== "" ? bpjsTkInput : null,
            bpjs_kesehatan: bpjsKesInput !== "" ? bpjsKesInput : null,
            
            // PTKP dihitung ulang berdasarkan status pernikahan & jumlah anak terbaru
            ptkp: hitungPtkp(
                document.getElementById("status_pernikahan").value,
                document.getElementById("jenis_kelamin").value,
                document.getElementById("anak").value
            ),

            // No Absen STG sekarang di hrd.employees. SELALU ditulis ulang
            // (bukan cuma saat Borongan) supaya nilai lama dari masa kerja
            // sebelumnya otomatis ter-reset ke null kalau form rehire
            // tidak diisi ulang -- tidak ada data lama yang "nempel".
            no_absen_stg: document.getElementById("status_karyawan").value === "Borongan" ? (document.getElementById("no_absen_stg")?.value.trim() || null) : null
        };

        // 2. Payload Insert Assignment Baru untuk hrd.employee_assignments
        const statusKaryawanVal = document.getElementById("status_karyawan").value;
        const assignmentPayload = {
            employee_id: currentEmpId,
            branch_id: document.getElementById("branch_id").value || null,
            costcenter_id: document.getElementById("costcenter_id").value || null,
            departemen_id: document.getElementById("departemen_id").value || null,
            area_id: document.getElementById("area_id").value || null,
            bagian_id: statusKaryawanVal === "Borongan" ? (document.getElementById("bagian_id").value || null) : null,
            jabatan_id: document.getElementById("jabatan_id").value || null,
            status_karyawan: statusKaryawanVal,
            start_date: document.getElementById("start_date").value || null,
            action_type: 'REHIRE', // Tandai aksi penempatan sebagai REHIRE
            is_active: true
        };

        // Execute Update Employee
        const { error: empError } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .update(employeePayload)
            .eq("id", currentEmpId);

        if (empError) throw empError;

        // Execute Insert New Assignment
        const { error: assignError } = await supabaseClient
            .schema("hrd")
            .from("employee_assignments")
            .insert(assignmentPayload);

        if (assignError) throw assignError;

        alert("Proses Rehire Berhasil! Status karyawan kembali Aktif dengan NIK dan Penempatan Baru.");
        window.location.href = "directory.html";

    } catch (err) {
        console.error("Gagal melakukan proses rehire karyawan:", err);
        alert("Gagal memproses rehire: " + err.message);
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalText;
    }
}