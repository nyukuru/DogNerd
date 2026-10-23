{
  description = "DogNerd, a Firefox web extension adding UI improvements to Dog Online";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.pre-commit-hooks.url = "github:cachix/git-hooks.nix";

  outputs = {
    self,
    nixpkgs,
    pre-commit-hooks,
    ...
  }: let
    supportedSystems = [
      "x86_64-linux"
      "x86_64-darwin"
      "aarch64-linux"
      "aarch64-darwin"
    ];

    forAllSystems = func:
      nixpkgs.lib.genAttrs supportedSystems
      (
        system: (
          func
          system
          (import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          })
        )
      );
  in {
    packages = forAllSystems (
      system: pkgs:
        (pkgs.lib.packagesFromDirectoryRecursive {
          directory = ./nix-packages;
          callPackage = pkgs.newScope (
            self.packages.${system}
            // {self = builtins.removeAttrs self ["packages"];}
          );
        })
        // {default = self.packages.${system}.dognerd;}
    );

    devShells = forAllSystems (system: pkgs: {
      default = self.packages.${system}.dev-shell;
    });

    checks = forAllSystems (system: pkgs: {
      inherit (self.packages.${system}) dognerd;

      pre-commit-check = pre-commit-hooks.lib.${system}.run {
        src = ./.;
        hooks = {
          alejandra.enable = true;
        };
      };
    });
  };
}
