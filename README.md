# Warpdrive documentation renderer

This repository builds the public [Warpdrive documentation](https://docs.warpdrivecrm.com/)
with Fumadocs and Next.js. [Warpdrive](https://github.com/KhademOHAli1/warpdrive) owns
the guides, sidebar metadata, public images, and screenshot capture instructions.
The renderer owns the site, public URL checks, and build dependencies. The renderer
repository does not contain the CRM application or its private runbooks.

## Build a preview

Use the Bun version in `package.json`. In a separate Warpdrive checkout, check
out the exact revision in [content-source.json](content-source.json). Run these
commands from the renderer root:

```sh
bun scripts/stage-content.mjs /absolute/path/to/warpdrive
bun install --frozen-lockfile
bun --no-env-file audit --json
bun run typecheck
bun run build
bun run check:export
```

Staging reads Git blobs from the source checkout's `HEAD`. Commit any local
guide changes you want to preview before staging. The script stages only
Markdown, MDX, and sidebar metadata listed under `docs-site/docs/` and recognized
images under `docs-site/public/img/`. It rejects symlinks, unexpected tracked
files, ambiguous guide names, and local edits to previously staged files. The
generated `docs/` and `public/img/` trees stay out of renderer commits. Update
the original content checkout and rerun staging to replace the generated trees.

Serve `out/` at a static host root. The export includes guide pages, search and
its local index, the sitemap, and the public discovery file. Use `bun run dev`
from the renderer root for interactive preview.

## Review a content update

Edit and review guide or image changes in Warpdrive first. Update the full
commit SHA in `content-source.json` when the reviewed content revision is ready.
Renderer CI checks out that exact commit, stages its public files, and checks
the static export for navigation, existing bookmarks, links, and assets. The
preview artifact contains both repository revisions in `preview-provenance.json`.
The workflow only uploads an artifact for review.

## CRM color tokens

Staging extracts the shared light and dark color values from the same Warpdrive
commit as the guides. It reads the token declarations in `src/app/globals.css`
and writes an allowlisted palette to `.content-theme/palette.css`. Fumadocs
maps its colors to that palette in `app/globals.css`. Change shared color values
in Warpdrive, then advance the content revision for the standalone preview.

## Fumadocs updates

Dependabot checks for releases daily at 07:00 Europe/Berlin and groups updates to
`fumadocs-core`, `fumadocs-ui`, and `fumadocs-mdx`. A verified Dependabot pull
request containing only compatible minor or patch upgrades to those packages and
their lockfile can merge automatically after the full renderer preview passes.
Major upgrades and other dependencies use the same preview checks and require
manual review. GitHub deletes temporary branches after merge.

After an automatic merge, the workflow runs the renderer preview on `main` to
produce a new static export and provenance. This artifact is ready for the
separate hosting promotion. Warpdrive's `docs-site/renderer.lock` controls
which renderer revision its own documentation checks use.

Warpdrive's [hosting guide](https://github.com/KhademOHAli1/warpdrive/blob/main/docs/development/public-docs-migration.md)
covers host promotion and rollback. The renderer uses Warpdrive's existing MIT
license. Screenshot authorship and capture instructions remain with the
[public assets in Warpdrive](https://github.com/KhademOHAli1/warpdrive/tree/main/docs-site).
