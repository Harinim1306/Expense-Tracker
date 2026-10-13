import SwiftUI

struct ContentView: View {
    // ⚙️ Configure your app endpoint:
    // • For Netlify deployment: "https://your-app.netlify.app"
    // • For testing on your local Wi-Fi: "http://10.70.8.97:3000"
    // • If empty (""), it automatically loads bundled standalone.html inside the app!
    @State private var serverUrlString: String = "http://10.70.8.97:3000"
    
    @State private var isLoading: Bool = true
    @State private var errorMessage: String? = nil

    var body: some View {
        ZStack {
            Color(red: 247/255, green: 246/255, blue: 242/255) // TrackFlow Cream background
                .ignoresSafeArea()

            TrackFlowWebView(
                urlString: serverUrlString,
                isLoading: $isLoading,
                errorMessage: $errorMessage
            )
            .ignoresSafeArea(.all, edges: .bottom)

            // Loading overlay
            if isLoading {
                VStack(spacing: 12) {
                    ProgressView()
                        .scaleEffect(1.2)
                        .tint(Color(red: 45/255, green: 106/255, blue: 79/255)) // Sage Green
                    Text("Loading TrackFlow…")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundColor(Color(red: 43/255, green: 45/255, blue: 66/255))
                }
                .padding(24)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.white.opacity(0.92))
                        .shadow(color: Color.black.opacity(0.08), radius: 12, x: 0, y: 4)
                )
                .transition(.opacity)
            }

            // Connection error view with retry button
            if let error = errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 40))
                        .foregroundColor(Color(red: 220/255, green: 38/255, blue: 38/255))

                    Text("Unable to Connect")
                        .font(.headline)
                        .foregroundColor(Color(red: 43/255, green: 45/255, blue: 66/255))

                    Text(error)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)

                    Button(action: {
                        errorMessage = nil
                        isLoading = true
                        NotificationCenter.default.post(name: .reloadWebView, object: nil)
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.clockwise")
                            Text("Retry Connection")
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(Color(red: 45/255, green: 106/255, blue: 79/255))
                        .cornerRadius(10)
                    }
                }
                .padding(24)
                .background(
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Color.white)
                        .shadow(color: Color.black.opacity(0.12), radius: 16, x: 0, y: 6)
                )
                .padding(.horizontal, 32)
            }
        }
    }
}

extension Notification.Name {
    static let reloadWebView = Notification.Name("reloadWebView")
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
