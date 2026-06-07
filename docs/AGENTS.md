# AGENTS.md

This file gives documentation-specific guidance for agents working under `docs/`.

## Documentation Role

Documentation is the source of truth for Chapter 1 architecture and rollout sequencing. Keep docs aligned with the intended LAN live streaming path:

```text
browser camera -> WebRTC -> MediaMTX relay -> FFmpeg -> HLS files -> nginx -> player
```

## Writing Rules

- Keep `Chapter-1-Design-Doc.md` authoritative for architecture decisions.
- Keep implementation checklists and breakdowns consistent with the design doc.
- Use concrete paths, ports, and endpoint examples when they clarify local setup.
- Preserve the backend boundary: orchestration only, no application-server video segment delivery.
- Preserve the stream model: one `streamId` per publisher path, encoder worker, and HLS output directory.
- Preserve the viewer model: one active stream per viewer session.
- Keep browser publish docs aligned with MediaMTX routes: `/<path>/publish` for the built-in browser page and `/<path>/whip` for custom ingest clients.

## Change Guidance

- Update docs when code changes alter endpoints, env vars, runtime commands, external binaries, or output paths.
- Prefer small amendments over rewriting whole docs.
- If a design assumption changes, update the design doc first, then align checklists and implementation breakdowns.
- Keep examples Windows-friendly because the current repo path and nginx sample use Windows paths.
