let currentEntity = "branches";
let masterCache = {};
let rawData = [];

document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();
    await loadCurrentMasterEntity();
    setupFormSubmit();

    // Form Supervisor Zona (panel terpisah dari form generik)
    const formSupervisorZone = document.getElementById("formSupervisorZone");
    if (formSupervisorZone) {
        formSupervisorZone.addEventListener("submit", handleSaveSupervisorZone);
    }
});

// Pindah menu sidebar. Menu "supervisor_zones" memakai panel sendiri
// (#supervisorPane), sedangkan menu lain memakai panel generik (#genericPane).
function switchMasterTab(entityName) {
    document.querySelectorAll('#masterTab .nav-link').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`#masterTab button[data-entity="${entityName}"]`);
    if (targetBtn) targetBtn.classList.add('active');

    currentEntity = entityName;

    const isSupervisor = entityName === "supervisor_zones";
    document.getElementById("genericPane").classList.toggle("d-none", isSupervisor);
    document.getElementById("supervisorPane").classList.toggle("d-none", !isSupervisor);

    if (isSupervisor) {
        loadSupervisorZonesList();
        return;
    }

    // Kembalikan filter ke "active" setiap pindah menu
    const filterEl = document.getElementById("filterStatus");
    if (filterEl) filterEl.value = "active";

    loadCurrentMasterEntity();
}

async function fetchTableData(tableName, schema = 'public') {
    const { data, error } = await supabaseClient.schema(schema).from(tableName).select("*").order("id", { ascending: true });
    if (error) throw error;
    return data || [];
}

async function ensureMasterCacheLoaded() {
    if (currentEntity === "branches") {
        // Jumlah cost center per cabang dihitung dari cost_centers.branch_id
        masterCache.cost_centers = await fetchTableData("cost_centers");
    } else if (currentEntity === "cost_centers") {
        // Data pendukung form Cost Center: master, struktur (cost_center_structures),
        // dan hak edit (fungsi database is_master_data_editor, sama dengan aturan RLS)
        const [branches, depts, areas, jabs, structs, ed] = await Promise.all([
            fetchTableData("branches"),
            fetchTableData("departments"),
            fetchTableData("areas"),
            fetchTableData("jabatans"),
            fetchTableData("cost_center_structures"),
            supabaseClient.rpc("is_master_data_editor")
        ]);
        masterCache.branches = branches;
        masterCache.departments = depts;
        masterCache.areas = areas;
        masterCache.jabatans = jabs;
        masterCache.cc_structures = structs;
        masterCache.isEditor = !ed.error && ed.data === true;   // gagal cek = dianggap tidak boleh
    }
}

// ---------- Helper checklist & hitungan (Cabang / Cost Center) ----------
// Hitung jumlah item unik yang terhubung ke satu pemilik (cabang / cost center)
function countLinks(links, ownerCol, ownerId, itemCol) {
    const set = new Set();
    (links || []).forEach(l => { if (l[ownerCol] == ownerId && l[itemCol] != null) set.add(l[itemCol]); });
    return set.size;
}

function countBadge(n) {
    const cls = n > 0 ? "bg-primary-subtle text-primary" : "bg-secondary-subtle text-secondary";
    return `<span class="badge ${cls}">${n}</span>`;
}

// Id item yang sudah terhubung ke satu pemilik (utk mencentang checklist saat Edit)
function selectedLinkIds(links, ownerCol, ownerId, itemCol) {
    if (ownerId === undefined || ownerId === null) return [];
    return (links || []).filter(l => l[ownerCol] == ownerId).map(l => l[itemCol]);
}

// Kotak checklist. items = [{id, label, active}]. Item non-aktif hanya
// ditampilkan jika sebelumnya sudah tercentang (supaya tidak hilang diam-diam).
function buildChecklistHtml(group, title, items, selectedIds) {
    const sel = new Set((selectedIds || []).map(Number));
    const rows = items
        .filter(it => it.active || sel.has(Number(it.id)))
        .map(it => `
            <div class="form-check">
                <input class="form-check-input chk-${group}" type="checkbox" id="chk_${group}_${it.id}" value="${it.id}" ${sel.has(Number(it.id)) ? "checked" : ""}>
                <label class="form-check-label small" for="chk_${group}_${it.id}">${it.label}${it.active ? "" : ' <span class="text-muted">(Non-Aktif)</span>'}</label>
            </div>`)
        .join("") || `<div class="small text-muted">Belum ada data.</div>`;
    return `<div class="mb-3">
                <label class="small fw-bold d-block mb-1">${title}</label>
                <div class="border rounded p-2 bg-light" style="max-height: 160px; overflow-y: auto;">${rows}</div>
            </div>`;
}

// Ambil id yang tercentang dari satu kelompok checklist
function getCheckedIds(group) {
    return [...document.querySelectorAll(`.chk-${group}:checked`)].map(el => parseInt(el.value));
}

