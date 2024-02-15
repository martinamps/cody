@file:Suppress("FunctionName", "ClassName")
package com.sourcegraph.cody.protocol_generated

data class TextDocumentEditParams(
  val uri: String? = null,
  val edits: List<TextEdit>? = null,
  val options: OptionsParams? = null,
)

