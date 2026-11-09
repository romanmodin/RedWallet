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
import java.math.BigInteger
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
    private fun balance() = RegtestNode.rpc { Lndmobile.walletBalance(ByteArray(0),it) }.number(2)
    private fun waitForFixtureSync() {
        val tip = fixture("height").toLong()
        waitFor {
            val info = RegtestNode.rpc { Lndmobile.getInfo(ByteArray(0),it) }
            info.number(6) == tip && info.number(9) == 1L
        }
    }
    private fun start() {
        node("start","127.0.0.1")
        waitFor { node("status") == "Needs setup" }
    }
    @Test fun openingCapIsEnforcedBeforeNodeCalls() {
        val rejected = runCatching { RegtestNode.invoice("open", "02" + "a".repeat(64), "1", "10000001") }
        assertTrue(rejected.isFailure)
        assertTrue(rejected.exceptionOrNull()?.message.orEmpty().contains("10,000,000 sats"))
    }
    @Test fun unsafeFeeIsRejectedBeforeAnyNodeCall() {
        val maximum = LightningAmounts.MAX_FEE_RATE
        assertTrue(LightningAmounts.validFeeRate(maximum))
        assertTrue(LightningAmounts.validFeeRate(1_000_000L))
        assertFalse(LightningAmounts.validFeeRate(maximum + 1))
        assertFalse(LightningAmounts.validFeeRate(3_002_399_751_580_330L))
        val product = BigInteger.valueOf(maximum).multiply(BigInteger.valueOf(3000L))
            .multiply(BigInteger.valueOf(1_000_000L)).add(BigInteger.valueOf(999L))
        assertTrue(product <= BigInteger.valueOf(Long.MAX_VALUE))
        for (rate in listOf(maximum + 1, 3_002_399_751_580_330L, Long.MAX_VALUE)) {
            val opening = runCatching { RegtestNode.invoice("open", "02" + "a".repeat(64), rate.toString(), "100000") }
            assertTrue(opening.exceptionOrNull() is IllegalArgumentException)
            val withdrawal = runCatching {
                NodeManagement.run("withdrawReview", MainnetConfiguration.addressPrefix + "qfixture", "1000", rate.toString())
            }
            assertTrue(withdrawal.exceptionOrNull() is IllegalArgumentException)
            val closing = runCatching { NodeManagement.run("close", "a".repeat(64) + ":0", "", rate.toString()) }
            assertTrue(closing.exceptionOrNull() is IllegalArgumentException)
        }
    }
    @Test fun payments() {
        assertFalse(MainnetConfiguration.live)
        start()
        node("setup")
        waitFor { node("status") == "Running" }
        val largeInvoice = RegtestNode.invoice("receive","","","44000000") as String
        val largeDecoded = RegtestNode.invoice("decode",largeInvoice,"","") as com.facebook.react.bridge.ReadableMap
        assertEquals("44000000",largeDecoded.getString("sats"))
        assertFalse(LightningAmounts.valid(Long.MAX_VALUE))
        assertFalse(LightningAmounts.valid(0L))
        assertTrue(LightningAmounts.validFeeRate(250L))
        val identity = node("details").lineSequence().first()
        File(ctx.cacheDir,"identity").writeText(identity)
        val addr = node("fund")
        assertTrue(addr.startsWith("bcrt1"))
        assertEquals("Repeated requests must retain the unused receiving address",addr,node("fund"))
        fixture("fund",addr)
        waitFor { Regex("Confirmed funding balance: ([0-9]+)").find(node("details"))!!.groupValues[1].toLong() >= 100000 }
        val nextAddr = node("fund")
        assertNotEquals("A detected deposit must advance the receiving address",addr,nextAddr)
        assertEquals(nextAddr,node("fund"))
        val remote = fixture("peer")
        RegtestNode.invoice("connect",remote + "@127.0.0.1:19735","","")
        waitForFixtureSync()
        val point = RegtestNode.invoice("open",remote,"","100000") as String
        val opening = NodeManagement.run("channelStatus","","","") as com.facebook.react.bridge.ReadableArray
        assertEquals(1,opening.size())
        assertEquals(point,opening.getMap(0)!!.getString("point"))
        assertEquals("pending",opening.getMap(0)!!.getString("state"))
        fixture("confirm",point)
        waitForFixtureSync()
        waitFor { node("details").contains("Active channels: 1") }
        val opened = NodeManagement.run("channelStatus","","","") as com.facebook.react.bridge.ReadableArray
        assertEquals(1,opened.size())
        assertEquals("active",opened.getMap(0)!!.getString("state"))
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
        assertEquals(true,RegtestNode.payInvoice(outgoing,hash,"20000","250"))
        runCatching { RegtestNode.payInvoice(outgoing,hash,"20000","250") }
        val paymentHistory = RegtestNode.invoice("paymentHistory","0","","") as com.facebook.react.bridge.ReadableMap
        val paymentRows = requireNotNull(paymentHistory.getArray("rows"))
        assertEquals(1,paymentRows.size())
        assertEquals(hash,paymentRows.getMap(0)!!.getString("id"))
        assertEquals("sent",paymentRows.getMap(0)!!.getString("direction"))
        assertEquals("settled",paymentRows.getMap(0)!!.getString("state"))
        assertFalse(paymentRows.getMap(0)!!.hasKey("payment_preimage"))

        assertEquals("settled",fixture("pay",RegtestNode.invoice("receive","","","2000") as String))
        assertTrue(node("history").contains("Settled"))
        val exported = Uri.parse(RegtestNode.recovery(ctx,"export",phrase,""))
        File(requireNotNull(exported.path)).copyTo(File(ctx.cacheDir,"recovery.rwln"),overwrite = true)
        val listed = NodeManagement.run("channels","","","") as com.facebook.react.bridge.ReadableArray
        assertEquals(point,listed.getMap(0)!!.getString("point"))
        waitForFixtureSync()
        val beforeClose = balance()
        // The disposable routing peer uses a fixed 50 sat/vB estimate.
        val closing = NodeManagement.run("close",point,"","50") as String
        assertEquals(64,closing.length)
        fixture("confirm",closing + ":0")
        waitForFixtureSync()
        waitFor { balance() > beforeClose }
        waitFor { (NodeManagement.run("channels","","","") as com.facebook.react.bridge.ReadableArray).size() == 0 }
        waitFor { runCatching { RegtestNode.requireSynced(); true }.getOrDefault(false) }
        val target = fixture("withdraw-address")
        val withdrawal = NodeManagement.run("withdrawReview",target,"1000","1") as com.facebook.react.bridge.ReadableMap
        val token = requireNotNull(withdrawal.getString("token"))
        assertTrue(runCatching { NodeManagement.run("withdraw","wrong-token","","") }.isFailure)
        val txid = NodeManagement.run("withdraw",token,"","") as String
        assertEquals(64,txid.length)
        assertTrue(runCatching { NodeManagement.run("withdraw",token,"","") }.isFailure)
        assertEquals("received-1000",fixture("verify-withdraw",txid))
        waitForFixtureSync()
        waitFor {
            RegtestNode.rpc { Lndmobile.getTransactions(ByteArray(0),it) }.blobs[1].orEmpty().map(::Fields)
                .any { it.string(1) == txid && it.number(3) > 0 }
        }
        assertTrue((NodeManagement.run("history","","","") as String).contains(txid))
        assertTrue(balance() > 100000)
        File(ctx.cacheDir,"balance").writeText(balance().toString())
    }
    @Test fun restore() {
        start()
        val uri = Uri.fromFile(File(ctx.cacheDir,"recovery.rwln")).toString()
        assertTrue(runCatching { RegtestNode.recovery(ctx,"restore","incorrect-disposable-passphrase",uri) }.isFailure)
        assertEquals("Needs setup",node("status"))
        RegtestNode.recovery(ctx,"restore",phrase,uri)
        waitFor { node("status") == "Running" }
        assertEquals(File(ctx.cacheDir,"identity").readText(),node("details").lineSequence().first())
        waitForFixtureSync()
        val expected = File(ctx.cacheDir,"balance").readText().toLong()
        waitFor { balance() == expected }
        val target = fixture("withdraw-address")
        val review = NodeManagement.run("withdrawReview",target,"1000","1") as com.facebook.react.bridge.ReadableMap
        val txid = NodeManagement.run("withdraw",requireNotNull(review.getString("token")),"","") as String
        assertEquals("received-1000",fixture("verify-withdraw",txid))
    }
}
