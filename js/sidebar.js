document.addEventListener("DOMContentLoaded", async () => {
    await renderDropdownSidebar();
});

async function renderDropdownSidebar() {
    const sidebarEl = document.getElementById("dynamicSidebarMenu");
    if (!sidebarEl) return;

    // 1. Data Menu berdasarkan Acuan Side Bar Menu.pdf
    const fallbackMenus = [
        // Home
        { menu_code: 'M-HOME', menu_name: 'Home', category: 'Home', path_url: 'index.html', icon_class: 'fa-solid fa-house', sort_order: 1 },

        // Employees
        { menu_code: 'M-EMP-01', menu_name: 'Data Karyawan', category: 'Employees', path_url: 'modules/employees/directory.html', icon_class: 'fa-solid fa-address-card', sort_order: 10 },
        { menu_code: 'M-EMP-02', menu_name: 'Performa Karyawan', category: 'Employees', path_url: 'modules/employees/appraisal.html', icon_class: 'fa-solid fa-chart-line', sort_order: 11 },

        // Time
        { menu_code: 'M-TIME-01', menu_name: 'Absensi', category: 'Time', path_url: 'modules/time/attendance.html', icon_class: 'fa-solid fa-clock', sort_order: 20 },
        { menu_code: 'M-TIME-02', menu_name: 'Lembur', category: 'Time', path_url: 'modules/time/overtime.html', icon_class: 'fa-solid fa-user-clock', sort_order: 21 },
        { menu_code: 'M-TIME-03', menu_name: 'Hari Libur', category: 'Time', path_url: 'modules/time/time-off.html', icon_class: 'fa-solid fa-calendar-minus', sort_order: 22 },
        { menu_code: 'M-TIME-04', menu_name: 'Jadwal Kerja', category: 'Time', path_url: 'modules/time/schedule.html', icon_class: 'fa-solid fa-calendar-days', sort_order: 23 },
        { menu_code: 'M-TIME-05', menu_name: 'Time Settings', category: 'Time', path_url: 'modules/time/time_settings.html', icon_class: 'fa-solid fa-gears', sort_order: 24 },

        // Payroll
        { menu_code: 'M-PAY-01', menu_name: 'Komponen Payrol', category: 'Payroll', path_url: 'modules/payrol/components.html', icon_class: 'fa-solid fa-coins', sort_order: 30 },
        { menu_code: 'M-PAY-02', menu_name: 'Proses Payrol', category: 'Payroll', path_url: 'modules/payrol/processing.html', icon_class: 'fa-solid fa-calculator', sort_order: 31 },
        { menu_code: 'M-PAY-03', menu_name: 'Alokasi THR', category: 'Payroll', path_url: 'modules/payrol/thr.html', icon_class: 'fa-solid fa-gift', sort_order: 32 },
        { menu_code: 'M-PAY-04', menu_name: 'Laporan Payrol', category: 'Payroll', path_url: 'modules/payrol/reports.html', icon_class: 'fa-solid fa-file-invoice-dollar', sort_order: 33 },
        { menu_code: 'M-PAY-05', menu_name: 'Pengaturan Payrol', category: 'Payroll', path_url: 'modules/payrol/payroll_settings.html', icon_class: 'fa-solid fa-gears', sort_order: 34 },

        // Assets
        { menu_code: 'M-AST-01', menu_name: 'Stock Barang', category: 'Assets', path_url: 'modules/assets/catalog.html', icon_class: 'fa-solid fa-boxes-stacked', sort_order: 40 },
        { menu_code: 'M-AST-02', menu_name: 'Permintaan Barang', category: 'Assets', path_url: 'modules/assets/requests.html', icon_class: 'fa-solid fa-clipboard-list', sort_order: 41 },
        { menu_code: 'M-AST-03', menu_name: 'Inventaris', category: 'Assets', path_url: 'modules/assets/fixed-assets.html', icon_class: 'fa-solid fa-warehouse', sort_order: 42 },
        { menu_code: 'M-AST-04', menu_name: 'Kerusakan Barang', category: 'Assets', path_url: 'modules/assets/damages.html', icon_class: 'fa-solid fa-triangle-exclamation', sort_order: 43 },
        { menu_code: 'M-AST-05', menu_name: 'Data Barang', category: 'Assets', path_url: 'modules/assets/data-barang.html', icon_class: 'fa-solid fa-box', sort_order: 44 },

        // Finance
        { menu_code: 'M-FIN-01', menu_name: 'Invoice', category: 'Finance', path_url: 'modules/finance/invoice.html', icon_class: 'fa-solid fa-file-invoice', sort_order: 50 },
        { menu_code: 'M-FIN-02', menu_name: 'Reimburse', category: 'Finance', path_url: 'modules/finance/reimbursement.html', icon_class: 'fa-solid fa-receipt', sort_order: 51 },
        { menu_code: 'M-FIN-03', menu_name: 'Pinjaman', category: 'Finance', path_url: 'modules/finance/loan.html', icon_class: 'fa-solid fa-hand-holding-dollar', sort_order: 52 },

        // Operasional
        { menu_code: 'M-OPS-01', menu_name: 'Security', category: 'Operasional', path_url: 'modules/operations/security.html', icon_class: 'fa-solid fa-user-shield', sort_order: 60 },
        { menu_code: 'M-OPS-02', menu_name: 'Cleaning Service', category: 'Operasional', path_url: 'modules/operations/cleaning.html', icon_class: 'fa-solid fa-broom', sort_order: 61 },
        { menu_code: 'M-OPS-03', menu_name: 'Resepsionis', category: 'Operasional', path_url: 'modules/operations/receptionist.html', icon_class: 'fa-solid fa-concierge-bell', sort_order: 62 },
        { menu_code: 'M-OPS-04', menu_name: 'STG', category: 'Operasional', path_url: 'modules/operations/stg/dashboard_stg.html', icon_class: 'fa-solid fa-truck-ramp-box', sort_order: 63 },

        // Files
        { menu_code: 'M-FILES-01', menu_name: 'Dokumen & Files', category: 'Files', path_url: 'modules/company/legality.html', icon_class: 'fa-solid fa-folder-open', sort_order: 70 },

        // Settings
        { menu_code: 'M-SET-01', menu_name: 'Data Pengguna', category: 'Settings', path_url: 'modules/settings/users.html', icon_class: 'fa-solid fa-user-gear', sort_order: 90 },
        { menu_code: 'M-SET-02', menu_name: 'Master Data', category: 'Settings', path_url: 'modules/settings/master_data.html', icon_class: 'fa-solid fa-database', sort_order: 91 },
        { menu_code: 'M-SET-03', menu_name: 'Akses Maintenance', category: 'Settings', path_url: 'modules/settings/system_config.html', icon_class: 'fa-solid fa-gear', sort_order: 92 }
    ];

    let menusToRender = fallbackMenus;

    // Ambil dari Supabase jika koneksi siap
    try {
        if (typeof supabaseClient !== "undefined") {
            const { data: dbMenus, error } = await supabaseClient
                .from("app_menus")
                .select("*")
                .eq("is_active", true)
                .order("sort_order", { ascending: true });

            if (!error && dbMenus && dbMenus.length > 0) {
                menusToRender = dbMenus;
            }
        }
    } catch (err) {
        console.warn("Menggunakan fallback menu lokal:", err.message);
    }

    // Normalisasi & Hitung Relative Path Otomatis dari posisi halaman saat ini
    const currentPath = window.location.pathname.replace(/\\/g, '/');
    let prefixPath = "./";
    
    if (currentPath.includes("/modules/")) {
        prefixPath = "../../"; // Naik 2 tingkat ke root proyek
    }

    // Ikon Kategori Utama
    const categoryIcons = {
        'Home': 'fa-solid fa-house',
        'Employees': 'fa-solid fa-users',
        'Time': 'fa-solid fa-clock',
        'Payroll': 'fa-solid fa-calculator',
        'Assets': 'fa-solid fa-boxes-stacked',
        'Finance': 'fa-solid fa-wallet',
        'Operasional': 'fa-solid fa-gears',
        'Files': 'fa-solid fa-folder',
        'Settings': 'fa-solid fa-sliders'
    };

    // Grouping Menu per Kategori
    const groupedMenus = {};
    menusToRender.forEach(m => {
        const cat = m.category || "Lainnya";
        if (!groupedMenus[cat]) groupedMenus[cat] = [];
        groupedMenus[cat].push(m);
    });

    let sidebarHtml = "";
    let catIndex = 0;

    for (const [category, items] of Object.entries(groupedMenus)) {
        catIndex++;
        const collapseId = `collapse-cat-${catIndex}`;

        // Cek apakah ada sub-menu dalam kategori ini yang sedang aktif
        let isCatActive = false;
        items.forEach(m => {
            const fileNameOnly = m.path_url.split('/').pop();
            if (currentPath.endsWith(fileNameOnly)) {
                isCatActive = true;
            }
        });

        const iconClass = categoryIcons[category] || 'fa-solid fa-folder';

        // Jika hanya ada 1 item tanpa dropdown (misal Home)
        if (items.length === 1 && items[0].category === 'Home') {
            const m = items[0];
            let targetUrl = prefixPath === "../../" ? "../../index.html" : "index.html";
            const isActive = currentPath.endsWith("index.html") || currentPath.endsWith("/") ? "active" : "";

            sidebarHtml += `
                <li class="sidebar-item">
                    <a href="${targetUrl}" class="sidebar-link ${isActive}">
                        <i class="${m.icon_class} me-2"></i>
                        <span>${m.menu_name}</span>
                    </a>
                </li>`;
            continue;
        }

        // Dropdown Accordion Header
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

        // Render Sub-menu (PERBAIKAN UTAMA PERHITUNGAN PATH DI SINI)
        items.forEach(m => {
            let targetUrl = prefixPath + m.path_url; // Seluruh jalur dari root dipertahankan (misal: "../../modules/settings/system_config.html")

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