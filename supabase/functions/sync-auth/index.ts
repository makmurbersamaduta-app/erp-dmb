// ===================================================
// supabase/functions/sync-auth/index.ts
// Edge Function untuk sinkronisasi auth.users
// Menangani beberapa aksi lewat 1 parameter "action":
//   - create           : buat akun auth baru untuk user
//   - deactivate       : nonaktifkan (ban) akun auth
//   - update_email     : ganti email auth (dipicu saat NIK berubah)
//   - reset_password   : admin reset password ke pola NIK+123
//   - resync           : sinkron ulang email+password (NIK berubah)
//   - request_reset    : karyawan mengajukan reset lewat PWA (belum login)
//   - self_reset_password : karyawan set password baru sendiri (belum login)
//
// PENTING -- kolom public.users.must_change_password BUKAN LAGI boolean,
// melainkan text dengan 3 kemungkinan nilai (state machine):
//   'close'    -> normal, user bisa login seperti biasa (default)
//   'open'     -> karyawan sudah mengajukan reset, MENUNGGU admin approve
//                 (tombol Reset Password di halaman Users Account jadi aktif/merah)
//   'progress' -> admin sudah approve & reset password ke pola default,
//                 MENUNGGU karyawan membuat password baru saat login/lupa-password
// Alur: close -> (karyawan ajukan) -> open -> (admin klik reset) -> progress
//       -> (karyawan buat password baru) -> close
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
            Deno.env.get("https://gkqxzxwiawfpjtnzexvq.supabase.co") ?? "",
            Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrcXh6eHdpYXdmcGp0bnpleHZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDYzMjQzOSwiZXhwIjoyMTAwMjA4NDM5fQ.1Bso1q41baA1OfuPeFxyiWeqCzwXA9orniOdtzRrLqY") ?? ""
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
        // Aksi "request_reset" dipanggil SEBELUM karyawan login (dari form
        // "Ajukan Reset Password" di PWA) -- karyawan hanya tahu username-nya,
        // belum tahu user_id -- jadi validasi user_id juga dilewati di sini.
        if (action !== "deactivate_bulk" && action !== "request_reset" && (!action || !user_id)) {
            return jsonResponse({ success: false, message: "Parameter 'action' dan 'user_id' wajib diisi." }, 400);
        }
        if (action === "deactivate_bulk" && !Array.isArray(rawBody.user_ids)) {
            return jsonResponse({ success: false, message: "Parameter 'action' dan 'user_ids' wajib diisi." }, 400);
        }
        if (action === "request_reset" && !rawBody.username) {
            return jsonResponse({ success: false, message: "Parameter 'username' wajib diisi." }, 400);
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

        // ===================================================
        // AKSI: REQUEST_RESET -- karyawan mengajukan reset password
        // lewat form "Ajukan Reset Password" di PWA (BELUM ada Auth
        // session, karena karyawan justru sedang lupa password).
        // Ditangani via username, BUKAN user_id, dan diletakkan SEBELUM
        // lookup user-by-id di bawah -- sama seperti pola deactivate_bulk.
        //
        // Logika 3-state (lihat catatan di header file):
        //   close    -> ubah jadi 'open', beri tahu karyawan utk hubungi admin
        //   open     -> sudah pernah diajukan, jangan diajukan ulang
        //   progress -> admin sudah approve, arahkan langsung ke modal ganti password
        // ===================================================
        if (action === "request_reset") {
            const username = rawBody.username;

            const { data: reqUserRow, error: reqUserError } = await supabaseAdmin
                .from("users")
                .select("id, must_change_password")
                .ilike("username", username)
                .maybeSingle();

            if (reqUserError || !reqUserRow) {
                return jsonResponse({ success: false, message: "Username / NIK tidak ditemukan." }, 404);
            }

            // Sudah di-approve admin -- tidak perlu ajukan ulang, langsung
            // arahkan ke modal buat password baru di sisi frontend.
            if (reqUserRow.must_change_password === "progress") {
                return jsonResponse({
                    success: true,
                    status: "progress",
                    user_id: reqUserRow.id,
                    message: "Password Anda sudah di-reset Admin. Silakan buat password baru."
                });
            }

            // Sudah pernah mengajukan, masih menunggu admin -- jangan
            // ajukan ulang (mencegah spam permintaan berulang).
            if (reqUserRow.must_change_password === "open") {
                return jsonResponse({
                    success: true,
                    status: "open",
                    message: "Permintaan reset password Anda sudah diajukan sebelumnya dan sedang menunggu Admin. Silakan hubungi Admin HRD."
                });
            }

            // Status 'close' (normal) -- ini pengajuan baru, ubah ke 'open'
            // supaya tombol Reset Password di halaman Users Account (ERP)
            // menyala merah untuk baris karyawan ini.
            const { error: openError } = await supabaseAdmin
                .from("users")
                .update({ must_change_password: "open", updated_at: new Date().toISOString() })
                .eq("id", reqUserRow.id);

            if (openError) {
                return jsonResponse({ success: false, message: `Gagal mengajukan reset: ${openError.message}` }, 500);
            }

            return jsonResponse({
                success: true,
                status: "open",
                message: "Permintaan reset password berhasil diajukan. Silakan hubungi Admin HRD untuk proses lebih lanjut."
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
        // AKSI: RESET_PASSWORD -- admin approve permintaan reset,
        // password dikembalikan ke pola NIK+123.
        //
        // PERBAIKAN (sebelumnya bug): aksi ini dulu HANYA mereset
        // password Auth tanpa pernah mengubah must_change_password,
        // padahal tombol reset di ERP hanya aktif kalau kolom itu
        // sudah true/'open' -- akibatnya tidak ada jalan bagi kolom
        // ini untuk berubah sama sekali. Sekarang aksi ini WAJIB
        // set status ke 'progress', menandakan karyawan tinggal
        // membuat password baru saat login/lupa-password berikutnya.
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

            const { error: flagError } = await supabaseAdmin
                .from("users")
                .update({ must_change_password: "progress", updated_at: new Date().toISOString() })
                .eq("id", user_id);

            if (flagError) {
                return jsonResponse({ success: false, message: `Password direset, tapi gagal update status: ${flagError.message}` }, 500);
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

        // ===================================================
        // AKSI: SELF_RESET_PASSWORD -- user set password baru sendiri
        // lewat halaman Lupa Password (tanpa Auth session aktif)
        // Hanya boleh jalan kalau must_change_password = 'progress' --
        // ini pagar keamanan utama aksi ini (sebelumnya cek boolean
        // true, sekarang cek status 'progress' di state machine baru).
        // ===================================================
        if (action === "self_reset_password") {
            const newPassword = rawBody.new_password;

            if (!newPassword || newPassword.length < 6) {
                return jsonResponse({ success: false, message: "Password baru minimal 6 karakter." }, 400);
            }

            // Pagar utama: tolak kalau status BUKAN 'progress' (artinya
            // admin belum pernah approve permintaan reset user ini)
            const { data: freshUserRow, error: recheckError } = await supabaseAdmin
                .from("users")
                .select("must_change_password, auth_uid")
                .eq("id", user_id)
                .single();

            if (recheckError || !freshUserRow) {
                return jsonResponse({ success: false, message: "User tidak ditemukan." }, 404);
            }

            if (freshUserRow.must_change_password !== "progress") {
                return jsonResponse({ success: false, message: "Akun ini tidak dalam status wajib ganti password." }, 403);
            }

            if (!freshUserRow.auth_uid) {
                return jsonResponse({ success: false, message: "Akun ini belum memiliki akun auth." }, 400);
            }

            const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(
                freshUserRow.auth_uid,
                { password: newPassword }
            );

            if (pwError) {
                return jsonResponse({ success: false, message: `Gagal menyimpan password baru: ${pwError.message}` }, 500);
            }

            // Selesai -- kembalikan ke status normal 'close'
            const { error: flagError } = await supabaseAdmin
                .from("users")
                .update({ must_change_password: "close", updated_at: new Date().toISOString() })
                .eq("id", user_id);

            if (flagError) {
                return jsonResponse({ success: false, message: `Password tersimpan, tapi gagal update status: ${flagError.message}` }, 500);
            }

            return jsonResponse({ success: true, message: "Password berhasil diperbarui. Silakan login dengan password baru." });
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