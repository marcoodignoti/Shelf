cask "shelf-beta" do
  version "0.1.2"
  sha256 "588fbabe6dbd45efc87a1e7c58952b21b6b43f17c799f25e55ad4de1348793c4"

  url "https://github.com/marcoodignoti/Shelf/releases/download/v#{version}/Shelf_#{version}_arm64.dmg",
      verified: "github.com/marcoodignoti/Shelf/"
  name "Shelf Beta"
  desc "Local-first desktop workspace for notes, PDFs, study, and research"
  homepage "https://github.com/marcoodignoti/Shelf"

  livecheck do
    url "https://github.com/marcoodignoti/Shelf/releases/latest"
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on :macos

  app "Shelf.app"

  zap trash: [
    "~/Library/Application Support/org.opennotion.desktop",
    "~/Library/Preferences/org.opennotion.desktop.plist",
    "~/Library/Saved Application State/org.opennotion.desktop.savedState",
  ]

  caveats <<~EOS
    Shelf beta builds are unsigned. macOS may show Gatekeeper warnings until
    Developer ID signing and notarization are added.
  EOS
end