// Samakan isi tabel penghubung dgn centangan terbaru:
// tambah yg baru dicentang, hapus yg dicopot (dan baris dobel jika ada).
// Insert dikerjakan DULU baru delete, supaya kalau insert gagal data lama tetap utuh.
async function syncCategoryLinks(table, ownerCol, ownerId, itemCol, newIds) {
    const { data: existing, error: errRead } = await supabaseClient
        .from(table).select(`id, ${itemCol}`).eq(ownerCol, ownerId);
    if (errRead) throw errRead;

    const wanted = new Set(newIds);
    const have = new Set();
    const deleteIds = [];
    (existing || []).forEach(r => {
        if (!wanted.has(r[itemCol]) || have.has(r[itemCol])) deleteIds.push(r.id);
        else have.add(r[itemCol]);
    });
    const toInsert = newIds.filter(id => !have.has(id)).map(id => ({ [ownerCol]: ownerId, [itemCol]: id }));

    if (toInsert.length > 0) {
        const { error } = await supabaseClient.from(table).insert(toInsert);
        if (error) throw error;
    }
    if (deleteIds.length > 0) {
        const { error } = await supabaseClient.from(table).delete().in("id", deleteIds);
        if (error) throw error;
    }
}

async function loadCurrentMasterEntity() {
    const bodyEl = document.getElementById("masterTableBody");
    if (!bodyEl) return;
    
    bodyEl.innerHTML = `<tr><td colspan="100%" class="text-center py-4">Memuat data...</td></tr>`;

    try {
        await ensureMasterCacheLoaded();
        rawData = await fetchTableData(currentEntity);
        renderMasterTable();
    } catch (err) {
        bodyEl.innerHTML = `<tr><td colspan="100%" class="text-center text-danger">Gagal memuat data: ${err.message || err}</td></tr>`;
    }
}

// Render Table + Terapkan Filter
function renderMasterTable() {
    const filterEl = document.getElementById("filterStatus");
    const filterVal = filterEl ? filterEl.value : "active";
    
    // Terapkan Filter Status
    const filteredData = rawData.filter(row => {
        const isActive = row.is_active !== false;
        if (filterVal === "all") return true;
        if (filterVal === "active") return isActive;
        if (filterVal === "inactive") return !isActive;
        return true;
    });

    const headerEl = document.getElementById("masterTableHeader");
    const bodyEl = document.getElementById("masterTableBody");
    
    const titles = { 
        branches: "Daftar Cabang", 
        departments: "Daftar Departemen", 
        cost_centers: "Daftar Cost Center", 
        jabatans: "Daftar Jabatan", 
        bagians: "Daftar Bagian", 
        areas: "Daftar Area Kerja", 
        zonas: "Daftar Zona", 
    };
    
    const titleEl = document.getElementById("masterTableTitle");
    if (titleEl) titleEl.innerHTML = titles[currentEntity] || "Master Data";

    let headerHtml = `<th style="width: 50px;" class="text-center">No</th>`;
    if (currentEntity === "branches") headerHtml += `<th>Nama Cabang</th><th class="text-center">Jumlah Cost Center</th>`;
    else if (currentEntity === "departments") headerHtml += `<th>Nama Departemen</th>`;
    else if (currentEntity === "cost_centers") headerHtml += `<th>Nama Cost Center</th><th>Cabang</th><th class="text-center">Dept</th><th class="text-center">Area</th><th class="text-center">Jabatan</th>`;
    else if (currentEntity === "jabatans") headerHtml += `<th>Nama Jabatan</th>`;
    else if (currentEntity === "bagians") headerHtml += `<th>Nama Bagian</th>`;
    else if (currentEntity === "areas") headerHtml += `<th>Nama Area</th>`;
    else if (currentEntity === "zonas") headerHtml += `<th>Nama Zona</th>`;
    
    headerHtml += `<th class="text-center">Status</th><th style="width: 100px;" class="text-center">Aksi</th>`;
    headerEl.innerHTML = headerHtml;

    if (filteredData.length === 0) {
        bodyEl.innerHTML = `<tr><td colspan="100%" class="text-center py-4 text-muted">Tidak ada data yang sesuai dengan filter.</td></tr>`;
        return;
    }

    // Utk cost_centers: kelompokkan data per Cabang (diurutkan
    // alfabet nama cabang), disisipi baris judul kelompok. Nomor
    // urut (No) tetap berjalan menerus lintas kelompok (tidak
    // reset ke 1 tiap ganti cabang) — konsisten dgn tabel lain.
    const columnCount = (headerHtml.match(/<th/g) || []).length;
    let displayData = filteredData;
    const groupByBranch = currentEntity === "cost_centers";

    if (groupByBranch) {
        displayData = [...filteredData].sort((a, b) => {
            const branchA = (masterCache.branches||[]).find(br => br.id == a.branch_id);
            const branchB = (masterCache.branches||[]).find(br => br.id == b.branch_id);
            return (branchA?.branch_name||'').localeCompare(branchB?.branch_name||'', 'id');
        });
    }

    let bodyHtml = "";
    let lastBranchId; // penanda kelompok terakhir yg sudah ditulis, undefined di awal
    displayData.forEach((row, idx) => {
        if (groupByBranch && row.branch_id !== lastBranchId) {
            const br = (masterCache.branches||[]).find(b => b.id == row.branch_id);
            const branchLabel = br?.branch_name || 'Tanpa Cabang';
            bodyHtml += `<tr class="table-group-header"><td colspan="${columnCount}" class="fw-bold bg-light">${branchLabel}</td></tr>`;
            lastBranchId = row.branch_id;
        }

        const isActive = row.is_active !== false;
        const statusBadge = isActive ? `<span class="badge bg-success-subtle text-success">Aktif</span>` : `<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>`;
        
        const toggleIcon = isActive ? `<i class="fa-solid fa-ban"></i>` : `<i class="fa-solid fa-check"></i>`;
        const toggleColor = isActive ? `text-danger` : `text-success`;
        const toggleTitle = isActive ? `Non-aktifkan Data` : `Aktifkan Data`;

        bodyHtml += `<tr><td class="text-center">${idx + 1}</td>`;
        if (currentEntity === "branches") {
            const nCc = (masterCache.cost_centers||[]).filter(c => c.branch_id == row.id).length;
            bodyHtml += `<td>${row.branch_name||'-'}</td><td class="text-center">${countBadge(nCc)}</td>`;
        }
        else if (currentEntity === "departments") bodyHtml += `<td>${row.department_name||'-'}</td>`;
        else if (currentEntity === "cost_centers") {
            const br = (masterCache.branches||[]).find(b => b.id == row.branch_id);
            const nDept = countLinks(masterCache.cc_structures, "cost_center_id", row.id, "dept_id");
            const nArea = countLinks(masterCache.cc_structures, "cost_center_id", row.id, "area_id");
            const nJab = countLinks(masterCache.cc_structures, "cost_center_id", row.id, "jabatan_id");
            bodyHtml += `<td>${row.costcenter_name||'-'}</td><td>${br?.branch_name||'-'}</td>
                <td class="text-center">${countBadge(nDept)}</td>
                <td class="text-center">${countBadge(nArea)}</td>
                <td class="text-center">${countBadge(nJab)}</td>`;
        }
        else if (currentEntity === "jabatans") bodyHtml += `<td>${row.jabatan_name||'-'}</td>`;
        else if (currentEntity === "bagians") bodyHtml += `<td>${row.bagian_name||'-'}</td>`;
        else if (currentEntity === "areas") {
            bodyHtml += `<td>${row.area_name||'-'}</td>`;
        }
        else if (currentEntity === "zonas") bodyHtml += `<td>${row.zona_name||'-'}</td>`;

        bodyHtml += `
            <td class="text-center">${statusBadge}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-light border text-primary" onclick="openEditMasterModal(${row.id})" title="Edit Data"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn btn-sm btn-light border ${toggleColor}" onclick="toggleActiveStatus(${row.id}, ${isActive})" title="${toggleTitle}">${toggleIcon}</button>
            </td></tr>`;
    });
    bodyEl.innerHTML = bodyHtml;
}

