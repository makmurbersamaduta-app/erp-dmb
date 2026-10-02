// ===================================================
// js/module/settings/system_config.js
// Halaman Konfigurasi Sistem (Roles, Menu, Permission Matrix)
// ===================================================

// ---------------------------------------------------
// 1. STATE GLOBAL
// ---------------------------------------------------
let systemRoles = [];
let systemMenus = [];
let menuCategories = [];        // dari tabel public.menu_categories: [{category_name, category_code}]
let currentPermissions = {};    // state lokal checkbox SEBELUM disimpan ke DB
let originalPermissions = {};   // snapshot terakhir yg TERSIMPAN di DB -- dipakai utk deteksi "ada perubahan atau tidak"
let editingMenuId = null;       // null = mode Tambah Menu, angka = mode Edit Menu

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

    const formZonaCoverage = document.getElementById("formZonaCoverage");
    if (formZonaCoverage) {
        formZonaCoverage.onsubmit = null;
        formZonaCoverage.addEventListener("submit", handleSaveZonaCoverage);
    }

    const formSupervisorZone = document.getElementById("formSupervisorZone");
    if (formSupervisorZone) {
        formSupervisorZone.onsubmit = null;
        formSupervisorZone.addEventListener("submit", handleSaveSupervisorZone);
    }

    await loadSystemRoles();
    await loadMenuCategories();   // kamus kategori -- WAJIB sebelum render dropdown & tabel menu
    await loadSystemMenus();
    await loadPermissionsMatrix();

    // Tab 4: Zona & Approval Routing
    await loadZonaTabMasters();   // zonas, departments, areas -- WAJIB sebelum render dropdown
    await loadZonaCoverageList();
    await loadSupervisorZonesList();
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
        return;
    }
    menuCategories = data || [];
    renderCategoryDropdown();
}

function renderCategoryDropdown() {
    const sel = document.getElementById("f_menu_category_select");
    if (!sel) return;

    let html = menuCategories.map(c =>
        `<option value="${c.category_name}" data-code="${c.category_code}">${c.category_name} (${c.category_code})</option>`
    ).join("");

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
        document.getElementById("menusTableBody").innerHTML = `<tr><td colspan="6" class="text-center text-danger">Gagal memuat menu: ${error.message}</td></tr>`;
        return;
    }
    systemMenus = data || [];
    renderMenusTable();
}

const PLATFORM_LABEL = { "M": "Web ERP", "PWA": "Aplikasi PWA" };

