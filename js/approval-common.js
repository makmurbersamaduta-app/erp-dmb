// File: js/approval-common.js
// Fungsi bersama untuk semua halaman persetujuan di Web ERP
// (Inbox > Persetujuan, dan Monitoring Persetujuan).
//
// Isi: panggilan ke fungsi database, format tanggal/angka, pembuat HTML
// (info, tabel barang, riwayat), dan aturan tombol keputusan.
// Tidak ada tampilan halaman di sini; halaman memanggil ApprovalUI.xxx().
//
// Muat file ini SETELAH js/supabase.js dan SEBELUM js halaman.

const ApprovalUI = (function () {
    "use strict";

    // ---------------------------------------------------
    // 1. LABEL DAN WARNA
    // ---------------------------------------------------
    const TYPE_LABEL = {
        permintaan_barang: "Permintaan Barang",
        overtime: "Overtime",
        time_off: "Time Off",
        change_shift: "Change Shift",
        attendance: "Attendance"
    };

    // Warna badge Bootstrap per status
    const STATUS_BADGE = {
        Diajukan: "bg-warning text-dark",
        Koreksi: "bg-info text-dark",
        Ditolak: "bg-danger",
        Disetujui: "bg-success"
    };

    // Siapa yang memutuskan / melakukan aksi
    const MODE_LABEL = {
        manusia: "Approver",
        otomatis_sistem: "Otomatis (sistem)",
        bypass: "Bypass",
        pemohon: "Pemohon"
    };

    // Teks konfirmasi tiap tombol keputusan.
    // alasan = true -> kolom alasan wajib diisi.
    const CONFIRM = {
        Disetujui: { teks: "Setujui pengajuan ini?", tombol: "Ya, Setujui", kelas: "btn-success", alasan: false, hasil: "disetujui" },
        Koreksi:   { teks: "Pemohon akan diminta memperbaiki pengajuan ini.", tombol: "Kirim Koreksi", kelas: "btn-warning", alasan: true, hasil: "dikembalikan untuk dikoreksi" },
        Ditolak:   { teks: "Pengajuan ini akan ditolak dan tidak bisa diubah pemohon.", tombol: "Ya, Tolak", kelas: "btn-danger", alasan: true, hasil: "ditolak" }
    };

    // ---------------------------------------------------
    // 2. FORMAT TEKS
    // ---------------------------------------------------
    const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const pad2 = (n) => String(n).padStart(2, "0");

    // Mengamankan teks sebelum dimasukkan ke HTML
    function esc(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // "2026-10-05" -> "Senin, 05 Okt 2026"
    function formatTanggal(s) {
        if (!s) return "-";
        const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
        const dt = new Date(y, (m || 1) - 1, d || 1);
        if (isNaN(dt)) return "-";
        return `${HARI[dt.getDay()]}, ${pad2(dt.getDate())} ${BULAN[dt.getMonth()]} ${dt.getFullYear()}`;
    }

    // "2026-10-05T08:30:00+00:00" -> "05 Okt 2026, 15:30" (jam sesuai perangkat)
    function formatWaktu(s) {
        if (!s) return "-";
        const dt = new Date(s);
        if (isNaN(dt)) return "-";
        return `${pad2(dt.getDate())} ${BULAN[dt.getMonth()]} ${dt.getFullYear()}, ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    }

    function formatQty(n) {
        return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n) || 0);
    }

    function statusBadge(status) {
        return `<span class="badge ${STATUS_BADGE[status] || "bg-secondary"}">${esc(status || "-")}</span>`;
    }

    // ---------------------------------------------------
    // 3. PANGGILAN KE DATABASE
    // Semua lewat fungsi database (Paket A, C, D). Siapa yang boleh melakukan
    // apa dicek di database, bukan di sini.
    // ---------------------------------------------------
    async function rpc(name, args) {
        const sb = window.supabaseClient;
        if (!sb) throw new Error("Koneksi ke server belum siap. Muat ulang halaman.");
        const { data, error } = await sb.rpc(name, args);
        if (error) throw new Error(error.message);
        return data;
    }

    // true jika browser punya sesi login Supabase Auth
    async function hasSession() {
        const sb = window.supabaseClient;
        if (!sb) return false;
        const { data } = await sb.auth.getSession();
        return !!(data && data.session);
    }

    // Isi lengkap + riwayat satu pengajuan
    async function loadDetail(id) {
        const [detail, history] = await Promise.all([
            rpc("approval_detail", { p_approval_id: id }),
            rpc("approval_history", { p_approval_id: id })
        ]);
        return { detail, history: history || [] };
    }

    // Keputusan: action = "Disetujui" | "Koreksi" | "Ditolak"
    function decide(id, action, note) {
        return rpc("approval_decide", { p_approval_id: id, p_action: action, p_note: note || null });
    }

    // ---------------------------------------------------
    // 4. PEMBUAT HTML (dipakai bersama)
    // ---------------------------------------------------
    function fotoHtml(url) {
        // Hanya alamat http/https yang ditampilkan (menghindari alamat berbahaya)
        if (!url || !/^https?:\/\//i.test(String(url))) return `<span class="text-muted">-</span>`;
        return `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="apv-thumb" src="${esc(url)}" alt="Foto barang" loading="lazy"></a>`;
    }

    // Kode batch, tanggal, periode, pemohon
    function infoHtml(d) {
        const pemohon = d.pemohon_nama
            ? `${d.pemohon_nama}${d.pemohon_nik ? " (" + d.pemohon_nik + ")" : ""}`
            : (d.pemohon_nik || "-");
        const cell = (label, value) =>
            `<div class="apv-info-cell"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
        return `<dl class="apv-info">
            ${cell("Kode Batch", d.kode_batch || "-")}
            ${cell("Tanggal", formatTanggal(d.tanggal))}
            ${cell("Periode Permintaan", d.periode_permintaan || "-")}
            ${cell("Pemohon", pemohon)}
        </dl>`;
    }

    // Tabel barang: kode, nama, qty, satuan, foto
    function itemsTableHtml(items) {
        const list = Array.isArray(items) ? items : [];
        const dash = `<span class="text-muted">-</span>`;
        const rows = list.length === 0
            ? `<tr><td colspan="5" class="text-center text-muted">Tidak ada barang.</td></tr>`
            : list.map(it => `
                <tr>
                    <td>${esc(it.kode_barang)}</td>
                    <td>${it.nama_barang ? esc(it.nama_barang) : dash}</td>
                    <td class="text-end">${esc(formatQty(it.qty))}</td>
                    <td>${it.satuan ? esc(it.satuan) : dash}</td>
                    <td>${fotoHtml(it.photo_path)}</td>
                </tr>`).join("");
        return `<div class="table-responsive">
            <table class="table table-sm table-bordered align-middle apv-table mb-0">
                <thead class="table-light">
                    <tr><th>Kode Barang</th><th>Nama Barang</th><th class="text-end">Qty</th><th>Satuan</th><th>Foto Barang</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    // Riwayat aksi (diajukan, diubah, koreksi, setuju, tolak)
    function historyHtml(rows) {
        const list = Array.isArray(rows) ? rows : [];
        if (list.length === 0) return `<div class="text-muted small">Belum ada riwayat.</div>`;
        return `<ul class="apv-history">${list.map(h => `
            <li>
                <span class="fw-semibold">${esc(h.action)}</span>
                <span class="text-muted"> &middot; ${esc(h.actor_nama || "Sistem")}${h.actor_role ? " (" + esc(h.actor_role) + ")" : ""}
                &middot; ${esc(MODE_LABEL[h.decision_mode] || h.decision_mode || "")}
                &middot; ${esc(formatWaktu(h.created_at))}</span>
                ${h.note ? `<div class="apv-history-note">Alasan: ${esc(h.note)}</div>` : ""}
            </li>`).join("")}</ul>`;
    }

    return {
        TYPE_LABEL, STATUS_BADGE, MODE_LABEL, CONFIRM,
        esc, formatTanggal, formatWaktu, formatQty, statusBadge,
        rpc, hasSession, loadDetail, decide,
        fotoHtml, infoHtml, itemsTableHtml, historyHtml
    };
})();