async function openCreateMasterModal() {
    await ensureMasterCacheLoaded();
    document.getElementById("formMaster").reset();
    document.getElementById("master_id").value = "";
    document.getElementById("modalMasterTitle").innerText = `Tambah Data`;
    renderModalFields({});
    
    // Pastikan input kunci/kode bisa diisi saat Tambah Data
    const codeInput = document.getElementById("f_code");
    if (codeInput) {
        codeInput.removeAttribute("readonly");
        codeInput.removeAttribute("disabled");
        codeInput.classList.remove("bg-light");
    }

    new bootstrap.Modal(document.getElementById("modalMasterForm")).show();
}

async function openEditMasterModal(id) {
    try {
        await ensureMasterCacheLoaded();
        const { data, error } = await supabaseClient.from(currentEntity).select("*").eq("id", id).single();
        if (error) throw error;

        document.getElementById("master_id").value = data.id;
        document.getElementById("modalMasterTitle").innerText = `Edit Data`;
        renderModalFields(data);
        
        // Lock field utama/kode saat Edit Data
        const codeInput = document.getElementById("f_code");
        if (codeInput) {
            if (codeInput.tagName === "SELECT") {
                codeInput.setAttribute("disabled", "disabled");
            } else {
                codeInput.setAttribute("readonly", "readonly");
                codeInput.classList.add("bg-light");
            }
        }

        new bootstrap.Modal(document.getElementById("modalMasterForm")).show();
    } catch (err) {
        alert("Gagal mengambil data edit: " + (err.message || err));
    }
}

