#!/bin/sh
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
M=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
for w in buyer=2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA seller=8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib; do
  n=${w%%=*}; a=${w#*=}
  echo "$n USDC=$(spl-token balance --owner $a $M -u devnet 2>&1) SOL=$(solana balance $a -u devnet 2>&1)"
done
