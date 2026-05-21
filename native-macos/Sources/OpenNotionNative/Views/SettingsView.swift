import OpenNotionCore
import SwiftUI

struct SettingsView: View {
    @State private var databasePath = ""

    var body: some View {
        Form {
            LabeledContent("Data source") {
                Text(databasePath)
                    .textSelection(.enabled)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 560)
        .onAppear {
            databasePath = (try? DatabaseSafety.defaultSession().activeDatabasePath) ?? "Unavailable"
        }
    }
}
