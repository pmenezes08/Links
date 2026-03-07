import UIKit
import Capacitor
import CodetrixStudioCapacitorGoogleAuth

class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
    }

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GoogleAuth())
    }
}
