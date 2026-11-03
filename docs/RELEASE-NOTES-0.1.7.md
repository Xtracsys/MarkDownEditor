# Xtracsys Editor 0.1.7

Xtracsys Editor is a local-first editor for plain text, code, configuration
files, and Markdown. Documents remain ordinary files; the app adds no metadata
or hidden state beside them.

## Changes

- Crash recovery is now opt-in and off by default. Recovery snapshots contain
  unsaved document text; enabling the setting starts snapshots, and turning it
  off erases stored snapshots. Startup also removes snapshots left by older
  builds, and recovery offers appear only while the setting is enabled.
- The Normalize Line Endings dialog now accurately explains that a final
  newline is preserved rather than added.

## Downloads

This release includes the universal macOS DMG, Windows x64 installer and ZIP,
and Linux x64 Debian package and tarball. Verify each file with the matching
entry in `SHA256SUMS.txt` before running it.

The macOS build is ad-hoc signed and not notarized. Windows and Linux packages
are CI-built but have not been manually verified on those operating systems.
See the repository's platform status and security notes for details.
