# Project rules for Claude

## Git workflow

- Commit and push directly to `main`. Do not create feature branches, worktrees, or pull requests unless I explicitly ask for one.
- If you are on another branch when you start work, switch to `main` (`git checkout main && git pull`) before committing.
- After committing, push with `git push origin main`.
- If the push is rejected because `main` has moved, run `git pull --rebase origin main` and push again. Never force-push `main`.
- Still follow the normal safety rules: don't commit secrets (`.env`, keys, credentials), and don't skip hooks (`--no-verify`).
