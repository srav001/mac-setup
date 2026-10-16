import AppKit
import UniformTypeIdentifiers

let app = URL(fileURLWithPath: NSHomeDirectory() + "/Applications/Rex Neovim.app")
let extensions = [
    "txt", "md", "mdx", "markdown", "json", "jsonc", "yaml", "yml", "toml", "xml", "plist", "log",
    "csv", "tsv", "ini", "conf", "cfg", "env", "lock", "gitignore", "sh", "zsh", "py", "lua",
    "js", "mjs", "cjs", "jsx", "ts", "cts", "tsx", "c", "h", "swift", "go", "rs", "sql", "css",
    "graphql", "vue", "svelte",
]

let probe = FileManager.default.temporaryDirectory.appendingPathComponent("rex-neovim-probe")
try? FileManager.default.createDirectory(at: probe, withIntermediateDirectories: true)
var types = Set<UTType>()
for ext in extensions {
    let file = probe.appendingPathComponent("probe.\(ext)")
    FileManager.default.createFile(atPath: file.path, contents: nil)
    if NSWorkspace.shared.urlForApplication(toOpen: file) != app,
       let type = try file.resourceValues(forKeys: [.contentTypeKey]).contentType {
        types.insert(type)
    }
}
try? FileManager.default.removeItem(at: probe)

if !types.isEmpty { print("Click Change in each of the \(types.count) dialogs macOS shows.") }
var failed = false
let group = DispatchGroup()
for type in types {
    group.enter()
    NSWorkspace.shared.setDefaultApplication(at: app, toOpen: type) { error in
        if let error {
            print("Not set: \(type.identifier): \(error.localizedDescription)")
            failed = true
        }
        group.leave()
    }
}
group.wait()
exit(failed ? 1 : 0)
