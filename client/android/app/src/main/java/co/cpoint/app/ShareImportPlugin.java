package co.cpoint.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/**
 * Android counterpart to iOS {@code ShareImportPlugin}: reads {@code IncomingShare/manifest.json},
 * returns each file as base64 for JS (avoids WebView file URL issues), and clears on
 * {@link #clearPending}.
 */
@CapacitorPlugin(name = "ShareImport")
public class ShareImportPlugin extends Plugin {

    @PluginMethod
    public void getPending(PluginCall call) {
        File base = getContext().getFilesDir();
        File incoming = new File(base, ShareIntentHelper.INCOMING_SUBDIR);
        File manifestFile = new File(incoming, "manifest.json");
        if (!manifestFile.exists()) {
            JSObject empty = new JSObject();
            empty.put("items", new JSONArray());
            call.resolve(empty);
            return;
        }

        try {
            byte[] raw = readAllBytes(manifestFile);
            JSONObject root = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            JSONArray rawItems = root.optJSONArray("items");
            if (rawItems == null) {
                JSObject empty = new JSObject();
                empty.put("items", new JSONArray());
                call.resolve(empty);
                return;
            }

            ShareIntentHelper.deleteRecursive(ShareIntentHelper.importedDir(getContext()));
            File imported = ShareIntentHelper.importedDir(getContext());
            if (!imported.mkdirs() && !imported.isDirectory()) {
                call.reject("Could not prepare imported share files.");
                return;
            }

            JSONArray out = new JSONArray();
            for (int i = 0; i < rawItems.length(); i++) {
                JSONObject item = rawItems.optJSONObject(i);
                if (item == null) {
                    continue;
                }
                String name = item.optString("filename", "");
                if (name.isEmpty()) {
                    continue;
                }
                String mime = item.optString("mimeType", "application/octet-stream");
                String kind = item.optString("kind", "file");
                File source = new File(incoming, name);
                if (!source.exists()) {
                    continue;
                }
                File dest = new File(imported, name);
                try {
                    copyFile(source, dest);
                    byte[] fileData = readAllBytes(dest);
                    String dataBase64 = Base64.encodeToString(fileData, Base64.NO_WRAP);
                    JSONObject row = new JSONObject();
                    row.put("filename", name);
                    row.put("mimeType", mime);
                    row.put("kind", kind);
                    row.put("dataBase64", dataBase64);
                    out.put(row);
                } catch (Exception e) {
                    // Skip unreadable entries (matches iOS logging + continue behavior).
                }
            }

            JSObject ret = new JSObject();
            ret.put("items", out);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read share manifest.", e);
        }
    }

    @PluginMethod
    public void clearPending(PluginCall call) {
        File incoming = new File(getContext().getFilesDir(), ShareIntentHelper.INCOMING_SUBDIR);
        ShareIntentHelper.deleteRecursive(incoming);
        ShareIntentHelper.deleteRecursive(ShareIntentHelper.importedDir(getContext()));
        call.resolve();
    }

    private static byte[] readAllBytes(File f) throws java.io.IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            long len = f.length();
            if (len > Integer.MAX_VALUE) {
                throw new java.io.IOException("File too large");
            }
            int size = (int) len;
            byte[] buf = new byte[size];
            int off = 0;
            while (off < size) {
                int n = in.read(buf, off, size - off);
                if (n < 0) {
                    break;
                }
                off += n;
            }
            if (off != size) {
                byte[] trimmed = new byte[off];
                System.arraycopy(buf, 0, trimmed, 0, off);
                return trimmed;
            }
            return buf;
        }
    }

    private static void copyFile(File src, File dst) throws java.io.IOException {
        try (FileInputStream in = new FileInputStream(src);
             java.io.FileOutputStream out = new java.io.FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) {
                out.write(buf, 0, n);
            }
        }
    }
}
