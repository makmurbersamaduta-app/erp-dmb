// =====================================================================
// STRUKTUR COST CENTER: Area -> Departemen -> Jabatan
// Dipakai modal Cost Center di master_data.html.
// Data tersimpan di public.cost_center_structures (1 baris = 1 jabatan).
// Simpan file ini di: js/module/settings/cost_center_structure.js
// =====================================================================

// [1] STATE: data sementara selama modal terbuka (belum tersimpan ke database)
// ccStruct = [ { areaId, depts: [ { deptId, jabIds: [] } ] } ]
let ccStruct = [];
let ccMulti = false;   // mode radio "lebih dari 1 area?". Hanya tampilan, TIDAK disimpan.

// [2] HELPER: nama dari master, opsi dropdown, label tombol jabatan
const ccName = (list, key, id) => (list || []).find(x => x.id == id)?.[key] || "-";

// Item non-aktif hanya tampil jika sudah terpilih. Item yang sudah dipakai blok lain dikunci (disabled).
function ccOptions(list, key, selectedId, usedIds) {
    const opts = (list || [])
        .filter(x => x.is_active !== false || x.id == selectedId)
        .map(x => {
            const used = x.id != selectedId && usedIds.includes(x.id);
            return `<option value="${x.id}" ${x.id == selectedId ? "selected" : ""} ${used ? "disabled" : ""}>${x[key]}${x.is_active === false ? " (Non-Aktif)" : ""}</option>`;
        }).join("");
    return `<option value="">-- Pilih --</option>${opts}`;
}
const ccJabLabel = ids => ids.length ? `${ids.length} jabatan dipilih` : "Pilih jabatan";

// [3] KONVERSI DATA: baris database (datar) <-> bentuk bertingkat untuk form
function rowsToStruct(rows) {
    const areas = new Map();
    (rows || []).forEach(r => {
        if (!areas.has(r.area_id)) areas.set(r.area_id, new Map());
        const depts = areas.get(r.area_id);
        if (!depts.has(r.dept_id)) depts.set(r.dept_id, []);
        depts.get(r.dept_id).push(r.jabatan_id);
    });
    return [...areas].map(([areaId, depts]) => ({
        areaId, depts: [...depts].map(([deptId, jabIds]) => ({ deptId, jabIds }))
    }));
}

// Validasi aturan sekaligus membuat baris untuk disimpan. Melempar Error jika ada yang belum lengkap.
function structToRows() {
    const M = masterCache, rows = [], seenArea = new Set();
    if (!ccStruct.length) throw new Error("Pilih minimal 1 area.");
    ccStruct.forEach((a, i) => {
        if (!a.areaId) throw new Error(`Area #${i + 1} belum dipilih.`);
        if (seenArea.has(a.areaId)) throw new Error("Ada area yang dipilih dua kali.");
        seenArea.add(a.areaId);
        const areaNama = ccName(M.areas, "area_name", a.areaId);
        if (!a.depts.length) throw new Error(`Area ${areaNama} butuh minimal 1 departemen.`);
        const seenDept = new Set();
        a.depts.forEach(d => {
            if (!d.deptId) throw new Error(`Ada departemen yang belum dipilih di area ${areaNama}.`);
            if (seenDept.has(d.deptId)) throw new Error(`Departemen dobel di area ${areaNama}.`);
            seenDept.add(d.deptId);
            if (!d.jabIds.length) throw new Error(`Pilih minimal 1 jabatan untuk ${ccName(M.departments, "department_name", d.deptId)} di area ${areaNama}.`);
            d.jabIds.forEach(j => rows.push({ area_id: a.areaId, dept_id: d.deptId, jabatan_id: j }));
        });
    });
    return rows;
}

