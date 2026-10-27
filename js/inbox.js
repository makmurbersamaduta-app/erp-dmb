// File: js/module/inbox.js
// Inbox ERP (desktop). Tab Persetujuan sudah aktif untuk Permintaan Barang
// (bagian 7 di bawah). Tab Notifikasi masih placeholder.

// ---------------------------------------------------
// 1. PENGATURAN HALAMAN (ubah di sini kalau nama file berbeda)
// ---------------------------------------------------
const INBOX_LOGIN_PAGE = "login.html";  // halaman login ERP (sejajar index.html)
const INBOX_HOME_PAGE  = "index.html";  // tujuan tombol kembali kalau tidak ada riwayat

// ---------------------------------------------------
// 2. SAAT HALAMAN DIBUKA
// ---------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    const sessionOk = await checkInboxSession();
    if (!sessionOk) return;

    initBackButton();
    initTabs();
    InboxApproval.init();   // BARU: tab Persetujuan (lihat bagian 7)

    // Nanti, untuk tab Notifikasi:
    // await loadNotifications();
});

// ---------------------------------------------------
// 3. CEK LOGIN (memakai sesi Supabase Auth, bukan localStorage buatan sendiri)
// ---------------------------------------------------
async function checkInboxSession() {
    try {
        const { data, error } = await window.supabaseClient.auth.getSession();
        if (data?.session) return true;

        // Offline / jaringan bermasalah: jangan keluarkan user hanya karena ini
        if (!navigator.onLine || error?.name === "AuthRetryableFetchError") return true;
    } catch (err) {
        console.error("[Inbox] Gagal mengecek sesi:", err);
        return true; // error tak terduga: jangan keluarkan user
    }

    window.location.replace(INBOX_LOGIN_PAGE);
    return false;
}

// ---------------------------------------------------
// 4. TOMBOL KEMBALI
// ---------------------------------------------------
function initBackButton() {
    document.getElementById("btnBack").addEventListener("click", () => {
        // Kalau dibuka lewat link dari halaman lain, kembali ke halaman itu.
        // Kalau dibuka langsung (tidak ada riwayat), pergi ke beranda.
        if (document.referrer && window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = INBOX_HOME_PAGE;
        }
    });
}

// ---------------------------------------------------
// 5. PINDAH TAB
// ---------------------------------------------------
function initTabs() {
    document.querySelectorAll(".inbox-tab").forEach(tab => {
        tab.addEventListener("click", () => switchInboxTab(tab.dataset.tab));
    });
}

