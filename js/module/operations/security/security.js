// ===================================================
// dashboard-security.js
// Halaman "Dashboard Security".
// Isi: 4 grafik (Inspeksi Area, Absensi Karyawan, Pelanggaran, Rekap Patroli).
// SEMUA DATA MASIH DUMMY. Saat data asli siap, hanya fungsi di
// KELOMPOK 3 yang perlu diganti; kelompok lain tidak perlu diubah.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file (warna, nama bulan,
// daftar area dan jenis pelanggaran contoh).
// ===================================================
const COLORS = {
    primary: "#2b6cb0",
    warning: "#d9822b",
    danger: "#d64545",
    success: "#2f9e44",
    neutral: "#a9bfd6"
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Area contoh (dummy). Nanti diganti nama area asli dari tabel areas.
const DUMMY_AREAS = ["Gerbang Utama", "Gudang Bahan Baku", "Area Produksi", "Area Parkir", "Gudang Barang Jadi", "Kantor"];
const AREA_COLORS = ["#2b6cb0", "#d9822b", "#2f9e44", "#8e5bd0", "#d64545", "#3aa6b9"];

// Jenis pelanggaran contoh (dummy)
const DUMMY_VIOLATIONS = [
    "Terlambat masuk",
    "Meninggalkan pos tanpa izin",
    "Tidak memakai atribut lengkap",
    "Tidak mengisi buku jaga",
    "Melewatkan titik patroli",
    "Tertidur saat berjaga"
];

const REKAP_TOP_N = 2;      // jumlah area yang diberi warna "paling sering" / "paling jarang"

// ===================================================
// KELOMPOK 2: FUNGSI BANTU (HELPER)
// Fungsi: pembuat angka acak yang hasilnya selalu sama untuk masukan yang
// sama ("seeded"), supaya data dummy tidak berubah-ubah tiap halaman
// dimuat ulang atau tiap pilihan bulan dibuka kembali.
// ===================================================
const $ = (id) => document.getElementById(id);

function seededRandom(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function randInt(rand, min, max) {
    return Math.floor(rand() * (max - min + 1)) + min;
}

// ===================================================
// KELOMPOK 3: DATA DUMMY
// Fungsi: satu fungsi per grafik yang mengembalikan data contoh.
// Bentuk data yang dikembalikan SAMA dengan yang nanti dipakai data asli,
// jadi saat data asli siap cukup ganti isi fungsi ini dengan query Supabase.
// ===================================================

// Grafik 1: total kunjungan tiap area, 6 bulan terakhir
function getInspeksiData() {
    const now = new Date();
    const labels = [];
    const seeds = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(`${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`);
        seeds.push(d.getFullYear() * 100 + d.getMonth());
    }
    const datasets = DUMMY_AREAS.map((area, a) => ({
        area,
        values: seeds.map(seed => randInt(seededRandom(seed * 10 + a), 15, 60))
    }));
    return { labels, datasets };
}

// Grafik 2: jumlah ijin, sakit, alpha, cuti untuk setiap tanggal di bulan terpilih
function getAbsensiData(year, month) {
    const days = new Date(year, month + 1, 0).getDate();
    const rand = seededRandom(year * 100 + month);
    const labels = [];
    const ijin = [], sakit = [], alpha = [], cuti = [];
    for (let d = 1; d <= days; d++) {
        labels.push(String(d));
        ijin.push(randInt(rand, 0, 3));
        sakit.push(randInt(rand, 0, 3));
        alpha.push(randInt(rand, 0, 2));
        cuti.push(randInt(rand, 0, 4));
    }
    return { labels, ijin, sakit, alpha, cuti };
}

// Grafik 3: total pelanggaran per jenis
function getPelanggaranData() {
    const values = [14, 9, 11, 6, 8, 3];
    return { labels: DUMMY_VIOLATIONS, values };
}

// Grafik 4: total patroli per area, diurutkan dari yang terbanyak
function getRekapPatroliData() {
    const totals = [128, 96, 84, 61, 37, 22];
    const rows = DUMMY_AREAS.map((area, i) => ({ area, total: totals[i] }));
    rows.sort((a, b) => b.total - a.total);
    return { labels: rows.map(r => r.area), values: rows.map(r => r.total) };
}

// ===================================================
// KELOMPOK 4: PENGATURAN DASAR CHART.JS
// Fungsi: font dan opsi yang sama untuk semua grafik.
// ===================================================
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;

const LEGEND_BOTTOM = { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } };

