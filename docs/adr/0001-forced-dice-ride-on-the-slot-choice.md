# Forced dice ride on the slot choice

A branch keeps the user's choices and derives every outcome from them: every rebuild (a truncated variation, a team edit, a restored support state) plays the kept turns again from their choices, and share links and support states carry those choices. A forced die is therefore part of the slot choice (`BranchSlotChoice`, like the Tera or Mega `modifier`), replays with every rebuild, and travels in share links and support states as an optional field, so neither format raises its version. Storing the outcome instead would break each rebuild path, because all of them derive outcomes from choices; stored as part of the choice, a forced die applies again after a team edit, and the simulator decides again whether it can take effect.

## Consequences

Share links and support states leave the app, so once they carry forced dice, every later reader keeps accepting the field (AGENTS.md, formats that leave the app).
