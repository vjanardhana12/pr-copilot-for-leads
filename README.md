# PR Copilot for Leads

**AI review cockpit that lets Dynamics 365 F&O dev leads approve, reject, or comment on pull requests from their phone in seconds.**

> Microsoft Global Hackathon 2026 project.
> **Created by Vinod Kumar K J (AIBS) — <vjanardhana@microsoft.com>. © 2026. All rights reserved.**

## The problem

Reviewing pull requests in Azure DevOps is slow on desktop and nearly impossible on mobile — the cramped ADO window makes real code review, rebase checks, and label validation unworkable. Reviews get delayed or rushed, and quality slips.

## What it does

**PR Copilot for Leads** is a mobile-first AI review cockpit for Dynamics 365 Finance & Operations engineering leads. It pulls every active pull request assigned to a lead and does the heavy lifting first — so the lead approves, rejects, or comments in **seconds, from their phone**.

- **AI PR summary** — reads the diff and explains *what changed* and *how risky it is* (🟢 low / 🟡 medium / 🔴 high).
- **Clean diff** — hides noise (whitespace, generated and metadata files) and surfaces only meaningful changes, readable on a phone.
- **Automated prechecks** — build & best-practice status, correct labels, and whether the branch needs a rebase — shown as simple red/green.
- **One-tap actions** — Approve, Reject, or send an **AI-drafted comment** for the developer to address.

## Architecture

```
Mobile app (installable PWA / responsive shell)
        │  REST
        ▼
Backend service ──► Azure DevOps REST API (PRs, diffs, policies, labels, rebase status)
        │
        ├──► Azure OpenAI: summarize diff, risk score, draft comments, validate labels
        └──► Prechecks: build / best-practice status, rebase-behind count, label rules
```

## Tech stack

- Mobile-first, touch-first UI (installable PWA / responsive shell), one primary action per screen.
- Azure DevOps REST API for PRs, diffs, policies, labels, and rebase status.
- Azure OpenAI for diff summarization, risk scoring, and comment drafting.

## Responsible AI

The AI *recommends*; the lead always makes the final call. Every verdict shows its reasoning, and AI-drafted comments are fully editable before sending. Runs against non-production projects; no secrets stored in the app.

## Team

- Vinod Kumar K J — lead
- _(developer 2)_
- _(developer 3)_

## Status

Early / hackathon build. See [ROADMAP](ROADMAP.md) *(coming soon)*.

## License

TBD.
