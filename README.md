# PHP CS Fixer

VSCode/Cursor extension for [php-cs-fixer](https://github.com/PHP-CS-Fixer/PHP-CS-Fixer) with multi-config support.

## Why this extension?

Most php-cs-fixer extensions only support a single config file. If your project uses different coding standards for different directories (e.g., strict rules for `src/` and relaxed rules for legacy code), they can't handle it.

This extension uses `--path-mode=intersection` to try each config file and apply only the one whose Finder matches the current file.

## Features

- **Multi-config support** — auto-discovers all `.php-cs-fixer*.php` config files and applies the right one per file
- **Auto-detect executable** — finds `php-cs-fixer` from `vendor/bin/`, global Composer install, or a configured path
- **Format on save** — works as a standard VSCode formatter (set as default PHP formatter)
- **Cross-platform** — works on Windows, macOS, and Linux
- **Works in Cursor** — fully compatible with Cursor IDE

## Setup

1. Install the extension
2. Set it as your default PHP formatter:

```jsonc
{
  "[php]": {
    "editor.defaultFormatter": "JorrinKievit.php-cs-fixer",
    "editor.formatOnSave": true
  }
}
```

That's it. The extension auto-discovers your config files and executable.

## Multi-config example

Given a project with two configs:

- `.php-cs-fixer.dist.php` — strict Symfony rules for `src/`
- `.php-cs-fixer.legacy.dist.php` — basic formatting for `legacy/`, `config/`

Each config defines a `Finder` with `->in()` pointing to its directories. When you save a file, the extension tries each config with `--path-mode=intersection`. Only the config whose Finder includes that file's directory will apply.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `phpCsFixer.executablePath` | `""` | Path to `php-cs-fixer`. Empty = auto-detect from `vendor/bin/` |
| `phpCsFixer.phpPath` | `""` | Path to `php`. Empty = use `php` from PATH |
| `phpCsFixer.configFiles` | `[]` | Explicit config file list. Empty = auto-discover |
| `phpCsFixer.autoDiscoverPatterns` | `[".php-cs-fixer.php", ...]` | Glob patterns for config discovery |
| `phpCsFixer.disabledConfigs` | `[]` | Config filenames to skip (e.g., `[".php-cs-fixer.new.dist.php"]`) |
| `phpCsFixer.extraArgs` | `[]` | Extra args passed to `php-cs-fixer fix` |
| `phpCsFixer.timeout` | `10000` | Timeout in ms |

## Troubleshooting

Open the **Output** panel and select **PHP CS Fixer** to see detailed logs of which configs are tried and whether they match.
