package io.bluewallet.bluewallet.lightning

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import io.bluewallet.bluewallet.BuildConfig

// Same public XBT peers/configuration as the iPhone port, adapted from
// Kilombino/kilowallet-ios at 0ec864d (Apache-2.0). No Bitcoin DNS discovery.
internal object MainnetConfiguration {
    val live = BuildConfig.XBT_LIGHTNING_MAINNET
    val network get() = if (live) "mainnet" else "regtest"
    val units get() = if (live) "sats" else "test sats"
    val addressPrefix get() = if (live) "bc1" else "bcrt1"
    val peers = listOf("ln.kilombino.com:11010", "nodoblake2b.airdns.org:11010", "179.27.118.130:8343", "82.67.102.15:8333", "home.skyhawk.ca:8333")
    fun endpoint(value: String): String {
        val parts = value.split(':')
        require(parts.size == 2)
        val port = parts[1].toIntOrNull()
        require(port != null && port in 1..65535 && parts[1].all { it in '0'..'9' })
        val host = parts[0].lowercase(java.util.Locale.ROOT)
        require(host.length in 1..253 && !host.endsWith(".onion"))
        require(host.split('.').all { label -> label.length in 1..63 && label.first() != '-' && label.last() != '-' && label.all { it in 'a'..'z' || it in '0'..'9' || it == '-' } })
        return "$host:$port"
    }
    fun text(selected: List<String> = peers): String {
        require(selected.size in 1..16)
        val endpoints = selected.map(::endpoint)
        return listOf("[Application Options]", "debuglevel=info", "nolisten=true", "norest=true", "tlsdisableautofill=true", "alias=RedWallet", "nobootstrap=true", "maxpendingchannels=3", "protocol.wumbo-channels=true", "maxchansize=2100000000000000", "[Bitcoin]", "bitcoin.mainnet=true", "bitcoin.node=neutrino", "[neutrino]")
            .plus(endpoints.map { "neutrino.connect=$it" })
            .plus(listOf("neutrino.maxpeers=${maxOf(4, selected.size + 2)}", "[fee]", "fee.url=https://nodex.kilombino.com/data/lnd-fees.json", "[wtclient]", "wtclient.active=true")).joinToString("\n")
    }
    private fun peerFile(context: Context) = File(context.noBackupFilesDir, "XBTLightning-mainnet-peer.json")
    fun savedPeer(context: Context): String {
        val bytes = try { AtomicFile(peerFile(context)).readFully() } catch (_: java.io.FileNotFoundException) { return "" }
        val peer = JSONObject(bytes.toString(Charsets.UTF_8)).getString("peer")
        return if (peer.isEmpty()) "" else endpoint(peer)
    }
    fun savePeer(context: Context, value: String) {
        val peer = if (value.isEmpty()) "" else endpoint(value)
        val file = AtomicFile(peerFile(context))
        val stream = file.startWrite()
        try { stream.write(JSONObject().put("peer",peer).toString().toByteArray()); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
}
