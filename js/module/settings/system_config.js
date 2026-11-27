// ===================================================
// js/module/settings/system_config.js
// Halaman Konfigurasi Sistem (Roles, Menu, Permission Matrix)
// Daftar Zona & Zona Coverage sudah dipindah ke master_data.js
// ===================================================

// ---------------------------------------------------
// 1. STATE GLOBAL
// ---------------------------------------------------
let systemRoles = [];
let systemMenus = [];
let menuCategories = [];        // dari tabel public.menu_categories: [{category_name, category_code}]
let menuCategoriesError = "";   // pesan error kalau gagal load menu_categories (kosong = sukses)
let currentPermissions = {};    // state lokal checkbox SEBELUM disimpan ke DB
let originalPermissions = {};   // snapshot terakhir yg TERSIMPAN di DB -- dipakai utk deteksi "ada perubahan atau tidak"
let editingMenuId = null;       // null = mode Tambah Menu, angka = mode Edit Menu
let jabatanList = [];           // dari tabel public.jabatans -- dipakai blok Jabatan di modal Akses Menu
let menuAccessRulesAll = [];    // seluruh baris menu_access_rules -- badge ringkas kolom Akses

// Flag pengunci (cegah double submit / race condition)
let isRoleSubmitting = false;
let isMenuSubmitting = false;

document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();

    // Pasang event listener form secara aman (hanya 1x, hapus inline onsubmit dulu)
    const formRole = document.getElementById("formRole");
    if (formRole) {
        formRole.onsubmit = null;
        formRole.addEventListener("submit", handleSaveRole);
    }

    const formMenu = document.getElementById("formMenu");
    if (formMenu) {
        formMenu.onsubmit = null;
        formMenu.addEventListener("submit", handleSaveMenu);
    }

    await loadSystemRoles();
    await loadMenuCategories();   // kamus kategori -- WAJIB sebelum render dropdown & tabel menu
    await loadJabatanList();          // WAJIB sebelum modal Akses Menu dibuka
    await loadMenuAccessRulesAll();   // WAJIB sebelum renderMenusTable (badge kolom Akses)
    await loadAccessMasters();        // departemen & area untuk modal Akses Menu
    await loadSystemMenus();
    await loadPermissionsMatrix();
});

