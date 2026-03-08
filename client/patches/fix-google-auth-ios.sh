#!/bin/bash
# Patch @codetrix-studio/capacitor-google-auth to auto-initialize on load()
# This prevents the Plugin.swift:74 nil crash by ensuring GIDSignIn is set
# before signIn() can be called.

PLUGIN_SWIFT="node_modules/@codetrix-studio/capacitor-google-auth/ios/Plugin/Plugin.swift"

if [ ! -f "$PLUGIN_SWIFT" ]; then
  echo "Google Auth plugin not found, skipping patch"
  exit 0
fi

# Check if already patched
if grep -q "AUTO-INIT PATCH" "$PLUGIN_SWIFT"; then
  echo "Google Auth plugin already patched"
  exit 0
fi

# Replace empty load() with auto-initializing load()
sed -i.bak 's/public override func load() {/public override func load() {\
        \/\/ AUTO-INIT PATCH: initialize from config on plugin load\
        if let clientId = getClientIdValue() {\
            let scopes = (getConfigValue("scopes") as? [String]) ?? ["profile", "email"]\
            self.loadSignInClient(customClientId: clientId, customScopes: scopes)\
            NSLog("GoogleAuth: auto-initialized from config on load()")\
        }/' "$PLUGIN_SWIFT"

rm -f "${PLUGIN_SWIFT}.bak"
echo "Google Auth plugin patched successfully"
