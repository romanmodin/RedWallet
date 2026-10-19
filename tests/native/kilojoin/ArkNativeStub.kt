package com.kilombino.pyblockwatch.ark
// Standalone JVM test only. Keep the pinned upstream crypto source unchanged;
// disable unavailable Android JNI and exercise its original Kotlin fallback.
@Suppress("UNUSED_PARAMETER")
object ArkNative {
    val available = false
    fun secpPubkey(k: ByteArray): ByteArray? = null
    fun secpEcdsaSign(k: ByteArray, m: ByteArray, lowR: Boolean): ByteArray? = null
    fun secpEcdh(k: ByteArray, p: ByteArray): ByteArray? = null
    fun secpTweakAdd(k: ByteArray, t: ByteArray): ByteArray? = null
    fun secpSchnorrSign(k: ByteArray, m: ByteArray, a: ByteArray): ByteArray? = null
}