// ===================================================
// 2. ROLES (tidak berubah dari versi sebelumnya)
// ===================================================
async function loadSystemRoles() {
    const { data, error } = await supabaseClient.from("roles").select("*").order("id", { ascending: true });

    if (error) {
        document.getElementById("rolesTableBody").innerHTML = `<tr><td colspan="4" class="text-center text-danger">Error: ${error.message}</td></tr>`;
        return;
    }

    systemRoles = data || [];

    let html = "", selectHtml = "";
    systemRoles.forEach(r => {
        html += `
            <tr class="text-center">
                <td>${r.id}</td>
                <td class="text-start"><strong>${r.role_name}</strong></td>
                <td class="text-start small text-muted">${r.description || '-'}</td>
                <td><button class="btn btn-sm btn-light text-danger" onclick="deleteRole(${r.id})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
        selectHtml += `<option value="${r.id}">${r.role_name}</option>`;
    });

    document.getElementById("rolesTableBody").innerHTML = html || `<tr><td colspan="4" class="text-center text-muted">Belum ada role.</td></tr>`;

    const roleSelectEl = document.getElementById("permissionRoleSelect");
    if (roleSelectEl) {
        roleSelectEl.innerHTML = selectHtml;
    }
}

function openRoleModal() {
    const form = document.getElementById("formRole");
    if (form) form.reset();
    isRoleSubmitting = false;
    new bootstrap.Modal(document.getElementById("modalRole")).show();
}

async function handleSaveRole(e) {
    if (e) e.preventDefault();
    if (isRoleSubmitting) return;
    isRoleSubmitting = true;

    const roleNameEl = document.getElementById("f_role_name");
    const roleDescEl = document.getElementById("f_role_desc");
    const roleName = roleNameEl ? roleNameEl.value.trim() : "";
    const roleDesc = roleDescEl ? roleDescEl.value.trim() : "";

    if (!roleName) {
        alert("Nama Role wajib diisi!");
        isRoleSubmitting = false;
        return;
    }

    const btnSubmit = document.getElementById("btnSaveRole") || (e && e.target ? e.target.querySelector("button[type='submit']") : null);
    const origBtnText = btnSubmit ? btnSubmit.innerHTML : "Simpan";

    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
    }

    try {
        const payload = { role_name: roleName, description: roleDesc };
        const { error } = await supabaseClient.from("roles").insert([payload]);

        if (error) {
            if (error.status === 409 || error.code === '23505' || (error.message && error.message.includes("duplicate"))) {
                throw new Error(`Role dengan nama '${roleName}' sudah ada di database.`);
            }
            throw error;
        }

        const modalEl = document.getElementById("modalRole");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        await loadSystemRoles();
        await loadPermissionsMatrix();
        alert("Role berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan Role: " + (err.message || err));
    } finally {
        isRoleSubmitting = false;
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = origBtnText;
        }
    }
}

async function deleteRole(id) {
    if (!confirm("Yakin hapus role ini? (Pastikan tidak ada user yang terikat)")) return;
    try {
        const { error } = await supabaseClient.from("roles").delete().eq("id", parseInt(id));
        if (error) throw error;
        await loadSystemRoles();
        await loadPermissionsMatrix();
    } catch (e) {
        alert("Gagal menghapus role: " + (e.message || e));
    }
}

// ===================================================
// 3. KAMUS KATEGORI (menu_categories)
// Sumber dropdown "Kategori" di modal Tambah Menu, plus opsi
// "+ Kategori Baru..." (Opsi A yang Anda pilih) yang otomatis
// menambah baris baru ke tabel ini saat dipakai pertama kali.
// ===================================================
async function loadMenuCategories() {
    const { data, error } = await supabaseClient
        .from("menu_categories")
        .select("*")
        .order("category_name", { ascending: true });

    if (error) {
        console.error("Gagal memuat kamus kategori:", error.message);
        menuCategories = [];
        menuCategoriesError = error.message;   // ditampilkan di dropdown supaya tidak gagal diam-diam
        renderCategoryDropdown();
        return;
    }
    menuCategoriesError = "";
    menuCategories = data || [];
    renderCategoryDropdown();
}

function renderCategoryDropdown() {
    const sel = document.getElementById("f_menu_category_select");
    if (!sel) return;

    let html = menuCategories.map(c =>
        `<option value="${c.category_name}" data-code="${c.category_code}">${c.category_name} (${c.category_code})</option>`
    ).join("");

    // Kalau load gagal, tampilkan alasannya (opsi non-aktif, tidak bisa dipilih)
    if (menuCategoriesError) {
        html = `<option value="" disabled>(Gagal memuat kategori: ${menuCategoriesError})</option>` + html;
    }

    html += `<option value="__new__">+ Kategori Baru...</option>`;
    sel.innerHTML = html;
}

// Muncul/hilang field "Nama Kategori Baru" + "Kode Kategori Baru"
// tergantung pilihan dropdown -- ini yang mewujudkan Opsi A.
function handleCategoryChange() {
    const sel = document.getElementById("f_menu_category_select");
    const isNew = sel && sel.value === "__new__";

    document.getElementById("newCategoryNameWrapper").classList.toggle("d-none", !isNew);
    document.getElementById("newCategoryCodeWrapper").classList.toggle("d-none", !isNew);

    updateMenuCodePreview();
}

// ===================================================
// 3B. JABATAN (public.jabatans) -- untuk blok ketiga di modal Akses Menu
// ===================================================
async function loadJabatanList() {
    const { data, error } = await supabaseClient
        .from("jabatans")
        .select("*")
        .eq("is_active", true)
        .order("jabatan_name", { ascending: true });

    if (error) {
        console.error("Gagal memuat daftar jabatan:", error.message);
        jabatanList = [];
        return;
    }
    jabatanList = data || [];
}

// ===================================================
// 3C. MENU ACCESS RULES -- load semua baris sekaligus, dipakai untuk
// badge ringkas di kolom "Akses" tabel menu, dan sebagai sumber data
// saat modal Akses dibuka (tidak query ulang per menu).
// ===================================================
async function loadMenuAccessRulesAll() {
    const { data, error } = await supabaseClient
        .from("menu_access_rules")
        .select("*");

    if (error) {
        console.error("Gagal memuat menu_access_rules:", error.message);
        menuAccessRulesAll = [];
        return;
    }
    menuAccessRulesAll = data || [];
}

// Badge ringkas: tampilkan dimensi apa saja yang dibatasi untuk satu menu_code.
// Tidak merinci value_id/mode di badge -- cukup jadi indikator "ada batasan",
// detail lengkap dilihat dengan klik tombol "Atur".
function renderAccessBadge(menuCode) {
    const rules = menuAccessRulesAll.filter(r => r.menu_code === menuCode);
    if (rules.length === 0) {
        return `<span class="badge bg-light text-muted border">Semua</span>`;
    }

    const labelMap = { departemen: "Dept", area: "Area", jabatan: "Jabatan" };
    const dims = [...new Set(rules.map(r => r.dimension))].map(d => labelMap[d] || d);

    return `<span class="badge bg-warning-subtle text-dark border">${dims.join(" + ")}</span>`;
}

// ===================================================
// 4. PEMBUATAN KODE MENU OTOMATIS
//
// Format: {PLATFORM}-{KODE_KATEGORI}-{URUT}
// PENOMORAN PER-PLATFORM (bukan per-kategori, sesuai keputusan Anda):
// urut dihitung dari nomor TERTINGGI yang pernah dipakai di platform
// itu (M atau PWA), LINTAS kategori, lalu +1.
//
// PENTING -- ini hanya berlaku untuk menu BARU. Menu yang SUDAH ADA
// (termasuk yang formatnya beda2/tidak standar seperti "M-HOME" tanpa
// nomor urut) TIDAK PERNAH diubah oleh fungsi ini, supaya tidak ada
// resiko merusak referensi menu_code di skrip lain (mis. PWA
// menu-restrictions.js) yang belum sempat kita verifikasi.
// ===================================================
function computeNextMenuCode(platform, categoryCode) {
    // Regex: cocok dengan pola "M-APAPUN-DIGIT" atau "PWA-APAPUN-DIGIT"
    // -- categoryCode di sini sengaja wildcard [A-Z]+, karena yang mau
    // dihitung adalah nomor urut TERTINGGI di platform itu, tanpa peduli
    // kategori menu yang sudah ada.
    const regex = new RegExp(`^${platform}-[A-Z]+-(\\d+)$`);
    let maxNum = 0;

    systemMenus.forEach(m => {
        const match = (m.menu_code || "").match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    });

    const nextNum = String(maxNum + 1).padStart(2, "0");
    return `${platform}-${categoryCode}-${nextNum}`;
}

// Dipanggil tiap kali Platform/Kategori/field kategori-baru berubah,
// supaya admin lihat preview kode SEBELUM klik Simpan.
function updateMenuCodePreview() {
    // Mode Edit: kode menu existing tidak boleh berubah, preview
    // sudah di-set langsung ke nilai lama saat openMenuModal(editId), skip.
    if (editingMenuId !== null) return;

    const platform = document.getElementById("f_menu_platform")?.value;
    const catSelect = document.getElementById("f_menu_category_select");
    const previewEl = document.getElementById("f_menu_code_preview");
    if (!platform || !catSelect || !previewEl) return;

    let categoryCode = "";

    if (catSelect.value === "__new__") {
        categoryCode = (document.getElementById("f_new_category_code")?.value || "").trim().toUpperCase();
    } else {
        const opt = catSelect.options[catSelect.selectedIndex];
        categoryCode = opt ? opt.getAttribute("data-code") : "";
    }

    if (!categoryCode) {
        previewEl.value = "(pilih/lengkapi kategori dulu)";
        return;
    }

    previewEl.value = computeNextMenuCode(platform, categoryCode);
}

// ===================================================
// 5. MENUS -- render tabel dikelompokkan per Platform > Kategori
//    (poin 1), tampilkan Path URL + Platform + tombol Edit (poin 3)
// ===================================================
async function loadSystemMenus() {
    const { data, error } = await supabaseClient
        .from("app_menus")
        .select("*")
        .order("platform", { ascending: true })   // ERP (M) dulu, baru PWA -- alfabetis kebetulan pas
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });

    if (error) {
        document.getElementById("menusTableBody").innerHTML = `<tr><td colspan="7" class="text-center text-danger">Gagal memuat menu: ${error.message}</td></tr>`;
        return;
    }
    systemMenus = data || [];
    renderMenusTable();
}

// ---------------------------------------------------
// 5A. PENGATURAN URUTAN & PENGELOMPOKAN TABEL MENU APLIKASI
// ---------------------------------------------------

// Label platform. Nilai kolom "platform" di database huruf kecil
// ("erp" / "pwa"), jadi kunci map ini HARUS huruf kecil.
const PLATFORM_LABEL = { "erp": "ERP", "pwa": "PWA" };
const PLATFORM_ORDER = ["erp", "pwa"];   // ERP tampil dulu, baru PWA

// Urutan main menu ERP. Dicocokkan dengan kolom "category" di app_menus.
// Ejaan HARUS sama dengan isi database (mis. "Payroll", bukan "Payrol").
const ERP_GROUP_ORDER = ["Home", "Employees", "Time", "Payroll", "Assets", "Finance", "Operasional", "Files", "Settings"];

// Urutan main menu PWA. Dicocokkan dengan AWALAN menu_code
// (PWA-OPS-01 -> kunci "OPS"), BUKAN dengan kolom category.
// Grup "Account" ditambahkan karena ada 5 menu PWA-ACCOUNT-xx di database.
// Kalau grup ini mau dihapus/dipindah, ubah baris di bawah.
const PWA_GROUP_ORDER = [
    { key: "HOME",    label: "Home" },
    { key: "OPS",     label: "Operasional" },
    { key: "REPORT",  label: "Laporan" },
    { key: "ACCOUNT", label: "Account" }
];

// State: platform mana yang sedang dikecilkan (collapse). Default: semua terbuka.
let collapsedPlatforms = {};

// Menentukan sebuah menu masuk main menu (grup) yang mana + urutannya.
function getMenuGroup(m) {
    const platformKey = (m.platform || "").toLowerCase();

    if (platformKey === "pwa") {
        const match = (m.menu_code || "").match(/^PWA-([A-Z]+)-/i);
        const key = match ? match[1].toUpperCase() : "";
        const idx = PWA_GROUP_ORDER.findIndex(g => g.key === key);
        if (idx >= 0) return { order: idx, label: PWA_GROUP_ORDER[idx].label };
        return { order: PWA_GROUP_ORDER.length, label: "Lainnya" };
    }

    const cat = (m.category || "").trim().toLowerCase();
    const idx = ERP_GROUP_ORDER.findIndex(c => c.toLowerCase() === cat);
    if (idx >= 0) return { order: idx, label: ERP_GROUP_ORDER[idx] };
    return { order: ERP_GROUP_ORDER.length, label: m.category || "Lainnya" };
}

function platformRank(platformKey) {
    const idx = PLATFORM_ORDER.indexOf(platformKey);
    return idx >= 0 ? idx : 99;
}

// Urutan akhir: Platform -> Main menu -> (ERP: sort_order | PWA: nomor menu_code)
function sortMenusForDisplay(menus) {
    return [...menus].sort((a, b) => {
        const pa = (a.platform || "").toLowerCase();
        const pb = (b.platform || "").toLowerCase();
        if (pa !== pb) return platformRank(pa) - platformRank(pb);

        const ga = getMenuGroup(a);
        const gb = getMenuGroup(b);
        if (ga.order !== gb.order) return ga.order - gb.order;
        if (ga.label !== gb.label) return ga.label.localeCompare(gb.label);

        if (pa !== "pwa") {
            const sa = Number(a.sort_order) || 0;
            const sb = Number(b.sort_order) || 0;
            if (sa !== sb) return sa - sb;
        }
        return (a.menu_code || "").localeCompare(b.menu_code || "", undefined, { numeric: true });
    });
}

// Klik baris ERP / PWA -> kecilkan / besarkan
function togglePlatform(platformKey) {
    collapsedPlatforms[platformKey] = !collapsedPlatforms[platformKey];
    renderMenusTable();
}

function renderMenusTable() {
    const tbody = document.getElementById("menusTableBody");
    if (systemMenus.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Belum ada menu.</td></tr>`;
        return;
    }

    const sorted = sortMenusForDisplay(systemMenus);
    let html = "";
    let lastPlatform = null;
    let lastGroup = null;
    let lastCategory = null;

    sorted.forEach(m => {
        const platformKey = (m.platform || "").toLowerCase();
        const platformLabel = PLATFORM_LABEL[platformKey] || m.platform;
        const group = getMenuGroup(m);

        // Level 1: baris platform (ERP / PWA) -- bisa diklik untuk dikecilkan
        if (platformKey !== lastPlatform) {
            const isCollapsed = !!collapsedPlatforms[platformKey];
            const total = sorted.filter(x => (x.platform || "").toLowerCase() === platformKey).length;
            html += `
                <tr class="table-secondary" style="cursor:pointer;" onclick="togglePlatform('${platformKey}')">
                    <td colspan="7" class="fw-bold small text-uppercase">
                        <i class="fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'} me-2"></i>
                        <i class="fa-solid fa-layer-group me-2"></i>${platformLabel}
                        <span class="badge bg-secondary-subtle text-secondary ms-2">${total} menu</span>
                    </td>
                </tr>`;
            lastPlatform = platformKey;
            lastGroup = null;
            lastCategory = null;
        }

        // Kalau platform sedang dikecilkan, lewati baris di bawahnya
        if (collapsedPlatforms[platformKey]) return;

        // Level 2: baris main menu (Home, Employees, Time, ...)
        if (group.label !== lastGroup) {
            html += `
                <tr class="table-light">
                    <td colspan="7" class="fw-semibold small text-muted ps-4">
                        <i class="fa-solid fa-folder me-2"></i>${group.label}
                    </td>
                </tr>`;
            lastGroup = group.label;
            lastCategory = null;
        }

        // Level 3 (khusus PWA): sub-kategori, hanya kalau namanya beda dengan main menu
        if (platformKey === "pwa" && m.category !== lastCategory) {
            if ((m.category || "").toLowerCase() !== group.label.toLowerCase()) {
                html += `
                    <tr>
                        <td colspan="7" class="small text-muted ps-5 bg-white">
                            <i class="fa-solid fa-angle-right me-2"></i>${m.category}
                        </td>
                    </tr>`;
            }
            lastCategory = m.category;
        }

        html += `
            <tr class="text-center">
                <td><code>${m.menu_code}</code></td>
                <td class="text-start"><i class="${m.icon_class} me-2 text-primary"></i>${m.menu_name}</td>
                <td class="text-start small text-muted">${m.path_url}</td>
                <td><span class="badge bg-primary-subtle text-primary">${platformLabel}</span></td>
                <td>${m.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
                <td>
                    ${renderAccessBadge(m.menu_code)}<br>
                    <button class="btn btn-sm btn-outline-secondary py-0 px-2 mt-1" style="font-size:0.7rem;" onclick="openMenuAccessModal(${m.id})">Atur</button>
                </td>
                <td>
                    <button class="btn btn-sm btn-light text-primary me-1" onclick="openMenuModal(${m.id})" title="Edit menu"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-light text-danger" onclick="deleteMenu(${m.id})" title="Hapus menu"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });

    tbody.innerHTML = html;
}

// ===================================================
// 5B. MODAL AKSES MENU (menu_access_rules)
// Simpan dengan hapus-lalu-insert-ulang seluruh rule untuk
// menu_code itu, sesuai desain yang disepakati.
// ===================================================
function openMenuAccessModal(menuId) {
    const menu = systemMenus.find(m => m.id === menuId);
    if (!menu) { alert("Menu tidak ditemukan."); return; }

    document.getElementById("ma_menu_id").value = menu.id;
    document.getElementById("ma_menu_code").value = menu.menu_code;
    document.getElementById("modalMenuAccessTitle").textContent = `Atur Akses: ${menu.menu_name}`;

    const existingRules = menuAccessRulesAll.filter(r => r.menu_code === menu.menu_code);

    setupAccessBlock("dept", departmentList, "id", "department_name", existingRules.filter(r => r.dimension === "departemen"));
    setupAccessBlock("area", areaList, "id", "area_name", existingRules.filter(r => r.dimension === "area"));
    setupAccessBlock("jabatan", jabatanList, "id", "jabatan_name", existingRules.filter(r => r.dimension === "jabatan"));

    new bootstrap.Modal(document.getElementById("modalMenuAccess")).show();
}

// Isi satu blok (dept/area/jabatan): render checklist dari master data,
// centang yang sudah tersimpan, set toggle Hanya/Kecuali, buka blok
// otomatis kalau menu ini memang sudah punya rule untuk dimension itu.
function setupAccessBlock(prefix, masterList, idField, nameField, existingRules) {
    const listEl = document.getElementById(`ma_${prefix}_list`);
    const enabledCheckbox = document.getElementById(`ma_${prefix}_enabled`);
    const bodyEl = document.getElementById(`ma_${prefix}_body`);

    const selectedIds = existingRules.map(r => r.value_id);
    const mode = existingRules.length > 0 ? existingRules[0].mode : "hanya";

    listEl.innerHTML = masterList.map(item => `
        <div class="form-check access-item">
            <input class="form-check-input" type="checkbox" value="${item[idField]}" id="ma_${prefix}_item_${item[idField]}" ${selectedIds.includes(item[idField]) ? "checked" : ""}>
            <label class="form-check-label small" for="ma_${prefix}_item_${item[idField]}">${item[nameField]}</label>
        </div>
    `).join("") || `<div class="small text-muted">Tidak ada data.</div>`;

    document.getElementById(`ma_${prefix}_mode_${mode}`).checked = true;

    enabledCheckbox.checked = existingRules.length > 0;
    bodyEl.classList.toggle("d-none", existingRules.length === 0);
}

function toggleAccessBlock(prefix) {
    const enabled = document.getElementById(`ma_${prefix}_enabled`).checked;
    document.getElementById(`ma_${prefix}_body`).classList.toggle("d-none", !enabled);
}

function filterAccessList(prefix, keyword) {
    const items = document.querySelectorAll(`#ma_${prefix}_list .access-item`);
    const kw = keyword.trim().toLowerCase();
    items.forEach(item => {
        const label = item.querySelector("label").textContent.toLowerCase();
        item.style.display = label.includes(kw) ? "" : "none";
    });
}

async function handleSaveMenuAccess() {
    const menuCode = document.getElementById("ma_menu_code").value;
    const btnSubmit = document.getElementById("btnSaveMenuAccess");
    const origText = btnSubmit.innerHTML;

    const newRows = [];
    let validationError = null;

    [["dept", "departemen"], ["area", "area"], ["jabatan", "jabatan"]].forEach(([prefix, dimension]) => {
        const enabled = document.getElementById(`ma_${prefix}_enabled`).checked;
        if (!enabled) return;

        const mode = document.querySelector(`input[name="ma_${prefix}_mode"]:checked`).value;
        const checkedBoxes = document.querySelectorAll(`#ma_${prefix}_list input[type="checkbox"]:checked`);
        const valueIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));

        if (valueIds.length === 0) {
            validationError = `Blok "${dimension}" aktif tapi belum ada yang dicentang. Pilih minimal satu, atau matikan toggle-nya.`;
            return;
        }

        valueIds.forEach(valueId => {
            newRows.push({ menu_code: menuCode, dimension, mode, value_id: valueId, rule_group: 1 });
        });
    });

    if (validationError) {
        alert(validationError);
        return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;

    try {
        const { error: deleteError } = await supabaseClient
            .from("menu_access_rules")
            .delete()
            .eq("menu_code", menuCode);
        if (deleteError) throw deleteError;

        if (newRows.length > 0) {
            const { error: insertError } = await supabaseClient
                .from("menu_access_rules")
                .insert(newRows);
            if (insertError) throw insertError;
        }

        bootstrap.Modal.getInstance(document.getElementById("modalMenuAccess"))?.hide();
        await loadMenuAccessRulesAll();
        renderMenusTable();
        alert("Akses menu berhasil disimpan!");

    } catch (err) {
        alert("Gagal menyimpan akses menu: " + (err.message || err));
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = origText;
    }
}

// openMenuModal(null atau tanpa argumen) = mode TAMBAH
// openMenuModal(5) = mode EDIT menu id 5
function openMenuModal(editId = null) {
    const form = document.getElementById("formMenu");
    if (form) form.reset();
    isMenuSubmitting = false;
    editingMenuId = editId;

    const title = document.getElementById("modalMenuTitle");
    const platformWrapper = document.getElementById("menuPlatformWrapper");
    const categoryWrapper = document.getElementById("menuCategoryWrapper");
    const newCatNameWrapper = document.getElementById("newCategoryNameWrapper");
    const newCatCodeWrapper = document.getElementById("newCategoryCodeWrapper");
    const codePreview = document.getElementById("f_menu_code_preview");

    // Selalu sembunyikan dulu field kategori-baru, biar tidak nyangkut dari sesi sebelumnya
    newCatNameWrapper.classList.add("d-none");
    newCatCodeWrapper.classList.add("d-none");

    if (editId === null) {
        // ---- MODE TAMBAH ----
        if (title) title.textContent = "Tambah Menu Aplikasi Baru";
        platformWrapper.classList.remove("d-none");
        categoryWrapper.classList.remove("d-none");
        renderCategoryDropdown(); // pastikan opsi "+ Kategori Baru..." selalu di paling bawah & fresh
        document.getElementById("f_menu_edit_id").value = "";
        handleCategoryChange();   // sinkronkan field "Kategori Baru" dgn pilihan dropdown (+ update preview kode)

    } else {
        // ---- MODE EDIT ----
        // Kode menu, Platform, dan Kategori TIDAK BOLEH diubah untuk
        // menu existing (lihat catatan keamanan poin 4 di atas) --
        // sembunyikan selector-nya, tampilkan kode lama sebagai info saja.
        const menu = systemMenus.find(m => m.id === editId);
        if (!menu) {
            alert("Menu tidak ditemukan.");
            return;
        }

        if (title) title.textContent = `Edit Menu: ${menu.menu_code}`;
        platformWrapper.classList.add("d-none");
        categoryWrapper.classList.add("d-none");

        document.getElementById("f_menu_edit_id").value = menu.id;
        codePreview.value = menu.menu_code + "  (tidak bisa diubah)";
        document.getElementById("f_menu_name").value = menu.menu_name;
        document.getElementById("f_menu_url").value = menu.path_url;
        document.getElementById("f_menu_icon").value = menu.icon_class;
        document.getElementById("f_menu_sort").value = menu.sort_order;
        document.getElementById("f_menu_active").value = menu.is_active ? "true" : "false";
    }

    new bootstrap.Modal(document.getElementById("modalMenu")).show();
}

async function handleSaveMenu(e) {
    if (e) e.preventDefault();
    if (isMenuSubmitting) return;
    isMenuSubmitting = true;

    const menuName = document.getElementById("f_menu_name")?.value.trim();
    const pathUrl = document.getElementById("f_menu_url")?.value.trim();
    const iconClass = document.getElementById("f_menu_icon")?.value.trim();
    const sortOrderVal = document.getElementById("f_menu_sort")?.value;
    const isActiveVal = document.getElementById("f_menu_active")?.value;

    if (!menuName || !pathUrl) {
        alert("Nama Menu dan Path URL wajib diisi!");
        isMenuSubmitting = false;
        return;
    }

    const btnSubmit = e && e.target ? e.target.querySelector("button[type='submit']") : null;
    const origBtnText = btnSubmit ? btnSubmit.innerHTML : "Simpan";
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
    }

    try {
        if (editingMenuId !== null) {
            // ---- UPDATE menu existing -- menu_code/category/platform TIDAK ikut diupdate ----
            const payload = {
                menu_name: menuName,
                path_url: pathUrl,
                icon_class: iconClass || "fa-solid fa-circle",
                sort_order: sortOrderVal ? parseInt(sortOrderVal) : 0,
                is_active: isActiveVal === "true"
            };

            const { error } = await supabaseClient.from("app_menus").update(payload).eq("id", editingMenuId);
            if (error) throw error;

        } else {
            // ---- INSERT menu baru -- generate menu_code otomatis ----
            const platform = document.getElementById("f_menu_platform")?.value;
            const catSelect = document.getElementById("f_menu_category_select");
            let categoryName, categoryCode;

            if (catSelect.value === "__new__") {
                categoryName = (document.getElementById("f_new_category_name")?.value || "").trim();
                categoryCode = (document.getElementById("f_new_category_code")?.value || "").trim().toUpperCase();

                if (!categoryName || !categoryCode) {
                    throw new Error("Nama & Kode Kategori Baru wajib diisi.");
                }

                // Daftarkan kategori baru ke kamus DULU, supaya tersedia
                // untuk menu berikutnya juga (bukan cuma dipakai sekali di sini)
                const { error: catError } = await supabaseClient
                    .from("menu_categories")
                    .insert([{ category_name: categoryName, category_code: categoryCode }]);

                if (catError) {
                    if (catError.code === '23505') {
                        throw new Error(`Kategori atau kode '${categoryCode}' sudah dipakai. Gunakan yang lain.`);
                    }
                    throw catError;
                }

                menuCategories.push({ category_name: categoryName, category_code: categoryCode });

            } else {
                categoryName = catSelect.value;
                const opt = catSelect.options[catSelect.selectedIndex];
                categoryCode = opt ? opt.getAttribute("data-code") : "";
            }

            const menuCode = computeNextMenuCode(platform, categoryCode);

            const payload = {
                menu_code: menuCode,
                menu_name: menuName,
                category: categoryName,
                path_url: pathUrl,
                icon_class: iconClass || "fa-solid fa-circle",
                sort_order: sortOrderVal ? parseInt(sortOrderVal) : 0,
                is_active: isActiveVal === "true"
                // kolom "platform" TIDAK dikirim -- itu generated column,
                // otomatis dihitung DB dari menu_code
            };

            const { error } = await supabaseClient.from("app_menus").insert([payload]);
            if (error) {
                if (error.code === '23505') {
                    throw new Error(`Kode menu '${menuCode}' sudah ada (kemungkinan ada insert lain barengan). Coba lagi.`);
                }
                throw error;
            }
        }

        const modalEl = document.getElementById("modalMenu");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        await loadMenuCategories();
        await loadSystemMenus();
        await loadPermissionsMatrix();
        alert(editingMenuId !== null ? "Menu berhasil diperbarui!" : "Menu berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan Menu: " + (err.message || err));
    } finally {
        isMenuSubmitting = false;
        editingMenuId = null;
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = origBtnText;
        }
    }
}