// [4] TAMPILAN: menggambar ulang editor (radio, kartu Area, blok Departemen, dropdown centang Jabatan)
function renderCcStructure() {
    const wrap = document.getElementById("ccStructWrap");
    const M = masterCache;
    const usedAreas = ccStruct.map(a => a.areaId);

    const areaHtml = ccStruct.map((a, ai) => {
        const usedDepts = a.depts.map(d => d.deptId);
        const deptHtml = a.depts.map((d, di) => {
            const jabs = (M.jabatans || [])
                .filter(j => j.is_active !== false || d.jabIds.includes(j.id))
                .map(j => `<label class="dropdown-item small d-flex gap-2 align-items-center">
                    <input type="checkbox" class="form-check-input mt-0" data-act="jab" data-a="${ai}" data-d="${di}" value="${j.id}" ${d.jabIds.includes(j.id) ? "checked" : ""}>
                    <span>${j.jabatan_name}</span></label>`).join("");
            return `<div class="cc-dept">
                <div class="d-flex gap-2 mb-2">
                    <select class="form-select form-select-sm" data-act="dept" data-a="${ai}" data-d="${di}">${ccOptions(M.departments, "department_name", d.deptId, usedDepts)}</select>
                    ${a.depts.length > 1 ? `<button type="button" class="btn btn-sm btn-light border text-danger" data-act="delDept" data-a="${ai}" data-d="${di}" title="Hapus departemen"><i class="fa-solid fa-trash"></i></button>` : ""}
                </div>
                <div class="dropdown">
                    <button type="button" class="btn btn-sm btn-outline-secondary w-100 text-start dropdown-toggle" data-bs-toggle="dropdown" data-bs-auto-close="outside">${ccJabLabel(d.jabIds)}</button>
                    <div class="dropdown-menu w-100 cc-jab-menu">${jabs}</div>
                </div>
            </div>`;
        }).join("");

        return `<div class="cc-area">
            <div class="d-flex gap-2 mb-1">
                <select class="form-select form-select-sm fw-semibold" data-act="area" data-a="${ai}">${ccOptions(M.areas, "area_name", a.areaId, usedAreas)}</select>
                ${ccMulti && ccStruct.length > 1 ? `<button type="button" class="btn btn-sm btn-light border text-danger" data-act="delArea" data-a="${ai}" title="Hapus area"><i class="fa-solid fa-trash"></i></button>` : ""}
            </div>
            ${deptHtml}
            <button type="button" class="btn btn-sm btn-link px-0 mt-2" data-act="addDept" data-a="${ai}"><i class="fa-solid fa-plus me-1"></i>Tambah departemen</button>
        </div>`;
    }).join("");

    wrap.innerHTML = `
        <label class="small fw-bold d-block mb-1">Cost center ini memiliki lebih dari 1 area?</label>
        <div class="btn-group btn-group-sm w-100 mb-3">
            <input type="radio" class="btn-check" name="ccMulti" id="ccMultiNo" value="0" data-act="mode" ${!ccMulti ? "checked" : ""}>
            <label class="btn btn-outline-primary" for="ccMultiNo">Tidak</label>
            <input type="radio" class="btn-check" name="ccMulti" id="ccMultiYes" value="1" data-act="mode" ${ccMulti ? "checked" : ""}>
            <label class="btn btn-outline-primary" for="ccMultiYes">Ya</label>
        </div>
        ${areaHtml}
        ${ccMulti ? `<button type="button" class="btn btn-sm btn-outline-primary" data-act="addArea"><i class="fa-solid fa-plus me-1"></i>Tambah area</button>` : ""}`;
}

// [5] EVENT: perubahan isian (dropdown, centang jabatan, radio) dan klik tombol tambah/hapus
function ccOnChange(e) {
    const t = e.target, act = t.dataset.act;
    if (!act) return;
    const a = ccStruct[+t.dataset.a];
    const d = a && a.depts[+t.dataset.d];
    if (act === "area") { a.areaId = +t.value || null; renderCcStructure(); }
    else if (act === "dept") { d.deptId = +t.value || null; renderCcStructure(); }
    else if (act === "jab") {
        // Tidak menggambar ulang supaya dropdown tidak menutup saat mencentang; cukup ubah label tombol.
        const id = +t.value;
        d.jabIds = t.checked ? [...new Set([...d.jabIds, id])] : d.jabIds.filter(x => x !== id);
        t.closest(".dropdown").querySelector(".dropdown-toggle").textContent = ccJabLabel(d.jabIds);
    } else if (act === "mode") {
        const toMulti = t.value === "1";
        if (!toMulti && ccStruct.length > 1 && !confirm("Hanya area pertama yang dipertahankan. Lanjutkan?")) { renderCcStructure(); return; }
        if (!toMulti) ccStruct = ccStruct.slice(0, 1);
        ccMulti = toMulti;
        renderCcStructure();
    }
}

function ccOnClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act, ai = +b.dataset.a, di = +b.dataset.d;
    if (act === "addArea") ccStruct.push({ areaId: null, depts: [{ deptId: null, jabIds: [] }] });
    else if (act === "delArea") ccStruct.splice(ai, 1);
    else if (act === "addDept") ccStruct[ai].depts.push({ deptId: null, jabIds: [] });
    else if (act === "delDept") ccStruct[ai].depts.splice(di, 1);
    else return;
    renderCcStructure();
}

// [6] PINTU MASUK: dipanggil master_data.js setiap modal Cost Center dibuka
// rows = baris cost_center_structures milik cost center ini (kosong jika cost center baru)
function initCcStructure(rows) {
    const wrap = document.getElementById("ccStructWrap");
    if (!wrap) return;
    // Hak edit dicek ke database (is_master_data_editor), sama dengan aturan RLS.
    if (!masterCache.isEditor) {
        wrap.innerHTML = `<div class="alert alert-secondary small mb-0">Anda tidak memiliki akses untuk mengubah struktur Area, Departemen dan Jabatan.</div>`;
        return;
    }
    ccStruct = rowsToStruct(rows);
    if (!ccStruct.length) ccStruct = [{ areaId: null, depts: [{ deptId: null, jabIds: [] }] }];
    ccMulti = ccStruct.length > 1;
    wrap.addEventListener("change", ccOnChange);
    wrap.addEventListener("click", ccOnClick);
    renderCcStructure();
}

// [7] SIMPAN: satu panggilan ke fungsi database (hapus yang dicopot + tambah yang baru, atomik)
async function saveCcStructure(costCenterId, rows) {
    const { error } = await supabaseClient.rpc("save_cost_center_structure", { p_cost_center_id: costCenterId, p_rows: rows });
    if (error) throw error;
}