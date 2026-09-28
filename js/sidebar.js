// ===================================================
// js/sidebar.js
// Render sidebar dinamis Web ERP.
//
// PERUBAHAN PENTING: sidebar ini TIDAK LAGI query Supabase untuk
// ambil menu/permission. erp_session (dibuat saat login) TERNYATA
// sudah membawa array "permissions" yang sudah di-resolve penuh
// (hasil join role_permissions + app_menus dari proses login),
// lengkap dengan menu apa saja yang boleh DILIHAT role ini -- jadi
// kita tinggal baca session, bukan query ulang. Jauh lebih cepat
// (tidak ada round-trip ke DB tiap buka halaman) dan otomatis benar
// per-role karena memang dihitung ulang tiap kali user login.
//
// CATATAN KETERBATASAN: karena permission ini "dibekukan" di dalam
// session saat login, kalau Admin/Maintenance mengubah Matriks Hak
// Akses SAAT user itu sedang login, sidebar user tsb TIDAK otomatis
// berubah sampai dia logout+login lagi (session lama masih dipakai).
// Ini bukan bug, tapi konsekuensi wajar dari desain "permission
// dihitung sekali saat login" -- beri tahu user kalau perlu berlaku
// langsung, mereka harus logout dulu.
// ===================================================

document.addEventListener("DOMContentLoaded", () => {
    renderDropdownSidebar();
});

