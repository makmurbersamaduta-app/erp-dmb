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
let originalNikKaryawan = "";
let isResigned = false;   // true jika karyawan non-aktif (resign) -> form terkunci permanen
let dataLoaded = false;    // true setelah data karyawan selesai dimuat // NIK saat data pertama kali dimuat, untuk deteksi perubahan NIK

// Role yang BOLEH melakukan koreksi riwayat, dibandingkan dengan roleId di erp_session.
// Saat ini: role dengan id 1, 2, dan 3.
const ROLE_ID_BOLEH_KOREKSI = [1, 2, 3];

// id master yang dipakai penempatan karyawan SAAT INI: tetap boleh tampil di dropdown walau nonaktif
// (supaya data yang sudah tersimpan tidak terhapus tanpa sengaja saat disimpan ulang).
let usedMaster = {};

// Daftar master untuk dropdown: hanya yang aktif (+ yang sedang dipakai, diberi tanda "(nonaktif)")
function optList(list, usedId, nameKey) {
    return list
        .filter(m => m.is_active !== false || (usedId !== null && usedId !== undefined && String(m.id) === String(usedId)))
        .map(m => m.is_active === false ? { ...m, [nameKey]: `${m[nameKey]} (nonaktif)` } : m);
}

let currentAssignmentStartDate = null;   // start_date asli baris penempatan yang sedang diedit
let currentAssignmentIsMutation = false; // true jika baris itu bertipe MUTATION
let riwayatAssignments = [];   // semua assignment karyawan, terbaru di atas
let koreksiMode = null;        // 'cancel_mutation' | 'update_resign_date' | 'cancel_resign'

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

    // Form dikunci dulu sampai data selesai dimuat
    setFormLocked(true);

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
    populateSelect("branch_id", optList(masterBranches, usedMaster.branch, "branch_name"), "id", "branch_name", "-- Pilih Cabang --");
    populateSelect("departemen_id", optList(masterDepartments, usedMaster.dept, "department_name"), "id", "department_name", "-- Pilih Departemen --");
    populateSelect("jabatan_id", optList(masterJabatans, usedMaster.jabatan, "jabatan_name"), "id", "jabatan_name", "-- Pilih Jabatan --");

    resetSelect("costcenter_id", "-- Pilih Cost Center --");
    resetSelect("area_id", "-- Pilih Area --");
    resetSelect("bagian_id", "-- Pilih Bagian --");
}

