@file:Suppress("FunctionName", "ClassName", "unused", "EnumEntryName", "UnusedImport")
package com.sourcegraph.cody.agent.protocol_generated;

import com.google.gson.annotations.SerializedName;

data class AuthStatus(
  val username: String,
  val endpoint: EndpointEnum, // Oneof: 
  val isLoggedIn: Boolean,
  val isFireworksTracingEnabled: Boolean,
  val showInvalidAccessTokenError: Boolean,
  val authenticated: Boolean,
  val hasVerifiedEmail: Boolean,
  val requiresVerifiedEmail: Boolean,
  val siteHasCodyEnabled: Boolean,
  val siteVersion: String,
  val codyApiVersion: Long,
  val configOverwrites: CodyLLMSiteConfiguration? = null,
  val showNetworkError: Boolean? = null,
  val primaryEmail: String? = null,
  val displayName: String? = null,
  val avatarURL: String? = null,
  val userCanUpgrade: Boolean,
  val isOfflineMode: Boolean? = null,
) {

  enum class EndpointEnum {
    @SerializedName("") ``,
  }
}

