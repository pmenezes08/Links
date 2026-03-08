import UIKit
import Capacitor
import CodetrixStudioCapacitorGoogleAuth

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GoogleAuth())
    }
}