async function deleteMenu(id) {
    if (!confirm("Yakin hapus menu ini?")) return;
    try {
        const { error } = await supabaseClient.from("app_menus").delete().eq("id", parseInt(id));
        if (error) throw error;
        await loadSystemMenus();
        await loadPermissionsMatrix();
    } catch (e) {
        alert("Gagal menghapus menu: " + (e.message || e));
    }
}

// ===================================================
// 6. MATRIKS HAK AKSES
// - Poin 4: kolom Platform + dikelompokkan per platform (per role)
// - Poin 5: tombol Simpan disabled/abu2 kalau belum ada perubahan
// - Poin 6: savePermissionsBulk() sekarang panggil RPC atomik
//           save_role_permissions_batch, bukan loop select+insert/update
// ===================================================
async function loadPermissionsMatrix() {
    const roleSelect = document.getElementById("permissionRoleSelect");
    const roleId = roleSelect ? roleSelect.value : null;
    if (!roleId) return;

    const roleName = roleSelect.options[roleSelect.selectedIndex]?.text || "";
    const { data: perms } = await supabaseClient.from("role_permissions").select("*").eq("role_id", parseInt(roleId));

    currentPermissions = {};
    systemMenus.forEach(m => {
        const perm = (perms || []).find(p => p.menu_id == m.id) || { can_view: false, can_create: false, can_edit: false, can_delete: false };
        currentPermissions[m.id] = {
            menu_id: m.id,
            can_view: !!perm.can_view,
            can_create: !!perm.can_create,
            can_edit: !!perm.can_edit,
            can_delete: !!perm.can_delete
        };
    });

    // Snapshot kondisi "tersimpan di DB" saat ini -- jadi acuan pembanding
    // untuk deteksi ada-perubahan-atau-tidak (poin 5)
    originalPermissions = JSON.parse(JSON.stringify(currentPermissions));

    renderPermissionsMatrix(roleName);
    updateSavePermissionsButtonState(); // pasti disabled/abu2 tepat setelah load fresh
}

