cask "opennotion-beta" do
  version "0.1.2"
  sha256 "b505dc668a58c750d8db54bdd7f87c4dced835d3e3ac2a3b9fb813dcc30cee46"

  url "https://github.com/marcoodignoti/OpenNotion/releases/download/v#{version}/OpenNotion_#{version}_arm64.dmg",
      verified: "github.com/marcoodignoti/OpenNotion/"
  name "OpenNotion Beta"
  desc "Local-first desktop workspace for notes, PDFs, study, and research"
  homepage "https://github.com/marcoodignoti/OpenNotion"

  livecheck do
    url "https://github.com/marcoodignoti/OpenNotion/releases/latest"
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on :macos

  app "OpenNotion.app"

  zap trash: [
    "~/Library/Application Support/org.opennotion.desktop",
    "~/Library/Preferences/org.opennotion.desktop.plist",
    "~/Library/Saved Application State/org.opennotion.desktop.savedState",
  ]

  caveats <<~EOS
    OpenNotion beta builds are unsigned. macOS may show Gatekeeper warnings until
    Developer ID signing and notarization are added.
  EOS
end
