package net.biohazards.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Full-screen tablet app for Biohazards field operations and the 3-panel
 * Cursor-style Agent Workspace.
 *
 * Cloud PDF/signing generation stays on the server and is blocked here.
 * Native tablet capabilities (en-AU SpeechRecognizer + TTS, rapid multi-shot
 * compressed photo capture, non-blocking offline banner, Light/Dark system bar
 * sync, Keep Screen On, and haptic feedback) are bridged into the WebView via
 * window.BiohazardsNative.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var pasteBar: LinearLayout
    private lateinit var offline: LinearLayout
    private lateinit var offlineBanner: LinearLayout
    private lateinit var photoBatchBar: LinearLayout
    private lateinit var photoBatchLabel: TextView
    private lateinit var photoBatchDone: Button

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingChooser: WebChromeClient.FileChooserParams? = null
    private var pendingShotFile: File? = null
    private var pendingShotUri: Uri? = null
    private val batchPhotoUris = mutableListOf<Uri>()
    private var batchAllowMultiple: Boolean = false

    private var geoOrigin: String? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var permissionRequest: PermissionRequest? = null
    private var lastGoodUrl: String = START_URL
    private var hasLoadedPage: Boolean = false

    @Volatile
    private var isNetworkAvailable: Boolean = true

    @Volatile
    private var keepScreenOnEnabled: Boolean = false

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private var speechRecognizer: SpeechRecognizer? = null
    private var pendingVoiceLang: String? = null
    private var tts: TextToSpeech? = null
    private var ttsReady: Boolean = false

    private val imageExecutor = Executors.newSingleThreadExecutor()

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val params = pendingChooser
        pendingChooser = null
        if (params != null) showFileSourcePicker(params, granted)
    }

    private val audioPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val lang = pendingVoiceLang
        pendingVoiceLang = null
        if (granted && lang != null) {
            beginSpeechRecognition(lang)
        } else if (lang != null) {
            emitVoiceEvent("error", error = "Microphone permission denied")
        }
    }

    private val locationPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val allowed = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        geoCallback?.invoke(geoOrigin, allowed, false)
        geoCallback = null
        geoOrigin = null
    }

    private val mediaPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val request = permissionRequest
        permissionRequest = null
        if (request == null) return@registerForActivityResult
        val grantedResources = mutableListOf<String>()
        if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            grants[Manifest.permission.CAMERA] == true
        ) {
            grantedResources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        }
        if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            grants[Manifest.permission.RECORD_AUDIO] == true
        ) {
            grantedResources.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        }
        if (grantedResources.isNotEmpty()) request.grant(grantedResources.toTypedArray())
        else request.deny()
    }

    private val galleryChooser = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = fileCallback
        fileCallback = null
        if (callback == null) return@registerForActivityResult
        if (result.resultCode != RESULT_OK) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }
        val uris = extractResultUris(result.data)
        callback.onReceiveValue(if (uris.isNotEmpty()) uris else null)
    }

    private val takePicture = registerForActivityResult(
        ActivityResultContracts.TakePicture(),
    ) { saved ->
        val file = pendingShotFile
        val uri = pendingShotUri
        pendingShotFile = null
        pendingShotUri = null

        if (!saved || file == null || uri == null || !file.exists() || file.length() == 0L) {
            if (batchPhotoUris.isEmpty()) {
                cancelPhotoBatch()
            } else {
                updatePhotoBatchBar()
            }
            return@registerForActivityResult
        }

        imageExecutor.execute {
            downscalePhotoInPlace(file)
            runOnUiThread {
                batchPhotoUris.add(uri)
                performHaptic("light")
                if (!batchAllowMultiple) {
                    finishPhotoBatch()
                } else {
                    updatePhotoBatchBar()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        progress = findViewById(R.id.progress)
        pasteBar = findViewById(R.id.paste_bar)
        offline = findViewById(R.id.offline)
        offlineBanner = findViewById(R.id.offline_banner)
        photoBatchBar = findViewById(R.id.photo_batch_bar)
        photoBatchLabel = findViewById(R.id.photo_batch_label)
        photoBatchDone = findViewById(R.id.photo_batch_done)

        findViewById<Button>(R.id.paste_link).setOnClickListener { showPasteDialog() }
        findViewById<Button>(R.id.retry).setOnClickListener {
            offline.visibility = View.GONE
            web.visibility = View.VISIBLE
            web.loadUrl(lastGoodUrl)
        }
        findViewById<Button>(R.id.offline_banner_retry).setOnClickListener {
            offlineBanner.visibility = View.GONE
            web.reload()
        }
        findViewById<Button>(R.id.photo_batch_another).setOnClickListener { launchCameraShot() }
        photoBatchDone.setOnClickListener { finishPhotoBatch() }
        findViewById<Button>(R.id.photo_batch_cancel).setOnClickListener { cancelPhotoBatch() }

        setupTts()
        setupConnectivityMonitor()
        setupWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (photoBatchBar.visibility == View.VISIBLE) {
                    cancelPhotoBatch()
                    return
                }
                if (offline.visibility == View.VISIBLE) {
                    offline.visibility = View.GONE
                    web.visibility = View.VISIBLE
                    return
                }
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        val incoming = signInLink(intent?.data)
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else if (incoming != null) {
            web.loadUrl(incoming.toString())
        } else {
            web.loadUrl(START_URL)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val link = signInLink(intent.data) ?: return
        offline.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(link.toString())
    }

    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        unregisterConnectivityMonitor()
        speechRecognizer?.destroy()
        speechRecognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
        imageExecutor.shutdown()
        super.onDestroy()
    }

    private fun setupTts() {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val res = tts?.setLanguage(Locale("en", "AU"))
                ttsReady = res != TextToSpeech.LANG_MISSING_DATA && res != TextToSpeech.LANG_NOT_SUPPORTED
            }
        }
    }

    private fun setupConnectivityMonitor() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        connectivityManager = cm
        isNetworkAvailable = checkActiveNetwork(cm)

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                isNetworkAvailable = true
                runOnUiThread {
                    offlineBanner.visibility = View.GONE
                    notifyWebConnectivity()
                }
            }

            override fun onLost(network: Network) {
                val stillOnline = checkActiveNetwork(cm)
                isNetworkAvailable = stillOnline
                runOnUiThread {
                    if (!stillOnline && hasLoadedPage) {
                        offlineBanner.visibility = View.VISIBLE
                    }
                    notifyWebConnectivity()
                }
            }
        }
        networkCallback = callback
        runCatching { cm.registerDefaultNetworkCallback(callback) }
    }

    private fun unregisterConnectivityMonitor() {
        val cm = connectivityManager
        val cb = networkCallback
        if (cm != null && cb != null) {
            runCatching { cm.unregisterNetworkCallback(cb) }
        }
        networkCallback = null
    }

    private fun checkActiveNetwork(cm: ConnectivityManager): Boolean {
        val active = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun notifyWebConnectivity() {
        if (!::web.isInitialized) return
        web.evaluateJavascript(
            "window.dispatchEvent(new Event('bh-native-connectivity'));",
            null,
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
            setGeolocationEnabled(true)
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString $APP_USER_AGENT"
        }

        web.addJavascriptInterface(NativeBridge(), "BiohazardsNative")

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, DOCUMENT_SCRIPT, APP_ORIGINS)
        }

        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, _, _, _ ->
            if (isCloudDocument(Uri.parse(url).path)) showCloudMessage()
            else openExternal(Uri.parse(url))
        }
    }

    private fun applySystemBarTheme(mode: String) {
        val isLight = mode == "light"
        // Keep status bar dark-slate (#020617) to blend seamlessly with RankPulse top chrome.
        window.statusBarColor = ContextCompat.getColor(this, R.color.bg)
        window.navigationBarColor = ContextCompat.getColor(
            this,
            if (isLight) R.color.bg_light else R.color.bg,
        )
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = isLight
    }

    private fun performHaptic(kind: String) {
        val flag = when (kind) {
            "confirm" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP
            "warning" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            else -> HapticFeedbackConstants.CLOCK_TICK
        }
        web.performHapticFeedback(flag)
    }

    private fun beginSpeechRecognition(lang: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emitVoiceEvent("error", error = "Speech recognition unavailable")
            return
        }
        speechRecognizer?.destroy()
        val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
        speechRecognizer = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                emitVoiceEvent("start")
            }

            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                // Final results arrive via onResults shortly after onEndOfSpeech.
            }

            override fun onError(error: Int) {
                emitVoiceEvent("error", error = "voice_error_$error")
            }

            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull().orEmpty()
                if (text.isNotBlank()) emitVoiceEvent("final", text = text)
                else emitVoiceEvent("end")
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull().orEmpty()
                if (text.isNotBlank()) emitVoiceEvent("partial", text = text)
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang.ifBlank { "en-AU" })
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        recognizer.startListening(intent)
    }

    private fun emitVoiceEvent(type: String, text: String? = null, error: String? = null) {
        val payload = JSONObject().apply {
            put("type", type)
            if (text != null) put("text", text)
            if (error != null) put("error", error)
        }.toString()
        runOnUiThread {
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('bh-native-voice',{detail:$payload}));",
                null,
            )
        }
    }

    private inner class NativeBridge {
        @JavascriptInterface
        fun setTheme(mode: String?) {
            val clean = if (mode == "light") "light" else "dark"
            runOnUiThread { applySystemBarTheme(clean) }
        }

        @JavascriptInterface
        fun setKeepScreenOn(enabled: Boolean) {
            keepScreenOnEnabled = enabled
            runOnUiThread {
                if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        @JavascriptInterface
        fun isKeepScreenOn(): Boolean = keepScreenOnEnabled

        @JavascriptInterface
        fun haptic(kind: String?) {
            val clean = kind.orEmpty()
            runOnUiThread { performHaptic(clean) }
        }

        @JavascriptInterface
        fun hasVoice(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)

        @JavascriptInterface
        fun startVoice(lang: String?) {
            val targetLang = lang?.takeIf { it.isNotBlank() } ?: "en-AU"
            runOnUiThread {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    beginSpeechRecognition(targetLang)
                } else {
                    pendingVoiceLang = targetLang
                    audioPermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }

        @JavascriptInterface
        fun stopVoice() {
            runOnUiThread {
                speechRecognizer?.stopListening()
            }
        }

        @JavascriptInterface
        fun speak(text: String?) {
            val clean = text?.trim().orEmpty()
            if (clean.isEmpty()) return
            runOnUiThread {
                if (ttsReady) {
                    tts?.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "bh_reply_${System.currentTimeMillis()}")
                }
            }
        }

        @JavascriptInterface
        fun stopSpeaking() {
            runOnUiThread { tts?.stop() }
        }

        @JavascriptInterface
        fun isOnline(): Boolean = isNetworkAvailable

        @JavascriptInterface
        fun openEmailCompose(to: String?, subject: String?, body: String?): Boolean {
            val recipient = to?.trim().orEmpty()
            val subj = subject?.trim().orEmpty()
            val text = body.orEmpty()
            runOnUiThread { launchEmailCompose(recipient, subj, text) }
            return true
        }

        @JavascriptInterface
        fun openSmsCompose(to: String?, body: String?): Boolean {
            val recipient = to?.trim().orEmpty()
            val text = body.orEmpty()
            runOnUiThread { launchSmsCompose(recipient, text) }
            return true
        }

        @JavascriptInterface
        fun shareText(subject: String?, body: String?): Boolean {
            val subj = subject?.trim().orEmpty()
            val text = body.orEmpty()
            if (text.isBlank()) return false
            runOnUiThread { launchShareSheet(subj, text) }
            return true
        }

        @JavascriptInterface
        fun clearCacheAndReload() {
            runOnUiThread {
                web.clearCache(true)
                web.reload()
            }
        }
    }

    private fun launchEmailCompose(to: String, subject: String, body: String) {
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:")
            if (to.isNotBlank()) putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            if (subject.isNotBlank()) putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        // Prefer Gmail directly on the tablet if installed, otherwise fall back to any mail app.
        val gmailIntent = Intent(intent).setPackage("com.google.android.gm")
        if (gmailIntent.resolveActivity(packageManager) != null) {
            try {
                startActivity(gmailIntent)
                return
            } catch (_: Exception) {
                // Fall through to generic mail chooser.
            }
        }
        try {
            startActivity(Intent.createChooser(intent, "Send email"))
        } catch (_: Exception) {
            launchShareSheet(subject, body)
        }
    }

    private fun launchSmsCompose(to: String, body: String) {
        val smsIntent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(to)}")).apply {
            putExtra("sms_body", body)
        }
        try {
            startActivity(smsIntent)
        } catch (_: Exception) {
            launchShareSheet("", body)
        }
    }

    private fun launchShareSheet(subject: String, body: String) {
        val share = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            if (subject.isNotBlank()) putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        try {
            startActivity(Intent.createChooser(share, "Share message"))
        } catch (_: Exception) {
            // No share target available on device.
        }
    }

    private fun showPasteDialog() {
        val input = EditText(this).apply {
            hint = "https://app.biohazards.net/login/…"
            setTextIsSelectable(true)
            minHeight = (56 * resources.displayMetrics.density).toInt()
            val pad = (12 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.paste_title)
            .setMessage(R.string.paste_message)
            .setView(input)
            .setPositiveButton(R.string.paste_open) { _, _ ->
                val link = signInLink(Uri.parse(input.text?.toString()?.trim().orEmpty()))
                if (link == null) {
                    AlertDialog.Builder(this)
                        .setMessage(R.string.paste_invalid)
                        .setPositiveButton(android.R.string.ok, null)
                        .show()
                } else {
                    web.loadUrl(link.toString())
                }
            }
            .setNegativeButton(R.string.paste_cancel, null)
            .show()
    }

    private fun showCloudMessage() {
        if (isFinishing) return
        AlertDialog.Builder(this)
            .setMessage(R.string.cloud_documents)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            // No handler for this link on the tablet.
        }
    }

    private fun syncPasteBar(url: String?) {
        val path = runCatching { Uri.parse(url).path }.getOrNull().orEmpty()
        pasteBar.visibility = if (path == "/login" || path == "/login/") View.VISIBLE else View.GONE
    }

    private fun showFileSourcePicker(params: WebChromeClient.FileChooserParams, cameraAllowed: Boolean) {
        val accept = params.acceptTypes.firstOrNull { it.isNotBlank() } ?: "image/*"
        val wantsImage = accept == "*/*" || accept.startsWith("image")
        val allowMultiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE

        if (!wantsImage || !cameraAllowed || !hasCameraHandler()) {
            launchGalleryPicker(accept, allowMultiple)
            return
        }

        val cameraLabel = getString(
            if (allowMultiple) R.string.photo_source_rapid_camera else R.string.photo_source_camera,
        )
        val items = arrayOf(cameraLabel, getString(R.string.photo_source_gallery))

        AlertDialog.Builder(this)
            .setTitle(R.string.photo_source_title)
            .setItems(items) { _, which ->
                if (which == 0) {
                    batchPhotoUris.clear()
                    batchAllowMultiple = allowMultiple
                    launchCameraShot()
                } else {
                    launchGalleryPicker(accept, allowMultiple)
                }
            }
            .setOnCancelListener { cancelPhotoBatch() }
            .show()
    }

    private fun hasCameraHandler(): Boolean {
        val probe = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
        return packageManager.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY).isNotEmpty()
    }

    private fun launchCameraShot() {
        val (file, uri) = newCameraFileAndUri()
        pendingShotFile = file
        pendingShotUri = uri
        try {
            takePicture.launch(uri)
        } catch (_: Exception) {
            if (batchPhotoUris.isEmpty()) cancelPhotoBatch() else updatePhotoBatchBar()
        }
    }

    private fun updatePhotoBatchBar() {
        val count = batchPhotoUris.size
        if (count == 0) {
            photoBatchBar.visibility = View.GONE
            return
        }
        photoBatchLabel.text = if (count == 1) {
            getString(R.string.photo_batch_count_one)
        } else {
            getString(R.string.photo_batch_count_many, count)
        }
        photoBatchDone.text = getString(R.string.photo_batch_done, count)
        photoBatchBar.visibility = View.VISIBLE
    }

    private fun finishPhotoBatch() {
        photoBatchBar.visibility = View.GONE
        val uris = batchPhotoUris.toTypedArray()
        batchPhotoUris.clear()
        val cb = fileCallback
        fileCallback = null
        performHaptic("confirm")
        cb?.onReceiveValue(if (uris.isNotEmpty()) uris else null)
    }

    private fun cancelPhotoBatch() {
        photoBatchBar.visibility = View.GONE
        batchPhotoUris.clear()
        val cb = fileCallback
        fileCallback = null
        cb?.onReceiveValue(null)
    }

    private fun launchGalleryPicker(accept: String, allowMultiple: Boolean) {
        val content = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (accept == "*/*" || accept.isBlank()) "image/*" else accept
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
        }
        try {
            galleryChooser.launch(Intent.createChooser(content, getString(R.string.add_photo)))
        } catch (_: Exception) {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
        }
    }

    private fun extractResultUris(data: Intent?): Array<Uri> {
        if (data == null) return emptyArray()
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) {
            return Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
        }
        val single = data.data
        return if (single != null) arrayOf(single) else emptyArray()
    }

    private fun newCameraFileAndUri(): Pair<File, Uri> {
        val dir = File(cacheDir, "camera").apply { mkdirs() }
        val file = File(dir, "capture-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        return file to uri
    }

    /** Downscales oversized tablet camera JPEGs to ~1920px / 85% while preserving EXIF rotation. */
    private fun downscalePhotoInPlace(file: File) {
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            val maxDim = maxOf(bounds.outWidth, bounds.outHeight)
            if (maxDim <= 0) return

            val exif = ExifInterface(file.absolutePath)
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
            val rotation = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
            if (maxDim <= MAX_PHOTO_DIMENSION && rotation == 0f) return

            var sample = 1
            while (maxDim / (sample * 2) >= MAX_PHOTO_DIMENSION) {
                sample *= 2
            }
            val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
            val raw = BitmapFactory.decodeFile(file.absolutePath, decodeOpts) ?: return
            val scale = if (maxOf(raw.width, raw.height) > MAX_PHOTO_DIMENSION) {
                MAX_PHOTO_DIMENSION.toFloat() / maxOf(raw.width, raw.height).toFloat()
            } else {
                1f
            }
            val matrix = Matrix().apply {
                if (scale < 1f) postScale(scale, scale)
                if (rotation != 0f) postRotate(rotation)
            }
            val processed = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
            if (processed !== raw) raw.recycle()
            FileOutputStream(file).use { out ->
                processed.compress(Bitmap.CompressFormat.JPEG, PHOTO_JPEG_QUALITY, out)
            }
            processed.recycle()
        }
    }

    private inner class Client : WebViewClient() {
        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                view?.evaluateJavascript(DOCUMENT_SCRIPT, null)
            }
            progress.visibility = View.VISIBLE
            offline.visibility = View.GONE
            web.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            progress.visibility = View.GONE
            if (url != null && !url.startsWith("data:")) {
                lastGoodUrl = url
                hasLoadedPage = true
            }
            if (isNetworkAvailable) offlineBanner.visibility = View.GONE
            syncPasteBar(url)
            CookieManager.getInstance().flush()
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val uri = request.url
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") {
                if (scheme == "mailto" || scheme == "tel" || scheme == "sms") openExternal(uri)
                return true
            }
            if (!isAppHost(uri.host)) {
                openExternal(uri)
                return true
            }
            val path = uri.path.orEmpty()
            if (isCloudDocument(path)) {
                showCloudMessage()
                return true
            }
            return false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            progress.visibility = View.GONE
            if (hasLoadedPage) {
                // Non-blocking banner preserves the open workspace/job data on brief drops.
                offlineBanner.visibility = View.VISIBLE
            } else {
                web.visibility = View.INVISIBLE
                offline.visibility = View.VISIBLE
                pasteBar.visibility = View.GONE
            }
        }

        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
            handler?.cancel()
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
            val host = runCatching { Uri.parse(origin).host }.getOrNull()
            if (!isAppHost(host) || callback == null) {
                callback?.invoke(origin, false, false)
                return
            }
            val fine = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION)
            val coarse = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION)
            if (fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false)
                return
            }
            geoOrigin = origin
            geoCallback = callback
            locationPermission.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ))
        }

        override fun onPermissionRequest(request: PermissionRequest?) {
            if (request == null) return
            val host = runCatching { Uri.parse(request.origin.toString()).host }.getOrNull()
            if (!isAppHost(host)) {
                request.deny()
                return
            }
            val needed = mutableListOf<String>()
            val immediate = mutableListOf<String>()
            if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    immediate.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                } else {
                    needed.add(Manifest.permission.CAMERA)
                }
            }
            if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    immediate.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                } else {
                    needed.add(Manifest.permission.RECORD_AUDIO)
                }
            }
            if (needed.isEmpty()) {
                if (immediate.isNotEmpty()) request.grant(immediate.toTypedArray()) else request.deny()
                return
            }
            permissionRequest = request
            mediaPermission.launch(needed.toTypedArray())
        }

        override fun onShowFileChooser(
            view: WebView?,
            callback: ValueCallback<Array<Uri>>?,
            params: FileChooserParams?,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val chooserParams = params ?: return false
            val cameraOk = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (cameraOk) {
                showFileSourcePicker(chooserParams, true)
            } else {
                pendingChooser = chooserParams
                cameraPermission.launch(Manifest.permission.CAMERA)
            }
            return true
        }

        override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
            if (isFinishing) {
                result?.cancel()
                return true
            }
            AlertDialog.Builder(this@MainActivity)
                .setMessage(message)
                .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                .setOnCancelListener { result?.cancel() }
                .show()
            return true
        }

        override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean {
            return false
        }
    }

    companion object {
        private const val START_URL = "https://app.biohazards.net/"
        private const val APP_USER_AGENT = "BiohazardsDataEntry/1.2"
        private const val MAX_PHOTO_DIMENSION = 1920
        private const val PHOTO_JPEG_QUALITY = 85

        private val APP_ORIGINS = setOf(
            "https://app.biohazards.net",
            "https://login.biohazards.net",
            "https://photo.biohazards.net",
            "https://notes.biohazards.net",
            "https://newjob.biohazards.net",
        )

        private val CLOUD_PREFIXES = listOf(
            "/api/pdf",
            "/api/print",
            "/api/build-document",
        )

        private val DOCUMENT_SCRIPT = """
            (function () {
              try {
                if (!localStorage.getItem('bh_v11_migrated')) {
                  localStorage.setItem('bh_v11_migrated', '1');
                  localStorage.setItem('bh_view_mode', 'agent');
                }
              } catch (e) {}
              if (window.__bhDataEntry) return;
              window.__bhDataEntry = true;
              var blocked = ['/api/pdf','/api/print','/api/build-document'];
              function isBlocked(url) {
                url = String(url || '');
                for (var i = 0; i < blocked.length; i++) if (url.indexOf(blocked[i]) !== -1) return true;
                return false;
              }
              function deny() {
                alert('Document generation and PDF downloads stay on the web app. You can still send saved document links from Docs.');
              }
              if (window.fetch) {
                var origFetch = window.fetch;
                window.fetch = function (input, init) {
                  var url = typeof input === 'string' ? input : (input && input.url);
                  if (isBlocked(url)) { deny(); return Promise.reject(new Error('cloud-document')); }
                  return origFetch.apply(this, arguments);
                };
              }
              var origOpen = XMLHttpRequest.prototype.open;
              XMLHttpRequest.prototype.open = function (method, url) {
                this.__bhUrl = url;
                return origOpen.apply(this, arguments);
              };
              var origSend = XMLHttpRequest.prototype.send;
              XMLHttpRequest.prototype.send = function () {
                if (isBlocked(this.__bhUrl)) { deny(); return; }
                return origSend.apply(this, arguments);
              };
              document.addEventListener('submit', function (e) {
                var action = e.target && e.target.action;
                if (isBlocked(action)) { e.preventDefault(); deny(); }
              }, true);
              document.addEventListener('click', function (e) {
                var node = e.target;
                var anchor = node && node.closest ? node.closest('a') : null;
                if (anchor && isBlocked(anchor.href)) { e.preventDefault(); deny(); }
              }, true);
            })();
        """.trimIndent()

        private fun isAppHost(host: String?): Boolean {
            if (host.isNullOrBlank()) return false
            return host == "biohazards.net" || host.endsWith(".biohazards.net")
        }

        private fun isCloudDocument(path: String?): Boolean {
            if (path.isNullOrBlank()) return false
            return CLOUD_PREFIXES.any { path == it || path.startsWith("$it/") }
        }

        private fun signInLink(uri: Uri?): Uri? {
            if (uri == null || uri.scheme != "https") return null
            val host = uri.host ?: return null
            if (host != "app.biohazards.net" && host != "login.biohazards.net") return null
            val path = uri.path ?: return null
            if (!path.startsWith("/login/")) return null
            if (path.removePrefix("/login/").isBlank()) return null
            return uri
        }
    }
}
