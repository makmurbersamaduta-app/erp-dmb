// ===================================================
// supabase/functions/sync-auth/index.ts
// Edge Function untuk sinkronisasi auth.users
// Menangani 4 aksi lewat 1 parameter "action":
//   - create          : buat akun auth baru untuk user
//   - deactivate      : nonaktifkan (ban) akun auth
//   - update_email    : ganti email auth (dipicu saat NIK berubah)
//   - reset_password  : reset password ke pola NIK+123
// ===================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Header CORS -- wajib supaya browser (dari users.js) diizinkan
// memanggil endpoint ini lewat fetch/functions.invoke
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYNTHETIC_DOMAIN = "@supabase.mail";

Deno.serve(async (req) => {
    // Preflight CORS request dari browser
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Client dengan service_role -- otomatis tersedia di setiap
        // Edge Function tanpa perlu diset manual, bisa bypass RLS
        // dan mengakses Admin API (auth.admin.*)
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const rawBody = await req.json();

        // Deteksi sumber pemanggilan: Database Webhook (otomatis) atau
        // pemanggilan manual dari UI (checklist massal di users.js).
        // Webhook Supabase mengirim { type, table, record, old_record }.
        // Pemanggilan manual mengirim { action, user_id }.
        let action: string;
        let user_id: number;

        if (rawBody.type && rawBody.record) {
            // --- Sumber: Database Webhook ---
            const record = rawBody.record;
            const oldRecord = rawBody.old_record;

            if (rawBody.type === "INSERT") {
                action = "create";
                user_id = record.id;
            } else if (rawBody.type === "UPDATE") {
                // Cuma proses sebagai update_email kalau username BENAR berubah
                // (webhook UPDATE bisa terpicu oleh perubahan kolom lain juga,
                // misal role_id berubah dari halaman Users Account -- itu
                // TIDAK perlu memicu sinkronisasi auth)
                if (oldRecord && record.username !== oldRecord.username) {
                    action = "resync";
                    user_id = record.id;
                } else {
                    // Perubahan bukan soal username -- tidak ada yang perlu
                    // disinkronkan ke auth.users, keluar tanpa aksi.
                    return jsonResponse({ success: true, message: "Tidak ada perubahan username, dilewati." });
                }
            } else {
                return jsonResponse({ success: true, message: `Event '${rawBody.type}' tidak memerlukan aksi.` });
            }
        } else {
            // --- Sumber: Pemanggilan manual dari UI ---
            action = rawBody.action;
            user_id = rawBody.user_id;
        }

                // Aksi "deactivate_bulk" pakai "user_ids" (jamak), bukan "user_id"
        // (tunggal) -- jadi validasi umum ini dilewati khusus untuk aksi itu.
        if (action !== "deactivate_bulk" && (!action || !user_id)) {
            return jsonResponse({ success: false, message: "Parameter 'action' dan 'user_id' wajib diisi." }, 400);
        }
        if (action === "deactivate_bulk" && !Array.isArray(rawBody.user_ids)) {
            return jsonResponse({ success: false, message: "Parameter 'action' dan 'user_ids' wajib diisi." }, 400);
        }

// ===================================================
        // AKSI: DEACTIVATE_BULK -- ditangani DI SINI, SEBELUM lookup
        // user tunggal di bawah -- karena bulk tidak punya "user_id"
        // tunggal, kalau tidak di-return duluan akan salah lolos ke
        // lookup single-user dan gagal "User tidak ditemukan".
        // ===================================================
        if (action === "deactivate_bulk") {
            const userIds = rawBody.user_ids;

            const { data: usersData, error: fetchError } = await supabaseAdmin
                .from("users")
                .select("id, auth_uid")
                .in("id", userIds);

            if (fetchError) {
                return jsonResponse({ success: false, message: `Gagal mengambil data users: ${fetchError.message}` }, 500);
            }

            const results = [];

            for (const userId of userIds) {
                const userRecord = usersData.find((u: any) => String(u.id) === String(userId));

                if (!userRecord) {
                    results.push({ user_id: userId, success: false, message: "User tidak ditemukan." });
                    continue;
                }
                if (!userRecord.auth_uid) {
                    results.push({ user_id: userId, success: false, message: "User belum memiliki akun auth." });
                    continue;
                }

                const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
                    userRecord.auth_uid,
                    { ban_duration: "876000h" }
                );

                if (banError) {
                    results.push({ user_id: userId, success: false, message: banError.message });
                } else {
                    results.push({ user_id: userId, success: true, message: "OK" });
                }
            }

            const successCount = results.filter(r => r.success).length;
            const failCount = results.length - successCount;

            return jsonResponse({
                success: true,
                message: `Selesai. Berhasil: ${successCount}, Gagal: ${failCount}`,
                results
            });
        }

        // Ambil data user dari public.users -- dibutuhkan di semua aksi
        // untuk tahu username (NIK) dan auth_uid saat ini
        const { data: userRow, error: userError } = await supabaseAdmin
            .from("users")
            .select("id, username, auth_uid, is_active")
            .eq("id", user_id)
            .single();

        if (userError || !userRow) {
            return jsonResponse({ success: false, message: "User tidak ditemukan di public.users." }, 404);
        }

        const syntheticEmail = `${userRow.username.toLowerCase()}${SYNTHETIC_DOMAIN}`;
        const defaultPassword = `${userRow.username}123`;

        // ===================================================
        // AKSI: CREATE -- buat akun auth baru
        // ===================================================
        if (action === "create") {
            if (userRow.auth_uid) {
                return jsonResponse({ success: false, message: "User ini sudah memiliki akun auth." }, 400);
            }

            const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                email: syntheticEmail,
                password: defaultPassword,
                email_confirm: true
            });

            if (createError) {
                return jsonResponse({ success: false, message: `Gagal membuat akun auth: ${createError.message}` }, 500);
            }

            const { error: updateError } = await supabaseAdmin
                .from("users")
                .update({ auth_uid: newAuthUser.user.id })
                .eq("id", user_id);

            if (updateError) {
                return jsonResponse({ success: false, message: `Akun auth dibuat, tapi gagal menyimpan auth_uid: ${updateError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Akun auth berhasil dibuat.", auth_uid: newAuthUser.user.id });
        }

        
        // ===================================================
        // AKSI: DEACTIVATE -- nonaktifkan akun auth (ban)
        // ===================================================
        if (action === "deactivate") {
            if (!userRow.auth_uid) {
                return jsonResponse({ success: false, message: "User ini belum memiliki akun auth." }, 400);
            }

            const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
                userRow.auth_uid,
                { ban_duration: "876000h" } // ~100 tahun, efektif permanen
            );

            if (banError) {
                return jsonResponse({ success: false, message: `Gagal menonaktifkan akun auth: ${banError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Akun auth berhasil dinonaktifkan." });
        }

        // ===================================================
        // AKSI: REACTIVATE -- aktifkan kembali akun auth yang di-ban
        // ===================================================
        if (action === "reactivate") {
            if (!userRow.auth_uid) {
                return jsonResponse({ success: false, message: "User ini belum memiliki akun auth." }, 400);
            }

            const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
                userRow.auth_uid,
                { ban_duration: "none" }
            );

            if (unbanError) {
                return jsonResponse({ success: false, message: `Gagal mengaktifkan kembali akun auth: ${unbanError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Akun auth berhasil diaktifkan kembali." });
        }

        // ===================================================
        // AKSI: UPDATE_EMAIL -- sinkronkan email auth (saat NIK berubah)
        // ===================================================
        if (action === "update_email") {
            if (!userRow.auth_uid) {
                return jsonResponse({ success: false, message: "User ini belum memiliki akun auth, tidak ada yang perlu disinkronkan." }, 400);
            }

            const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(
                userRow.auth_uid,
                { email: syntheticEmail, email_confirm: true }
            );

            if (emailError) {
                return jsonResponse({ success: false, message: `Gagal mengubah email auth: ${emailError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Email auth berhasil disinkronkan." });
        }

        // ===================================================
        // AKSI: RESET_PASSWORD -- reset password ke pola NIK+123
        // ===================================================
        if (action === "reset_password") {
            if (!userRow.auth_uid) {
                return jsonResponse({ success: false, message: "User ini belum memiliki akun auth." }, 400);
            }

            const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(
                userRow.auth_uid,
                { password: defaultPassword }
            );

            if (pwError) {
                return jsonResponse({ success: false, message: `Gagal mereset password: ${pwError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Password berhasil direset ke pola default." });
        }

        // ===================================================
        // AKSI: RESYNC -- sinkron ulang email + password auth.users
        // dengan public.users (dipicu saat NIK berubah, ditandai
        // lewat kolom auth_sync_pending = true)
        // ===================================================
        if (action === "resync") {
            if (!userRow.auth_uid) {
                return jsonResponse({ success: false, message: "User ini belum memiliki akun auth, gunakan aksi 'create' terlebih dahulu." }, 400);
            }

            const { error: resyncError } = await supabaseAdmin.auth.admin.updateUserById(
                userRow.auth_uid,
                { email: syntheticEmail, password: defaultPassword, email_confirm: true }
            );

            if (resyncError) {
                return jsonResponse({ success: false, message: `Gagal sinkron ulang akun auth: ${resyncError.message}` }, 500);
            }

            // Matikan flag -- baris ini tidak lagi butuh sinkronisasi
            const { error: flagError } = await supabaseAdmin
                .from("users")
                .update({ auth_sync_pending: false })
                .eq("id", user_id);

            if (flagError) {
                return jsonResponse({ success: false, message: `Akun auth sudah disinkron, tapi gagal mematikan flag: ${flagError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Akun auth berhasil disinkron ulang." });
        }

        return jsonResponse({ success: false, message: `Aksi '${action}' tidak dikenali.` }, 400);

    } catch (err) {
        return jsonResponse({ success: false, message: `Terjadi kesalahan tak terduga: ${err.message}` }, 500);
    }
});

function jsonResponse(body: object, status: number = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}