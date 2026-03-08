#!/bin/bash
# Patch @codetrix-studio/capacitor-google-auth for GoogleSignIn 7.x API
# The original plugin targets GoogleSignIn 6.x which has different APIs.
# This rewrites Plugin.swift for 7.x compatibility.

PLUGIN_SWIFT="node_modules/@codetrix-studio/capacitor-google-auth/ios/Plugin/Plugin.swift"

if [ ! -f "$PLUGIN_SWIFT" ]; then
  echo "Google Auth plugin not found, skipping patch"
  exit 0
fi

# Check if already patched for 7.x
if grep -q "signIn(withPresenting:" "$PLUGIN_SWIFT"; then
  echo "Google Auth plugin already patched for 7.x"
  exit 0
fi

cat > "$PLUGIN_SWIFT" << 'SWIFT_EOF'
import Foundation
import Capacitor
import GoogleSignIn

@objc(GoogleAuth)
public class GoogleAuth: CAPPlugin {
    var signInCall: CAPPluginCall!
    var forceAuthCode: Bool = false
    var additionalScopes: [String] = []

    func loadSignInClient(
        customClientId: String,
        customScopes: [String]
    ) {
        let serverClientId = getServerClientIdValue()
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: customClientId,
            serverClientID: serverClientId
        )

        let defaultGrantedScopes = ["email", "profile", "openid"]
        additionalScopes = customScopes.filter { !defaultGrantedScopes.contains($0) }
        forceAuthCode = getConfig().getBoolean("forceCodeForRefreshToken", false)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleOpenUrl(_:)),
            name: Notification.Name(Notification.Name.capacitorOpenURL.rawValue),
            object: nil
        )
    }

    public override func load() {
        if let clientId = getClientIdValue() {
            let scopes = (getConfigValue("scopes") as? [String]) ?? ["profile", "email"]
            self.loadSignInClient(customClientId: clientId, customScopes: scopes)
            NSLog("GoogleAuth: auto-initialized from config on load()")
        }
    }

    @objc
    func initialize(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId") ?? getClientIdValue() else {
            NSLog("GoogleAuth: no client id found in config")
            call.resolve()
            return
        }
        let customScopes = call.getArray("scopes", String.self) ?? (getConfigValue("scopes") as? [String] ?? [])
        forceAuthCode = call.getBool("grantOfflineAccess") ?? (getConfigValue("forceCodeForRefreshToken") as? Bool ?? false)
        self.loadSignInClient(customClientId: clientId, customScopes: customScopes)
        call.resolve()
    }

    @objc
    func signIn(_ call: CAPPluginCall) {
        signInCall = call
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if GIDSignIn.sharedInstance.hasPreviousSignIn() && !self.forceAuthCode {
                GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                    if let error = error {
                        self.signInCall?.reject(error.localizedDescription)
                        return
                    }
                    guard let user = user else {
                        self.signInCall?.reject("No user returned")
                        return
                    }
                    self.resolveSignInCallWith(user: user)
                }
            } else {
                guard let presentingVc = self.bridge?.viewController else {
                    self.signInCall?.reject("No presenting view controller")
                    return
                }
                GIDSignIn.sharedInstance.signIn(withPresenting: presentingVc, hint: nil, additionalScopes: self.additionalScopes) { result, error in
                    if let error = error {
                        self.signInCall?.reject(error.localizedDescription, "\((error as NSError).code)")
                        return
                    }
                    guard let user = result?.user else {
                        self.signInCall?.reject("No user returned")
                        return
                    }
                    self.resolveSignInCallWith(user: user)
                }
            }
        }
    }

    @objc
    func refresh(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let user = GIDSignIn.sharedInstance.currentUser else {
                call.reject("User not logged in.")
                return
            }
            user.refreshTokensIfNeeded { user, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                guard let user = user else {
                    call.reject("No user returned")
                    return
                }
                let authenticationData: [String: Any] = [
                    "accessToken": user.accessToken.tokenString,
                    "idToken": user.idToken?.tokenString ?? NSNull(),
                    "refreshToken": ""
                ]
                call.resolve(authenticationData)
            }
        }
    }

    @objc
    func signOut(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            GIDSignIn.sharedInstance.signOut()
        }
        call.resolve()
    }

    @objc
    func handleOpenUrl(_ notification: Notification) {
        guard let object = notification.object as? [String: Any],
              let url = object["url"] as? URL else {
            return
        }
        GIDSignIn.sharedInstance.handle(url)
    }

    func getClientIdValue() -> String? {
        if let clientId = getConfig().getString("iosClientId") { return clientId }
        if let clientId = getConfig().getString("clientId") { return clientId }
        if let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
           let dict = NSDictionary(contentsOfFile: path) as? [String: AnyObject],
           let clientId = dict["CLIENT_ID"] as? String { return clientId }
        return nil
    }

    func getServerClientIdValue() -> String? {
        return getConfig().getString("serverClientId")
    }

    func resolveSignInCallWith(user: GIDGoogleUser) {
        var userData: [String: Any] = [
            "authentication": [
                "accessToken": user.accessToken.tokenString,
                "idToken": user.idToken?.tokenString ?? NSNull(),
                "refreshToken": ""
            ],
            "email": user.profile?.email ?? NSNull(),
            "familyName": user.profile?.familyName ?? NSNull(),
            "givenName": user.profile?.givenName ?? NSNull(),
            "id": user.userID ?? NSNull(),
            "name": user.profile?.name ?? NSNull()
        ]
        if let imageUrl = user.profile?.imageURL(withDimension: 100)?.absoluteString {
            userData["imageUrl"] = imageUrl
        }
        signInCall?.resolve(userData)
    }
}
SWIFT_EOF

echo "Google Auth plugin patched for GoogleSignIn 7.x"