function populateSelect(elemId, items, valKey, textKey, defaultText) {
    const el = document.getElementById(elemId);
    if (!el) return;

    // Simpan pilihan saat ini, supaya tidak hilang saat daftar opsi dibangun ulang
    // (penyebab Area/Bagian ter-reset ketika "Tanggal Masuk" diisi)
    const previousValue = el.value;

    el.innerHTML = `<option value="">${defaultText}</option>`;
    (items || []).forEach(item => {
        const opt = document.createElement("option");
        opt.value = item[valKey];
        opt.textContent = item[textKey];
        el.appendChild(opt);
    });

    // Kembalikan pilihan lama HANYA jika masih ada di daftar baru
    // (mis. ganti Cabang -> Area milik cabang lama otomatis kosong, memang seharusnya begitu)
    if (previousValue && Array.from(el.options).some(o => o.value === String(previousValue))) {
        el.value = previousValue;
    }
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
        return action.includes("MUTASI") || action.includes("MUTATION") || action.includes("RESIGN");
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
    // Urutkan terbaru dulu (start_date, lalu created_at) agar pilihan tidak bergantung urutan acak dari database
    const sortedAssign = [...(allAssignments || [])].sort((a, b) =>
        (b.start_date || "").localeCompare(a.start_date || "") ||
        (b.created_at || "").localeCompare(a.created_at || ""));
    const activeAssign = sortedAssign.find(a => a.is_active) || sortedAssign[0] || null;

    if (activeAssign) {
        currentAssignmentId = activeAssign.id;

        // Master yang dipakai penempatan ini tetap harus ada di dropdown (walau nonaktif)
        usedMaster = {
            branch: activeAssign.branch_id, cc: activeAssign.costcenter_id, area: activeAssign.area_id,
            dept: activeAssign.departemen_id, bagian: activeAssign.bagian_id, jabatan: activeAssign.jabatan_id
        };
        populateSelect("branch_id", optList(masterBranches, usedMaster.branch, "branch_name"), "id", "branch_name", "-- Pilih Cabang --");
        populateSelect("departemen_id", optList(masterDepartments, usedMaster.dept, "department_name"), "id", "department_name", "-- Pilih Departemen --");
        populateSelect("jabatan_id", optList(masterJabatans, usedMaster.jabatan, "jabatan_name"), "id", "jabatan_name", "-- Pilih Jabatan --");

        setInputValue("status_karyawan", activeAssign.status_karyawan);
        setInputValue("branch_id", activeAssign.branch_id);
        // --- TAMBAHAN PARSIAL UNTUK EDIT ---
    setInputValue("no_absen_stg", emp.no_absen_stg); // Mengisi nilai no_absen_stg
    toggleNoAbsenStgVisibility();                            // Menampilkan/menyembunyikan field

        // Jalankan filter penempatan & bagian secara berjenjang
        handlePlacementAndFiltering();

        setInputValue("costcenter_id", activeAssign.costcenter_id);

        // Re-filter area berdasarkan cost center yang telah terpilih
        handleAreaFiltering();
        setInputValue("area_id", activeAssign.area_id);

        setInputValue("departemen_id", activeAssign.departemen_id);
        setInputValue("bagian_id", activeAssign.bagian_id);
        if (activeAssign.bagian_id && !document.getElementById("bagian_id")?.value) {
            console.warn("[Edit] bagian_id", activeAssign.bagian_id, "tidak ditemukan di master public.bagians");
        }
        setInputValue("jabatan_id", activeAssign.jabatan_id);
        // Tanggal Mulai Bekerja = TANGGAL MASUK (rehire terakhir, atau penempatan awal),
        // bukan tanggal mutasi terakhir.
        const masukRow = findTanggalMasukRow(sortedAssign);
        setInputValue("start_date", (masukRow || activeAssign).start_date);

        currentAssignmentStartDate = activeAssign.start_date;
        currentAssignmentIsMutation = String(activeAssign.action_type || "").toUpperCase() === "MUTATION";

        // Jika baris yang diedit adalah MUTASI, kolom ini hanya tampilan (tanggal mutasi diubah
        // lewat tombol "Ubah Data Mutasi Terakhir"), supaya tanggal masuk tidak menimpa tanggal mutasi.
        const sdInput = document.getElementById("start_date");
        if (sdInput) {
            sdInput.readOnly = currentAssignmentIsMutation;
            if (!document.getElementById("startDateHint")) {
                sdInput.insertAdjacentHTML("afterend", '<div id="startDateHint" class="form-text small"></div>');
            }
            document.getElementById("startDateHint").textContent = currentAssignmentIsMutation
                ? 'Diambil dari tanggal masuk / rehire. Untuk mengubah tanggal mutasi, gunakan "Ubah Data Mutasi Terakhir" pada Riwayat Penempatan di bawah.'
                : "";
        }
    }

    // D. Tanggal Keluar: hanya tampil jika karyawan sudah non-aktif (resign)
    isResigned = emp.is_active === false;
    const endDateBox = document.getElementById("container_end_date");
    if (endDateBox) {
        if (isResigned) {
            const ends = (allAssignments || []).map(a => a.end_date).filter(Boolean).sort();
            setInputValue("end_date", ends.length ? ends[ends.length - 1] : "");
            endDateBox.style.display = "block";
        } else {
            endDateBox.style.display = "none";
        }
    }

    // E. Semua field terkunci saat halaman dibuka (resign -> terkunci permanen)
    dataLoaded = true;
    setFormLocked(true);

    // F. Riwayat penempatan & tombol koreksi
    riwayatAssignments = sortedAssign;
    renderRiwayatSection(emp);
}