function renderPermissionsMatrix(roleName) {
    let html = "";
    let lastPlatform = null;
    let lastCategory = null;

    systemMenus.forEach(m => {
        const perm = currentPermissions[m.id];

        // Header grup Platform (level 1)
        if (m.platform !== lastPlatform) {
            html += `
                <tr class="table-secondary">
                    <td colspan="7" class="fw-bold small text-uppercase">
                        <i class="fa-solid fa-layer-group me-2"></i>${PLATFORM_LABEL[m.platform] || m.platform}
                    </td>
                </tr>`;
            lastPlatform = m.platform;
            lastCategory = null;
        }

        // Header grup Kategori (level 2)
        if (m.category !== lastCategory) {
            html += `
                <tr class="table-light">
                    <td colspan="7" class="fw-semibold small text-muted ps-4">
                        <i class="fa-solid fa-folder me-2"></i>${m.category}
                    </td>
                </tr>`;
            lastCategory = m.category;
        }

        html += `
            <tr>
                <td class="fw-semibold"><i class="${m.icon_class} me-2 text-secondary"></i>${m.menu_name}</td>
                <td class="text-center"><span class="badge bg-primary-subtle text-primary">${m.platform}</span></td>
                <td class="text-center text-primary fw-bold">${roleName}</td>
                <td class="text-center"><input class="form-check-input border-secondary" style="transform: scale(1.3);" type="checkbox" ${perm.can_view ? 'checked' : ''} onchange="updateTempPerm(${m.id}, 'can_view', this.checked)"></td>
                <td class="text-center"><input class="form-check-input border-secondary" style="transform: scale(1.3);" type="checkbox" ${perm.can_create ? 'checked' : ''} onchange="updateTempPerm(${m.id}, 'can_create', this.checked)"></td>
                <td class="text-center"><input class="form-check-input border-secondary" style="transform: scale(1.3);" type="checkbox" ${perm.can_edit ? 'checked' : ''} onchange="updateTempPerm(${m.id}, 'can_edit', this.checked)"></td>
                <td class="text-center"><input class="form-check-input border-secondary" style="transform: scale(1.3);" type="checkbox" ${perm.can_delete ? 'checked' : ''} onchange="updateTempPerm(${m.id}, 'can_delete', this.checked)"></td>
            </tr>`;
    });

    document.getElementById("permissionsMatrixBody").innerHTML = html;
}

