{
  lib,
  stdenv,
  mkShell,
  writeShellApplication,
  nodejs,
  web-ext,
  android-tools,
  claude-code,
  geckodriver,
  chromium,
  self,
}: let
  inherit (self.checks.${stdenv.hostPlatform.system}) pre-commit-check;

  firefox-mcp = writeShellApplication {
    name = "firefox-mcp";
    runtimeInputs = [nodejs geckodriver];
    text = ''
      mkdir -p .firefox-profile
      exec npx -y @mozilla/firefox-devtools-mcp@0.10.6 \
        --firefox-path "$(command -v firefox)" \
        --profile-path "$PWD/.firefox-profile" \
        "$@"
    '';
  };

  chrome-mcp = writeShellApplication {
    name = "chrome-mcp";
    runtimeInputs = [nodejs];
    text = ''
      mkdir -p .chrome-profile
      exec npx -y chrome-devtools-mcp@1.12.0 \
        --executablePath ${lib.getExe chromium} \
        --userDataDir "$PWD/.chrome-profile" \
        --categoryExtensions \
        --no-usage-statistics \
        "$@"
    '';
  };
in
  mkShell {
    packages =
      [
        nodejs
        web-ext
        android-tools
        claude-code
        firefox-mcp
      ]
      ++ lib.optional (lib.meta.availableOn stdenv.hostPlatform chromium) chrome-mcp;

    shellHook =
      pre-commit-check.shellHook
      + ''
        echo "Development Shell ready"
      '';
  }