// ===================================================
// FALLBACK MENU LOKAL -- HANYA dipakai kalau erp_session tidak ada,
// rusak, atau belum punya field "permissions" (misal sesi lama dari
// SEBELUM fitur permission ini dibuat). Sengaja TIDAK difilter role
// sama sekali -- ini jaring pengaman darurat, bukan jalur normal.
// ===================================================
function getFallbackMenus() {
    return [
        { menu_code: 'M-HOME', menu_name: 'Home', category: 'Home', path_url: 'index.html', icon_class: 'fa-solid fa-house', sort_order: 1 },
        { menu_code: 'M-EMP-01', menu_name: 'Data Karyawan', category: 'Employees', path_url: 'modules/employees/directory.html', icon_class: 'fa-solid fa-address-card', sort_order: 10 },
        { menu_code: 'M-EMP-02', menu_name: 'Performa Karyawan', category: 'Employees', path_url: 'modules/employees/appraisal.html', icon_class: 'fa-solid fa-chart-line', sort_order: 11 },
        { menu_code: 'M-TIME-01', menu_name: 'Absensi', category: 'Time', path_url: 'modules/time/attendance.html', icon_class: 'fa-solid fa-clock', sort_order: 20 },
        { menu_code: 'M-TIME-02', menu_name: 'Lembur', category: 'Time', path_url: 'modules/time/overtime.html', icon_class: 'fa-solid fa-user-clock', sort_order: 21 },
        { menu_code: 'M-TIME-03', menu_name: 'Hari Libur', category: 'Time', path_url: 'modules/time/time-off.html', icon_class: 'fa-solid fa-calendar-minus', sort_order: 22 },
        { menu_code: 'M-TIME-04', menu_name: 'Jadwal Kerja', category: 'Time', path_url: 'modules/time/schedule.html', icon_class: 'fa-solid fa-calendar-days', sort_order: 23 },
        { menu_code: 'M-TIME-05', menu_name: 'Time Settings', category: 'Time', path_url: 'modules/time/time_settings.html', icon_class: 'fa-solid fa-gears', sort_order: 24 },
        { menu_code: 'M-PAY-01', menu_name: 'Komponen Payrol', category: 'Payroll', path_url: 'modules/payrol/components.html', icon_class: 'fa-solid fa-coins', sort_order: 30 },
        { menu_code: 'M-PAY-02', menu_name: 'Proses Payrol', category: 'Payroll', path_url: 'modules/payrol/processing.html', icon_class: 'fa-solid fa-calculator', sort_order: 31 },
        { menu_code: 'M-PAY-03', menu_name: 'Alokasi THR', category: 'Payroll', path_url: 'modules/payrol/thr.html', icon_class: 'fa-solid fa-gift', sort_order: 32 },
        { menu_code: 'M-PAY-04', menu_name: 'Laporan Payrol', category: 'Payroll', path_url: 'modules/payrol/reports.html', icon_class: 'fa-solid fa-file-invoice-dollar', sort_order: 33 },
        { menu_code: 'M-PAY-05', menu_name: 'Pengaturan Payrol', category: 'Payroll', path_url: 'modules/payrol/payroll_settings.html', icon_class: 'fa-solid fa-gears', sort_order: 34 },
        { menu_code: 'M-AST-01', menu_name: 'Stock Barang', category: 'Assets', path_url: 'modules/assets/catalog.html', icon_class: 'fa-solid fa-boxes-stacked', sort_order: 40 },
        { menu_code: 'M-AST-02', menu_name: 'Permintaan Barang', category: 'Assets', path_url: 'modules/assets/requests.html', icon_class: 'fa-solid fa-clipboard-list', sort_order: 41 },
        { menu_code: 'M-AST-03', menu_name: 'Inventaris', category: 'Assets', path_url: 'modules/assets/fixed-assets.html', icon_class: 'fa-solid fa-warehouse', sort_order: 42 },
        { menu_code: 'M-AST-04', menu_name: 'Kerusakan Barang', category: 'Assets', path_url: 'modules/assets/damages.html', icon_class: 'fa-solid fa-triangle-exclamation', sort_order: 43 },
        { menu_code: 'M-AST-05', menu_name: 'Data Barang', category: 'Assets', path_url: 'modules/assets/data-barang.html', icon_class: 'fa-solid fa-box', sort_order: 44 },
        { menu_code: 'M-FIN-01', menu_name: 'Invoice', category: 'Finance', path_url: 'modules/finance/invoice.html', icon_class: 'fa-solid fa-file-invoice', sort_order: 50 },
        { menu_code: 'M-FIN-02', menu_name: 'Reimburse', category: 'Finance', path_url: 'modules/finance/reimbursement.html', icon_class: 'fa-solid fa-receipt', sort_order: 51 },
        { menu_code: 'M-FIN-03', menu_name: 'Pinjaman', category: 'Finance', path_url: 'modules/finance/loan.html', icon_class: 'fa-solid fa-hand-holding-dollar', sort_order: 52 },
        { menu_code: 'M-OPS-01', menu_name: 'Security', category: 'Operasional', path_url: 'modules/operations/security.html', icon_class: 'fa-solid fa-user-shield', sort_order: 60 },
        { menu_code: 'M-OPS-02', menu_name: 'Cleaning Service', category: 'Operasional', path_url: 'modules/operations/cleaning.html', icon_class: 'fa-solid fa-broom', sort_order: 61 },
        { menu_code: 'M-OPS-03', menu_name: 'Resepsionis', category: 'Operasional', path_url: 'modules/operations/receptionist.html', icon_class: 'fa-solid fa-concierge-bell', sort_order: 62 },
        { menu_code: 'M-OPS-04', menu_name: 'STG', category: 'Operasional', path_url: 'modules/operations/stg/dashboard_stg.html', icon_class: 'fa-solid fa-truck-ramp-box', sort_order: 63 },
        { menu_code: 'M-FILES-01', menu_name: 'Dokumen & Files', category: 'Files', path_url: 'modules/company/legality.html', icon_class: 'fa-solid fa-folder-open', sort_order: 70 },
        { menu_code: 'M-SET-01', menu_name: 'Data Pengguna', category: 'Settings', path_url: 'modules/settings/users.html', icon_class: 'fa-solid fa-user-gear', sort_order: 90 },
        { menu_code: 'M-SET-02', menu_name: 'Master Data', category: 'Settings', path_url: 'modules/settings/master_data.html', icon_class: 'fa-solid fa-database', sort_order: 91 },
        { menu_code: 'M-SET-03', menu_name: 'Akses Maintenance', category: 'Settings', path_url: 'modules/settings/system_config.html', icon_class: 'fa-solid fa-gear', sort_order: 92 }
    ];
}

// Ambil array permissions dari erp_session, kalau ada & valid.
function getSessionPermissions() {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (!raw) return null;
    try {
        const session = JSON.parse(raw);
        return Array.isArray(session.permissions) ? session.permissions : null;
    } catch {
        return null;
    }
}

