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
    // PERBAIKAN: setupCurrencyFormatters() dihapus -- fungsi ini tidak
    // pernah didefinisikan di file manapun (menyebabkan ReferenceError
    // di console), dan form ini memang tidak punya field bertipe
    // currency/gaji yang butuh formatter semacam itu.
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

    // Hanya data master AKTIF (is_active bukan false) yang boleh muncul di dropdown
    [masterBranches, masterCostCenters, masterDepartments, masterAreas, masterBagians, masterJabatans] =
        [masterBranches, masterCostCenters, masterDepartments, masterAreas, masterBagians, masterJabatans].map(list => list.filter(m => m.is_active !== false));

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

    // 2. FILTER AREA BERDASARKAN BRANCH SAJA (sebelumnya Branch+Cost Center)
    if (!branchVal) {
        resetSelect("area_id", "-- Pilih Area --");
    } else {
        const filteredAreas = masterAreas.filter(a =>
            String(a.branch_id) === String(branchVal)
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
// Ambil SEMUA NIK yang cocok dengan pola LIKE, bertahap per 1000 baris.
// (Supabase membatasi 1 request = max 1000 baris; tanpa ini NIK tertinggi bisa terlewat.)
async function fetchNikList(likePattern) {
    const PAGE = 1000;
    let all = [];
    while (true) {
        const { data, error } = await supabaseClient
            .schema('hrd')
            .from('employees')
            .select('nik_karyawan')
            .like('nik_karyawan', likePattern)
            .order('nik_karyawan', { ascending: true })
            .range(all.length, all.length + PAGE - 1);
        if (error) throw error; // JANGAN generate NIK dari data yang gagal dimuat
        if (!data || data.length === 0) break;
        all = all.concat(data);
    }
    return all;
}

async function generateNikAuto(statusKaryawan, branchId, deptId, startDateVal) {
    const nikInput = document.getElementById("nik_karyawan");
    if (!nikInput) return;

    try {
        let generatedNik = "";

        // a. STATUS = "Borongan" (Format: A001 -> A999 -> B001)
        if (statusKaryawan === "Borongan") {
            const emps = await fetchNikList('____'); // semua NIK 4 karakter (format Borongan: huruf + 3 angka)

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

            if (maxSeq >= 999 && currentLetter === 'Z') {
                alert('Urutan NIK Borongan sudah mencapai Z999. Hubungi administrator.');
                return;
            }
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

            const emps = await fetchNikList(`${prefix}%`);

            let maxSeq = 0;
            (emps || []).forEach(e => {
                const nik = (e.nik_karyawan || "").trim();
                const seqStr = nik.replace(prefix, "");
                const seq = parseInt(seqStr, 10);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            });

            if (maxSeq >= 999) {
                alert('Urutan NIK untuk kombinasi ini sudah mencapai 999. Hubungi administrator.');
                return;
            }
            const nextSeq = maxSeq + 1;
            generatedNik = `${prefix}${String(nextSeq).padStart(3, '0')}`;
        } 
        // c. STATUS KARYAWAN LAINNYA (PKWTT, PKWT, DLL) (Format: DMB + branch_id + dept_id + YY + MM + Seq 001)
        else if (statusKaryawan !== "") {
            if (!branchId || !deptId) return;

            const d = startDateVal ? new Date(startDateVal) : new Date();
            const yy = String(d.getFullYear()).slice(-2);
            const mm = String(d.getMonth() + 1).padStart(2, '0');

            const prefix = `DMB${branchId}${deptId}${yy}${mm}`;

            const emps = await fetchNikList(`${prefix}%`);

            let maxSeq = 0;
            (emps || []).forEach(e => {
                const nik = (e.nik_karyawan || "").trim();
                const seqStr = nik.replace(prefix, "");
                const seq = parseInt(seqStr, 10);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            });

            if (maxSeq >= 999) {
                alert('Urutan NIK untuk kombinasi ini sudah mencapai 999. Hubungi administrator.');
                return;
            }
            const nextSeq = maxSeq + 1;
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