function renderModalFields(row) {
    let html = "";
    if (currentEntity === "branches") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.branch_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Cabang <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.branch_name||''}" required></div>`
            + "";
    } else if (currentEntity === "departments") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.department_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Departemen <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.department_name||''}" required></div>`;
    } else if (currentEntity === "cost_centers") {
        const branchOpts = (masterCache.branches||[]).filter(b => b.is_active !== false).map(b => `<option value="${b.id}" ${row.branch_id == b.id ? 'selected' : ''}>${b.branch_name}</option>`).join('');
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.costcenter_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Cost Center <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.costcenter_name||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Cabang <span class="text-danger">*</span></label><select id="f_branch" class="form-select" required><option value="">-- Pilih Cabang --</option>${branchOpts}</select></div>`
            + `<label class="small fw-bold d-block mb-2">Struktur Area, Departemen dan Jabatan</label><div id="ccStructWrap"></div>`;
    } else if (currentEntity === "jabatans") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.jabatan_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Jabatan <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.jabatan_name||''}" required></div>`;
    } else if (currentEntity === "bagians") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.bagian_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Bagian <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.bagian_name||''}" required></div>`;
    } else if (currentEntity === "areas") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.area_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Area <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.area_name||''}" required></div>`;
    } else if (currentEntity === "zonas") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.zona_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Zona <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.zona_name||''}" required></div>`;
    }
    const dlg = document.querySelector("#modalMasterForm .modal-dialog");
    if (dlg) {
        dlg.classList.toggle("modal-lg", currentEntity === "cost_centers");
        dlg.classList.toggle("modal-fullscreen-sm-down", currentEntity === "cost_centers"); // layar penuh di HP
    }
    document.getElementById("modalMasterFields").innerHTML = html;
    if (currentEntity === "cost_centers") initCcStructure((masterCache.cc_structures||[]).filter(s => s.cost_center_id == row.id));
}

function setupFormSubmit() {
    const form = document.getElementById("formMaster");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("master_id").value;
        const btnSave = document.getElementById("btnSaveMaster");
        const origBtnText = btnSave ? btnSave.innerHTML : "Simpan";

        if (btnSave) {
            btnSave.disabled = true;
            btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
        }

        try {
            let payload = {};

            // Mengambil nilai element (walaupun di-disabled)
            const codeEl = document.getElementById("f_code");
            const codeVal = codeEl ? codeEl.value : "";
            const nameVal = document.getElementById("f_name")?.value || "";

            if (currentEntity === "branches") {
                payload = { branch_code: codeVal, branch_name: nameVal };
            } else if (currentEntity === "departments") {
                payload = { department_code: codeVal, department_name: nameVal };
            } else if (currentEntity === "cost_centers") {
                const branchVal = document.getElementById("f_branch")?.value;
                payload = { costcenter_code: codeVal, costcenter_name: nameVal, branch_id: branchVal ? parseInt(branchVal) : null };
            } else if (currentEntity === "jabatans") {
                payload = { jabatan_code: codeVal, jabatan_name: nameVal };
            } else if (currentEntity === "bagians") {
                payload = { bagian_code: codeVal, bagian_name: nameVal };
            } else if (currentEntity === "areas") {
                payload = { area_code: codeVal, area_name: nameVal };
            } else if (currentEntity === "zonas") {
                payload = { zona_code: codeVal, zona_name: nameVal };
            }

            // Validasi struktur DULU, sebelum cost center disimpan (jika tidak lengkap, tidak ada yang tersimpan)
            let structRows = [];
            if (currentEntity === "cost_centers" && masterCache.isEditor) structRows = structToRows();

            let resultError = null;
            let ownerId = id ? parseInt(id) : null;

            if (id) {
                // Update
                const { error } = await supabaseClient.from(currentEntity).update(payload).eq("id", parseInt(id));
                resultError = error;
            } else {
                // Insert Baru (minta id baru kembali, dibutuhkan utk menyimpan checklist)
                payload.is_active = true;
                const { data: inserted, error } = await supabaseClient.from(currentEntity).insert([payload]).select("id").single();
                resultError = error;
                ownerId = inserted ? inserted.id : null;
                // Jika langkah checklist di bawah gagal & user klik Simpan lagi,
                // proses berikutnya jadi Update (bukan Insert dobel).
                if (ownerId) document.getElementById("master_id").value = ownerId;
            }

            if (resultError) throw resultError;

            // Simpan struktur Area-Departemen-Jabatan (satu panggilan, atomik)
            if (currentEntity === "cost_centers" && masterCache.isEditor) {
                await saveCcStructure(ownerId, structRows);
            }

            // Tutup Modal & Refresh Data
            const modalEl = document.getElementById("modalMasterForm");
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
            
            await loadCurrentMasterEntity();

        } catch (err) {
            alert("Gagal menyimpan data: " + (err.message || JSON.stringify(err)));
        } finally {
            if (btnSave) {
                btnSave.disabled = false;
                btnSave.innerHTML = origBtnText;
            }
        }
    });
}

// Soft Delete (Ubah Status Aktif/Non-Aktif)
async function toggleActiveStatus(id, currentStatus) {
    const actionText = currentStatus ? "menonaktifkan" : "mengaktifkan";
    if (!confirm(`Apakah Anda yakin ingin ${actionText} data ini?`)) return;
    
    try {
        const { error } = await supabaseClient.from(currentEntity).update({ is_active: !currentStatus }).eq("id", parseInt(id));
        if (error) throw error;
        
        await loadCurrentMasterEntity();
    } catch (e) {
        alert("Gagal merubah status: " + (e.message || e));
    }
}