// ==============================================================================
// LOCK / UNLOCK FORM
// ==============================================================================
function setFormLocked(locked) {
    document.querySelectorAll("#formCreateEmployee input, #formCreateEmployee select, #formCreateEmployee textarea")
        .forEach(el => { el.disabled = locked; });
    // Catatan: atribut readonly lama (NIK jika ada riwayat mutasi, PTKP, Alamat Domisili = KTP)
    // tidak disentuh, jadi tetap berlaku setelah form dibuka.

    const btnEdit = document.getElementById("btnEdit");
    const btnSubmit = document.getElementById("btnSubmit");
    if (btnEdit) btnEdit.classList.toggle("d-none", !(locked && dataLoaded && !isResigned));
    if (btnSubmit) btnSubmit.classList.toggle("d-none", locked || isResigned);

    const notice = document.getElementById("lockNotice");
    if (notice) {
        if (!dataLoaded) {
            notice.classList.add("d-none");
        } else if (isResigned) {
            notice.className = "alert alert-secondary small mb-3";
            notice.innerHTML = '<i class="fa-solid fa-lock me-1"></i> Karyawan ini sudah non-aktif (resign). Data hanya dapat dilihat dan tidak bisa diubah.';
        } else if (locked) {
            notice.className = "alert alert-info small mb-3";
            notice.innerHTML = '<i class="fa-solid fa-lock me-1"></i> Mode lihat saja. Klik tombol <b>Edit</b> untuk mengubah data.';
        } else {
            notice.className = "alert alert-warning small mb-3";
            notice.innerHTML = '<i class="fa-solid fa-pen me-1"></i> Mode edit aktif.';
        }
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

    if (!branchVal) {
        resetSelect("area_id", "-- Pilih Area --");
        return;
    }

    const filteredAreas = optList(masterAreas, usedMaster.area, "area_name").filter(a =>
        String(a.branch_id) === String(branchVal)
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

    // Jalankan pengecekan tampilan No Absen STG
    toggleNoAbsenStgVisibility();
    // 1. Filter Cost Center berdasarkan Branch
    if (!branchVal) {
        resetSelect("costcenter_id", "-- Pilih Cost Center --");
        resetSelect("area_id", "-- Pilih Area --");
    } else {
        const filteredCC = optList(masterCostCenters, usedMaster.cc, "costcenter_name").filter(cc => String(cc.branch_id) === String(branchVal));
        populateSelect("costcenter_id", filteredCC, "id", "costcenter_name", "-- Pilih Cost Center --");

        if (filteredCC.some(cc => String(cc.id) === String(ccVal))) {
            ccSelect.value = ccVal;
        } else {
            resetSelect("area_id", "-- Pilih Area --");
        }
    }

    // 2. Filter Area berdasarkan Branch & Cost Center
    handleAreaFiltering();

    // 3. Bagian: daftar SELALU diisi (tidak lagi hanya untuk "Borongan"),
    //    agar data bagian karyawan non-Borongan tetap ter-load dan tidak hilang.
    populateSelect("bagian_id", optList(masterBagians, usedMaster.bagian, "bagian_name"), "id", "bagian_name", "-- Pilih Bagian --");

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

    // Listener Perubahan Penempatan & Status untuk Update Cascading (NIK TIDAK lagi diubah otomatis)
    const placementFields = ["branch_id", "costcenter_id", "departemen_id", "status_karyawan", "start_date"];
    placementFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => handlePlacementAndFiltering());
        }
    });

    // Tombol Edit: buka kunci form (tidak berlaku untuk karyawan resign)
    document.getElementById("btnEdit")?.addEventListener("click", () => {
        if (!isResigned) setFormLocked(false);
    });

    // Jika status diganti (oleh user) menjadi selain Borongan, kosongkan Bagian
    document.getElementById("status_karyawan")?.addEventListener("change", (e) => {
        if (e.target.value !== "Borongan") {
            const b = document.getElementById("bagian_id");
            if (b) b.value = "";
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
    if (isResigned) return; // karyawan resign tidak boleh diubah

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
            bagian_id: document.getElementById("bagian_id").value || null,
            jabatan_id: document.getElementById("jabatan_id").value || null,
            status_karyawan: statusKaryawanVal,
            // Baris MUTASI: tanggalnya TIDAK boleh tertimpa tanggal masuk yang tampil di kolom ini
            start_date: currentAssignmentIsMutation
                ? currentAssignmentStartDate
                : (document.getElementById("start_date").value || null)
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

// ==============================================================================
// 7. RIWAYAT PENEMPATAN & KOREKSI (batal mutasi, ubah tanggal resign, batal resign)
// Perubahan data diproses oleh fungsi database (hrd.cancel_last_mutation,
// hrd.update_resign_date, hrd.cancel_resign) -> 1 transaksi, ada catatan audit.
// Mengubah data/tanggal mutasi terakhir: lewat tombol Edit di form utama
// (tanggal akhir penempatan sebelumnya disesuaikan otomatis oleh trigger database).
// ==============================================================================
function escHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTgl(d) {
    if (!d) return "-";
    const p = String(d).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

// Identitas pengguna dari erp_session (dipakai untuk catatan audit & cek role)
function getSessionActor() {
    try {
        const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
        if (!raw) return { name: "", roleId: null };
        const p = JSON.parse(raw);
        const rid = parseInt(p.roleId, 10);
        return {
            name: String(p.fullName || p.nama || p.nik || ""),
            roleId: Number.isNaN(rid) ? null : rid
        };
    } catch (e) {
        return { name: "", roleId: null };
    }
}

// CATATAN: ini hanya pembatas tampilan. erp_session ada di browser dan bisa diubah
// pengguna sendiri, jadi BUKAN pengamanan sungguhan.
function bolehKoreksi() {
    const rid = getSessionActor().roleId;
    return rid !== null && ROLE_ID_BOLEH_KOREKSI.includes(rid);
}

// Baris yang menjadi dasar "Tanggal Masuk": REHIRE terakhir; jika tidak pernah rehire,
// penempatan paling awal yang BUKAN mutasi. (Sama dengan kolom Tanggal Masuk di Directory.)
function findTanggalMasukRow(rows) {
    if (!rows || rows.length === 0) return null;
    const type = a => String(a.action_type || "").toUpperCase();
    const byDate = (x, y) => (x.start_date || "").localeCompare(y.start_date || "") ||
                             (x.created_at || "").localeCompare(y.created_at || "");
    const pick = (arr, last) => {
        const s = arr.filter(a => a.start_date).sort(byDate);
        return s.length ? (last ? s[s.length - 1] : s[0]) : null;
    };
    return pick(rows.filter(a => type(a) === "REHIRE"), true)
        || pick(rows.filter(a => type(a) !== "MUTATION"), false)
        || pick(rows, false);
}

function renderRiwayatSection(emp) {
    const box = document.getElementById("sectionRiwayat");
    if (!box) return;

    const nm = (list, id, key) => list.find(x => String(x.id) === String(id))?.[key] || "-";
    const isEmpActive = emp.is_active !== false;
    const last = riwayatAssignments[0] || null;
    const lastIsMutation = last && String(last.action_type || "").toUpperCase() === "MUTATION";
    const masukRow = findTanggalMasukRow(riwayatAssignments);

    const rows = riwayatAssignments.map(a => `
        <tr>
            <td class="text-nowrap">${fmtTgl(a.start_date)}</td>
            <td class="text-nowrap">${fmtTgl(a.end_date)}</td>
            <td><span class="badge bg-secondary-subtle text-dark">${escHtml(a.action_type || "-")}</span>
                ${a.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : ''}
                ${masukRow && a.id === masukRow.id ? '<span class="badge bg-primary-subtle text-primary">Tgl Masuk</span>' : ''}</td>
            <td>${escHtml(a.status_karyawan || "-")}</td>
            <td>${escHtml(nm(masterBranches, a.branch_id, "branch_name"))}</td>
            <td>${escHtml(nm(masterCostCenters, a.costcenter_id, "costcenter_name"))}</td>
            <td>${escHtml(nm(masterDepartments, a.departemen_id, "department_name"))}</td>
            <td>${escHtml(nm(masterAreas, a.area_id, "area_name"))}</td>
            <td>${escHtml(nm(masterJabatans, a.jabatan_id, "jabatan_name"))}</td>
            <td>${escHtml(a.end_reason || "")}</td>
        </tr>`).join("");

    let actions = "";
    if (!bolehKoreksi()) {
        const r = getSessionActor().roleId;
        actions = `<div class="text-muted small"><i class="fa-solid fa-lock me-1"></i>Koreksi riwayat hanya untuk role yang diizinkan. Role ID terbaca: <b>${escHtml(r === null ? "(tidak terbaca)" : r)}</b>.</div>`;
    } else if (!isEmpActive) {
        actions = `
            <div class="d-flex flex-wrap gap-2">
                <button type="button" class="btn btn-outline-primary btn-sm" onclick="openKoreksi('update_resign_date')"><i class="fa-solid fa-calendar-days me-1"></i>Ubah Tanggal Keluar</button>
                <button type="button" class="btn btn-outline-danger btn-sm" onclick="openKoreksi('cancel_resign')"><i class="fa-solid fa-rotate-left me-1"></i>Batalkan Resign</button>
            </div>
            <div class="text-muted small mt-2">Ubah tanggal keluar tidak menghapus blacklist. Batalkan resign akan menghapus blacklist.</div>`;
    } else if (lastIsMutation) {
        actions = `
            <div class="d-flex flex-wrap gap-2">
                <button type="button" class="btn btn-outline-primary btn-sm" onclick="openEditMutasi()"><i class="fa-solid fa-pen me-1"></i>Ubah Data Mutasi Terakhir</button>
                <button type="button" class="btn btn-outline-danger btn-sm" onclick="openKoreksi('cancel_mutation')"><i class="fa-solid fa-rotate-left me-1"></i>Batalkan Mutasi Terakhir</button>
            </div>
            <div class="text-muted small mt-2">Mengubah tanggal mutasi otomatis menyesuaikan tanggal selesai penempatan sebelumnya.</div>`;
    } else {
        actions = `<div class="text-muted small">Tidak ada koreksi yang tersedia untuk kondisi saat ini.</div>`;
    }

    box.innerHTML = `
        <div class="card border-0 shadow-sm">
            <div class="card-header bg-white fw-bold small"><i class="fa-solid fa-clock-rotate-left me-2 text-primary"></i>Riwayat Penempatan &amp; Koreksi</div>
            <div class="card-body">
                <div class="table-responsive mb-3">
                    <table class="table table-sm table-hover small mb-0">
                        <thead class="table-light"><tr>
                            <th>Mulai</th><th>Selesai</th><th>Jenis</th><th>Status</th><th>Cabang</th>
                            <th>Cost Center</th><th>Departemen</th><th>Area</th><th>Jabatan</th><th>Keterangan</th>
                        </tr></thead>
                        <tbody>${rows || '<tr><td colspan="10" class="text-center text-muted py-3">Belum ada riwayat.</td></tr>'}</tbody>
                    </table>
                </div>
                ${actions}
            </div>
        </div>`;

    injectKoreksiModal();
    injectEditMutasiModal();
}

function injectKoreksiModal() {
    if (document.getElementById("modalKoreksi")) return;
    document.body.insertAdjacentHTML("beforeend", `
    <div class="modal fade" id="modalKoreksi" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content border-0 shadow">
                <div class="modal-header border-bottom py-2">
                    <h6 class="modal-title fw-bold" id="korTitle"></h6>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-warning small" id="korDesc"></div>
                    <div class="mb-3" id="korDateWrap" style="display:none;">
                        <label class="form-label small fw-bold">Tanggal Keluar Baru <span class="text-danger">*</span></label>
                        <input type="date" id="korDate" class="form-control form-control-sm">
                    </div>
                    <div>
                        <label class="form-label small fw-bold">Alasan koreksi <span class="text-danger">*</span></label>
                        <textarea id="korReason" class="form-control form-control-sm" rows="3" placeholder="Mis. salah input, karyawan batal resign, dll."></textarea>
                    </div>
                </div>
                <div class="modal-footer border-top py-2">
                    <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-danger btn-sm" id="korSubmit" onclick="submitKoreksi()">Proses</button>
                </div>
            </div>
        </div>
    </div>`);
}

function openKoreksi(mode) {
    koreksiMode = mode;
    const last = riwayatAssignments[0];
    const dateWrap = document.getElementById("korDateWrap");
    const dateInput = document.getElementById("korDate");
    document.getElementById("korReason").value = "";
    dateWrap.style.display = "none";

    if (mode === "cancel_mutation") {
        document.getElementById("korTitle").textContent = "Batalkan Mutasi Terakhir";
        document.getElementById("korDesc").innerHTML =
            `Mutasi mulai <b>${fmtTgl(last?.start_date)}</b> akan DIHAPUS dan penempatan sebelumnya diaktifkan kembali. ` +
            `Perubahan <b>NIK</b> atau <b>No. Absen STG</b> yang terjadi saat mutasi <b>tidak</b> dikembalikan otomatis, cek dan perbaiki manual bila perlu.`;
    } else if (mode === "update_resign_date") {
        document.getElementById("korTitle").textContent = "Ubah Tanggal Keluar";
        document.getElementById("korDesc").innerHTML = "Hanya tanggal keluar yang diubah. Status blacklist tidak berubah.";
        dateWrap.style.display = "block";
        dateInput.value = last?.end_date || "";
    } else if (mode === "cancel_resign") {
        document.getElementById("korTitle").textContent = "Batalkan Resign";
        document.getElementById("korDesc").innerHTML =
            "Karyawan diaktifkan kembali, <b>status blacklist dihapus</b>, dan akun login diaktifkan kembali.";
    }
    new bootstrap.Modal(document.getElementById("modalKoreksi")).show();
}

async function submitKoreksi() {
    const reason = document.getElementById("korReason").value.trim();
    if (reason.length < 3) { alert("Alasan koreksi wajib diisi."); return; }
    if (!bolehKoreksi()) { alert("Role Anda tidak diizinkan melakukan koreksi."); return; }

    const btn = document.getElementById("korSubmit");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Memproses...`;

    try {
        const a = getSessionActor();
        const actor = `${a.name} (role ${a.roleId})`;
        const last = riwayatAssignments[0];
        let fn, params;

        if (koreksiMode === "cancel_mutation") {
            fn = "cancel_last_mutation";
            params = { p_assignment_id: last.id, p_actor: actor, p_reason: reason };
        } else if (koreksiMode === "update_resign_date") {
            const newDate = document.getElementById("korDate").value;
            if (!newDate) throw new Error("Tanggal keluar baru wajib diisi.");
            fn = "update_resign_date";
            params = { p_employee_id: currentEmpId, p_end_date: newDate, p_actor: actor, p_reason: reason };
        } else if (koreksiMode === "cancel_resign") {
            fn = "cancel_resign";
            params = { p_employee_id: currentEmpId, p_actor: actor, p_reason: reason };
        } else {
            throw new Error("Jenis koreksi tidak dikenali.");
        }

        const { data, error } = await supabaseClient.schema("hrd").rpc(fn, params);
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.message || "Gagal");

        // Batal resign: aktifkan kembali akun login (kebalikan dari proses resign)
        let warn = "";
        if (koreksiMode === "cancel_resign") {
            try {
                const { data: u, error: uErr } = await supabaseClient
                    .from("users").select("id, auth_uid").eq("employee_id", currentEmpId).maybeSingle();
                if (!uErr && u?.auth_uid) {
                    const { data: r, error: rErr } = await supabaseClient.functions.invoke("sync-auth", {
                        body: { action: "reactivate", user_id: u.id }
                    });
                    if (rErr || !r?.success) {
                        warn = "\n\nPERINGATAN: akun login GAGAL diaktifkan kembali otomatis. Aktifkan manual lewat halaman Users Account.";
                    }
                }
            } catch (e) {
                warn = "\n\nPERINGATAN: akun login GAGAL diaktifkan kembali otomatis. Aktifkan manual lewat halaman Users Account.";
            }
        }

        alert("Koreksi berhasil disimpan." + warn);
        window.location.reload();
    } catch (err) {
        console.error("Gagal koreksi riwayat:", err);
        alert("Gagal melakukan koreksi: " + (err.message || err));
        btn.disabled = false;
        btn.innerHTML = original;
    }
}


// ------------------------------------------------------------------------------
// UBAH DATA MUTASI TERAKHIR (modal) -> rpc hrd.update_last_mutation
// ------------------------------------------------------------------------------
function injectEditMutasiModal() {
    if (document.getElementById("modalEditMutasi")) return;
    document.body.insertAdjacentHTML("beforeend", `
    <div class="modal fade" id="modalEditMutasi" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content border-0 shadow">
                <div class="modal-header border-bottom py-2">
                    <h6 class="modal-title fw-bold"><i class="fa-solid fa-pen me-2 text-primary"></i>Ubah Data Mutasi Terakhir</h6>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row g-2">
                        <div class="col-md-6"><label class="form-label small fw-bold">Tanggal Mulai Mutasi <span class="text-danger">*</span></label>
                            <input type="date" id="em_start" class="form-control form-control-sm"></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Status Karyawan <span class="text-danger">*</span></label>
                            <select id="em_status" class="form-select form-select-sm"></select></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Cabang</label>
                            <select id="em_branch" class="form-select form-select-sm" onchange="onEmBranchChange()"></select></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Cost Center</label>
                            <select id="em_cc" class="form-select form-select-sm"></select></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Departemen</label>
                            <select id="em_dept" class="form-select form-select-sm"></select></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Area</label>
                            <select id="em_area" class="form-select form-select-sm"></select></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Jabatan</label>
                            <select id="em_jabatan" class="form-select form-select-sm"></select></div>
                        <div class="col-md-6"><label class="form-label small fw-bold">Bagian</label>
                            <select id="em_bagian" class="form-select form-select-sm"></select></div>
                        <div class="col-12"><label class="form-label small fw-bold">Alasan koreksi <span class="text-danger">*</span></label>
                            <textarea id="em_reason" class="form-control form-control-sm" rows="2" placeholder="Mis. salah input tanggal / area"></textarea></div>
                    </div>
                    <div class="text-muted small mt-2">NIK dan No. Absen STG tidak diubah dari sini.</div>
                </div>
                <div class="modal-footer border-top py-2">
                    <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary btn-sm" id="emSubmit" onclick="submitEditMutasi()">Simpan Perubahan</button>
                </div>
            </div>
        </div>
    </div>`);
}

// Isi <select> dari array; pilih nilai "selected" jika ada di daftar
function fillEmSelect(id, items, valKey, textKey, placeholder, selected) {
    const el = document.getElementById(id);
    let html = `<option value="">${placeholder}</option>`;
    items.forEach(it => { html += `<option value="${escHtml(it[valKey])}">${escHtml(it[textKey])}</option>`; });
    el.innerHTML = html;
    const sel = selected === null || selected === undefined ? "" : String(selected);
    el.value = Array.from(el.options).some(o => o.value === sel) ? sel : "";
}

function refreshEmCascade(selCc, selArea) {
    const b = document.getElementById("em_branch").value;
    fillEmSelect("em_cc", optList(masterCostCenters, riwayatAssignments[0]?.costcenter_id, "costcenter_name").filter(c => b && String(c.branch_id) === b), "id", "costcenter_name", "-- Pilih Cost Center --", selCc);
    fillEmSelect("em_area", optList(masterAreas, riwayatAssignments[0]?.area_id, "area_name").filter(a => b && String(a.branch_id) === b), "id", "area_name", "-- Pilih Area --", selArea);
}

function onEmBranchChange() {
    // Ganti cabang: cost center & area milik cabang lama otomatis kosong
    refreshEmCascade("", "");
}

function openEditMutasi() {
    const last = riwayatAssignments[0];
    if (!last) return;

    // Cost Center & Area di modal ini juga berupa dropdown pencarian
    enhanceSearchableSelect("em_cc");
    enhanceSearchableSelect("em_area");
    enhanceSearchableSelect("em_jabatan");
    enhanceSearchableSelect("em_bagian");

    const statuses = ["Tetap", "PKWT", "PKWTT", "Reliver", "Borongan"];
    if (last.status_karyawan && !statuses.includes(last.status_karyawan)) statuses.push(last.status_karyawan);
    fillEmSelect("em_status", statuses.map(x => ({ v: x, t: x })), "v", "t", "-- Pilih Status --", last.status_karyawan);

    fillEmSelect("em_branch", optList(masterBranches, last.branch_id, "branch_name"), "id", "branch_name", "-- Pilih Cabang --", last.branch_id);
    refreshEmCascade(last.costcenter_id, last.area_id);
    fillEmSelect("em_dept", optList(masterDepartments, last.departemen_id, "department_name"), "id", "department_name", "-- Pilih Departemen --", last.departemen_id);
    fillEmSelect("em_jabatan", optList(masterJabatans, last.jabatan_id, "jabatan_name"), "id", "jabatan_name", "-- Pilih Jabatan --", last.jabatan_id);
    fillEmSelect("em_bagian", optList(masterBagians, last.bagian_id, "bagian_name"), "id", "bagian_name", "-- Pilih Bagian --", last.bagian_id);

    document.getElementById("em_start").value = last.start_date || "";
    document.getElementById("em_reason").value = "";
    new bootstrap.Modal(document.getElementById("modalEditMutasi")).show();
}

async function submitEditMutasi() {
    const reason = document.getElementById("em_reason").value.trim();
    const start = document.getElementById("em_start").value;
    const status = document.getElementById("em_status").value;
    if (!start) { alert("Tanggal mulai mutasi wajib diisi."); return; }
    if (!status) { alert("Status karyawan wajib dipilih."); return; }
    if (reason.length < 3) { alert("Alasan koreksi wajib diisi."); return; }
    if (!bolehKoreksi()) { alert("Role Anda tidak diizinkan melakukan koreksi."); return; }

    const btn = document.getElementById("emSubmit");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Menyimpan...`;

    try {
        const a = getSessionActor();
        const v = id => document.getElementById(id).value;
        const { data, error } = await supabaseClient.schema("hrd").rpc("update_last_mutation", {
            p_assignment_id: riwayatAssignments[0].id,
            p_data: {
                start_date: start, status_karyawan: status,
                branch_id: v("em_branch"), costcenter_id: v("em_cc"), departemen_id: v("em_dept"),
                area_id: v("em_area"), jabatan_id: v("em_jabatan"), bagian_id: v("em_bagian")
            },
            p_actor: `${a.name} (role ${a.roleId})`,
            p_reason: reason
        });
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.message || "Gagal");

        alert("Data mutasi berhasil diperbarui.");
        window.location.reload();
    } catch (err) {
        console.error("Gagal ubah mutasi:", err);
        alert("Gagal mengubah data mutasi: " + (err.message || err));
        btn.disabled = false;
        btn.innerHTML = original;
    }
}


// ==============================================================================
// DROPDOWN DENGAN PENCARIAN (Searchable Select)
// Mengubah <select> biasa menjadi kolom ketik + tombol panah:
//  - ketik sebagian nama (mis. "rama") -> daftar menyaring opsi yang mengandung teks itu
//  - klik tombol panah / klik kolom -> seluruh daftar tampil tanpa perlu mengetik
// <select> aslinya tetap ada (disembunyikan secara visual) sehingga semua kode lama
// (isi opsi, ambil nilai, validasi "required", event change) tetap bekerja.
// ==============================================================================
(function () {
    const SVG_CARET = '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.6 5l6.4 6.4L14.4 5z"/></svg>';
    const selValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

    function injectStyle() {
        if (document.getElementById("ssStyle")) return;
        const st = document.createElement("style");
        st.id = "ssStyle";
        st.textContent = `
            .ss-wrap { position: relative; }
            .ss-hidden-select { position: absolute !important; left: 0; bottom: 0; width: 100%; height: 1px;
                                opacity: 0; pointer-events: none; border: 0 !important; padding: 0 !important; }
            .ss-list { position: fixed; z-index: 3000; max-height: 240px; overflow-y: auto; background: #fff;
                       border: 1px solid #ced4da; border-radius: .375rem; box-shadow: 0 .5rem 1rem rgba(0,0,0,.15); }
            .ss-item { padding: .4rem .75rem; cursor: pointer; font-size: .875rem; }
            .ss-item:hover, .ss-item.active { background: #e7f1ff; }
            .ss-item.selected { font-weight: 600; }
            .ss-empty { padding: .5rem .75rem; color: #6c757d; font-size: .85rem; }`;
        document.head.appendChild(st);
    }

    function esc(v) {
        return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    window.enhanceSearchableSelect = function (selectId) {
        const sel = document.getElementById(selectId);
        if (!sel || sel.dataset.ss === "1") return;   // sudah pernah dipasang
        sel.dataset.ss = "1";
        injectStyle();

        const wrap = document.createElement("div");
        wrap.className = "ss-wrap";
        wrap.innerHTML = `<div class="input-group ${sel.classList.contains("form-select-sm") ? "input-group-sm" : ""}">
            <input type="text" class="form-control" autocomplete="off" spellcheck="false">
            <button type="button" class="btn btn-outline-secondary" tabindex="-1" aria-label="Buka daftar">${SVG_CARET}</button>
        </div>`;
        sel.parentNode.insertBefore(wrap, sel);
        wrap.appendChild(sel);
        sel.classList.add("ss-hidden-select");
        sel.tabIndex = -1;

        const input = wrap.querySelector("input");
        const btn = wrap.querySelector("button");
        let list = null, items = [], activeIdx = -1;

        const selectedText = () => {
            const o = sel.options[sel.selectedIndex];
            return o && o.value !== "" ? o.text : "";
        };
        const placeholderText = () => (sel.options.length && sel.options[0].value === "") ? sel.options[0].text : "";

        // Samakan tampilan kolom ketik dengan <select> (nilai, placeholder, status disabled)
        function sync() {
            input.value = selectedText();
            input.placeholder = placeholderText();
            input.disabled = sel.disabled;
            btn.disabled = sel.disabled;
        }

        function setValue(v) {
            selValueDesc.set.call(sel, v);
            sync();
            sel.dispatchEvent(new Event("change", { bubbles: true }));  // supaya filter bertingkat tetap jalan
        }

        // Kode lama mengisi nilai lewat "select.value = ..." -> ikut disinkronkan ke tampilan
        Object.defineProperty(sel, "value", {
            configurable: true,
            get() { return selValueDesc.get.call(this); },
            set(v) { selValueDesc.set.call(this, v); sync(); }
        });
        new MutationObserver(sync).observe(sel, { childList: true, attributes: true, attributeFilter: ["disabled"] });
        sel.addEventListener("change", sync);

        function place() {
            if (!list) return;
            const r = wrap.getBoundingClientRect();
            list.style.left = r.left + "px";
            list.style.width = r.width + "px";
            const spaceBelow = window.innerHeight - r.bottom;
            if (spaceBelow < Math.min(240, list.scrollHeight) + 8 && r.top > spaceBelow) {
                list.style.top = "auto";
                list.style.bottom = (window.innerHeight - r.top) + "px";
            } else {
                list.style.bottom = "auto";
                list.style.top = r.bottom + "px";
            }
        }

        function render(filterText) {
            const q = (filterText || "").trim().toLowerCase();
            items = Array.from(sel.options).filter(o => o.value !== "" && (!q || o.text.toLowerCase().includes(q)));
            list.innerHTML = items.length
                ? items.map((o, i) => `<div class="ss-item${o.value === sel.value ? " selected" : ""}" data-i="${i}">${esc(o.text)}</div>`).join("")
                : '<div class="ss-empty">Tidak ada hasil</div>';
            activeIdx = q ? (items.length ? 0 : -1) : items.findIndex(o => o.value === sel.value);
            highlight();
            place();
        }

        function highlight() {
            if (!list) return;
            list.querySelectorAll(".ss-item").forEach((el, i) => el.classList.toggle("active", i === activeIdx));
            const a = list.querySelector(".ss-item.active");
            if (a) a.scrollIntoView({ block: "nearest" });
        }

        function openList(filterText) {
            if (sel.disabled) return;
            if (!list) {
                list = document.createElement("div");
                list.className = "ss-list";
                list.addEventListener("mousedown", e => {
                    e.preventDefault();                       // jangan sampai kolom ketik kehilangan fokus
                    const it = e.target.closest(".ss-item");
                    if (it) choose(parseInt(it.dataset.i, 10));
                });
                document.body.appendChild(list);
            }
            render(filterText);
        }

        function closeList() {
            if (list) { list.remove(); list = null; }
            activeIdx = -1;
        }

        function choose(i) {
            const o = items[i];
            if (!o) return;
            if (sel.value !== o.value) setValue(o.value); else sync();
            closeList();
        }

        // Saat kolom ditinggalkan: teks kosong = kosongkan pilihan; teks cocok persis = pilih; selain itu kembalikan
        function commit() {
            closeList();
            const t = input.value.trim().toLowerCase();
            if (t === "") {
                if (sel.value !== "") setValue(""); else sync();
                return;
            }
            const exact = Array.from(sel.options).find(o => o.value !== "" && o.text.toLowerCase() === t);
            if (exact && sel.value !== exact.value) setValue(exact.value); else sync();
        }

        input.addEventListener("focus", () => { if (!list) { openList(""); input.select(); } });
        input.addEventListener("click", () => { if (!list) openList(""); });
        input.addEventListener("input", () => { if (!list) openList(input.value); else render(input.value); });
        input.addEventListener("blur", () => setTimeout(commit, 0));
        input.addEventListener("keydown", e => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!list) openList(""); else { activeIdx = Math.min(activeIdx + 1, items.length - 1); highlight(); }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (list) { activeIdx = Math.max(activeIdx - 1, 0); highlight(); }
            } else if (e.key === "Enter") {
                if (list) { e.preventDefault(); if (activeIdx >= 0) choose(activeIdx); else commit(); }
            } else if (e.key === "Escape") {
                if (list) { e.preventDefault(); e.stopPropagation(); closeList(); sync(); }
            }
        });

        btn.addEventListener("mousedown", e => e.preventDefault());
        btn.addEventListener("click", () => {
            if (list) { closeList(); sync(); } else { input.focus(); if (!list) openList(""); }
        });

        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);

        sync();
    };

    function initMain() { ["costcenter_id", "area_id", "bagian_id", "jabatan_id"].forEach(window.enhanceSearchableSelect); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMain);
    else initMain();
})();