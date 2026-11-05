package io.bluewallet.bluewallet.lightning

import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.ReadableMap
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class MainnetDeviceTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun publicSync() {
        assertTrue(MainnetConfiguration.live)
        assertEquals("example.com:8333",MainnetConfiguration.endpoint("EXAMPLE.com:8333"))
        listOf("bad.onion:8333", "peer:0", "peer:65536", "host:8333\nbitcoin.regtest=true", "https://host:8333", "-bad:8333", "host:abc", "host: 8333").forEach {
            assertTrue("Unsafe peer accepted",runCatching { MainnetConfiguration.endpoint(it) }.isFailure)
        }
        assertFalse(MainnetConfiguration.text().contains("bitcoin.regtest"))
        assertEquals(5,MainnetConfiguration.text().lineSequence().count { it.startsWith("neutrino.connect=") })
        MainnetConfiguration.savePeer(ctx,"127.0.0.1:18444")
        assertEquals("127.0.0.1:18444",MainnetConfiguration.savedPeer(ctx))
        File(ctx.noBackupFilesDir,"XBTLightning-mainnet-peer.json").writeText("invalid-json")
        assertTrue(runCatching { MainnetConfiguration.savedPeer(ctx) }.isFailure)
        MainnetConfiguration.savePeer(ctx,"")
        assertEquals("",MainnetConfiguration.savedPeer(ctx))
        RegtestNode.run(ctx,"start","")
        var provisioned = false
        repeat(120) {
            if (!provisioned) {
                when (RegtestNode.run(ctx,"status","")) {
                    "Needs setup", "Locked" -> { RegtestNode.run(ctx,"setup",""); provisioned = true }
                    "Failed" -> fail("Embedded node startup failed")
                    else -> Thread.sleep(1000)
                }
            }
        }
        assertTrue("Node did not become ready for setup",provisioned)
        var ready = false
        repeat(540) {
            if (!ready) {
                when (RegtestNode.run(ctx,"status","")) {
                    "Running" -> ready = true
                    "Failed" -> fail("Embedded node stopped")
                    else -> {
                        if (it % 6 == 0) println(RegtestNode.run(ctx,"progress",""))
                        Thread.sleep(5000)
                    }
                }
            }
        }
        assertTrue("Public XBT sync did not finish; no funds used",ready)
        assertTrue(RegtestNode.run(ctx,"details","").contains("Synced: true"))
        assertTrue(RegtestNode.run(ctx,"fund","").startsWith("bc1"))
        val invoice = RegtestNode.invoice("receive","","","100") as String
        assertTrue(invoice.startsWith("lnbc") && !invoice.startsWith("lnbcrt"))
        val decoded = RegtestNode.invoice("decode",invoice,"","") as ReadableMap
        assertEquals("100",decoded.getString("sats"))
        assertTrue(runCatching { RegtestNode.invoice("decode","lnbcrt1invalid","","") }.isFailure)
        // A public-network smoke test creates only an unfunded, disposable node.
        val fakeWords = List(24) { "fixture".toByteArray() }
        val sealed = Recovery.export("disposable-test-passphrase",fakeWords,byteArrayOf(1))
        assertTrue(sealed.copyOfRange(0,22).toString(Charsets.UTF_8).startsWith("RedWallet-XBT-mainnet-"))
        assertEquals(24,Recovery.import("disposable-test-passphrase",sealed).first.size)
        val otherNetwork = sealed.copyOf()
        "RedWallet-XBT-regtest-1\n".toByteArray().copyInto(otherNetwork)
        assertTrue(runCatching { Recovery.import("disposable-test-passphrase",otherNetwork) }.isFailure)
        val modified = sealed.copyOf().apply { this[0] = 0 }
        assertTrue(runCatching { Recovery.import("disposable-test-passphrase",modified) }.isFailure)
    }
}
