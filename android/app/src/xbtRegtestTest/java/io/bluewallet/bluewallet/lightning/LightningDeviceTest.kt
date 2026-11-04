package io.bluewallet.bluewallet.lightning

import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import lndmobile.Callback
import lndmobile.Lndmobile
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class LightningDeviceTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    private val phrase = "disposable-restore-fixture"
    private fun node(op: String, arg: String = "") = RegtestNode.run(ctx, op, arg)
    private fun waitFor(check: () -> Boolean) {
        repeat(100) { if (check()) return; Thread.sleep(1000) }
        fail("Timed out waiting for the regtest node")
    }
    private fun fixture(action: String, arg: String = ""): String {
        val request = URL("http://localhost:18149/" + action).openConnection() as HttpURLConnection
        return try {
            request.requestMethod = "POST"
            request.connectTimeout = 10000
            request.readTimeout = 100000
            request.doOutput = true
            request.outputStream.use { it.write(arg.toByteArray()) }
            request.inputStream.bufferedReader().use { it.readText() }
        } finally { request.disconnect() }
    }
    private fun start() {
        node("start","127.0.0.1")
        waitFor { node("status") == "Needs setup" }
    }
    @Test fun payments() {
        start()
        node("setup")
        waitFor { node("status") == "Running" }
        val identity = node("details").lineSequence().first()
        File(ctx.cacheDir,"identity").writeText(identity)
        val addr = node("fund")
        assertTrue(addr.startsWith("bcrt1"))
        fixture("fund",addr)
        waitFor { Regex("Confirmed funding balance: ([0-9]+)").find(node("details"))!!.groupValues[1].toLong() >= 100000 }
        val remote = fixture("peer")
        RegtestNode.invoice("connect",remote + "@127.0.0.1:19735","","")
        val point = RegtestNode.invoice("open",remote,"","100000") as String
        fixture("confirm",point)
        waitFor { node("details").contains("Active channels: 1") }
        val outgoing = fixture("invoice")
        val review = RegtestNode.invoice("decode",outgoing,"","") as com.facebook.react.bridge.ReadableMap
        val hash = requireNotNull(review.getString("hash"))
        assertEquals("20000",review.getString("sats"))
        waitFor {
            val result = CompletableFuture<ByteArray>()
            Lndmobile.queryRoutes(message { writeString(1, remote); writeUInt64(2, 20000) }, object : Callback {
                override fun onResponse(data: ByteArray?) { result.complete(data ?: ByteArray(0)) }
                override fun onError(error: Exception) { result.completeExceptionally(error) }
            })
            runCatching { !Fields(result.get(10, TimeUnit.SECONDS)).blobs[1].isNullOrEmpty() }.getOrDefault(false)
        }
        assertTrue(runCatching { RegtestNode.invoice("pay",outgoing,hash,"19999") }.isFailure)
        assertEquals(true,RegtestNode.invoice("pay",outgoing,hash,"20000"))
        assertEquals("settled",fixture("pay",RegtestNode.invoice("receive","","","2000") as String))
        assertTrue(node("history").contains("Settled"))
        val exported = Uri.parse(RegtestNode.recovery(ctx,"export",phrase,""))
        File(requireNotNull(exported.path)).copyTo(File(ctx.cacheDir,"recovery.rwln"),overwrite = true)
    }
    @Test fun restore() {
        start()
        val uri = Uri.fromFile(File(ctx.cacheDir,"recovery.rwln")).toString()
        assertTrue(runCatching { RegtestNode.recovery(ctx,"restore","incorrect-disposable-passphrase",uri) }.isFailure)
        assertEquals("Needs setup",node("status"))
        RegtestNode.recovery(ctx,"restore",phrase,uri)
        waitFor { node("status") == "Running" }
        assertEquals(File(ctx.cacheDir,"identity").readText(),node("details").lineSequence().first())
    }
}
