// ===================================================
// 1. INISIALISASI SUPABASE CLIENT
// ===================================================

const supabaseClient = window.supabaseClient;

const SYNTHETIC_DOMAIN = "@supabase.mail"; // Domain sintetis untuk autentikasi berbasis username

// ===================================================
// 2. EVENT LISTENER DOM
// ===================================================
document.addEventListener("DOMContentLoaded", () => {
    // Autoload Username jika memilih "Remember Me"
    const savedUsername = localStorage.getItem("dmb_remembered_username");
    const usernameInput = document.getElementById("usernameInput");
    const rememberMeInput = document.getElementById("rememberMeInput");

    if (savedUsername && usernameInput && rememberMeInput) {
        usernameInput.value = savedUsername;
        rememberMeInput.checked = true;
    }

    // Proteksi Guard jika berada di luar halaman login
    if (!window.location.pathname.endsWith("login.html")) {
        checkAuthGuard();
    }

    // Listener Form Login
    const formLogin = document.getElementById("formLogin");
    if (formLogin) {
        formLogin.addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = document.getElementById("usernameInput").value.trim();
            const password = document.getElementById("passwordInput").value;
            const isRememberMe = document.getElementById("rememberMeInput")?.checked || false;

            await handleLogin(username, password, isRememberMe);
        });
    }

    // Listener Toggle Lihat Password
    const btnTogglePassword = document.getElementById("btnTogglePassword");
    if (btnTogglePassword) {
        btnTogglePassword.addEventListener("click", () => {
            const pwdInput = document.getElementById("passwordInput");
            const icon = document.getElementById("toggleIcon");
            if (pwdInput.type === "password") {
                pwdInput.type = "text";
                icon.classList.replace("fa-eye", "fa-eye-slash");
            } else {
                pwdInput.type = "password";
                icon.classList.replace("fa-eye-slash", "fa-eye");
            }
        });
    }

    // Listener Form Ubah Password
    const formChangePassword = document.getElementById("formChangePassword");
    if (formChangePassword) {
        formChangePassword.addEventListener("submit", async (e) => {
            e.preventDefault();
            await handleChangePassword();
        });
    }
});

// ===================================================
// 3. FUNGSI UTAMA LOGIN
// ===================================================
async function handleLogin(username, password, isRememberMe = false) {
    const alertBox = document.getElementById("alertContainer");
    const btnText = document.getElementById("btnText");
    const btnSpinner = document.getElementById("btnSpinner");
    const btnLogin = document.getElementById("btnLogin");

    // UI Loading State
    alertBox.classList.add("d-none");
    alertBox.innerText = "";
    btnText.innerText = "Memproses...";
    btnSpinner.classList.remove("d-none");
    btnLogin.disabled = true;

    try {
        const syntheticEmail = `${username.toLowerCase()}${SYNTHETIC_DOMAIN}`;

        // A. Autentikasi ke Supabase Auth
        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
            email: syntheticEmail,
            password: password
        });

        if (authError) {
            console.error("Auth Error:", authError);
            throw new Error("Username atau Password yang Anda masukkan salah!");
        }

        // B. Ambil Data Akun dari public.users BERDASARKAN USERNAME (Mengatasi Masalah BIGINT vs UUID)
        const { data: userData, error: userError } = await supabaseClient
            .from("users_safe")
            .select("id, email, username, role_id, dep_id, area_id, is_active")
            .ilike("username", username)
            .maybeSingle();

        if (userError) {
            console.error("Database Query Error (users):", userError);
            throw new Error(`Gagal membaca data user: ${userError.message}`);
        }

        if (!userData) {
            throw new Error("Data akun tidak ditemukan di tabel users!");
        }

        if (!userData.is_active) {
            await supabaseClient.auth.signOut();
            throw new Error("Akun Web Anda statusnya NON-AKTIF. Hubungi Administrator!");
        }

        // C. Ambil Nama Role Terpisah (Mencegah Error Relasi)
        let roleName = "User";
        if (userData.role_id) {
            const { data: roleData } = await supabaseClient
                .from("roles")
                .select("id, role_name")
                .eq("id", userData.role_id)
                .maybeSingle();

            if (roleData && roleData.role_name) {
                roleName = roleData.role_name.trim();
            }
        }

        const isSuperAdmin = roleName.toLowerCase() === "super admin";

        // D. Ambil Matriks Hak Akses Modul dari public.role_permissions
        let userPermissions = [];
        if (userData.role_id) {
            const { data: permissionsData } = await supabaseClient
                .from("role_permissions")
                .select(`
                    can_view,
                    can_create,
                    can_edit,
                    can_delete,
                    app_menus ( id, menu_code, menu_name, category, path_url, icon_class, sort_order )
                `)
                .eq("role_id", userData.role_id)
                .eq("can_view", true);

            if (permissionsData && permissionsData.length > 0) {
                userPermissions = permissionsData.map(p => ({
                    code: p.app_menus?.menu_code || "",
                    name: p.app_menus?.menu_name || "",
                    category: p.app_menus?.category || "Lainnya",
                    path: p.app_menus?.path_url || "#",
                    icon: p.app_menus?.icon_class || "fa-solid fa-circle",
                    sort: p.app_menus?.sort_order || 0,
                    actions: {
                        create: p.can_create,
                        edit: p.can_edit,
                        delete: p.can_delete
                    }
                }));
            }
        }

        // E. Hubungkan ke hrd.employees (Mencocokkan nik_karyawan = username)
        let employeeData = null;
        const { data: emp } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .select("id, nik_karyawan, nama, is_active, blacklist")
            .ilike("nik_karyawan", userData.username)
            .maybeSingle();

        if (emp) {
            if (emp.blacklist || !emp.is_active) {
                await supabaseClient.auth.signOut();
                throw new Error("Akses Ditolak: Karyawan berstatus BLACKLIST atau NON-AKTIF!");
            }
            employeeData = emp;
        }

        // F. Ambil Assignment Struktural Karyawan
        let assignmentData = null;
        if (employeeData) {
            const { data: assign } = await supabaseClient
                .schema("hrd")
                .from("employee_assignments")
                .select("branch_id, costcenter_id, departemen_id, area_id, bagian_id, jabatan_id")
                .eq("employee_id", employeeData.id)
                .eq("is_active", true)
                .maybeSingle();
            assignmentData = assign;
        }

        // G. Scope Coverage Supervisor
        let allowedAreaIds = [];
        let managedZoneIds = [];

        if (!isSuperAdmin && employeeData) {
            const { data: supervisorZones } = await supabaseClient
                .from("supervisor_zones")
                .select("zona_id")
                .eq("employee_id", employeeData.id);

            if (supervisorZones && supervisorZones.length > 0) {
                managedZoneIds = supervisorZones.map(z => z.zona_id);

                const { data: areasInZones } = await supabaseClient
                    .from("areas")
                    .select("id")
                    .in("zona_id", managedZoneIds);

                if (areasInZones) {
                    allowedAreaIds = areasInZones.map(a => a.id);
                }
            }
        }

        // H. Simpan Session Login
        const userSession = {
            userId: userData.id,
            authUserUuid: authData.user.id,
            employeeId: employeeData?.id || null,
            nik: userData.username,
            fullName: employeeData?.nama || userData.username || "User ERP",
            roleId: userData.role_id,
            roleName: roleName,
            isSuperAdmin: isSuperAdmin,
            
            departmentId: assignmentData?.departemen_id || userData.dep_id || null,
            bagianId: assignmentData?.bagian_id || null,
            jabatanId: assignmentData?.jabatan_id || null,
            areaId: userData.area_id || null,
            
            managedZoneIds: managedZoneIds,
            allowedAreaIds: allowedAreaIds,
            permissions: userPermissions
        };

        if (isRememberMe) {
            localStorage.setItem("dmb_remembered_username", username);
            localStorage.setItem("erp_session", JSON.stringify(userSession));
            sessionStorage.removeItem("erp_session");
        } else {
            localStorage.removeItem("dmb_remembered_username");
            sessionStorage.setItem("erp_session", JSON.stringify(userSession));
            localStorage.removeItem("erp_session");
        }

        // I. Redirect Ke Dashboard Utama
        window.location.href = "index.html";

    } catch (err) {
        console.error("Login Error Catch:", err);
        alertBox.innerText = err.message || "Terjadi kesalahan saat mencoba masuk.";
        alertBox.classList.remove("d-none");
    } finally {
        btnText.innerText = "Masuk Ke Sistem";
        btnSpinner.classList.add("d-none");
        btnLogin.disabled = false;
    }
}

