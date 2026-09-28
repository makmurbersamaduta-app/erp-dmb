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

    await loadSystemRoles();
    await loadMenuCategories();   // kamus kategori -- WAJIB sebelum render dropdown & tabel menu
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