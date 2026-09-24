<<<<<<< HEAD
let currentEntity = "branches";
let masterCache = {};
let rawData = [];

document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();
    await loadCurrentMasterEntity();
    setupFormSubmit();
});

function switchMasterTab(entityName) {
    document.querySelectorAll('.nav-pills .nav-link').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`button[onclick="switchMasterTab('${entityName}')"]`);
    if (targetBtn) targetBtn.classList.add('active');
    
    currentEntity = entityName;
    
    // Kembalikan filter ke "active" setiap pindah tab
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
    if (currentEntity === "areas") {
        masterCache.cost_centers = await fetchTableData("cost_centers");
        masterCache.zonas = await fetchTableData("zonas");
    } else if (currentEntity === "cost_centers") {
        masterCache.branches = await fetchTableData("branches");
    } else if (currentEntity === "supervisor_zones") {
        masterCache.employees = await fetchTableData("employees", "hrd");
        masterCache.assignments = await fetchTableData("employee_assignments", "hrd");
        masterCache.departments = await fetchTableData("departments");
        masterCache.jabatans = await fetchTableData("jabatans");
        masterCache.zonas = await fetchTableData("zonas");
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
        supervisor_zones: "Daftar Zona Supervisor" 
    };
    
    const titleEl = document.getElementById("masterTableTitle");
    if (titleEl) titleEl.innerHTML = titles[currentEntity] || "Master Data";

    let headerHtml = `<th style="width: 50px;" class="text-center">No</th>`;
    if (currentEntity === "branches") headerHtml += `<th>Nama Cabang</th>`;
    else if (currentEntity === "departments") headerHtml += `<th>Nama Departemen</th>`;
    else if (currentEntity === "cost_centers") headerHtml += `<th>Nama Cost Center</th><th>Cabang</th>`;
    else if (currentEntity === "jabatans") headerHtml += `<th>Nama Jabatan</th>`;
    else if (currentEntity === "bagians") headerHtml += `<th>Nama Bagian</th>`;
    else if (currentEntity === "areas") headerHtml += `<th>Nama Area</th><th>Cost Center</th><th>Zona</th>`;
    else if (currentEntity === "zonas") headerHtml += `<th>Nama Zona</th>`;
    else if (currentEntity === "supervisor_zones") headerHtml += `<th>NIK Supervisor</th><th>Nama Karyawan</th><th>Departemen</th><th>Jabatan</th><th>Zona Tanggung Jawab</th>`;
    
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
        if (currentEntity === "branches") bodyHtml += `<td>${row.branch_name||'-'}</td>`;
        else if (currentEntity === "departments") bodyHtml += `<td>${row.department_name||'-'}</td>`;
        else if (currentEntity === "cost_centers") {
            const br = (masterCache.branches||[]).find(b => b.id == row.branch_id);
            bodyHtml += `<td>${row.costcenter_name||'-'}</td><td>${br?.branch_name||'-'}</td>`;
        }
        else if (currentEntity === "jabatans") bodyHtml += `<td>${row.jabatan_name||'-'}</td>`;
        else if (currentEntity === "bagians") bodyHtml += `<td>${row.bagian_name||'-'}</td>`;
        else if (currentEntity === "areas") {
            const cc = (masterCache.cost_centers||[]).find(c => c.id == row.cost_center_id);
            const zn = (masterCache.zonas||[]).find(z => z.id == row.zona_id);
            bodyHtml += `<td>${row.area_name||'-'}</td><td>${cc?.costcenter_name||'-'}</td><td>${zn?.zona_name||'-'}</td>`;
        }
        else if (currentEntity === "zonas") bodyHtml += `<td>${row.zona_name||'-'}</td>`;
        else if (currentEntity === "supervisor_zones") {
            // Pencarian karyawan fleksibel (mencocokkan NIK Karyawan atau ID)
            const emp = (masterCache.employees||[]).find(e => e.nik_karyawan == row.employee_id || e.id == row.employee_id || e.nik_karyawan == row.nik_karyawan);
            const assign = (masterCache.assignments||[]).find(a => (a.employee_id == emp?.id || a.employee_id == emp?.nik_karyawan) && a.is_active !== false);
            const dept = (masterCache.departments||[]).find(d => d.id == assign?.departemen_id);
            const jab = (masterCache.jabatans||[]).find(j => j.id == assign?.jabatan_id);
            const zn = (masterCache.zonas||[]).find(z => z.id == row.zona_id || z.id == row.zona_id);
            
            bodyHtml += `<td><strong>${emp?.nik_karyawan || row.employee_id || '-'}</strong></td>
                        <td>${emp?.nama || '-'}</td>
                        <td>${dept?.department_name || '-'}</td>
                        <td>${jab?.jabatan_name || '-'}</td>
                        <td><strong>${zn?.zona_name || '-'}</strong></td>`;
        }

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
    const codeInput = document.getElementById("f_code") || document.getElementById("f_emp");
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
        const codeInput = document.getElementById("f_code") || document.getElementById("f_emp");
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
                <div class="mb-3"><label class="small fw-bold">Nama Cabang <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.branch_name||''}" required></div>`;
    } else if (currentEntity === "departments") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.department_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Departemen <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.department_name||''}" required></div>`;
    } else if (currentEntity === "cost_centers") {
        const branchOpts = (masterCache.branches||[]).filter(b => b.is_active !== false).map(b => `<option value="${b.id}" ${row.branch_id == b.id ? 'selected' : ''}>${b.branch_name}</option>`).join('');
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.costcenter_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Cost Center <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.costcenter_name||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Cabang <span class="text-danger">*</span></label><select id="f_branch" class="form-select" required><option value="">-- Pilih Cabang --</option>${branchOpts}</select></div>`;
    } else if (currentEntity === "jabatans") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.jabatan_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Jabatan <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.jabatan_name||''}" required></div>`;
    } else if (currentEntity === "bagians") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.bagian_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Bagian <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.bagian_name||''}" required></div>`;
    } else if (currentEntity === "areas") {
        const ccOpts = (masterCache.cost_centers||[]).filter(c => c.is_active !== false).map(c => `<option value="${c.id}" ${row.cost_center_id == c.id ? 'selected' : ''}>${c.costcenter_name}</option>`).join('');
        const znOpts = (masterCache.zonas||[]).filter(z => z.is_active !== false).map(z => `<option value="${z.id}" ${row.zona_id == z.id ? 'selected' : ''}>${z.zona_name}</option>`).join('');
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.area_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Area <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.area_name||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Cost Center <span class="text-danger">*</span></label><select id="f_cc" class="form-select" required><option value="">-- Pilih --</option>${ccOpts}</select></div>
                <div class="mb-3"><label class="small fw-bold">Zona <span class="text-danger">*</span></label><select id="f_zn" class="form-select" required><option value="">-- Pilih --</option>${znOpts}</select></div>`;
    } else if (currentEntity === "zonas") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.zona_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Zona <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.zona_name||''}" required></div>`;
    } else if (currentEntity === "supervisor_zones") {
        // 1. Cari ID Jabatan yang mengandung kata "Supervisor" atau "SPV" (Case-Insensitive)
        const supervisorJabatans = (masterCache.jabatans || []).filter(j => 
            j.jabatan_name && (
                j.jabatan_name.toLowerCase().includes("supervisor") || 
                j.jabatan_name.toLowerCase().includes("spv")
            )
        ).map(j => j.id);

        // 2. Filter penempatan (assignments) aktif yang berjabatan Supervisor
        const activeSpvAssignments = (masterCache.assignments || []).filter(a => 
            a.is_active !== false && supervisorJabatans.some(jid => jid == a.jabatan_id)
        );

        // 3. Dapatkan daftar ID & NIK karyawan yang berjabatan Supervisor aktif
        const spvEmpIds = activeSpvAssignments.map(a => a.employee_id);

        // 4. Filter karyawan aktif berjabatan Supervisor + sertakan karyawan yang sedang diedit
        const filteredEmployees = (masterCache.employees || []).filter(e => {
            const isSpv = spvEmpIds.some(id => id == e.id || id == e.nik_karyawan);
            const isCurrentEdit = row.employee_id == e.nik_karyawan || row.employee_id == e.id || row.nik_karyawan == e.nik_karyawan;
            return (e.is_active !== false && isSpv) || isCurrentEdit;
        });

        // 5. Opsi dropdown Karyawan (Menghubungkan NIK Karyawan)
        const empOpts = filteredEmployees.length > 0 
            ? filteredEmployees.map(e => {
                const selected = (row.employee_id == e.nik_karyawan || row.employee_id == e.id || row.nik_karyawan == e.nik_karyawan) ? 'selected' : '';
                // NIK Karyawan digunakan sebagai value utama sesuai instruksi
                const optVal = e.nik_karyawan || e.id;
                return `<option value="${optVal}" ${selected}>${e.nama} (${e.nik_karyawan || 'No NIK'})</option>`;
            }).join('')
            : `<option value="" disabled>-- Tidak ada karyawan berjabatan Supervisor aktif --</option>`;

        const selectedZoneId = row.zona_id || row.zona_id;
        const znOpts = (masterCache.zonas || [])
            .filter(z => z.is_active !== false)
            .map(z => `<option value="${z.id}" ${selectedZoneId == z.id ? 'selected' : ''}>${z.zona_name}</option>`)
            .join('');

        html = `
            <div class="mb-3">
                <label class="small fw-bold">Karyawan (Supervisor via NIK) <span class="text-danger">*</span></label>
                <select id="f_emp" class="form-select" required>
                    <option value="">-- Pilih Supervisor --</option>
                    ${empOpts}
                </select>
                <div class="form-text text-muted" style="font-size: 0.75rem;">
                    * Terhubung berbasis NIK Karyawan. Hanya menampilkan karyawan berjabatan Supervisor/SPV aktif.
                </div>
            </div>
            <div class="mb-3">
                <label class="small fw-bold">Zona Tanggung Jawab <span class="text-danger">*</span></label>
                <select id="f_zn" class="form-select" required>
                    <option value="">-- Pilih Zona --</option>
                    ${znOpts}
                </select>
            </div>`;
    }
    document.getElementById("modalMasterFields").innerHTML = html;
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
            const codeEl = document.getElementById("f_code") || document.getElementById("f_emp");
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
                const ccVal = document.getElementById("f_cc")?.value;
                const znVal = document.getElementById("f_zn")?.value;
                payload = { 
                    area_code: codeVal, 
                    area_name: nameVal, 
                    cost_center_id: ccVal ? parseInt(ccVal) : null, 
                    zona_id: znVal ? parseInt(znVal) : null 
                };
            } else if (currentEntity === "zonas") {
                payload = { zona_code: codeVal, zona_name: nameVal };
            } else if (currentEntity === "supervisor_zones") {
                const empVal = document.getElementById("f_emp")?.value;
                const znVal = document.getElementById("f_zn")?.value;
                payload = { 
                    employee_id: empVal ? empVal : null, // Disimpan sebagai NIK (String) tanpa parseInt
                    zona_id: znVal ? parseInt(znVal) : null 
                };
            }

            let resultError = null;

            if (id) {
                // Update
                const { error } = await supabaseClient.from(currentEntity).update(payload).eq("id", parseInt(id));
                resultError = error;
            } else {
                // Insert Baru
                payload.is_active = true;
                const { error } = await supabaseClient.from(currentEntity).insert([payload]);
                resultError = error;
            }

            if (resultError) throw resultError;

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
=======
let currentEntity = "branches";
let masterCache = {};
let rawData = [];