function updateTempPerm(menuId, field, value) {
    if (currentPermissions[menuId]) {
        currentPermissions[menuId][field] = value;
    }
    updateSavePermissionsButtonState();
}

// Bandingkan currentPermissions vs originalPermissions (snapshot saat
// load) -- kalau identik persis, tombol Simpan disabled+abu2 (poin 5).
function hasUnsavedPermissionChanges() {
    for (const menuId in currentPermissions) {
        const cur = currentPermissions[menuId];
        const orig = originalPermissions[menuId];
        if (!orig) return true; // menu baru yg belum ada di snapshot lama
        if (cur.can_view !== orig.can_view) return true;
        if (cur.can_create !== orig.can_create) return true;
        if (cur.can_edit !== orig.can_edit) return true;
        if (cur.can_delete !== orig.can_delete) return true;
    }
    return false;
}

function updateSavePermissionsButtonState() {
    const btn = document.getElementById("btnSavePermissions");
    if (!btn) return;
    btn.disabled = !hasUnsavedPermissionChanges();
}

async function savePermissionsBulk() {
    const roleSelect = document.getElementById("permissionRoleSelect");
    const roleId = roleSelect ? roleSelect.value : null;
    if (!roleId) {
        alert("Silakan pilih Role terlebih dahulu!");
        return;
    }

    const btnSave = document.getElementById("btnSavePermissions");
    const origHtml = btnSave ? btnSave.innerHTML : "Simpan";

    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...`;
    }

    try {
        // 1 panggilan RPC atomik untuk SEMUA baris -- menggantikan loop
        // select+insert/update satu-per-satu yang lama (lihat penjelasan
        // detail soal kenapa ini lebih aman, sudah dibahas sebelumnya).
        const payload = Object.values(currentPermissions);

        const { error } = await supabaseClient.rpc("save_role_permissions_batch", {
            role_id_input: parseInt(roleId),
            permissions: payload
        });

        if (error) throw error;

        // Sukses -- snapshot baru jadi acuan "tersimpan", tombol balik abu2
        originalPermissions = JSON.parse(JSON.stringify(currentPermissions));
        alert("Matriks Hak Akses Berhasil Disimpan!");

    } catch (e) {
        alert("Terjadi kesalahan saat menyimpan hak akses: " + (e.message || e));
    } finally {
        if (btnSave) {
            btnSave.innerHTML = origHtml;
        }
        updateSavePermissionsButtonState();
    }
}
// ===================================================
// 7. DATA PENDUKUNG MODAL AKSES MENU
// Departemen & Area dipakai blok checklist di modal "Atur Akses Menu".
// (Dulu ikut dimuat oleh fungsi Zona; sekarang berdiri sendiri supaya
// pemindahan Zona ke Master Data tidak merusak modal Akses Menu.)
// ===================================================
let departmentList = [];
let areaList = [];

async function loadAccessMasters() {
    const [deptRes, areaRes] = await Promise.all([
        supabaseClient.from("departments").select("*").order("department_name", { ascending: true }),
        supabaseClient.from("areas").select("*").order("area_name", { ascending: true })
    ]);
    if (deptRes.error) console.error("Gagal memuat departemen:", deptRes.error.message);
    if (areaRes.error) console.error("Gagal memuat area:", areaRes.error.message);

    departmentList = deptRes.data || [];
    areaList = (areaRes.data || []).filter(a => a.is_active === true);   // hanya area aktif
}