function switchInboxTab(tabName) {
    document.querySelectorAll(".inbox-tab").forEach(t => {
        const isActive = t.dataset.tab === tabName;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    document.querySelectorAll(".inbox-panel").forEach(p => p.classList.remove("active"));
    const panelId = "panel" + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    document.getElementById(panelId).classList.add("active");

    // BARU: segarkan daftar persetujuan setiap tab dibuka
    if (tabName === "persetujuan") InboxApproval.refresh();
}

// ---------------------------------------------------
// 6. BADGE JUMLAH BELUM DIBACA (disiapkan untuk nanti)
// Contoh pemakaian: setInboxBadge("badgeNotifikasi", 3);
// ---------------------------------------------------
function setInboxBadge(badgeId, count) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle("d-none", !(count > 0));
}

// ---------------------------------------------------
// 7. PERSETUJUAN (BARU)
// Fungsi: tab Persetujuan di Inbox. Menampilkan pengajuan yang MENUNGGU
// keputusan Anda sebagai approver terdaftar, detailnya di panel kanan,
// dan tombol Disetujui / Koreksi / Tolak.
//
// Data dan keputusan lewat fungsi database (Paket A, C, D) melalui
// js/approval-common.js. Siapa yang boleh memutuskan dicek di database.
// Pengajuan yang menggantung (misalnya approver resign) dipantau
// di halaman Monitoring Persetujuan, bukan di sini.
// ---------------------------------------------------
const InboxApproval = (function () {
    "use strict";

    const UI = ApprovalUI;
    const $ = (id) => document.getElementById(id);

    const state = {
        pending: [],     // daftar pengajuan menunggu dari database
        currentId: null, // pengajuan yang sedang dibuka di panel detail
        kode: "",        // kode batch yang sedang dibuka
        action: null,    // aksi yang sedang dikonfirmasi
        busy: false      // true saat menunggu jawaban database
    };

    // --- pesan di atas daftar ---
    // kind: "error" (merah), "success" (hijau), "info" (biru)
    function setMsg(text, kind) {
        const el = $("apvMsg");
        el.textContent = text || "";
        el.className = "apv-msg apv-msg-" + (kind || "error") + (text ? "" : " d-none");
    }

    // --- panel detail kosong ---
    function showEmptyDetail() {
        state.currentId = null;
        state.action = null;
        $("detailPersetujuan").innerHTML = `
            <div class="inbox-empty">
                <i class="fa-regular fa-file-lines"></i>
                Pilih pengajuan untuk melihat detailnya.
            </div>`;
        document.querySelectorAll(".apv-item.active").forEach(i => i.classList.remove("active"));
    }

    // --- daftar ---
    async function refresh() {
        setMsg("");
        try {
            if (!(await UI.hasSession())) {
                state.pending = [];
                renderGroups();
                setMsg("Sesi login belum terhubung ke server persetujuan. Keluar lalu masuk kembali.", "error");
                return;
            }
            state.pending = (await UI.rpc("approval_inbox_list")) || [];
            renderGroups();
        } catch (err) {
            setMsg("Gagal memuat persetujuan: " + err.message, "error");
        }
    }

    function renderGroups() {
        const barang = state.pending.filter(p => p.request_type === "permintaan_barang");
        const group = document.querySelector('.apv-group[data-type="permintaan_barang"]');

        const badge = group.querySelector(".apv-count");
        badge.textContent = barang.length;
        badge.classList.toggle("d-none", barang.length === 0);
        setInboxBadge("badgePersetujuan", barang.length);

        const list = group.querySelector(".apv-list");
        if (barang.length === 0) {
            list.innerHTML = `<div class="apv-empty">Tidak ada permintaan yang menunggu persetujuan.</div>`;
            return;
        }
        list.innerHTML = barang.map(p => `
            <button type="button" class="apv-item${p.approval_id === state.currentId ? " active" : ""}"
                    data-id="${UI.esc(p.approval_id)}" data-kode="${UI.esc(p.ref_label || "")}">
                <div class="apv-item-main">
                    <div class="apv-item-title">${UI.esc(p.ref_label || "-")}</div>
                    <div class="apv-item-sub">${UI.esc(p.requester_nama || "-")} &bull; ${UI.esc(UI.formatWaktu(p.diajukan_at))}</div>
                </div>
                <i class="fa-solid fa-chevron-right apv-chevron"></i>
            </button>`).join("");
    }

    // --- detail ---
    async function openDetail(id, kode) {
        state.currentId = id;
        state.kode = kode || "";
        state.action = null;
        document.querySelectorAll(".apv-item").forEach(i => i.classList.toggle("active", i.dataset.id === id));
        $("detailPersetujuan").innerHTML = `<div class="inbox-empty">Memuat data...</div>`;

        try {
            const bundle = await UI.loadDetail(id);
            if (state.currentId !== id) return;   // sudah pindah ke pengajuan lain
            renderDetail(bundle);
        } catch (err) {
            if (state.currentId !== id) return;
            $("detailPersetujuan").innerHTML =
                `<div class="inbox-empty">Gagal memuat: ${UI.esc(err.message)}</div>`;
        }
    }

    function renderDetail({ detail: d, history }) {
        state.kode = d.kode_batch || state.kode;
        const canDecide = d.status === "Diajukan";
        $("detailPersetujuan").innerHTML = `
            <div class="apv-detail">
                <div class="apv-detail-head">
                    <div>
                        <div class="apv-detail-title">${UI.esc(d.kode_batch || "-")}</div>
                        <div class="apv-detail-sub">${UI.esc(UI.TYPE_LABEL[d.request_type] || d.request_type)}</div>
                    </div>
                    ${UI.statusBadge(d.status)}
                </div>

                ${UI.infoHtml(d)}
                ${UI.itemsTableHtml(d.items)}

                <div class="apv-section-title">Riwayat</div>
                ${UI.historyHtml(history)}

                <div class="apv-confirm d-none" id="apvConfirmBox">
                    <div class="apv-confirm-text" id="apvConfirmText"></div>
                    <div id="apvNoteWrap" class="d-none">
                        <label for="apvNote" class="form-label apv-label">Alasan <span class="text-danger">*</span></label>
                        <textarea id="apvNote" class="form-control" rows="3" maxlength="500"
                                  placeholder="Tuliskan alasan untuk pemohon..."></textarea>
                    </div>
                </div>

                <div class="apv-detail-msg d-none" id="apvDetailMsg"></div>

                ${canDecide ? `
                <div class="apv-actions" id="apvActions">
                    <button type="button" class="btn btn-outline-danger" data-apv-action="Ditolak">Tolak</button>
                    <button type="button" class="btn btn-outline-warning" data-apv-action="Koreksi">Koreksi</button>
                    <button type="button" class="btn btn-success" data-apv-action="Disetujui">Disetujui</button>
                </div>
                <div class="apv-actions d-none" id="apvActionsConfirm">
                    <button type="button" class="btn btn-outline-secondary" id="apvBack">Kembali</button>
                    <button type="button" class="btn" id="apvConfirm">Kirim</button>
                </div>` : `
                <div class="apv-detail-msg apv-detail-msg-info">Pengajuan ini sudah diputuskan (status: ${UI.esc(d.status)}).</div>`}
            </div>`;
    }

    function setDetailMsg(text) {
        const el = $("apvDetailMsg");
        if (!el) return;
        el.textContent = text || "";
        el.classList.toggle("d-none", !text);
    }

    // --- keputusan: dua langkah supaya tidak terpencet tanpa sengaja ---
    function startConfirm(action) {
        const c = UI.CONFIRM[action];
        if (!c) return;
        state.action = action;
        setDetailMsg("");
        $("apvConfirmText").textContent = c.teks;
        $("apvNoteWrap").classList.toggle("d-none", !c.alasan);
        $("apvConfirmBox").classList.remove("d-none");

        const btn = $("apvConfirm");
        btn.textContent = c.tombol;
        btn.className = "btn " + c.kelas;

        $("apvActions").classList.add("d-none");
        $("apvActionsConfirm").classList.remove("d-none");
        if (c.alasan) $("apvNote").focus();
    }

    function backToMain() {
        if (state.busy) return;
        state.action = null;
        $("apvConfirmBox").classList.add("d-none");
        $("apvActionsConfirm").classList.add("d-none");
        $("apvActions").classList.remove("d-none");
        setDetailMsg("");
    }

    function setBusy(busy) {
        state.busy = busy;
        document.querySelectorAll("#detailPersetujuan button").forEach(b => { b.disabled = busy; });
    }

    async function submit() {
        if (state.busy || !state.action || !state.currentId) return;
        const action = state.action;
        const id = state.currentId;
        const kode = state.kode;
        const note = ($("apvNote") ? $("apvNote").value : "").trim();

        if (UI.CONFIRM[action].alasan && !note) {
            setDetailMsg("Alasan wajib diisi.");
            $("apvNote").focus();
            return;
        }

        setBusy(true);
        setDetailMsg("");
        try {
            await UI.decide(id, action, note);
        } catch (err) {
            setBusy(false);
            setDetailMsg(err.message);
            // Sudah diputuskan orang lain: sembunyikan tombol dan segarkan daftar
            if (/sudah diputuskan/i.test(err.message)) {
                const a = $("apvActions"), c = $("apvActionsConfirm");
                if (a) a.classList.add("d-none");
                if (c) c.classList.add("d-none");
                refresh();
            }
            return;
        }
        setBusy(false);

        showEmptyDetail();
        setMsg(`Pengajuan ${kode} ${UI.CONFIRM[action].hasil}.`, "success");
        await refreshKeepMsg();
    }

    // Segarkan daftar tanpa menghapus pesan keberhasilan
    async function refreshKeepMsg() {
        try {
            state.pending = (await UI.rpc("approval_inbox_list")) || [];
            renderGroups();
        } catch (err) {
            setMsg("Gagal memuat persetujuan: " + err.message, "error");
        }
    }

    // --- pemasangan kejadian ---
    function init() {
        // Baris jenis: buka/tutup daftar; jenis yang belum aktif memberi pesan
        document.querySelectorAll(".apv-group").forEach(group => {
            group.querySelector(".apv-group-head").addEventListener("click", () => {
                if (group.classList.contains("is-soon")) {
                    setMsg("Belum tersedia. Menyusul setelah Permintaan Barang.", "info");
                    return;
                }
                const open = !group.classList.contains("open");
                group.classList.toggle("open", open);
                group.querySelector(".apv-list").classList.toggle("d-none", !open);
            });
        });

        // Klik satu pengajuan di daftar
        document.querySelector('.apv-group[data-type="permintaan_barang"] .apv-list')
            .addEventListener("click", (e) => {
                const item = e.target.closest(".apv-item");
                if (item) openDetail(item.dataset.id, item.dataset.kode);
            });

        // Tombol di panel detail (dibuat ulang tiap pengajuan, jadi pakai delegasi)
        $("detailPersetujuan").addEventListener("click", (e) => {
            const act = e.target.closest("[data-apv-action]");
            if (act) return startConfirm(act.dataset.apvAction);
            if (e.target.closest("#apvBack")) return backToMain();
            if (e.target.closest("#apvConfirm")) return submit();
        });

        // Muat jumlah di awal supaya lencana tab langsung terisi
        refresh();
    }

    return { init, refresh };
})();