// ===================================================
// SUPERVISOR ZONA (dipindahkan dari system_config.js)
// Tampilan & pengaturan dari system_config, ditambah:
//  - kolom No + pengelompokan per cabang
//  - JALUR approval: Semua / Barang / Non-Barang
//  - PERAN: Utama / Cadangan
//    Cadangan HANYA dipakai kalau pemohon = approver Utama (aturan ada di database).
// ===================================================

const SV_JALUR_LABEL = { SEMUA: "Semua", BARANG: "Barang", NON_BARANG: "Non-Barang" };
const SV_JALUR_ORDER = { SEMUA: 0, BARANG: 1, NON_BARANG: 2 };
const SV_JALUR_BADGE = { SEMUA: "bg-secondary-subtle text-secondary", BARANG: "bg-info-subtle text-info", NON_BARANG: "bg-warning-subtle text-warning" };
const SV_PERAN_LABEL = { UTAMA: "Utama", CADANGAN: "Cadangan" };
const SV_PERAN_ORDER = { UTAMA: 0, CADANGAN: 1 };
const SV_PERAN_BADGE = { UTAMA: "bg-primary-subtle text-primary", CADANGAN: "bg-secondary-subtle text-secondary" };

// ---------------------------------------------------
// S1. STATE
// ---------------------------------------------------
let supervisorZonesList = [];
let svZonaList = [];
let svDeptList = [];
let svBranchList = [];
let svEmployeeMap = {};        // { employee_id: {id, nama, nik_karyawan} }
let svBranchByEmployee = {};   // { employee_id: branch_id } dari hrd.employee_assignments aktif
let svSearchResults = [];      // hasil pencarian karyawan terakhir (dipilih lewat nomor indeks)
let editingSupervisorZoneId = null;
let supervisorSearchTimeout = null;
let isSupervisorSubmitting = false;

// ---------------------------------------------------
// S2. LOAD DATA
// ---------------------------------------------------
async function loadSupervisorZonesList() {
    const tbody = document.getElementById("supervisorZonesTableBody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">Memuat data...</td></tr>`;

    try {
        const [zonas, depts, branches, szRes] = await Promise.all([
            fetchTableData("zonas"),
            fetchTableData("departments"),
            fetchTableData("branches"),
            supabaseClient.from("supervisor_zones").select("*")
                .order("zona_id", { ascending: true })
                .order("departemen_id", { ascending: true })
        ]);
        if (szRes.error) throw szRes.error;

        svZonaList = zonas;
        svDeptList = depts;
        svBranchList = branches;
        supervisorZonesList = szRes.data || [];
        svEmployeeMap = {};
        svBranchByEmployee = {};

        // supervisor_zones.employee_id (uuid) merujuk ke hrd.employees (schema BEDA),
        // jadi diambil lewat query terpisah lalu digabung manual di JS.
        const employeeIds = [...new Set(supervisorZonesList.map(sz => sz.employee_id))];
        if (employeeIds.length > 0) {
            const [empRes, asgRes] = await Promise.all([
                supabaseClient.schema("hrd").from("employees")
                    .select("id, nama, nik_karyawan").in("id", employeeIds),
                supabaseClient.schema("hrd").from("employee_assignments")
                    .select("employee_id, branch_id, start_date")
                    .eq("is_active", true).in("employee_id", employeeIds)
            ]);
            if (empRes.error) throw empRes.error;
            if (asgRes.error) throw asgRes.error;

            (empRes.data || []).forEach(e => { svEmployeeMap[e.id] = e; });

            // Kalau ada >1 penempatan aktif, pakai yang start_date-nya paling baru
            (asgRes.data || [])
                .sort((a, b) => String(a.start_date || "").localeCompare(String(b.start_date || "")))
                .forEach(a => { svBranchByEmployee[a.employee_id] = a.branch_id; });
        }

        renderSupervisorZoneDropdowns();
        renderSupervisorZonesTable();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Gagal memuat data: ${err.message || err}</td></tr>`;
    }
}

// Isi dropdown Zona (hanya zona aktif) & Departemen di modal. Diawali "-- Pilih --"
// supaya pilihan pertama tidak terpilih otomatis.
function renderSupervisorZoneDropdowns() {
    const zonaOptions = svZonaList
        .filter(z => z.is_active !== false)
        .map(z => `<option value="${z.id}">${z.zona_name} (${z.zona_code})</option>`)
        .join("");
    const deptOptions = svDeptList
        .map(d => `<option value="${d.id}">${d.department_name}</option>`)
        .join("");

    const zonaSel = document.getElementById("sz_zona_id");
    if (zonaSel) zonaSel.innerHTML = `<option value="" selected disabled>-- Pilih Zona --</option>` + zonaOptions;
    const deptSel = document.getElementById("sz_departemen_id");
    if (deptSel) deptSel.innerHTML = `<option value="" selected disabled>-- Pilih Departemen --</option>` + deptOptions;
}

