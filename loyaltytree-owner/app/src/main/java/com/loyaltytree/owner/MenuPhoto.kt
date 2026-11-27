package com.loyaltytree.owner

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.Icon
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

private val photoGreen = Color(0xFF063B2F)
private val photoBorder = Color(0xFFDFE9E3)
private const val PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** Cloudinary images only; never download private external customer URLs or pass owner credentials to Cloudinary. */
private fun trustedPhotoUrl(value: String): Boolean = runCatching {
    val url = URL(value)
    url.protocol == "https" && url.host.equals("res.cloudinary.com", ignoreCase = true)
}.getOrDefault(false)

private fun bitmapFromBytes(bytes: ByteArray, maxSize: Int = 720): Bitmap? {
    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    var sample = 1
    while (opts.outWidth / sample > maxSize * 2 || opts.outHeight / sample > maxSize * 2) sample *= 2
    val actual = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, actual)
}

/** Read-only remote preview with a 3 MB transfer ceiling; does not use web sessions or attach tokens. */
@Composable
internal fun MenuRemoteThumbnail(url: String, modifier: Modifier = Modifier) {
    var bitmap by remember(url) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(url) {
        bitmap = null
        if (!trustedPhotoUrl(url)) return@LaunchedEffect
        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 9000; readTimeout = 9000
                    instanceFollowRedirects = false
                }
                try {
                    if (conn.responseCode !in 200..299) return@runCatching null
                    val bytes = conn.inputStream.use { source ->
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = source.read(buffer)
                            if (count < 0) break
                            if (output.size() + count > 3 * 1024 * 1024) return@runCatching null
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    }
                    bitmapFromBytes(bytes)
                } finally { conn.disconnect() }
            }.getOrNull()
        }
    }
    Box(modifier.background(Color(0xFFEAF2ED), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
        val loaded = bitmap
        if (loaded == null) Text("Photo", color = Color(0xFF668074), fontSize = 12.sp)
        else Image(loaded.asImageBitmap(), contentDescription = "Product photo", modifier = Modifier.matchParentSize(), contentScale = ContentScale.Crop)
    }
}

private suspend fun cloudinaryMenuUpload(session: OwnerSession, bytes: ByteArray, mime: String, brandingRole: String? = null): String =
    withContext(Dispatchers.IO) {
        if (bytes.isEmpty() || bytes.size > PHOTO_MAX_BYTES) throw IOException("Choose a photo under 5 MB.")
        if (mime !in setOf("image/jpeg", "image/png", "image/webp")) throw IOException("Use JPG, PNG, or WebP.")
        if (brandingRole != null && brandingRole !in setOf("logo", "hero", "progress_icon")) throw IOException("Unsupported artwork role.")
        val purpose = if (brandingRole == null) "order_ahead_menu" else "branding&asset_role=$brandingRole"
        val path = "/api/v1/business/${java.net.URLEncoder.encode(session.slug, "UTF-8")}/cloudinary-signature?purpose=$purpose"
        val signed = API.post(path, session.token, JSONObject())
        if (signed.first !in 200..299) throw IOException(API.message(signed.second, "Unable to authorize photo upload."))
        val sig = signed.second as? JSONObject ?: throw IOException("Invalid upload authorization.")
        val cloudName = sig.optString("cloud_name")
        if (!cloudName.matches(Regex("[A-Za-z0-9_-]{1,80}"))) throw IOException("Invalid upload host.")
        val fields = listOf("api_key", "timestamp", "signature", "upload_preset", "folder") + if (brandingRole != null) listOf("eager") else emptyList()
        if (fields.any { sig.optString(it).isBlank() }) throw IOException("Incomplete upload authorization.")
        val boundary = "lt-${UUID.randomUUID()}"
        val conn = (URL("https://api.cloudinary.com/v1_1/$cloudName/image/upload").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 25000; readTimeout = 35000
            instanceFollowRedirects = false
            setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        }
        try {
            conn.outputStream.use { output ->
                fields.forEach { field ->
                    output.write("--$boundary\r\nContent-Disposition: form-data; name=\"$field\"\r\n\r\n${sig.getString(field)}\r\n".toByteArray(Charsets.UTF_8))
                }
                val suffix = when (mime) { "image/png" -> "png"; "image/webp" -> "webp"; else -> "jpg" }
                output.write("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"menu.$suffix\"\r\nContent-Type: $mime\r\n\r\n".toByteArray(Charsets.UTF_8))
                output.write(bytes)
                output.write("\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8))
            }
            if (conn.responseCode !in 200..299) throw IOException("Photo upload failed (${conn.responseCode}).")
            val resultText = conn.inputStream.bufferedReader().use { it.readText() }
            val secureUrl = JSONObject(resultText).optString("secure_url")
            if (!trustedPhotoUrl(secureUrl)) throw IOException("Upload did not return a trusted image URL.")
            secureUrl
        } finally { conn.disconnect() }
    }

private fun imageBytes(context: Context, uri: Uri): Pair<ByteArray, String> {
    val mime = context.contentResolver.getType(uri)?.lowercase() ?: "image/jpeg"
    if (mime !in setOf("image/jpeg", "image/png", "image/webp")) throw IOException("Use JPG, PNG, or WebP.")
    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            if (out.size() + n > PHOTO_MAX_BYTES) throw IOException("Choose a photo under 5 MB.")
            out.write(buf, 0, n)
        }
        out.toByteArray()
    } ?: throw IOException("Could not read selected photo.")
    return bytes to mime
}

