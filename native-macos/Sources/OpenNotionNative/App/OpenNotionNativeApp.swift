import SwiftUI

@main
struct OpenNotionNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = OpenNotionStore()

    var body: some Scene {
        WindowGroup("OpenNotion") {
            ContentView(store: store)
                .frame(minWidth: 960, minHeight: 640)
                .task {
                    store.load()
                }
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("New Page") {
                    store.createPage()
                }
                .keyboardShortcut("n")

                Button("Delete Page") {
                    store.deleteSelectedPage()
                }
                .keyboardShortcut(.delete)
                .disabled(store.selectedPage == nil)
            }
        }

        Settings {
            SettingsView()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}
