import AppKit
import UniformTypeIdentifiers

let app = URL(fileURLWithPath: NSHomeDirectory() + "/Applications/Rex Neovim.app")
let bundleID = "com.sravan.rex-neovim"
let dryRun = CommandLine.arguments.contains("--dry-run")
let extensions = [
    "txt", "md", "mdx", "markdown", "json", "jsonc", "yaml", "yml", "toml", "xml", "plist", "log",
    "csv", "tsv", "ini", "conf", "cfg", "env", "lock", "gitignore", "sh", "zsh", "py", "lua",
    "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "c", "h", "cpp", "hpp", "swift",
    "go", "rs", "sql", "css", "scss", "sass", "less", "html", "htm", "graphql", "vue", "svelte",
    "bash", "fish", "rb", "php", "java", "kt", "kts", "cs", "ex", "exs", "erl", "hrl",
    "r", "rmd", "jl", "pl", "pm", "ps1", "bat", "cmd", "tex", "bib", "rst", "adoc",
    "editorconfig", "gitconfig", "gitattributes", "dockerignore", "properties", "ipynb",
]

let types = Set([UTType.text, .plainText, .sourceCode] + extensions.compactMap {
    UTType(filenameExtension: $0, conformingTo: .text)
})

if !dryRun { print("Click Change in each file-type dialog macOS shows.") }
var failed = false
for type in types.sorted(by: { $0.identifier < $1.identifier }) {
    let current = LSCopyDefaultRoleHandlerForContentType(type.identifier as CFString, .all)?
        .takeRetainedValue() as String?
    if dryRun {
        print("\(current == bundleID ? "Already set" : "Would set"): \(type.identifier)")
        continue
    }
    if current == bundleID { continue }
    do {
        try await withCheckedThrowingContinuation { (completion: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.setDefaultApplication(at: app, toOpen: type) { error in
                if let error {
                    completion.resume(throwing: error)
                } else {
                    completion.resume()
                }
            }
        }
    } catch {
        print("Not set: \(type.identifier): \(error.localizedDescription)")
        failed = true
    }
}
exit(failed ? 1 : 0)