function renderMenusTable() {
    if (systemMenus.length === 0) {
        document.getElementById("menusTableBody").innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada menu.</td></tr>`;
        return;
    }

    let html = "";
    let lastPlatform = null;
    let lastCategory = null;

    systemMenus.forEach(m => {
        // Baris header grup PLATFORM (level 1) -- tiap kali platform berganti
        if (m.platform !== lastPlatform) {
            html += `
                <tr class="table-secondary">
                    <td colspan="6" class="fw-bold small text-uppercase">
                        <i class="fa-solid fa-layer-group me-2"></i>${PLATFORM_LABEL[m.platform] || m.platform}
                    </td>
                </tr>`;
            lastPlatform = m.platform;
            lastCategory = null; // reset supaya header kategori baru muncul lagi di platform baru
        }

        // Baris header grup KATEGORI (level 2, nested di dalam platform)
        if (m.category !== lastCategory) {
            html += `
                <tr class="table-light">
                    <td colspan="6" class="fw-semibold small text-muted ps-4">
                        <i class="fa-solid fa-folder me-2"></i>${m.category}
                    </td>
                </tr>`;
            lastCategory = m.category;
        }

        html += `
            <tr class="text-center">
                <td><code>${m.menu_code}</code></td>
                <td class="text-start"><i class="${m.icon_class} me-2 text-primary"></i>${m.menu_name}</td>
                <td class="text-start small text-muted">${m.path_url}</td>
                <td><span class="badge bg-primary-subtle text-primary">${m.platform}</span></td>
                <td>${m.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
                <td>
                    <button class="btn btn-sm btn-light text-primary me-1" onclick="openMenuModal(${m.id})" title="Edit menu"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-light text-danger" onclick="deleteMenu(${m.id})" title="Hapus menu"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });

    document.getElementById("menusTableBody").innerHTML = html;
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
        updateMenuCodePreview();

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
// 7. TAB 4: ZONA & APPROVAL ROUTING
// 3 bagian: Zona (referensi saja), Cakupan Zona (zona_coverage, CRUD),
// Supervisor Zona (supervisor_zones, CRUD).
//
// Field identitas (Zona/Departemen/Area untuk Cakupan; Karyawan/Zona
// untuk Supervisor) DIKUNCI saat Edit -- pola yang sama dengan Menu
// Aplikasi: kalau salah assign, hapus & buat baris baru, bukan diubah
// di tempat (supaya kode/kombinasi unik tidak jadi berantakan).
// ===================================================

let zonaList = [];
let departmentList = [];
let areaList = [];
let zonaCoverageList = [];
let supervisorZonesList = [];
let editingZonaCoverageId = null;
let editingSupervisorZoneId = null;
let selectedSupervisorEmployee = null; // {id, nama, nik_karyawan} saat mode Tambah

// ---------------------------------------------------
// 7.1 LOAD MASTER (zonas, departments, areas)
// ---------------------------------------------------
async function loadZonaTabMasters() {
    const [{ data: zonas }, { data: depts }, { data: areas }] = await Promise.all([
        supabaseClient.from("zonas").select("*").order("zona_name", { ascending: true }),
        supabaseClient.from("departments").select("*").order("department_name", { ascending: true }),
        supabaseClient.from("areas").select("*").eq("is_active", true).order("area_name", { ascending: true })
    ]);

    zonaList = zonas || [];
    departmentList = depts || [];
    areaList = areas || [];

    renderZonasTable();
    renderZonaDropdowns();
}

function renderZonasTable() {
    const tbody = document.getElementById("zonasTableBody");
    if (!tbody) return;

    if (zonaList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Belum ada data zona.</td></tr>`;
        return;
    }

    tbody.innerHTML = zonaList.map(z => `
        <tr class="text-center">
            <td class="text-start fw-semibold">${z.zona_name}</td>
            <td><code>${z.zona_code}</code></td>
            <td>${z.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
        </tr>`).join("");
}

// Isi ulang dropdown Zona di kedua modal (Cakupan & Supervisor) -- hanya zona aktif
function renderZonaDropdowns() {
    const options = zonaList
        .filter(z => z.is_active)
        .map(z => `<option value="${z.id}" data-code="${z.zona_code}">${z.zona_name} (${z.zona_code})</option>`)
        .join("");

    const zcSel = document.getElementById("zc_zona_id");
    if (zcSel) zcSel.innerHTML = options;

    const szSel = document.getElementById("sz_zona_id");
    if (szSel) szSel.innerHTML = options;

    const deptOptions = departmentList.map(d => `<option value="${d.id}">${d.department_name}</option>`).join("");
    const deptSel = document.getElementById("zc_departemen_id");
    if (deptSel) deptSel.innerHTML = deptOptions;

    const areaOptions = areaList.map(a => `<option value="${a.id}">${a.area_name}</option>`).join("");
    const areaSel = document.getElementById("zc_area_id");
    if (areaSel) areaSel.innerHTML = areaOptions;
}

// ---------------------------------------------------
// 7.2 CAKUPAN ZONA (zona_coverage)
// ---------------------------------------------------
async function loadZonaCoverageList() {
    const { data, error } = await supabaseClient
        .from("zona_coverage")
        .select("*")
        .order("zona_id", { ascending: true });

    if (error) {
        document.getElementById("zonaCoverageTableBody").innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error: ${error.message}</td></tr>`;
        return;
    }
    zonaCoverageList = data || [];
    renderZonaCoverageTable();
}

function renderZonaCoverageTable() {
    const tbody = document.getElementById("zonaCoverageTableBody");
    if (!tbody) return;

    if (zonaCoverageList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Belum ada cakupan zona.</td></tr>`;
        return;
    }

    tbody.innerHTML = zonaCoverageList.map(zc => {
        const zona = zonaList.find(z => z.id === zc.zona_id);
        const dept = departmentList.find(d => d.id === zc.departemen_id);
        const area = areaList.find(a => a.id === zc.area_id);

        return `
            <tr class="text-center">
                <td><code>${zc.kode_zona_coverage}</code></td>
                <td>${zona ? zona.zona_name : '-'}</td>
                <td>${dept ? dept.department_name : '-'}</td>
                <td>${area ? area.area_name : '-'}</td>
                <td class="text-start small text-muted">${zc.keterangan || '-'}</td>
                <td>${zc.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
                <td>
                    <button class="btn btn-sm btn-light text-primary me-1" onclick="openZonaCoverageModal(${zc.id})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-light text-danger" onclick="deleteZonaCoverage(${zc.id})" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    }).join("");
}

// Kode format: {zona_code}-{urutan}, nomor reset PER ZONA (sesuai catatan keputusan)
function computeNextZonaCoverageCode(zonaCode, zonaId) {
    const regex = new RegExp(`^${zonaCode}-(\\d+)$`);
    let maxNum = 0;

    zonaCoverageList
        .filter(zc => zc.zona_id === zonaId)
        .forEach(zc => {
            const match = (zc.kode_zona_coverage || "").match(regex);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        });

    return `${zonaCode}-${String(maxNum + 1).padStart(2, "0")}`;
}

function updateZonaCoverageCodePreview() {
    if (editingZonaCoverageId !== null) return; // mode edit: kode tidak berubah

    const sel = document.getElementById("zc_zona_id");
    const preview = document.getElementById("zc_code_preview");
    if (!sel || !preview) return;

    const opt = sel.options[sel.selectedIndex];
    const zonaCode = opt ? opt.getAttribute("data-code") : null;
    const zonaId = sel.value ? parseInt(sel.value) : null;

    if (!zonaCode || !zonaId) {
        preview.value = "(pilih zona dulu)";
        return;
    }
    preview.value = computeNextZonaCoverageCode(zonaCode, zonaId);
}

function openZonaCoverageModal(editId = null) {
    const form = document.getElementById("formZonaCoverage");
    if (form) form.reset();
    editingZonaCoverageId = editId;

    const title = document.getElementById("modalZonaCoverageTitle");
    const zonaWrapper = document.getElementById("zc_zona_wrapper");
    const deptWrapper = document.getElementById("zc_dept_wrapper");
    const areaWrapper = document.getElementById("zc_area_wrapper");

    if (editId === null) {
        // ---- MODE TAMBAH ----
        if (title) title.textContent = "Tambah Cakupan Zona";
        zonaWrapper.classList.remove("d-none");
        deptWrapper.classList.remove("d-none");
        areaWrapper.classList.remove("d-none");
        document.getElementById("zc_edit_id").value = "";
        renderZonaDropdowns();
        updateZonaCoverageCodePreview();

    } else {
        // ---- MODE EDIT -- Zona/Departemen/Area DIKUNCI ----
        const zc = zonaCoverageList.find(x => x.id === editId);
        if (!zc) { alert("Data tidak ditemukan."); return; }

        const zona = zonaList.find(z => z.id === zc.zona_id);
        const dept = departmentList.find(d => d.id === zc.departemen_id);
        const area = areaList.find(a => a.id === zc.area_id);

        if (title) title.textContent = `Edit Cakupan: ${zc.kode_zona_coverage}`;
        zonaWrapper.classList.add("d-none");
        deptWrapper.classList.add("d-none");
        areaWrapper.classList.add("d-none");

        document.getElementById("zc_edit_id").value = zc.id;
        document.getElementById("zc_code_preview").value =
            `${zc.kode_zona_coverage}  (${zona?.zona_name || '-'} / ${dept?.department_name || '-'} / ${area?.area_name || '-'} -- tidak bisa diubah)`;
        document.getElementById("zc_keterangan").value = zc.keterangan || "";
        document.getElementById("zc_is_active").value = zc.is_active ? "true" : "false";
    }

    new bootstrap.Modal(document.getElementById("modalZonaCoverage")).show();
}

async function handleSaveZonaCoverage(e) {
    if (e) e.preventDefault();

    const keterangan = document.getElementById("zc_keterangan").value.trim();
    const isActive = document.getElementById("zc_is_active").value === "true";

    const btnSubmit = e.target.querySelector("button[type='submit']");
    const origText = btnSubmit ? btnSubmit.innerHTML : "Simpan";
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
    }

    try {
        if (editingZonaCoverageId !== null) {
            // ---- UPDATE -- hanya keterangan & status ----
            const { error } = await supabaseClient
                .from("zona_coverage")
                .update({ keterangan: keterangan || null, is_active: isActive })
                .eq("id", editingZonaCoverageId);
            if (error) throw error;

        } else {
            // ---- INSERT BARU ----
            const zonaId = parseInt(document.getElementById("zc_zona_id").value);
            const departemenId = parseInt(document.getElementById("zc_departemen_id").value);
            const areaId = parseInt(document.getElementById("zc_area_id").value);

            // Cek duplikat AKTIF untuk kombinasi departemen+area ini --
            // pengecekan sisi client supaya pesan error ramah; index unik
            // partial di DB (zona_coverage_dept_area_active_uidx) adalah
            // jaring pengaman terakhir kalau ada race condition.
            const dupActive = zonaCoverageList.find(zc =>
                zc.departemen_id === departemenId && zc.area_id === areaId && zc.is_active
            );
            if (dupActive) {
                throw new Error(`Kombinasi Departemen+Area ini sudah terdaftar aktif di kode ${dupActive.kode_zona_coverage}. Nonaktifkan dulu baris lama kalau mau pindah zona.`);
            }

            const zonaOpt = document.getElementById("zc_zona_id");
            const zonaCode = zonaOpt.options[zonaOpt.selectedIndex].getAttribute("data-code");
            const kode = computeNextZonaCoverageCode(zonaCode, zonaId);

            const { error } = await supabaseClient.from("zona_coverage").insert([{
                zona_id: zonaId,
                departemen_id: departemenId,
                area_id: areaId,
                kode_zona_coverage: kode,
                keterangan: keterangan || null,
                is_active: isActive
            }]);

            if (error) {
                if (error.code === '23505') {
                    throw new Error("Kombinasi ini atau kode-nya sudah ada (kemungkinan ada insert lain barengan). Coba lagi.");
                }
                throw error;
            }
        }

        bootstrap.Modal.getInstance(document.getElementById("modalZonaCoverage"))?.hide();
        await loadZonaCoverageList();
        alert(editingZonaCoverageId !== null ? "Cakupan Zona berhasil diperbarui!" : "Cakupan Zona berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan: " + (err.message || err));
    } finally {
        editingZonaCoverageId = null;
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = origText;
        }
    }
}

async function deleteZonaCoverage(id) {
    if (!confirm("Yakin hapus cakupan zona ini?")) return;
    try {
        const { error } = await supabaseClient.from("zona_coverage").delete().eq("id", id);
        if (error) throw error;
        await loadZonaCoverageList();
    } catch (e) {
        alert("Gagal menghapus: " + (e.message || e));
    }
}

// ---------------------------------------------------
// 7.3 SUPERVISOR ZONA (supervisor_zones)
// ---------------------------------------------------
async function loadSupervisorZonesList() {
    const { data, error } = await supabaseClient
        .from("supervisor_zones")
        .select("*")
        .order("zona_id", { ascending: true });

    if (error) {
        document.getElementById("supervisorZonesTableBody").innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${error.message}</td></tr>`;
        return;
    }
    supervisorZonesList = data || [];

    // Ambil nama karyawan -- supervisor_zones.employee_id (uuid) merujuk ke
    // hrd.employees, schema BEDA, jadi tidak bisa di-join lewat PostgREST
    // embed biasa. Query terpisah lalu digabung manual di JS.
    const employeeIds = [...new Set(supervisorZonesList.map(sz => sz.employee_id))];
    let employeeMap = {};

    if (employeeIds.length > 0) {
        const { data: emps } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .select("id, nama, nik_karyawan")
            .in("id", employeeIds);

        (emps || []).forEach(e => { employeeMap[e.id] = e; });
    }

    renderSupervisorZonesTable(employeeMap);
}

function renderSupervisorZonesTable(employeeMap) {
    const tbody = document.getElementById("supervisorZonesTableBody");
    if (!tbody) return;

    if (supervisorZonesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Belum ada supervisor terdaftar.</td></tr>`;
        return;
    }

    const levelLabel = { 1: "1 - Utama", 2: "2 - Eskalasi" };

    tbody.innerHTML = supervisorZonesList.map(sz => {
        const zona = zonaList.find(z => z.id === sz.zona_id);
        const emp = employeeMap[sz.employee_id];
        const empLabel = emp ? `${emp.nama} (${emp.nik_karyawan})` : sz.employee_id;

        return `
            <tr class="text-center">
                <td class="text-start fw-semibold">${empLabel}</td>
                <td>${zona ? zona.zona_name : '-'}</td>
                <td><span class="badge bg-primary-subtle text-primary">${levelLabel[sz.approval_level] || sz.approval_level}</span></td>
                <td>${sz.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
                <td>
                    <button class="btn btn-sm btn-light text-primary me-1" onclick="openSupervisorZoneModal(${sz.id})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-light text-danger" onclick="deleteSupervisorZone(${sz.id})" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    }).join("");
}

// Pencarian karyawan (bukan dropdown biasa -- bisa ribuan baris).
// Debounce sederhana 300ms supaya tidak query tiap ketikan huruf.
let supervisorSearchTimeout = null;
function handleSupervisorEmployeeSearch() {
    clearTimeout(supervisorSearchTimeout);
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
            resultsEl.innerHTML = `<div class="list-group-item small text-muted">Tidak ditemukan.</div>`;
            return;
        }

        resultsEl.innerHTML = data.map(emp => `
            <button type="button" class="list-group-item list-group-item-action small" onclick='selectSupervisorEmployee(${JSON.stringify(emp)})'>
                ${emp.nama} <span class="text-muted">(${emp.nik_karyawan})</span>
            </button>`).join("");
    }, 300);
}

function selectSupervisorEmployee(emp) {
    selectedSupervisorEmployee = emp;
    document.getElementById("sz_selected_employee_id").value = emp.id;
    document.getElementById("sz_employee_search").value = `${emp.nama} (${emp.nik_karyawan})`;
    document.getElementById("sz_employee_search_results").innerHTML = "";
}

function openSupervisorZoneModal(editId = null) {
    const form = document.getElementById("formSupervisorZone");
    if (form) form.reset();
    editingSupervisorZoneId = editId;
    selectedSupervisorEmployee = null;
    document.getElementById("sz_employee_search_results").innerHTML = "";

    const title = document.getElementById("modalSupervisorZoneTitle");
    const searchWrapper = document.getElementById("sz_employee_search_wrapper");
    const zonaWrapper = document.getElementById("sz_zona_wrapper");

    if (editId === null) {
        // ---- MODE TAMBAH ----
        if (title) title.textContent = "Tambah Supervisor Zona";
        searchWrapper.classList.remove("d-none");
        zonaWrapper.classList.remove("d-none");
        document.getElementById("sz_edit_id").value = "";
        renderZonaDropdowns();

    } else {
        // ---- MODE EDIT -- Karyawan & Zona DIKUNCI ----
        const sz = supervisorZonesList.find(x => x.id === editId);
        if (!sz) { alert("Data tidak ditemukan."); return; }

        const zona = zonaList.find(z => z.id === sz.zona_id);

        if (title) title.textContent = "Edit Supervisor Zona";
        searchWrapper.classList.add("d-none");
        zonaWrapper.classList.add("d-none");

        document.getElementById("sz_edit_id").value = sz.id;
        document.getElementById("sz_selected_employee_id").value = sz.employee_id;
        document.getElementById("sz_approval_level").value = sz.approval_level;
        document.getElementById("sz_is_active").value = sz.is_active ? "true" : "false";

        // Tampilkan info identitas yg dikunci sebagai teks info saja
        const infoEl = document.getElementById("sz_employee_selected_display");
        infoEl.classList.remove("d-none");
        infoEl.innerHTML = `<div class="alert alert-secondary py-2 small mb-2">Zona: <strong>${zona?.zona_name || '-'}</strong> (tidak bisa diubah di sini -- hapus & buat baru kalau perlu pindah)</div>`;
    }

    new bootstrap.Modal(document.getElementById("modalSupervisorZone")).show();
}

async function handleSaveSupervisorZone(e) {
    if (e) e.preventDefault();

    const approvalLevel = parseInt(document.getElementById("sz_approval_level").value);
    const isActive = document.getElementById("sz_is_active").value === "true";

    const btnSubmit = e.target.querySelector("button[type='submit']");
    const origText = btnSubmit ? btnSubmit.innerHTML : "Simpan";
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
    }

    try {
        if (editingSupervisorZoneId !== null) {
            // ---- UPDATE -- hanya approval_level & status ----
            const { error } = await supabaseClient
                .from("supervisor_zones")
                .update({ approval_level: approvalLevel, is_active: isActive })
                .eq("id", editingSupervisorZoneId);
            if (error) throw error;

        } else {
            // ---- INSERT BARU ----
            const employeeId = document.getElementById("sz_selected_employee_id").value;
            const zonaId = parseInt(document.getElementById("sz_zona_id").value);

            if (!employeeId) {
                throw new Error("Pilih karyawan dari hasil pencarian dulu.");
            }

            const { error } = await supabaseClient.from("supervisor_zones").insert([{
                employee_id: employeeId,
                zona_id: zonaId,
                approval_level: approvalLevel,
                is_active: isActive
            }]);

            if (error) throw error;
        }

        bootstrap.Modal.getInstance(document.getElementById("modalSupervisorZone"))?.hide();
        await loadSupervisorZonesList();
        alert(editingSupervisorZoneId !== null ? "Supervisor Zona berhasil diperbarui!" : "Supervisor Zona berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan: " + (err.message || err));
    } finally {
        editingSupervisorZoneId = null;
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = origText;
        }
    }
}

async function deleteSupervisorZone(id) {
    if (!confirm("Yakin hapus supervisor dari zona ini?")) return;
    try {
        const { error } = await supabaseClient.from("supervisor_zones").delete().eq("id", id);
        if (error) throw error;
        await loadSupervisorZonesList();
    } catch (e) {
        alert("Gagal menghapus: " + (e.message || e));
    }
}