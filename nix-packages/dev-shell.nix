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

  dognerd-dev = writeShellApplication {
    name = "dognerd-dev";
    runtimeInputs = [web-ext];
    text = ''
      mkdir -p .dognerd-profile
      exec web-ext run \
        --source-dir "$PWD" \
        --firefox "$(command -v firefox)" \
        --firefox-profile "$PWD/.dognerd-profile" \
        --keep-profile-changes \
        --watch-ignored "$PWD/.dognerd-profile" \
        --watch-ignored "$PWD/.chrome-profile" \
        --start-url https://dogonline.net \
        "$@"
    '';
  };

  firefox-mcp = writeShellApplication {
    name = "firefox-mcp";
    runtimeInputs = [nodejs geckodriver];
    text = ''
      mkdir -p .dognerd-profile
      exec npx -y @mozilla/firefox-devtools-mcp@0.10.6 \
        --firefox-path "$(command -v firefox)" \
        --profile-path "$PWD/.dognerd-profile" \
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
        dognerd-dev
        firefox-mcp
      ]
      ++ lib.optional (lib.meta.availableOn stdenv.hostPlatform chromium) chrome-mcp;

    shellHook =
      pre-commit-check.shellHook
      + ''
        echo "Development Shell ready"
      '';
  }
