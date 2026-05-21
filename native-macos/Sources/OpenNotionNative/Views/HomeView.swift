import SwiftUI

struct HomeView: View {
    let onCreatePage: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("No page selected")
                .font(.title2)
                .fontWeight(.semibold)
            Button("New Page", action: onCreatePage)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