// ---------------------------------------------------
// S3. TAMPILAN TABEL (No + grup per cabang + Jalur + Peran)
// Urutan: Cabang -> Zona -> Departemen -> Jalur -> Peran (Utama dulu)
// ---------------------------------------------------
function renderSupervisorZonesTable() {
    const tbody = document.getElementById("supervisorZonesTableBody");
    if (!tbody) return;

    if (supervisorZonesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Belum ada supervisor terdaftar.</td></tr>`;
        return;
    }

    const rows = supervisorZonesList.map(sz => {
        const branchId = svBranchByEmployee[sz.employee_id] ?? null;
        const br = branchId !== null ? svBranchList.find(b => b.id == branchId) : null;
        return { sz, branchId: br ? br.id : null, branchName: br ? br.branch_name : "Tanpa Cabang" };
    });
    rows.sort((a, b) => {
        if (a.branchId === null && b.branchId !== null) return 1;
        if (b.branchId === null && a.branchId !== null) return -1;
        return a.branchName.localeCompare(b.branchName, "id")
            || (Number(a.branchId) - Number(b.branchId))
            || (a.sz.zona_id - b.sz.zona_id)
            || (a.sz.departemen_id - b.sz.departemen_id)
            || ((SV_JALUR_ORDER[a.sz.jalur] ?? 9) - (SV_JALUR_ORDER[b.sz.jalur] ?? 9))
            || ((SV_PERAN_ORDER[a.sz.peran] ?? 9) - (SV_PERAN_ORDER[b.sz.peran] ?? 9));
    });

    let html = "";
    let lastBranchId;   // undefined di awal supaya header kelompok pertama tetap tercetak
    rows.forEach(({ sz, branchId, branchName }, idx) => {
        if (branchId !== lastBranchId) {
            html += `<tr class="table-group-header"><td colspan="8" class="fw-bold bg-light text-start"><i class="fa-solid fa-building me-2 text-secondary"></i>${branchName}</td></tr>`;
            lastBranchId = branchId;
        }

        const zona = svZonaList.find(z => z.id === sz.zona_id);
        const dept = svDeptList.find(d => d.id === sz.departemen_id);
        const emp = svEmployeeMap[sz.employee_id];
        const empLabel = emp ? `${emp.nama} (${emp.nik_karyawan})` : sz.employee_id;

        html += `
            <tr class="text-center">
                <td>${idx + 1}</td>
                <td class="text-start fw-semibold">${empLabel}</td>
                <td class="text-start">${zona ? zona.zona_name : '-'}</td>
                <td class="text-start">${dept ? dept.department_name : '<span class="text-danger small">Belum diisi</span>'}</td>
                <td><span class="badge ${SV_JALUR_BADGE[sz.jalur] || ''}">${SV_JALUR_LABEL[sz.jalur] || sz.jalur}</span></td>
                <td><span class="badge ${SV_PERAN_BADGE[sz.peran] || ''}">${SV_PERAN_LABEL[sz.peran] || sz.peran}</span></td>
                <td>${sz.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
                <td>
                    <button class="btn btn-sm btn-light text-primary me-1" onclick="openSupervisorZoneModal(${sz.id})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-light text-danger" onclick="deleteSupervisorZone(${sz.id})" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });

    tbody.innerHTML = html;
}

// ---------------------------------------------------
// S4. PENCARIAN KARYAWAN (bukan dropdown biasa -- bisa ribuan baris)
// Debounce 300ms supaya tidak query tiap ketikan huruf.
// ---------------------------------------------------
function handleSupervisorEmployeeSearch() {
    clearTimeout(supervisorSearchTimeout);
    // Mengetik ulang = pilihan karyawan sebelumnya dibatalkan
    document.getElementById("sz_selected_employee_id").value = "";
    checkSupervisorConflict();

    const query = document.getElementById("sz_employee_search").value.trim();
    const resultsEl = document.getElementById("sz_employee_search_results");

    if (query.length < 3) {
        resultsEl.innerHTML = "";
        return;
    }

    supervisorSearchTimeout = setTimeout(async () => {
        const { data, error } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .select("id, nama, nik_karyawan")
            .or(`nama.ilike.%${query}%,nik_karyawan.ilike.%${query}%`)
            .eq("is_active", true)
            .limit(10);

        if (error || !data || data.length === 0) {
            svSearchResults = [];
            resultsEl.innerHTML = `<div class="list-group-item small text-muted">Tidak ditemukan.</div>`;
            return;
        }

        // Dipilih lewat indeks (lebih aman daripada JSON di atribut onclick)
        svSearchResults = data;
        resultsEl.innerHTML = data.map((emp, i) => `
            <button type="button" class="list-group-item list-group-item-action small" onclick="selectSupervisorEmployee(${i})">
                ${emp.nama} <span class="text-muted">(${emp.nik_karyawan})</span>
            </button>`).join("");
    }, 300);
}

function selectSupervisorEmployee(index) {
    const emp = svSearchResults[index];
    if (!emp) return;
    document.getElementById("sz_selected_employee_id").value = emp.id;
    document.getElementById("sz_employee_search").value = `${emp.nama} (${emp.nik_karyawan})`;
    document.getElementById("sz_employee_search_results").innerHTML = "";
    checkSupervisorConflict();
}

