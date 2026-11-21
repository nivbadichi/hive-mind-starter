#!/bin/sh
# Install Hive Mind on a Mac or on Linux. This is the front door: it checks for Node and Git, then hands the work to
# install.mjs next to it, the one installer for Windows, Mac and Linux (on Windows: core\gates\install.ps1).
#   sh core/install/install.sh install         install into your ~/.claude
#   sh core/install/install.sh --dry-run       only list what would change
#   sh core/install/install.sh                 with no command: show what it can do, and change nothing
#   sh core/install/install.sh uninstall       put everything back the way it was before the first install
#   sh core/install/install.sh remove-gates    take out only the gates
# For a test, add --claude-dir <folder> (and --root <folder> for a notebook in another place than this one).
# Run it as yourself, not with sudo.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || { echo "STOPPED: could not find the folder this script is in. Nothing was changed."; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "STOPPED: node was not found. Nothing was changed."
  echo "Node is not on this computer yet. Node is a free program that Hive Mind needs for its checks and for the start of every chat. Ask Claude to install Node, or install the LTS version from https://nodejs.org yourself. Then quit the Claude app completely, open it again, and say: add the small parts."
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "Note: Git was not found. The install goes ahead, but saving the notebook (and the privacy check before each save) needs Git, a free program from https://git-scm.com."
fi
exec node "$here/install.mjs" "$@"
