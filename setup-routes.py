import os
import shutil
from pathlib import Path

# Base directory
base = Path("C:/Users/tanju/NYhacks/chainsentinel/apps/web/src/app/api")

# Create directories
(base / "ctf-claim").mkdir(parents=True, exist_ok=True)
(base / "ctf-pool").mkdir(parents=True, exist_ok=True)

# Source files
claim_src = Path("C:/Users/tanju/NYhacks/ctf-claim-route.ts")
pool_src = Path("C:/Users/tanju/NYhacks/ctf-pool-route.ts")

# Destination files
claim_dst = base / "ctf-claim" / "route.ts"
pool_dst = base / "ctf-pool" / "route.ts"

# Copy files
shutil.copy(claim_src, claim_dst)
shutil.copy(pool_src, pool_dst)

print(f"Created: {claim_dst}")
print(f"Created: {pool_dst}")
print("Done!")