@Composable
internal fun MenuPhotoField(session: OwnerSession?, imageUrl: String, onBusy: (Boolean) -> Unit = {}, onImageUrl: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var uploading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    fun startUpload(bytesProvider: suspend () -> Pair<ByteArray, String>) {
        if (session == null || uploading) return
        scope.launch {
            uploading = true
            onBusy(true)
            message = "Uploading photo…"
            try {
                val (bytes, mime) = withContext(Dispatchers.IO) { bytesProvider() }
                val url = cloudinaryMenuUpload(session, bytes, mime)
                onImageUrl(url)
                message = "Photo uploaded. Save item to publish it."
            } catch (e: Exception) {
                message = e.message ?: "Photo upload failed. Try again."
            } finally { uploading = false; onBusy(false) }
        }
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) startUpload { imageBytes(context, uri) }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) startUpload {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
            out.toByteArray() to "image/jpeg"
        }
    }
    Column(
        Modifier.fillMaxWidth().border(1.dp, photoBorder, RoundedCornerShape(19.dp))
            .background(Color.White, RoundedCornerShape(19.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("PRODUCT MEDIA", color = photoGreen, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp, modifier = Modifier.weight(1f))
            if (imageUrl.isNotBlank()) {
                Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF247E5E), modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(4.dp))
                Text("Photo ready", color = Color(0xFF247E5E), fontSize = 11.sp)
            } else Text("1 photo • optional", color = Color(0xFF64776D), fontSize = 11.sp)
        }
        Text("Product photo", color = photoGreen, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        MenuRemoteThumbnail(imageUrl, Modifier.fillMaxWidth().height(214.dp))
        Text("A great product photo helps customers find your items in the QR menu.", color = Color(0xFF64776D), fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { gallery.launch("image/*") }, enabled = !uploading && session != null,
                colors = ButtonDefaults.buttonColors(containerColor = photoGreen),
                shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.PhotoLibrary, null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(5.dp))
                Text(if (imageUrl.isBlank()) "Add photo" else "Replace")
            }
            OutlinedButton(onClick = { camera.launch(null) }, enabled = !uploading && session != null,
                shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.CameraAlt, null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(5.dp))
                Text("Camera")
            }
        }
        if (imageUrl.isNotBlank()) {
            OutlinedButton(onClick = { onImageUrl(""); message = "Photo removed. Save item to confirm." }, enabled = !uploading, shape = RoundedCornerShape(12.dp)) { Text("Remove photo") }
        }
        if (uploading) Text("Uploading photo…", color = photoGreen, fontSize = 12.sp)
        if (message.isNotBlank()) Text(message, color = if (message.startsWith("Photo ") || message.startsWith("Uploading")) photoGreen else Color(0xFFAA3E36), fontSize = 12.sp)
        Text("JPG / PNG / WebP • Up to 5 MB. Camera takes a preview-size photo.", color = Color(0xFF64776D), fontSize = 11.sp)
    }
}


// LT native card artwork v5 — reuse signed uploader; gallery preserves PNG transparency.
@Composable
internal fun CardArtworkField(session: OwnerSession?, label: String, role: String, url: String, blocked: Boolean,
                              onBusy: (Boolean) -> Unit, onUrl: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val latestSession by androidx.compose.runtime.rememberUpdatedState(session)
    val latestCallback by androidx.compose.runtime.rememberUpdatedState(onUrl)
    val latestBusy by androidx.compose.runtime.rememberUpdatedState(onBusy)
    var uploading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val owner = latestSession
        if (uri != null && owner != null && !uploading && !blocked) {
            uploading = true
            latestBusy(true)
            scope.launch {
                try {
                    message = "Uploading…"
                    val (bytes, mime) = withContext(Dispatchers.IO) { imageBytes(context, uri) }
                    val uploaded = cloudinaryMenuUpload(owner, bytes, mime, role)
                    if (latestSession?.slug == owner.slug && latestSession?.token == owner.token) {
                        latestCallback(uploaded)
                        message = "Uploaded. Save card to apply."
                    }
                } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (e: Exception) { message = e.message ?: "Upload failed. Try again." }
                finally { uploading = false; latestBusy(false) }
            }
        }
    }
    Column(Modifier.fillMaxWidth().border(1.dp, photoBorder, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, color = photoGreen, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        val thumb = if (role == "hero") Modifier.fillMaxWidth().height(130.dp) else Modifier.size(88.dp)
        // WalletArtwork previews the saved draft above; thumbnail is only a convenience.
        MenuRemoteThumbnail(url, thumb)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { gallery.launch("image/*") }, enabled = !blocked && !uploading && session != null,
                colors = ButtonDefaults.buttonColors(containerColor = photoGreen), modifier = Modifier.weight(1f)) {
                Text(if (url.isBlank()) "Upload" else "Replace")
            }
            if (url.isNotBlank()) OutlinedButton(onClick = { latestCallback(""); message = "Removed. Save card to apply." }, enabled = !blocked && !uploading) { Text("Remove") }
        }
        Text("JPG / PNG / WebP · up to 5 MB", color = Color(0xFF64776D), fontSize = 11.sp)
        if (message.isNotBlank()) Text(message, color = photoGreen, fontSize = 12.sp)
    }
}
