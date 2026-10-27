// ===================================================
// js/module/settings/monitoring_persetujuan.js
// Halaman Monitoring Persetujuan (khusus Superadmin dan Maintenance).
//
// Fungsi: pendataan SEMUA pengajuan, termasuk yang "menggantung" karena
// approver terdaftar sudah nonaktif/resign atau belum ada. Dari sini
// Superadmin/Maintenance dapat memutuskan; jika bukan approver terdaftar,
// keputusan dicatat sebagai BYPASS di database.
//
// Data dan keputusan lewat fungsi database (Paket A dan D) melalui
// js/approval-common.js. Pembatasan role dicek di database.
// ===================================================

const MonitoringApproval = (function () {
    "use strict";

    const UI = ApprovalUI;
    const $ = (id) => document.getElementById(id);

    const state = {
        rows: [],        // hasil approval_monitor_list
        current: null,   // baris yang sedang dibuka di modal
        action: null,    // aksi yang sedang dikonfirmasi
        busy: false,
        modal: null      // objek Bootstrap Modal
    };

    // ---------------------------------------------------
    // 1. PESAN DI ATAS TABEL
    // kind: "danger" | "success" | "info" (kelas alert Bootstrap)
    // ---------------------------------------------------
    function setMsg(text, kind) {
        const el = $("monMsg");
        el.textContent = text || "";
        el.className = "alert alert-" + (kind || "danger") + (text ? "" : " d-none");
    }

    // ---------------------------------------------------
    // 2. DAFTAR
    // ---------------------------------------------------
    async function load() {
        setMsg("");
        $("monBody").innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Memuat data...</td></tr>`;
        try {
            if (!(await UI.hasSession())) {
                state.rows = [];
                render();
                setMsg("Sesi login tidak ditemukan. Silakan login ulang.", "danger");
                return;
            }
            state.rows = (await UI.rpc("approval_monitor_list", { p_status: $("monStatus").value })) || [];
            render();
        } catch (err) {
            state.rows = [];
            render();
            setMsg("Gagal memuat data: " + err.message, "danger");
        }
    }

    // Baris yang lolos filter jenis dan kotak pencarian (dilakukan di browser)
    function visibleRows() {
        const jenis = $("monJenis").value;
        const q = $("monCari").value.trim().toLowerCase();
        return state.rows.filter(r => {
            if (jenis && r.request_type !== jenis) return false;
            if (!q) return true;
            return [r.ref_label, r.requester_nama, r.requester_nik, r.zona_code,
                    r.departemen_nama, r.area_nama, r.approver_nama]
                .some(v => String(v || "").toLowerCase().includes(q));
        });
    }

    function approverCell(r) {
        if (r.decision_mode === "otomatis_sistem") {
            return `<span class="text-muted">Otomatis (sistem)</span>`;
        }
        if (!r.approver_nama) {
            return `<span class="badge bg-danger">Belum ada</span>`;
        }
        return `${UI.esc(r.approver_nama)}`
            + (r.approver_aktif ? "" : ` <span class="badge bg-danger">Nonaktif</span>`)
            + (r.anda_approver ? ` <span class="badge bg-primary">Anda</span>` : "");
    }

    function render() {
        const rows = visibleRows();
        $("monJumlah").textContent = state.rows.length
            ? `(${rows.length} dari ${state.rows.length}${state.rows.length >= 500 ? ", maksimal 500 terbaru" : ""})`
            : "";

        if (rows.length === 0) {
            $("monBody").innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Tidak ada pengajuan.</td></tr>`;
            return;
        }

        $("monBody").innerHTML = rows.map(r => {
            // Menunggu, tetapi approver tidak ada / nonaktif -> sorot sebagai menggantung
            const menggantung = r.status === "Diajukan" && r.decision_mode !== "otomatis_sistem"
                && (!r.approver_nama || !r.approver_aktif);
            const diputuskan = r.diputuskan_at
                ? `${UI.esc(UI.formatWaktu(r.diputuskan_at))}<span class="mon-sub">${UI.esc(r.diputuskan_oleh || "Sistem")} &middot; ${UI.esc(UI.MODE_LABEL[r.decision_mode] || "")}</span>`
                : `<span class="text-muted">-</span>`;
            return `
            <tr class="${menggantung ? "table-warning" : ""}" ${menggantung ? 'title="Menggantung: approver tidak ada atau nonaktif"' : ""}>
                <td>${UI.esc(UI.TYPE_LABEL[r.request_type] || r.request_type)}</td>
                <td class="fw-semibold">${UI.esc(r.ref_label || "-")}</td>
                <td>${UI.esc(r.requester_nama || "-")}<span class="mon-sub">${UI.esc(r.requester_nik || "")}</span></td>
                <td>${UI.esc(r.zona_code || "-")}<span class="mon-sub">${UI.esc(r.departemen_nama || "-")} &middot; ${UI.esc(r.area_nama || "-")}</span></td>
                <td>${approverCell(r)}</td>
                <td>${UI.statusBadge(r.status)}</td>
                <td>${UI.esc(UI.formatWaktu(r.diajukan_at))}</td>
                <td>${diputuskan}</td>
                <td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary" data-id="${UI.esc(r.approval_id)}">Detail</button></td>
            </tr>`;
        }).join("");
    }

    // ---------------------------------------------------
    // 3. MODAL DETAIL
    // ---------------------------------------------------
    async function openDetail(id) {
        const row = state.rows.find(r => r.approval_id === id);
        if (!row) return;
        state.current = row;
        state.action = null;
        $("monModalTitle").textContent = `${UI.TYPE_LABEL[row.request_type] || row.request_type} - ${row.ref_label || ""}`;
        $("monModalBody").innerHTML = `<div class="text-center text-muted py-4">Memuat data...</div>`;
        state.modal.show();

        try {
            const bundle = await UI.loadDetail(id);
            if (!state.current || state.current.approval_id !== id) return;
            renderDetail(bundle, row);
        } catch (err) {
            if (!state.current || state.current.approval_id !== id) return;
            $("monModalBody").innerHTML = `<div class="alert alert-danger mb-0">Gagal memuat: ${UI.esc(err.message)}</div>`;
        }
    }

    function renderDetail({ detail: d, history }, row) {
        const canDecide = d.status === "Diajukan";
        const bypassNote = canDecide && !row.anda_approver
            ? `<div class="alert alert-warning py-2 small mt-3 mb-0" id="monBypassNote">
                   Anda <strong>bukan approver terdaftar</strong> untuk pengajuan ini.
                   Keputusan Anda akan dicatat sebagai <strong>bypass</strong>.
               </div>`
            : "";

        $("monModalBody").innerHTML = `
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

            ${bypassNote}

            <div class="apv-confirm d-none" id="monConfirmBox">
                <div class="apv-confirm-text" id="monConfirmText"></div>
                <div id="monNoteWrap" class="d-none">
                    <label for="monNote" class="form-label apv-label">Alasan <span class="text-danger">*</span></label>
                    <textarea id="monNote" class="form-control" rows="3" maxlength="500"
                              placeholder="Tuliskan alasan untuk pemohon..."></textarea>
                </div>
            </div>

            <div class="alert alert-danger py-2 small mt-3 mb-0 d-none" id="monDetailMsg"></div>

            ${canDecide ? `
            <div class="d-flex justify-content-end gap-2 mt-3" id="monActions">
                <button type="button" class="btn btn-outline-danger" data-mon-action="Ditolak">Tolak</button>
                <button type="button" class="btn btn-outline-warning" data-mon-action="Koreksi">Koreksi</button>
                <button type="button" class="btn btn-success" data-mon-action="Disetujui">Disetujui</button>
            </div>
            <div class="d-flex justify-content-end gap-2 mt-3 d-none" id="monActionsConfirm">
                <button type="button" class="btn btn-outline-secondary" id="monBack">Kembali</button>
                <button type="button" class="btn" id="monConfirm">Kirim</button>
            </div>` : `
            <div class="alert alert-info py-2 small mt-3 mb-0">Pengajuan ini sudah diputuskan (status: ${UI.esc(d.status)}).</div>`}`;
    }

    function setDetailMsg(text) {
        const el = $("monDetailMsg");
        if (!el) return;
        el.textContent = text || "";
        el.classList.toggle("d-none", !text);
    }

    // ---------------------------------------------------
    // 4. KEPUTUSAN (dua langkah, sama seperti Inbox)
    // ---------------------------------------------------
    function startConfirm(action) {
        const c = UI.CONFIRM[action];
        if (!c) return;
        state.action = action;
        setDetailMsg("");

        const bypass = state.current && !state.current.anda_approver;
        $("monConfirmText").textContent = c.teks + (bypass ? " (dicatat sebagai bypass)" : "");
        $("monNoteWrap").classList.toggle("d-none", !c.alasan);
        $("monConfirmBox").classList.remove("d-none");

        const btn = $("monConfirm");
        btn.textContent = c.tombol;
        btn.className = "btn " + c.kelas;

        $("monActions").classList.add("d-none");
        $("monActionsConfirm").classList.remove("d-none");
        if (c.alasan) $("monNote").focus();
    }

    function backToMain() {
        if (state.busy) return;
        state.action = null;
        $("monConfirmBox").classList.add("d-none");
        $("monActionsConfirm").classList.add("d-none");
        $("monActions").classList.remove("d-none");
        setDetailMsg("");
    }

    function setBusy(busy) {
        state.busy = busy;
        document.querySelectorAll("#monModalBody button").forEach(b => { b.disabled = busy; });
    }

    async function submit() {
        if (state.busy || !state.action || !state.current) return;
        const action = state.action;
        const row = state.current;
        const note = ($("monNote") ? $("monNote").value : "").trim();

        if (UI.CONFIRM[action].alasan && !note) {
            setDetailMsg("Alasan wajib diisi.");
            $("monNote").focus();
            return;
        }

        setBusy(true);
        setDetailMsg("");
        try {
            await UI.decide(row.approval_id, action, note);
        } catch (err) {
            setBusy(false);
            setDetailMsg(err.message);
            if (/sudah diputuskan/i.test(err.message)) {
                const a = $("monActions"), c = $("monActionsConfirm");
                if (a) a.classList.add("d-none");
                if (c) c.classList.add("d-none");
                load();
            }
            return;
        }
        setBusy(false);

        state.modal.hide();
        state.current = null;
        await load();
        setMsg(`Pengajuan ${row.ref_label} ${UI.CONFIRM[action].hasil}.`, "success");
    }

    // ---------------------------------------------------
    // 5. PEMASANGAN KEJADIAN
    // ---------------------------------------------------
    function init() {
        state.modal = bootstrap.Modal.getOrCreateInstance($("monModal"));

        $("monStatus").addEventListener("change", load);
        $("monRefresh").addEventListener("click", load);
        $("monJenis").addEventListener("change", render);
        $("monCari").addEventListener("input", render);

        $("monBody").addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-id]");
            if (btn) openDetail(btn.dataset.id);
        });

        // Tombol di dalam modal (dibuat ulang tiap pengajuan, jadi pakai delegasi)
        $("monModalBody").addEventListener("click", (e) => {
            const act = e.target.closest("[data-mon-action]");
            if (act) return startConfirm(act.dataset.monAction);
            if (e.target.closest("#monBack")) return backToMain();
            if (e.target.closest("#monConfirm")) return submit();
        });

        // Tutup modal lewat tombol X / klik luar: lepas pengajuan yang dipilih
        $("monModal").addEventListener("hidden.bs.modal", () => {
            if (!state.busy) { state.current = null; state.action = null; }
        });

        load();
    }

    return { init, load };
})();

document.addEventListener("DOMContentLoaded", () => {
    // Pengaman login bawaan ERP (js/auth.js), sama seperti halaman lain
    if (typeof checkAuthGuard === "function") checkAuthGuard();
    MonitoringApproval.init();
});