// ===================================================
// 4. FUNGSI UBAH PASSWORD VIA MODAL
// ===================================================
async function handleChangePassword() {
    const modalAlert = document.getElementById("modalAlert");
    const btnText = document.getElementById("btnChangeText");
    const btnSpinner = document.getElementById("btnChangeSpinner");
    const btnSubmit = document.getElementById("btnSubmitChangePassword");

    const username = document.getElementById("changeUsername").value.trim();
    const oldPassword = document.getElementById("oldPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmNewPassword = document.getElementById("confirmNewPassword").value;

    modalAlert.classList.add("d-none");

    if (newPassword !== confirmNewPassword) {
        modalAlert.className = "alert alert-danger small py-2";
        modalAlert.innerText = "Konfirmasi password baru tidak cocok!";
        modalAlert.classList.remove("d-none");
        return;
    }

    btnText.innerText = "Memproses...";
    btnSpinner.classList.remove("d-none");
    btnSubmit.disabled = true;

    try {
        const syntheticEmail = `${username.toLowerCase()}${SYNTHETIC_DOMAIN}`;

        const { error: authErr } = await supabaseClient.auth.signInWithPassword({
            email: syntheticEmail,
            password: oldPassword
        });

        if (authErr) throw new Error("Username atau Password lama Anda salah!");

        const { error: updateErr } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (updateErr) throw updateErr;

        modalAlert.className = "alert alert-success small py-2";
        modalAlert.innerText = "✅ Password berhasil diperbarui! Silakan login dengan password baru.";
        modalAlert.classList.remove("d-none");

        document.getElementById("formChangePassword").reset();

        setTimeout(() => {
            const modalEl = document.getElementById("modalChangePassword");
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
        }, 2000);

    } catch (err) {
        modalAlert.className = "alert alert-danger small py-2";
        modalAlert.innerText = err.message || "Gagal memperbarui password.";
        modalAlert.classList.remove("d-none");
    } finally {
        btnText.innerText = "Simpan Password";
        btnSpinner.classList.add("d-none");
        btnSubmit.disabled = false;
    }
}

// ===================================================
// 5. GUARD & LOGOUT
// ===================================================
function checkAuthGuard() {
    const sessionData = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!sessionData) {
        window.location.href = "login.html";
    }
}

async function handleLogout() {
    if (window.supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    sessionStorage.removeItem("erp_session");
    localStorage.removeItem("erp_session");
    window.location.href = "erp-dmb/login.html";
}