// ---------------------------------------------------
// S5. CEK BENTROK + HARDLOCK (pesan di modal, tombol Simpan terkunci)
// Aturan:
//  1. 1 slot = Zona + Departemen + Jalur + Peran hanya boleh punya 1 orang AKTIF
//     (sama dengan index unik di database)
//  2. Satu orang tidak boleh jadi Utama SEKALIGUS Cadangan di Zona + Departemen + Jalur yang sama
// ---------------------------------------------------
function findSupervisorConflict(employeeId, zonaId, deptId, jalur, peran) {
    const slot = supervisorZonesList.find(x =>
        x.is_active && x.zona_id === zonaId && x.departemen_id === deptId &&
        x.jalur === jalur && x.peran === peran);
    if (slot) return { type: "slot", row: slot };

    if (employeeId) {
        const sama = supervisorZonesList.find(x =>
            x.is_active && x.employee_id === employeeId && x.zona_id === zonaId &&
            x.departemen_id === deptId && x.jalur === jalur && x.peran !== peran);
        if (sama) return { type: "orang_sama", row: sama };
    }
    return null;
}

function buildSupervisorConflictMessage(c, jalur, peran) {
    const emp = svEmployeeMap[c.row.employee_id];
    const nama = emp ? emp.nama : "Karyawan lain";
    if (c.type === "slot") {
        return `Slot ini sudah terisi oleh ${nama} (jalur ${SV_JALUR_LABEL[jalur]}, peran ${SV_PERAN_LABEL[peran]}). Nonaktifkan atau hapus dulu supervisor lama.`;
    }
    return `${nama} sudah terdaftar sebagai ${SV_PERAN_LABEL[c.row.peran]} untuk zona, departemen, dan jalur yang sama. Satu orang tidak boleh menjadi Utama sekaligus Cadangan.`;
}

function showSupervisorLock(message) {
    const alertEl = document.getElementById("sz_duplicate_alert");
    const msgEl = document.getElementById("sz_duplicate_message");
    const btn = document.getElementById("btnSaveSupervisorZone");
    if (msgEl) msgEl.textContent = message;
    if (alertEl) alertEl.classList.remove("d-none");
    if (btn) btn.disabled = true;
}

function clearSupervisorLock() {
    const alertEl = document.getElementById("sz_duplicate_alert");
    const btn = document.getElementById("btnSaveSupervisorZone");
    if (alertEl) alertEl.classList.add("d-none");
    if (btn) btn.disabled = false;
}

// Dipanggil otomatis tiap pilihan di modal (mode Tambah) berubah.
// Mengembalikan true kalau bentrok (modal terkunci).
function checkSupervisorConflict() {
    if (editingSupervisorZoneId !== null) return false;

    const zonaId = parseInt(document.getElementById("sz_zona_id").value);
    const deptId = parseInt(document.getElementById("sz_departemen_id").value);
    const jalur = document.getElementById("sz_jalur").value;
    const peran = document.getElementById("sz_peran").value;
    const employeeId = document.getElementById("sz_selected_employee_id").value;
    const willBeActive = document.getElementById("sz_is_active").value === "true";

    if (!zonaId || !deptId || !willBeActive) {
        clearSupervisorLock();
        return false;
    }

    const c = findSupervisorConflict(employeeId, zonaId, deptId, jalur, peran);
    if (c) {
        showSupervisorLock(buildSupervisorConflictMessage(c, jalur, peran));
        return true;
    }
    clearSupervisorLock();
    return false;
}

// ---------------------------------------------------
// S6. MODAL TAMBAH / EDIT
// Mode Edit: Karyawan, Zona, Departemen, Jalur & Peran DIKUNCI (hanya Status yang bisa diubah)
// ---------------------------------------------------
const SV_ADD_ONLY_IDS = ["sz_employee_search_wrapper", "sz_zona_wrapper", "sz_dept_wrapper", "sz_jalur_wrapper", "sz_peran_wrapper", "sz_help_wrapper"];

function openSupervisorZoneModal(editId = null) {
    const form = document.getElementById("formSupervisorZone");
    if (form) form.reset();
    editingSupervisorZoneId = editId;
    isSupervisorSubmitting = false;
    svSearchResults = [];
    document.getElementById("sz_employee_search_results").innerHTML = "";
    document.getElementById("sz_selected_employee_id").value = "";

    const title = document.getElementById("modalSupervisorZoneTitle");
    const infoEl = document.getElementById("sz_employee_selected_display");

    // Reset info terkunci dari sesi Edit sebelumnya
    infoEl.classList.add("d-none");
    infoEl.innerHTML = "";
    clearSupervisorLock();

    if (editId === null) {
        // ---- MODE TAMBAH ----
        if (title) title.textContent = "Tambah Supervisor Zona";
        SV_ADD_ONLY_IDS.forEach(id => document.getElementById(id).classList.remove("d-none"));
        document.getElementById("sz_edit_id").value = "";
        renderSupervisorZoneDropdowns();
        checkSupervisorConflict();

    } else {
        // ---- MODE EDIT ----
        const sz = supervisorZonesList.find(x => x.id === editId);
        if (!sz) { alert("Data tidak ditemukan."); return; }

        const zona = svZonaList.find(z => z.id === sz.zona_id);
        const dept = svDeptList.find(d => d.id === sz.departemen_id);
        const emp = svEmployeeMap[sz.employee_id];

        if (title) title.textContent = "Edit Supervisor Zona";
        SV_ADD_ONLY_IDS.forEach(id => document.getElementById(id).classList.add("d-none"));

        document.getElementById("sz_edit_id").value = sz.id;
        document.getElementById("sz_selected_employee_id").value = sz.employee_id;
        document.getElementById("sz_is_active").value = sz.is_active ? "true" : "false";

        infoEl.classList.remove("d-none");
        infoEl.innerHTML = `<div class="alert alert-secondary py-2 small mb-2">
            <strong>${emp ? emp.nama : '-'}</strong><br>
            Zona: <strong>${zona?.zona_name || '-'}</strong> | Departemen: <strong>${dept?.department_name || '-'}</strong><br>
            Jalur: <strong>${SV_JALUR_LABEL[sz.jalur] || sz.jalur}</strong> | Peran: <strong>${SV_PERAN_LABEL[sz.peran] || sz.peran}</strong><br>
            <span class="text-muted">Tidak bisa diubah di sini -- hapus &amp; buat baru kalau perlu pindah.</span></div>`;
    }

    new bootstrap.Modal(document.getElementById("modalSupervisorZone")).show();
}