function renderDropdownSidebar() {
    const sidebarEl = document.getElementById("dynamicSidebarMenu");
    if (!sidebarEl) return;

    const sessionPermissions = getSessionPermissions();
    let menusToRender;

    if (sessionPermissions && sessionPermissions.length > 0) {
        // -----------------------------------------------
        // POIN 1: Sumber kebenaran menu = session.permissions,
        // BUKAN query app_menus lagi -- ini SUDAH terfilter per role
        // sejak dihitung di proses login. Kita tinggal:
        // 1. Ambil yang platform Web ERP saja (code diawali "M-"),
        //    karena session ini menyimpan permission PWA+ERP jadi satu.
        // 2. Normalisasi nama field (code->menu_code, path->path_url,
        //    dst) supaya cocok dengan logika render di bawah yang
        //    sudah ada sebelumnya.
        // -----------------------------------------------
        menusToRender = sessionPermissions
            .filter(p => p.code && p.code.startsWith("M-"))
            .map(p => ({
                menu_code: p.code,
                menu_name: p.name,
                category: p.category,
                path_url: p.path,
                icon_class: p.icon,
                sort_order: p.sort || 0
            }));
    } else {
        // Sesi tidak ada / rusak / belum punya field permissions --
        // jaring pengaman darurat, tampilkan default TANPA filter role.
        console.warn("session.permissions tidak ditemukan -- sidebar tampil dengan menu default (tanpa filter role).");
        menusToRender = getFallbackMenus();
    }

    menusToRender.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // Normalisasi & Hitung Relative Path Otomatis dari posisi halaman saat ini
    const currentPath = window.location.pathname.replace(/\\/g, '/');
    let prefixPath = "./";
    if (currentPath.includes("/modules/")) {
        prefixPath = "../../";
    }

    const categoryIcons = {
        'Employees': 'fa-solid fa-users',
        'Time': 'fa-solid fa-clock',
        'Payroll': 'fa-solid fa-calculator',
        'Assets': 'fa-solid fa-boxes-stacked',
        'Finance': 'fa-solid fa-wallet',
        'Operasional': 'fa-solid fa-gears',
        'Files': 'fa-solid fa-folder',
        'Settings': 'fa-solid fa-sliders'
    };

    let sidebarHtml = "";

    // -----------------------------------------------
    // POIN 2: Menu "HOME" -- SELALU 1 link utama, TIDAK PERNAH jadi
    // dropdown/submenu, ditangani terpisah SEBELUM proses grouping.
    // -----------------------------------------------
    const homeMenu = menusToRender.find(m => m.category === 'Home');
    const otherMenus = menusToRender.filter(m => m.category !== 'Home');

    if (homeMenu) {
        let targetUrl = prefixPath === "../../" ? "../../index.html" : "index.html";
        const isActive = currentPath.endsWith("index.html") || currentPath.endsWith("/") ? "active" : "";

        sidebarHtml += `
            <li class="sidebar-item">
                <a href="${targetUrl}" class="sidebar-link ${isActive}">
                    <i class="${homeMenu.icon_class} me-2"></i>
                    <span>${homeMenu.menu_name}</span>
                </a>
            </li>`;
    }

    // Grouping Menu per Kategori (selain Home)
    const groupedMenus = {};
    otherMenus.forEach(m => {
        const cat = m.category || "Lainnya";
        if (!groupedMenus[cat]) groupedMenus[cat] = [];
        groupedMenus[cat].push(m);
    });

    let catIndex = 0;

    for (const [category, items] of Object.entries(groupedMenus)) {
        catIndex++;
        const collapseId = `collapse-cat-${catIndex}`;

        let isCatActive = false;
        items.forEach(m => {
            const fileNameOnly = m.path_url.split('/').pop();
            if (currentPath.endsWith(fileNameOnly)) {
                isCatActive = true;
            }
        });

        const iconClass = categoryIcons[category] || 'fa-solid fa-folder';

        sidebarHtml += `
            <li class="sidebar-item nav-item-dropdown ${isCatActive ? 'active-category' : ''}">
                <a class="sidebar-link d-flex justify-content-between align-items-center ${isCatActive ? '' : 'collapsed'}" 
                   data-bs-toggle="collapse" 
                   href="#${collapseId}" 
                   role="button" 
                   aria-expanded="${isCatActive ? 'true' : 'false'}">
                    <div>
                        <i class="${iconClass} me-2"></i>
                        <span>${category}</span>
                    </div>
                    <i class="fa-solid fa-chevron-down arrow-icon ms-2" style="font-size: 0.75rem; transition: transform 0.2s;"></i>
                </a>
                <div class="collapse ${isCatActive ? 'show' : ''}" id="${collapseId}">
                    <ul class="submenu-list list-unstyled ps-3 py-1 mb-0">`;

        items.forEach(m => {
            let targetUrl = prefixPath + m.path_url;
            const fileNameOnly = m.path_url.split('/').pop();
            const isActive = currentPath.endsWith(fileNameOnly) ? "active" : "";

            sidebarHtml += `
                <li class="submenu-item my-1">
                    <a href="${targetUrl}" class="submenu-link ${isActive} d-flex align-items-center text-decoration-none small py-1 px-2 rounded">
                        <i class="${m.icon_class} me-2" style="font-size: 0.85rem;"></i>
                        <span>${m.menu_name}</span>
                    </a>
                </li>`;
        });

        sidebarHtml += `
                    </ul>
                </div>
            </li>`;
    }

    sidebarEl.innerHTML = sidebarHtml;
}