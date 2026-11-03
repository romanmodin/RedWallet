package io.bluewallet.bluewallet.lightning

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

internal object Recovery {
    const val LIMIT = 4 * 1024 * 1024
    private const val ALIAS = "redwallet.xbt.regtest.credentials.v1"
    private val header = "RedWallet-XBT-regtest-1\n".toByteArray()
    private val random = SecureRandom()
    fun randomBytes(size: Int) = ByteArray(size).also(random::nextBytes)
    fun encode(data: ByteArray): String = Base64.encodeToString(data, Base64.NO_WRAP)
    fun decode(data: String): ByteArray = Base64.decode(data, Base64.DEFAULT)
    fun words(json: JSONObject): List<ByteArray> {
        val array = json.getJSONArray("words")
        require(array.length() == 24)
        return (0 until 24).map { decode(array.getString(it)).also { word -> require(word.size in 1..16) } }
    }
    fun wordsJson(words: List<ByteArray>) = JSONArray(words.map(::encode))

    private fun deviceKey(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        check(create) { "Device credentials are unavailable." }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    private fun seal(data: ByteArray, key: SecretKey, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(aad)
        return cipher.iv + cipher.doFinal(data)
    }
    private fun open(data: ByteArray, key: SecretKey, aad: ByteArray): ByteArray {
        require(data.size >= 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, data, 0, 12))
        cipher.updateAAD(aad)
        return cipher.doFinal(data, 12, data.size - 12)
    }
    fun readDevice(file: File): JSONObject? {
        val data = try { AtomicFile(file).readFully() } catch (_: java.io.FileNotFoundException) { return null }
        return JSONObject(open(data, deviceKey(false), header).toString(Charsets.UTF_8))
    }
    fun storeDevice(file: File, credentials: JSONObject) {
        val bytes = seal(credentials.toString().toByteArray(), deviceKey(true), header)
        val atomic = AtomicFile(file)
        val out = atomic.startWrite()
        try { out.write(bytes); atomic.finishWrite(out) } catch (e: Exception) { atomic.failWrite(out); throw e }
    }
    private fun portableKey(phrase: String, salt: ByteArray): SecretKey {
        require(phrase.toByteArray().size in 12..512)
        val spec = PBEKeySpec(phrase.toCharArray(), salt, 600_000, 256)
        return try { SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES") }
        finally { spec.clearPassword() }
    }
    fun export(phrase: String, words: List<ByteArray>, backup: ByteArray): ByteArray {
        require(backup.isNotEmpty())
        val clear = JSONObject().put("words", wordsJson(words)).put("channelBackup", encode(backup)).toString().toByteArray()
        val salt = randomBytes(16)
        val prefix = header + salt
        require(clear.size <= LIMIT - prefix.size - 28)
        return prefix + seal(clear, portableKey(phrase, salt), prefix)
    }
    fun import(phrase: String, data: ByteArray): Pair<List<ByteArray>, ByteArray> {
        val offset = header.size + 16
        require(data.size in (offset + 28)..LIMIT && data.copyOfRange(0, header.size).contentEquals(header))
        val clear = open(data.copyOfRange(offset, data.size), portableKey(phrase, data.copyOfRange(header.size, offset)), data.copyOf(offset))
        val material = JSONObject(clear.toString(Charsets.UTF_8))
        return words(material) to decode(material.getString("channelBackup")).also { require(it.isNotEmpty()) }
    }
}