// ===================================================
// KELOMPOK 5: GRAFIK 1 - INSPEKSI AREA
// Fungsi: diagram batang bertumpuk. Sumbu bawah = bulan, tiap warna = satu area.
// Tinggi batang = total kunjungan semua area pada bulan itu.
// ===================================================
function buildInspeksiChart() {
    const data = getInspeksiData();
    new Chart($("chartInspeksi"), {
        type: "bar",
        data: {
            labels: data.labels,
            datasets: data.datasets.map((ds, i) => ({
                label: ds.area,
                data: ds.values,
                backgroundColor: AREA_COLORS[i % AREA_COLORS.length],
                maxBarThickness: 48
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: LEGEND_BOTTOM },
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

// ===================================================
// KELOMPOK 6: GRAFIK 2 - ABSENSI KARYAWAN
// Fungsi: garis dengan 4 seri (Ijin, Sakit, Alpha, Cuti), sumbu bawah =
// tanggal. Pilihan bulan (12 bulan terakhir) di pojok kartu mengganti
// data dan jumlah tanggal pada grafik yang sama.
// ===================================================
let absensiChart = null;

function buildAbsensiChart() {
    const select = $("absensiMonth");
    const now = new Date();

    // isi pilihan bulan: bulan ini dan 11 bulan sebelumnya
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const opt = document.createElement("option");
        opt.value = `${d.getFullYear()}-${d.getMonth()}`;
        opt.textContent = `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
        select.appendChild(opt);
    }

    const first = getAbsensiData(now.getFullYear(), now.getMonth());
    absensiChart = new Chart($("chartAbsensi"), {
        type: "line",
        data: {
            labels: first.labels,
            datasets: [
                { label: "Ijin",  data: first.ijin,  borderColor: COLORS.primary, backgroundColor: "rgba(43,108,176,0.1)", tension: 0.35, pointRadius: 2 },
                { label: "Sakit", data: first.sakit, borderColor: COLORS.warning, backgroundColor: "rgba(217,130,43,0.1)", tension: 0.35, pointRadius: 2 },
                { label: "Alpha", data: first.alpha, borderColor: COLORS.danger,  backgroundColor: "rgba(214,69,69,0.1)",  tension: 0.35, pointRadius: 2 },
                { label: "Cuti",  data: first.cuti,  borderColor: COLORS.success, backgroundColor: "rgba(47,158,68,0.1)",  tension: 0.35, pointRadius: 2 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: LEGEND_BOTTOM },
            scales: {
                x: { title: { display: true, text: "Tanggal" } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });

    select.addEventListener("change", () => {
        const [y, m] = select.value.split("-").map(Number);
        const d = getAbsensiData(y, m);
        absensiChart.data.labels = d.labels;
        absensiChart.data.datasets[0].data = d.ijin;
        absensiChart.data.datasets[1].data = d.sakit;
        absensiChart.data.datasets[2].data = d.alpha;
        absensiChart.data.datasets[3].data = d.cuti;
        absensiChart.update();
    });
}

// ===================================================
// KELOMPOK 7: GRAFIK 3 - PELANGGARAN
// Fungsi: diagram batang mendatar, satu batang per jenis pelanggaran
// (nama jenis panjang, jadi dibuat mendatar agar terbaca).
// ===================================================
function buildPelanggaranChart() {
    const data = getPelanggaranData();
    new Chart($("chartPelanggaran"), {
        type: "bar",
        data: {
            labels: data.labels,
            datasets: [{
                label: "Jumlah Pelanggaran",
                data: data.values,
                backgroundColor: COLORS.danger,
                borderRadius: 6,
                maxBarThickness: 26
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

// ===================================================
// KELOMPOK 8: GRAFIK 4 - REKAP PATROLI
// Fungsi: diagram batang mendatar, area diurutkan dari paling sering ke
// paling jarang dipatroli. Dua area teratas berwarna biru, dua area
// terbawah berwarna oranye, sisanya abu-biru (jumlahnya di REKAP_TOP_N).
// ===================================================
function buildRekapPatroliChart() {
    const data = getRekapPatroliData();
    const last = data.values.length - 1;
    const barColors = data.values.map((_, i) =>
        i < REKAP_TOP_N ? COLORS.primary
        : i > last - REKAP_TOP_N ? COLORS.warning
        : COLORS.neutral);

    new Chart($("chartRekapPatroli"), {
        type: "bar",
        data: {
            labels: data.labels,
            datasets: [{
                label: "Jumlah Patroli",
                data: data.values,
                backgroundColor: barColors,
                borderRadius: 6,
                maxBarThickness: 26
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

// ===================================================
// KELOMPOK 9: INISIALISASI
// Fungsi: membuat keempat grafik saat halaman selesai dimuat.
// ===================================================
document.addEventListener("DOMContentLoaded", () => {
    buildInspeksiChart();
    buildAbsensiChart();
    buildPelanggaranChart();
    buildRekapPatroliChart();
});