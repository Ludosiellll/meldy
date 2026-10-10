#!/usr/bin/env bash
# Run a LibreOffice binary headless with a throwaway profile. Usage: lo.sh <soffice> <args...>
BIN="$1"; shift
PROF=$(mktemp -d /tmp/claude-0/-home-user/bdd6a3db-98b1-55d9-a278-b6d3039b029b/scratchpad/lo_prof_XXXX)
SAL_USE_VCLPLUGIN=svp timeout 240 "$BIN" -env:UserInstallation=file://$PROF --headless --norestore "$@"
rc=$?; rm -rf "$PROF"; exit $rc