document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();
    await loadCurrentMasterEntity();
    setupFormSubmit();
});

function switchMasterTab(entityName) {
    document.querySelectorAll('.nav-pills .nav-link').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`button[onclick="switchMasterTab('${entityName}')"]`);
    if (targetBtn) targetBtn.classList.add('active');
    
    currentEntity = entityName;
    
    // Kembalikan filter ke "active" setiap pindah tab
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
    if (currentEntity === "areas") {
        masterCache.cost_centers = await fetchTableData("cost_centers");
        masterCache.zonas = await fetchTableData("zonas");
    } else if (currentEntity === "cost_centers") {
        masterCache.branches = await fetchTableData("branches");
    } else if (currentEntity === "supervisor_zones") {
        masterCache.employees = await fetchTableData("employees", "hrd");
        masterCache.assignments = await fetchTableData("employee_assignments", "hrd");
        masterCache.departments = await fetchTableData("departments");
        masterCache.jabatans = await fetchTableData("jabatans");
        masterCache.zonas = await fetchTableData("zonas");
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
        supervisor_zones: "Daftar Zona Supervisor" 
    };
    
    const titleEl = document.getElementById("masterTableTitle");
    if (titleEl) titleEl.innerHTML = titles[currentEntity] || "Master Data";

    let headerHtml = `<th style="width: 50px;" class="text-center">No</th>`;
    if (currentEntity === "branches") headerHtml += `<th>Nama Cabang</th>`;
    else if (currentEntity === "departments") headerHtml += `<th>Nama Departemen</th>`;
    else if (currentEntity === "cost_centers") headerHtml += `<th>Nama Cost Center</th><th>Cabang</th>`;
    else if (currentEntity === "jabatans") headerHtml += `<th>Nama Jabatan</th>`;
    else if (currentEntity === "bagians") headerHtml += `<th>Nama Bagian</th>`;
    else if (currentEntity === "areas") headerHtml += `<th>Nama Area</th><th>Cost Center</th><th>Zona</th>`;
    else if (currentEntity === "zonas") headerHtml += `<th>Nama Zona</th>`;
    else if (currentEntity === "supervisor_zones") headerHtml += `<th>NIK Supervisor</th><th>Nama Karyawan</th><th>Departemen</th><th>Jabatan</th><th>Zona Tanggung Jawab</th>`;
    
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
        if (currentEntity === "branches") bodyHtml += `<td>${row.branch_name||'-'}</td>`;
        else if (currentEntity === "departments") bodyHtml += `<td>${row.department_name||'-'}</td>`;
        else if (currentEntity === "cost_centers") {
            const br = (masterCache.branches||[]).find(b => b.id == row.branch_id);
            bodyHtml += `<td>${row.costcenter_name||'-'}</td><td>${br?.branch_name||'-'}</td>`;
        }
        else if (currentEntity === "jabatans") bodyHtml += `<td>${row.jabatan_name||'-'}</td>`;
        else if (currentEntity === "bagians") bodyHtml += `<td>${row.bagian_name||'-'}</td>`;
        else if (currentEntity === "areas") {
            const cc = (masterCache.cost_centers||[]).find(c => c.id == row.cost_center_id);
            const zn = (masterCache.zonas||[]).find(z => z.id == row.zona_id);
            bodyHtml += `<td>${row.area_name||'-'}</td><td>${cc?.costcenter_name||'-'}</td><td>${zn?.zona_name||'-'}</td>`;
        }
        else if (currentEntity === "zonas") bodyHtml += `<td>${row.zona_name||'-'}</td>`;
        else if (currentEntity === "supervisor_zones") {
            // Pencarian karyawan fleksibel (mencocokkan NIK Karyawan atau ID)
            const emp = (masterCache.employees||[]).find(e => e.nik_karyawan == row.employee_id || e.id == row.employee_id || e.nik_karyawan == row.nik_karyawan);
            const assign = (masterCache.assignments||[]).find(a => (a.employee_id == emp?.id || a.employee_id == emp?.nik_karyawan) && a.is_active !== false);
            const dept = (masterCache.departments||[]).find(d => d.id == assign?.departemen_id);
            const jab = (masterCache.jabatans||[]).find(j => j.id == assign?.jabatan_id);
            const zn = (masterCache.zonas||[]).find(z => z.id == row.zona_id || z.id == row.zona_id);
            
            bodyHtml += `<td><strong>${emp?.nik_karyawan || row.employee_id || '-'}</strong></td>
                        <td>${emp?.nama || '-'}</td>
                        <td>${dept?.department_name || '-'}</td>
                        <td>${jab?.jabatan_name || '-'}</td>
                        <td><strong>${zn?.zona_name || '-'}</strong></td>`;
        }

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
    const codeInput = document.getElementById("f_code") || document.getElementById("f_emp");
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
        const codeInput = document.getElementById("f_code") || document.getElementById("f_emp");
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
                <div class="mb-3"><label class="small fw-bold">Nama Cabang <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.branch_name||''}" required></div>`;
    } else if (currentEntity === "departments") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.department_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Departemen <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.department_name||''}" required></div>`;
    } else if (currentEntity === "cost_centers") {
        const branchOpts = (masterCache.branches||[]).filter(b => b.is_active !== false).map(b => `<option value="${b.id}" ${row.branch_id == b.id ? 'selected' : ''}>${b.branch_name}</option>`).join('');
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.costcenter_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Cost Center <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.costcenter_name||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Cabang <span class="text-danger">*</span></label><select id="f_branch" class="form-select" required><option value="">-- Pilih Cabang --</option>${branchOpts}</select></div>`;
    } else if (currentEntity === "jabatans") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.jabatan_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Jabatan <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.jabatan_name||''}" required></div>`;
    } else if (currentEntity === "bagians") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.bagian_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Bagian <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.bagian_name||''}" required></div>`;
    } else if (currentEntity === "areas") {
        const ccOpts = (masterCache.cost_centers||[]).filter(c => c.is_active !== false).map(c => `<option value="${c.id}" ${row.cost_center_id == c.id ? 'selected' : ''}>${c.costcenter_name}</option>`).join('');
        const znOpts = (masterCache.zonas||[]).filter(z => z.is_active !== false).map(z => `<option value="${z.id}" ${row.zona_id == z.id ? 'selected' : ''}>${z.zona_name}</option>`).join('');
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.area_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Area <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.area_name||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Cost Center <span class="text-danger">*</span></label><select id="f_cc" class="form-select" required><option value="">-- Pilih --</option>${ccOpts}</select></div>
                <div class="mb-3"><label class="small fw-bold">Zona <span class="text-danger">*</span></label><select id="f_zn" class="form-select" required><option value="">-- Pilih --</option>${znOpts}</select></div>`;
    } else if (currentEntity === "zonas") {
        html = `<div class="mb-3"><label class="small fw-bold">Kode <span class="text-danger">*</span></label><input type="text" id="f_code" class="form-control" value="${row.zona_code||''}" required></div>
                <div class="mb-3"><label class="small fw-bold">Nama Zona <span class="text-danger">*</span></label><input type="text" id="f_name" class="form-control" value="${row.zona_name||''}" required></div>`;
    } else if (currentEntity === "supervisor_zones") {
        // 1. Cari ID Jabatan yang mengandung kata "Supervisor" atau "SPV" (Case-Insensitive)
        const supervisorJabatans = (masterCache.jabatans || []).filter(j => 
            j.jabatan_name && (
                j.jabatan_name.toLowerCase().includes("supervisor") || 
                j.jabatan_name.toLowerCase().includes("spv")
            )
        ).map(j => j.id);

        // 2. Filter penempatan (assignments) aktif yang berjabatan Supervisor
        const activeSpvAssignments = (masterCache.assignments || []).filter(a => 
            a.is_active !== false && supervisorJabatans.some(jid => jid == a.jabatan_id)
        );

        // 3. Dapatkan daftar ID & NIK karyawan yang berjabatan Supervisor aktif
        const spvEmpIds = activeSpvAssignments.map(a => a.employee_id);

        // 4. Filter karyawan aktif berjabatan Supervisor + sertakan karyawan yang sedang diedit
        const filteredEmployees = (masterCache.employees || []).filter(e => {
            const isSpv = spvEmpIds.some(id => id == e.id || id == e.nik_karyawan);
            const isCurrentEdit = row.employee_id == e.nik_karyawan || row.employee_id == e.id || row.nik_karyawan == e.nik_karyawan;
            return (e.is_active !== false && isSpv) || isCurrentEdit;
        });

        // 5. Opsi dropdown Karyawan (Menghubungkan NIK Karyawan)
        const empOpts = filteredEmployees.length > 0 
            ? filteredEmployees.map(e => {
                const selected = (row.employee_id == e.nik_karyawan || row.employee_id == e.id || row.nik_karyawan == e.nik_karyawan) ? 'selected' : '';
                // NIK Karyawan digunakan sebagai value utama sesuai instruksi
                const optVal = e.nik_karyawan || e.id;
                return `<option value="${optVal}" ${selected}>${e.nama} (${e.nik_karyawan || 'No NIK'})</option>`;
            }).join('')
            : `<option value="" disabled>-- Tidak ada karyawan berjabatan Supervisor aktif --</option>`;

        const selectedZoneId = row.zona_id || row.zona_id;
        const znOpts = (masterCache.zonas || [])
            .filter(z => z.is_active !== false)
            .map(z => `<option value="${z.id}" ${selectedZoneId == z.id ? 'selected' : ''}>${z.zona_name}</option>`)
            .join('');

        html = `
            <div class="mb-3">
                <label class="small fw-bold">Karyawan (Supervisor via NIK) <span class="text-danger">*</span></label>
                <select id="f_emp" class="form-select" required>
                    <option value="">-- Pilih Supervisor --</option>
                    ${empOpts}
                </select>
                <div class="form-text text-muted" style="font-size: 0.75rem;">
                    * Terhubung berbasis NIK Karyawan. Hanya menampilkan karyawan berjabatan Supervisor/SPV aktif.
                </div>
            </div>
            <div class="mb-3">
                <label class="small fw-bold">Zona Tanggung Jawab <span class="text-danger">*</span></label>
                <select id="f_zn" class="form-select" required>
                    <option value="">-- Pilih Zona --</option>
                    ${znOpts}
                </select>
            </div>`;
    }
    document.getElementById("modalMasterFields").innerHTML = html;
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
            const codeEl = document.getElementById("f_code") || document.getElementById("f_emp");
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
                const ccVal = document.getElementById("f_cc")?.value;
                const znVal = document.getElementById("f_zn")?.value;
                payload = { 
                    area_code: codeVal, 
                    area_name: nameVal, 
                    cost_center_id: ccVal ? parseInt(ccVal) : null, 
                    zona_id: znVal ? parseInt(znVal) : null 
                };
            } else if (currentEntity === "zonas") {
                payload = { zona_code: codeVal, zona_name: nameVal };
            } else if (currentEntity === "supervisor_zones") {
                const empVal = document.getElementById("f_emp")?.value;
                const znVal = document.getElementById("f_zn")?.value;
                payload = { 
                    employee_id: empVal ? empVal : null, // Disimpan sebagai NIK (String) tanpa parseInt
                    zona_id: znVal ? parseInt(znVal) : null 
                };
            }

            let resultError = null;

            if (id) {
                // Update
                const { error } = await supabaseClient.from(currentEntity).update(payload).eq("id", parseInt(id));
                resultError = error;
            } else {
                // Insert Baru
                payload.is_active = true;
                const { error } = await supabaseClient.from(currentEntity).insert([payload]);
                resultError = error;
            }

            if (resultError) throw resultError;

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
>>>>>>> 3d00068 (Initial commit Web ERP)
}