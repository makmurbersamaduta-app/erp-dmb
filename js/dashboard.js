// ===================================================
// INISIALISASI DATA DASHBOARD UTAMA
// ===================================================

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Jalankan Proteksi Halaman Guard
    checkAuthGuard();

    // 2. Tampilkan Info User di Header & Banner Welcome
    await setupUserProfileHeader();

    // 3. Muat Data Ringkasan Widget
    await loadDashboardStats();
});

// Helper untuk mengambil session dari localStorage maupun sessionStorage
function getErpSession() {
    const sessionData = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    return sessionData ? JSON.parse(sessionData) : null;
}

async function setupUserProfileHeader() {
    const user = getErpSession();
    if (!user) return;

    const userNameEl = document.getElementById("headerUserName");
    const userRoleEl = document.getElementById("headerUserRole");
    const welcomeNameEl = document.getElementById("welcomeName");

    let displayName = user.fullName || user.nik || "User ERP";

    // Jika displayName masih sama dengan Username/NIK, 
    // coba re-fetch nama asli dari tabel hrd.employees
    if ((displayName === user.nik || !user.fullName) && window.supabaseClient) {
        try {
            const { data: emp } = await supabaseClient
                .schema("hrd")
                .from("employees")
                .select("nama")
                .ilike("nik_karyawan", user.nik)
                .maybeSingle();

            if (emp && emp.nama) {
                displayName = emp.nama;
                
                // Update session di browser agar sinkron
                user.fullName = emp.nama;
                if (localStorage.getItem("erp_session")) {
                    localStorage.setItem("erp_session", JSON.stringify(user));
                } else {
                    sessionStorage.setItem("erp_session", JSON.stringify(user));
                }
            }
        } catch (err) {
            console.warn("Gagal mengambil nama dari hrd.employees:", err);
        }
    }

    // Set Teks ke Elemen HTML Header & Banner
    if (userNameEl) userNameEl.innerText = displayName;
    if (userRoleEl) userRoleEl.innerText = `${user.roleName || 'User'} (${user.nik})`;
    if (welcomeNameEl) welcomeNameEl.innerText = displayName;
}

async function loadDashboardStats() {
    const user = getErpSession();
    if (!user) return;

    try {
        const { count: empCount } = await supabaseClient
            .schema("hrd")
            .from("employees")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true);

        const statTotalEmp = document.getElementById("statTotalEmp");
        if (statTotalEmp) statTotalEmp.innerText = empCount || 0;

        const statAreaScope = document.getElementById("statAreaScope");
        if (statAreaScope) {
            if (user.isSuperAdmin) {
                statAreaScope.innerText = "Semua Area (Penuh)";
            } else if (user.allowedAreaIds && user.allowedAreaIds.length > 0) {
                statAreaScope.innerText = `${user.allowedAreaIds.length} Area Operasional`;
            } else {
                statAreaScope.innerText = "Terbatas (HQ)";
            }
        }

    } catch (err) {
        console.error("Gagal memuat statistik dashboard:", err);
    }
}