{
  lib,
  stdenvNoCC,
  web-ext,
}:
stdenvNoCC.mkDerivation {
  pname = "dognerd";
  version = (builtins.fromJSON (builtins.readFile ../manifest.json)).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../manifest.json
      ../data
      ../img
      ../src
    ];
  };

  nativeBuildInputs = [web-ext];

  buildPhase = ''
    export HOME=$TMPDIR
    web-ext lint --source-dir . --self-hosted
    web-ext build --source-dir . --artifacts-dir dist --filename dognerd.xpi
  '';

  installPhase = ''
    install -Dm644 dist/dognerd.xpi $out/dognerd.xpi
  '';
}
