# OTT Engineering Bootcamp

**Format:** Solo project

---

## Background

You've just joined an engineering team building an OTT([An OTT platform (Over-The-Top platform) is a service that delivers video, audio, or other media content directly over the internet, without requiring traditional cable, satellite, or broadcast TV services.]) platform from scratch. No legacy codebase, no existing infrastructure.

Your tech lead said it plainly on day one:

> *"Start small, prove it works, then think bigger. We'll check in at every milestone."*

Over the coming weeks you'll build a live streaming pipeline, a low-latency monitoring feed, an on-demand video service, ad capabilities, and eventually a cloud-ready architecture.

---

## The Mission

### Chapter 1 — "We Need to Go Live"

The first ask is straightforward: get a live stream running on the office network. A small group of people should be able to open a player and watch at the same time without issues.

Think about what needs to exist between a camera and a viewer's screen, and start building from there.

**A note on how it works:**
- Video must be encoded before it can be streamed — research what that means and what tools are commonly used
- HLS breaks a stream into small segments with a manifest file that players read — understand why
- A local caching layer in front of your stream matters even at small scale — look into why

**Checkpoint:**
- [ ] Live stream plays in a browser or media player on the local network
- [ ] Holds up with several simultaneous viewers
- [ ] You can trace the full path: source → encode → package → cache → player
- [ ] Half-page write-up on the key decisions you made

---

### Chapter 2 — "Ops Needs Their Own Feed"

The operations team needs to monitor a camera feed with as little delay as possible. They're on the local network, there are only two or three of them, and a basic viewer page is all they need. Standard streaming delay won't work here.

**A note on how it works:**
- HLS buffers by design — research why, and what protocols are built for low latency instead
- WebRTC is worth understanding at a high level — how does it differ from a traditional streaming pipeline?
- For a handful of viewers, you don't need scale — you need *speed*

**Checkpoint:**
- [ ] A low-latency stream is accessible on the local network
- [ ] Latency is measurably lower than Chapter 1
- [ ] Basic viewer page works — functionality over aesthetics
- [ ] You can explain why the architecture differs from Chapter 1

---

### Chapter 3 — "Can We Do On-Demand?"

The team wants recorded content available to watch at any time, with a short promotional clip playing before the main video starts. Build a pipeline that packages a video file for on-demand playback and sequences a pre-roll ad before it cleanly.

**A note on how it works:**
- VOD still uses segments and manifests — research how the packaging differs from live
- A pre-roll is the simplest form of ad insertion — look into how two clips can be sequenced in a manifest
- Understand the terms SSAI and CSAI conceptually — you're building neither fully, but knowing the difference matters

**Checkpoint:**
- [ ] A video file is packaged and plays on demand
- [ ] Pre-roll ad plays before the main content with a clean transition
- [ ] You can explain the conceptual difference between SSAI and CSAI

---

### Chapter 4 — "We Want Ads in the Live Stream Too"

Now trigger an ad break mid-stream — while the live feed is running — and have it resume cleanly afterward. A manually triggered swap is a valid approach here. Make it work and be honest about what you had to compromise on.

**A note on how it works:**
- Look up SCTE-35 — understand what it represents even if you won't implement it fully
- Synchronising an ad break across multiple active viewers is harder than it looks — research why
- Think carefully about what "resuming cleanly" means from the player's perspective

**Checkpoint:**
- [ ] Ad break can be triggered in the live stream
- [ ] Live feed resumes after the ad without errors
- [ ] At least two limitations or trade-offs documented

---

### Chapter 5 — "What Happens When We Go Public?"

A question comes up in planning:

> *"If we launched tomorrow and 100,000 people tried to watch — what would break first?"*

No building this chapter. Write a clear-headed document that identifies where your current system falls over and proposes an architecture that could handle that scale.

**A note on how it works:**
- CDNs deliver content from servers near the viewer — research how this changes the delivery architecture
- Origin shielding sits between your origin and the CDN edge — understand the problem it solves
- Cost modelling is part of architecture — look into how bandwidth and compute are typically estimated at streaming scale

**Checkpoint:**
- [ ] Written document identifying at least four bottlenecks in the current system
- [ ] Proposed architecture for 100k users with a diagram
- [ ] Covers CDN strategy, redundancy, and a rough cost model

---

### Chapter 6 — "Let's Do It on AWS" *(Extended Track)*

Rebuild the live streaming workflow using AWS media services instead of running everything yourself. The goal is to understand how the industry abstracts what you built, what you gain, and what you give up.

By the end, you should be able to map every AWS service back to a component you built in Chapter 1.

**A note on how it works:**
- Explore the AWS media services suite — understand what each service does before touching any config
- MediaLive, MediaPackage, and CloudFront each map to something you've already built
- Managed services hide complexity — knowing what's happening underneath makes you a better user of them

**Checkpoint:**
- [ ] Live stream delivered end-to-end through AWS media services
- [ ] VOD asset generated from the recording and playable
- [ ] Mapping document: each AWS service linked to its Chapter 1 equivalent

---

## A Note on How to Work

You will get stuck. That's part of the design.

Spend real time with documentation before reaching for a tutorial. When you're genuinely blocked after a solid attempt, ask.

At every checkpoint the question is always the same: *"Can you explain why you built it this way?"*

---

*Go build something real.*
