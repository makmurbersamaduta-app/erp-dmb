let systemRoles = [];
let systemMenus = [];
let currentPermissions = {}; // State lokal sebelum disimpan ke Database

// Flag Pengunci (Prevent Double Submit / Race Condition)
let isRoleSubmitting = false;
let isMenuSubmitting = false;

document.addEventListener("DOMContentLoaded", async () => {
    checkAuthGuard();

    // Pemasangan Event Listener Form Submit secara Aman (Hanya 1x)
    const formRole = document.getElementById("formRole");
    if (formRole) {
        formRole.onsubmit = null; // Hapus inline handler jika ada
        formRole.addEventListener("submit", handleSaveRole);
    }

    const formMenu = document.getElementById("formMenu");
    if (formMenu) {
        formMenu.onsubmit = null; // Hapus inline handler jika ada
        formMenu.addEventListener("submit", handleSaveMenu);
    }

    await loadSystemRoles();
    await loadSystemMenus();
    await loadPermissionsMatrix();
});

// ================= 1. ROLES =================
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
    isRoleSubmitting = false; // Reset lock
    new bootstrap.Modal(document.getElementById("modalRole")).show();
}

async function handleSaveRole(e) {
    if (e) e.preventDefault();
    
    // Kunci proses jika sedang berjalan (cegah double trigger)
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
        const payload = { 
            role_name: roleName, 
            description: roleDesc 
        };

        const { error } = await supabaseClient.from("roles").insert([payload]);

        if (error) {
            if (error.status === 409 || error.code === '23505' || (error.message && error.message.includes("duplicate"))) {
                throw new Error(`Role dengan nama '${roleName}' sudah ada di database.`);
            }
            throw error;
        }

        // Tutup Modal
        const modalEl = document.getElementById("modalRole");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        await loadSystemRoles();
        await loadPermissionsMatrix();
        alert("Role berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan Role: " + (err.message || err));
    } finally {
        isRoleSubmitting = false; // Buka kunci kembali
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

// ================= 2. MENUS =================
async function loadSystemMenus() {
    const { data, error } = await supabaseClient.from("app_menus").select("*").order("sort_order", { ascending: true });
    if (error) {
        document.getElementById("menusTableBody").innerHTML = `<tr><td colspan="5" class="text-center text-danger">Gagal memuat menu: ${error.message}</td></tr>`;
        return;
    }
    systemMenus = data || [];
    
    let html = "";
    systemMenus.forEach(m => {
        html += `
            <tr class="text-center">
                <td><code>${m.menu_code}</code></td>
                <td class="text-start"><i class="${m.icon_class} me-2 text-primary"></i>${m.menu_name}</td>
                <td><span class="badge border text-dark">${m.category}</span></td>
                <td>${m.is_active ? '<span class="badge bg-success-subtle text-success">Aktif</span>' : '<span class="badge bg-danger-subtle text-danger">Non-Aktif</span>'}</td>
                <td><button class="btn btn-sm btn-light text-danger" onclick="deleteMenu(${m.id})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
    });
    
    document.getElementById("menusTableBody").innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">Belum ada menu.</td></tr>`;
}

function openMenuModal() {
    const form = document.getElementById("formMenu");
    if (form) form.reset();
    isMenuSubmitting = false;
    new bootstrap.Modal(document.getElementById("modalMenu")).show();
}

async function handleSaveMenu(e) {
    if (e) e.preventDefault();
    
    if (isMenuSubmitting) return;
    isMenuSubmitting = true;

    const menuCode = document.getElementById("f_menu_code")?.value.trim();
    const menuName = document.getElementById("f_menu_name")?.value.trim();
    const category = document.getElementById("f_menu_category")?.value.trim();
    const pathUrl = document.getElementById("f_menu_url")?.value.trim();
    const iconClass = document.getElementById("f_menu_icon")?.value.trim();
    const sortOrderVal = document.getElementById("f_menu_sort")?.value;
    const isActiveVal = document.getElementById("f_menu_active")?.value;

    if (!menuCode || !menuName) {
        alert("Kode Menu dan Nama Menu wajib diisi!");
        isMenuSubmitting = false;
        return;
    }

    const btnSubmit = document.getElementById("btnSaveMenu") || (e && e.target ? e.target.querySelector("button[type='submit']") : null);
    const origBtnText = btnSubmit ? btnSubmit.innerHTML : "Simpan";

    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...`;
    }

    try {
        const payload = {
            menu_code: menuCode,
            menu_name: menuName,
            category: category || "Lainnya",
            path_url: pathUrl || "#",
            icon_class: iconClass || "fa-solid fa-circle",
            sort_order: sortOrderVal ? parseInt(sortOrderVal) : 0,
            is_active: isActiveVal === "true"
        };

        const { error } = await supabaseClient.from("app_menus").insert([payload]);

        if (error) {
            if (error.status === 409 || error.code === '23505' || (error.message && error.message.includes("duplicate"))) {
                throw new Error(`Kode menu '${menuCode}' sudah ada di database.`);
            }
            throw error;
        }

        const modalEl = document.getElementById("modalMenu");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        await loadSystemMenus();
        await loadPermissionsMatrix();
        alert("Menu berhasil ditambahkan!");

    } catch (err) {
        alert("Gagal menyimpan Menu: " + (err.message || err));
    } finally {
        isMenuSubmitting = false;
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

// ================= 3. PERMISSIONS MATRIX =================
async function loadPermissionsMatrix() {
    const roleSelect = document.getElementById("permissionRoleSelect");
    const roleId = roleSelect ? roleSelect.value : null;
    if (!roleId) return;

    const roleName = roleSelect.options[roleSelect.selectedIndex]?.text || "";
    const { data: perms } = await supabaseClient.from("role_permissions").select("*").eq("role_id", parseInt(roleId));

    currentPermissions = {}; 
    
    let html = "";
    systemMenus.forEach(m => {
        const perm = (perms || []).find(p => p.menu_id == m.id) || { can_view: false, can_create: false, can_edit: false, can_delete: false };
        currentPermissions[m.id] = { ...perm, menu_id: m.id };
        
        html += `
            <tr>
                <td class="fw-semibold"><i class="${m.icon_class} me-2 text-secondary"></i>${m.menu_name}</td>
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
}

async function savePermissionsBulk() {
    const roleSelect = document.getElementById("permissionRoleSelect");
    const roleId = roleSelect ? roleSelect.value : null;
    if (!roleId) {
        alert("Silakan pilih Role terlebih dahulu!");
        return;
    }

    const btnSave = document.querySelector(".card-footer .btn-success");
    const origHtml = btnSave ? btnSave.innerHTML : "Simpan";
    
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...`;
    }

    try {
        const parsedRoleId = parseInt(roleId);

        for (const menuId in currentPermissions) {
            const perm = currentPermissions[menuId];
            const parsedMenuId = parseInt(menuId);
            
            const { data: existing, error: fetchErr } = await supabaseClient
                .from("role_permissions")
                .select("id")
                .eq("role_id", parsedRoleId)
                .eq("menu_id", parsedMenuId)
                .maybeSingle();

            if (fetchErr) throw fetchErr;

            const payload = {
                can_view: !!perm.can_view,
                can_create: !!perm.can_create,
                can_edit: !!perm.can_edit,
                can_delete: !!perm.can_delete
            };

            if (existing) {
                const { error: updateErr } = await supabaseClient
                    .from("role_permissions")
                    .update(payload)
                    .eq("id", existing.id);
                if (updateErr) throw updateErr;
            } else {
                payload.role_id = parsedRoleId;
                payload.menu_id = parsedMenuId;
                const { error: insertErr } = await supabaseClient
                    .from("role_permissions")
                    .insert([payload]);
                if (insertErr) throw insertErr;
            }
        }
        alert("Matriks Hak Akses Berhasil Disimpan!");
    } catch (e) {
        alert("Terjadi kesalahan saat menyimpan hak akses: " + (e.message || e));
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = origHtml;
        }
    }
}