// ---------------------------------------------------
// S7. SIMPAN & HAPUS
// ---------------------------------------------------
async function handleSaveSupervisorZone(e) {
    if (e) e.preventDefault();
    if (isSupervisorSubmitting) return;

    const wasEditing = editingSupervisorZoneId !== null;
    const isActive = document.getElementById("sz_is_active").value === "true";

    // ---- HARDLOCK sisi aplikasi (mode Tambah): validasi + cek bentrok SEBELUM dikirim ----
    if (!wasEditing) {
        const employeeId = document.getElementById("sz_selected_employee_id").value;
        const zonaId = parseInt(document.getElementById("sz_zona_id").value);
        const deptId = parseInt(document.getElementById("sz_departemen_id").value);
        if (!employeeId) { alert("Pilih karyawan dari hasil pencarian dulu."); return; }
        if (!zonaId) { alert("Pilih zona dulu."); return; }
        if (!deptId) { alert("Pilih departemen dulu."); return; }
        if (checkSupervisorConflict()) return;   // pesan sudah tampil di modal
    }

    isSupervisorSubmitting = true;
    const btnSubmit = e.target.querySelector("button[type='submit']");
    const origText = btnSubmit ? btnSubmit.innerHTML : "Simpan";
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
    }

    let saved = false;
    let dbConflictMessage = "";

    try {
        if (wasEditing) {
            // ---- UPDATE -- hanya status ----
            const { error } = await supabaseClient
                .from("supervisor_zones")
                .update({ is_active: isActive })
                .eq("id", editingSupervisorZoneId);
            if (error) {
                if (error.code === "23505") {
                    dbConflictMessage = "Tidak bisa diaktifkan: slot (zona + departemen + jalur + peran) ini sudah diisi supervisor aktif lain.";
                } else {
                    throw error;
                }
            } else {
                saved = true;
            }

        } else {
            // ---- INSERT BARU ----
            const { error } = await supabaseClient.from("supervisor_zones").insert([{
                employee_id: document.getElementById("sz_selected_employee_id").value,
                zona_id: parseInt(document.getElementById("sz_zona_id").value),
                departemen_id: parseInt(document.getElementById("sz_departemen_id").value),
                jalur: document.getElementById("sz_jalur").value,
                peran: document.getElementById("sz_peran").value,
                is_active: isActive
            }]);
            if (error) {
                // 23505 = bentrok di database (jaring pengaman terakhir)
                if (error.code === "23505") {
                    dbConflictMessage = "Slot ini baru saja diisi pengguna lain. Data sudah dimuat ulang, silakan periksa kembali.";
                } else {
                    throw error;
                }
            } else {
                saved = true;
            }
        }

        if (saved) {
            bootstrap.Modal.getInstance(document.getElementById("modalSupervisorZone"))?.hide();
        }
        await loadSupervisorZonesList();
        if (saved) alert(wasEditing ? "Supervisor Zona berhasil diperbarui!" : "Supervisor Zona berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan: " + (err.message || err));
    } finally {
        // Mode Edit dipertahankan kalau gagal, supaya klik Simpan berikutnya tetap UPDATE
        if (saved) editingSupervisorZoneId = null;
        isSupervisorSubmitting = false;
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = origText;
        }
    }

    if (dbConflictMessage) {
        if (!checkSupervisorConflict()) showSupervisorLock(dbConflictMessage);
    }
}

async function deleteSupervisorZone(id) {
    if (!confirm("Yakin hapus supervisor dari zona ini?\n\nPengajuan yang masih menunggu approver ini akan kehilangan approver sampai approver baru didaftarkan.")) return;
    try {
        const { error } = await supabaseClient.from("supervisor_zones").delete().eq("id", id);
        if (error) throw error;
        await loadSupervisorZonesList();
    } catch (e) {
        alert("Gagal menghapus: " + (e.message || e));
    }
}