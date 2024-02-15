@file:Suppress("FunctionName", "ClassName")
package com.sourcegraph.cody.protocol_generated

data class ChatMessage(
  val speaker: SpeakerEnum? = null, // Oneof: human, assistant
  val text: String? = null,
  val displayText: String? = null,
  val contextFiles: List<ContextFile>? = null,
  val preciseContext: List<PreciseContext>? = null,
  val buttons: List<ChatButton>? = null,
  val data: Any? = null,
  val metadata: ChatMetadata? = null,
  val error: ChatError? = null,
)

