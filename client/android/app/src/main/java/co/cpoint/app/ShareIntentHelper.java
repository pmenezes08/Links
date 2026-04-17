package co.cpoint.app;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Persists Android share intents into app storage using the same manifest shape as iOS
 * ({@code IncomingShare/manifest.json} + {@code item_N.ext} files) so {@link ShareImportPlugin}
 * can return base64 payloads to JS.
 */
final class ShareIntentHelper {

    static final String INCOMING_SUBDIR = "IncomingShare";
    static final String IMPORTED_SUBDIR = "ImportedShare";
    private static final int MAX_ITEMS = 5;
    private static final String MANIFEST = "manifest.json";

    private static volatile boolean pendingShareNavigation = false;

    private ShareIntentHelper() {}

    static boolean hasPendingNavigation() {
        return pendingShareNavigation;
    }

    static void clearPendingNavigationFlag() {
        pendingShareNavigation = false;
    }

    static boolean saveIncomingIntent(Context ctx, @Nullable Intent intent) {
        if (intent == null) {
            return false;
        }
        String action = intent.getAction();
        if (action == null) {
            return false;
        }
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return false;
        }

        List<Uri> uris = collectUris(intent);
        StringBuilder textBlob = new StringBuilder();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (subject != null) {
            textBlob.append(subject).append(' ');
        }
        CharSequence extraText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (extraText != null) {
            textBlob.append(extraText);
        }
        List<String> textUrls = extractHttpUrls(textBlob.toString());

        if (uris.isEmpty() && textUrls.isEmpty()) {
            return false;
        }

        File incoming = new File(ctx.getFilesDir(), INCOMING_SUBDIR);
        deleteRecursive(incoming);
        if (!incoming.mkdirs()) {
            return false;
        }

        JSONArray items = new JSONArray();
        int count = 0;
        int fileIndex = 0;
        for (Uri uri : uris) {
            if (count >= MAX_ITEMS) {
                break;
            }
            try {
                String mime = resolveMime(ctx, uri);
                String ext = extensionForUri(ctx, uri, mime);
                KindMime km = classify(mime, ext);
                if (km == null) {
                    continue;
                }
                String filename = "item_" + fileIndex + "." + ext;
                fileIndex++;
                File dest = new File(incoming, filename);
                copyUriToFile(ctx, uri, dest);
                JSONObject o = new JSONObject();
                o.put("filename", filename);
                o.put("mimeType", km.mimeType);
                o.put("kind", km.kind);
                items.put(o);
                count++;
            } catch (Exception ignored) {
                // Skip unreadable items; continue with others.
            }
        }

        LinkedHashSet<String> seenUrl = new LinkedHashSet<>();
        for (String url : textUrls) {
            if (count >= MAX_ITEMS) {
                break;
            }
            if (!seenUrl.add(url)) {
                continue;
            }
            try {
                JSONObject o = new JSONObject();
                o.put("kind", "link");
                o.put("url", url);
                o.put("mimeType", "text/plain");
                o.put("filename", "");
                items.put(o);
                count++;
            } catch (Exception ignored) {
            }
        }

        if (items.length() == 0) {
            deleteRecursive(incoming);
            return false;
        }

