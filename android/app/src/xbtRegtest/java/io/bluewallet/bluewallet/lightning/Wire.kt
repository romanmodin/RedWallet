package io.bluewallet.bluewallet.lightning

import com.google.protobuf.CodedInputStream
import com.google.protobuf.CodedOutputStream
import java.io.ByteArrayOutputStream

internal fun message(block: CodedOutputStream.() -> Unit): ByteArray {
    val out = ByteArrayOutputStream()
    CodedOutputStream.newInstance(out).apply { block(); flush() }
    return out.toByteArray()
}

internal class Fields(data: ByteArray) {
    val numbers = mutableMapOf<Int, Long>()
    val blobs = mutableMapOf<Int, MutableList<ByteArray>>()
    init {
        val source = CodedInputStream.newInstance(data)
        while (!source.isAtEnd) {
            val tag = source.readTag()
            val field = tag ushr 3
            when (tag and 7) {
                0 -> numbers[field] = source.readUInt64()
                2 -> blobs.getOrPut(field) { mutableListOf() }.add(source.readByteArray())
                else -> require(source.skipField(tag))
            }
        }
    }
    fun number(field: Int) = numbers[field] ?: 0L
    fun bytes(field: Int) = requireNotNull(blobs[field]?.firstOrNull())
    fun string(field: Int) = bytes(field).toString(Charsets.UTF_8).also { require(it.isNotEmpty()) }
}
