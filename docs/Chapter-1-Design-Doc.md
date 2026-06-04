# Chapter 1 Design Doc: LAN Live Streaming With HLS

## Goal

Build the first working version of the OTT live streaming pipeline for local LAN use only. A small group of viewers on the same office network should be able to open a browser player or media player and watch the same live stream at the same time.

This chapter is intentionally focused on the HLS delivery path:

- Encode a live video source.
- Package the encoded stream into HLS segments and a manifest.
- Serve HLS through a local cache layer.
- Play the stream from another device on the LAN.
- Trace the full path from source to player.