        try {
            JSONObject manifest = new JSONObject();
            manifest.put("version", 2);
            manifest.put("items", items);
            File manifestFile = new File(incoming, MANIFEST);
            try (FileOutputStream fos = new FileOutputStream(manifestFile)) {
                fos.write(manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            pendingShareNavigation = true;
            return true;
        } catch (Exception e) {
            deleteRecursive(incoming);
            return false;
        }
    }

    private static List<String> extractHttpUrls(String text) {
        if (text == null || text.isEmpty()) {
            return Collections.emptyList();
        }
        Pattern p = Pattern.compile("https?://[^\\s<>\"]+", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(text);
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        while (m.find() && seen.size() < MAX_ITEMS) {
            String u = m.group();
            while (u.length() > 0 && ".,);]!?".indexOf(u.charAt(u.length() - 1)) >= 0) {
                u = u.substring(0, u.length() - 1);
            }
            if (u.startsWith("http://") || u.startsWith("https://")) {
                seen.add(u);
            }
        }
        return new ArrayList<>(seen);
    }

    static File importedDir(Context ctx) {
        return new File(ctx.getCacheDir(), IMPORTED_SUBDIR);
    }

    private static List<Uri> collectUris(Intent intent) {
        ArrayList<Uri> out = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null) {
                out.add(stream);
            } else if (intent.getClipData() != null) {
                for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                    Uri u = intent.getClipData().getItemAt(i).getUri();
                    if (u != null) {
                        out.add(u);
                    }
                    if (out.size() >= MAX_ITEMS) {
                        break;
                    }
                }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> extra = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (extra != null) {
                for (Uri u : extra) {
                    if (u != null) {
                        out.add(u);
                    }
                    if (out.size() >= MAX_ITEMS) {
                        break;
                    }
                }
            }
            if (out.isEmpty() && intent.getClipData() != null) {
                for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                    Uri u = intent.getClipData().getItemAt(i).getUri();
                    if (u != null) {
                        out.add(u);
                    }
                    if (out.size() >= MAX_ITEMS) {
                        break;
                    }
                }
            }
        }
        return out;
    }

    private static void copyUriToFile(Context ctx, Uri uri, File dest) throws IOException {
        try (InputStream in = ctx.getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) {
                throw new IOException("openInputStream returned null");
            }
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) {
                out.write(buf, 0, n);
            }
        }
    }

    private static String resolveMime(Context ctx, Uri uri) {
        String mime = ctx.getContentResolver().getType(uri);
        if (mime != null && !mime.isEmpty()) {
            return mime;
        }
        String ext = MimeTypeMap.getFileExtensionFromUrl(uri.toString());
        if (ext != null && !ext.isEmpty()) {
            String guess = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
            if (guess != null) {
                return guess;
            }
        }
        return "application/octet-stream";
    }

    private static String extensionForUri(Context ctx, Uri uri, String mime) {
        String name = queryDisplayName(ctx, uri);
        if (name != null && name.contains(".")) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1) {
                return name.substring(dot + 1).toLowerCase();
            }
        }
        String fromMime = guessExtensionFromMime(mime);
        if (fromMime != null) {
            return fromMime;
        }
        return "bin";
    }

    @Nullable
    private static String queryDisplayName(Context ctx, Uri uri) {
        try (Cursor c = ctx.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    return c.getString(idx);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    @Nullable
    private static String guessExtensionFromMime(String mime) {
        if (mime == null) {
            return null;
        }
        String m = mime.toLowerCase();
        if (m.startsWith("image/")) {
            if (m.contains("png")) return "png";
            if (m.contains("gif")) return "gif";
            if (m.contains("webp")) return "webp";
            if (m.contains("heic") || m.contains("heif")) return "heic";
            return "jpg";
        }
        if (m.startsWith("video/")) {
            if (m.contains("quicktime")) return "mov";
            if (m.contains("webm")) return "webm";
            return "mp4";
        }
        if (m.startsWith("audio/")) {
            if (m.contains("mpeg") && !m.contains("mp4")) return "mp3";
            if (m.contains("mp4") || m.contains("m4a")) return "m4a";
            if (m.contains("wav")) return "wav";
            if (m.contains("aac")) return "aac";
            return "m4a";
        }
        if ("application/pdf".equals(m)) {
            return "pdf";
        }
        return null;
    }

    private static class KindMime {
        final String kind;
        final String mimeType;

        KindMime(String kind, String mimeType) {
            this.kind = kind;
            this.mimeType = mimeType;
        }
    }

    /**
     * Mirrors iOS ShareExtension supported types: images, video, audio, PDF; plus common
     * file-url extensions for those families.
     */
    @Nullable
    private static KindMime classify(String mime, String extLower) {
        String e = extLower == null ? "" : extLower.toLowerCase();
        if (mime != null && mime.startsWith("image/")) {
            return new KindMime("image", mimeForFileExt(e, "image/jpeg"));
        }
        if (mime != null && mime.startsWith("video/")) {
            return new KindMime("video", mimeForFileExt(e, "video/mp4"));
        }
        if (mime != null && mime.startsWith("audio/")) {
            return new KindMime("audio", mimeForFileExt(e, "audio/mp4"));
        }
        if ("application/pdf".equals(mime) || "pdf".equals(e)) {
            return new KindMime("document", "application/pdf");
        }

        boolean isVid = inList(e, "mov", "mp4", "m4v", "avi", "mkv", "webm");
        boolean isImg = inList(e, "jpg", "jpeg", "png", "heic", "heif", "gif", "webp");
        boolean isAud = inList(e, "m4a", "mp3", "aac", "wav", "flac", "caf", "aiff", "aif", "ogg", "opus");
        boolean isPdf = "pdf".equals(e);

        if (isVid) {
            return new KindMime("video", mimeForFileExt(e, "video/mp4"));
        }
        if (isImg) {
            return new KindMime("image", mimeForFileExt(e, "image/jpeg"));
        }
        if (isAud) {
            return new KindMime("audio", mimeForFileExt(e, "audio/mp4"));
        }
        if (isPdf) {
            return new KindMime("document", "application/pdf");
        }
        return null;
    }

    private static boolean inList(String ext, String... opts) {
        for (String o : opts) {
            if (o.equals(ext)) {
                return true;
            }
        }
        return false;
    }

    private static String mimeForFileExt(String ext, String fallback) {
        switch (ext) {
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "png":
                return "image/png";
            case "heic":
            case "heif":
                return "image/heic";
            case "gif":
                return "image/gif";
            case "mp4":
            case "m4v":
                return "video/mp4";
            case "mov":
                return "video/quicktime";
            case "webm":
                return "video/webm";
            case "pdf":
                return "application/pdf";
            case "m4a":
                return "audio/mp4";
            case "mp3":
                return "audio/mpeg";
            case "aac":
                return "audio/aac";
            case "wav":
                return "audio/wav";
            case "caf":
                return "audio/x-caf";
            case "flac":
                return "audio/flac";
            case "ogg":
            case "opus":
                return "audio/ogg";
            case "aiff":
            case "aif":
                return "audio/aiff";
            default:
                return fallback;
        }
    }

    static void deleteRecursive(@Nullable File f) {
        if (f == null || !f.exists()) {
            return;
        }
        if (f.isDirectory()) {
            File[] ch = f.listFiles();
            if (ch != null) {
                for (File c : ch) {
                    deleteRecursive(c);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
